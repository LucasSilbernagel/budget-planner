/**
 * Naming and reverting a permanently refused sync edit (story 75.2, FR119).
 *
 * The end-to-end proof is `components/sync/__tests__/refused-edit-notice.db.test.tsx`
 * (real server, real engine). This file pins the rules that are awkward to
 * reach through the chain: grouping per row, name resolution and its
 * fallbacks, an op queued AFTER 75.1's D1 swept the queue, and one re-pull per
 * sync.
 */

import type { ServerChange, SyncOperation } from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addRefusalNotices,
  dismissAllRefusalNotices,
  dismissRefusalNotice,
  getRefusalNotices,
} from '../refusalNoticeStore'
import {
  type RefusalHandlerDeps,
  describeRefusedRow,
  handleRejectedOperations,
} from '../refusedEdits'

let seq = 0
function op(overrides: Partial<SyncOperation>): SyncOperation {
  seq++
  return {
    id: `op-${seq}`,
    type: 'update',
    entityType: 'expense',
    entityId: 'row-1',
    data: { userId: 'u', name: 'Rent' },
    timestamp: 1000 + seq,
    deviceId: 'd',
    userId: 'u',
    ...overrides,
  } as SyncOperation
}

function deps(overrides: Partial<RefusalHandlerDeps> = {}) {
  const queued: SyncOperation[] = []
  const applied: ServerChange[][] = []
  const base: RefusalHandlerDeps & { queued: SyncOperation[]; applied: ServerChange[][] } = {
    queued,
    applied,
    queue: {
      getAll: () => [...queued],
      removeBatch: vi.fn(async (ids: string[]) => {
        for (let i = queued.length - 1; i >= 0; i--) {
          if (ids.includes((queued[i] as SyncOperation).id)) queued.splice(i, 1)
        }
      }),
    },
    applyChanges: vi.fn((changes: ServerChange[]) => {
      applied.push(changes)
    }),
    lookupLocalRow: vi.fn(() => undefined),
    requestFullRepull: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  }
  return base
}

describe('describeRefusedRow — naming a refused row', () => {
  it("uses the newest op's non-blank name, and the kind the user knows", () => {
    const notice = describeRefusedRow(
      [op({ data: { name: 'Old' }, timestamp: 1 }), op({ data: { name: 'New' }, timestamp: 2 })],
      undefined
    )
    expect(notice).toMatchObject({
      key: 'expense:row-1',
      name: 'New',
      kind: 'expense',
      outcome: 'changed-back',
    })
  })

  it('treats a whitespace-only name as ABSENT and falls back (63.2 defect)', () => {
    const notice = describeRefusedRow([op({ data: { name: '   ' } })], { name: '\t' })
    expect(notice.name).toBeNull()
    expect(notice.fallback).toBe('An expense')
  })

  it('a delete carries no name — the local row supplies it when it is still there', () => {
    const notice = describeRefusedRow([op({ type: 'delete', data: { userId: 'u' } })], {
      name: 'Rent',
    })
    expect(notice).toMatchObject({ name: 'Rent', outcome: 'restored' })
  })

  it('a create in the group makes it "removed", even with follow-ups', () => {
    const notice = describeRefusedRow([op({ type: 'create' }), op({ type: 'delete' })], undefined)
    expect(notice.outcome).toBe('removed')
  })

  it('names a balance entry as an investment or a debt, from the op or the local row', () => {
    expect(
      describeRefusedRow([op({ entityType: 'balanceTracking', data: { type: 'debt' } })], undefined)
        .kind
    ).toBe('debt')
    expect(
      describeRefusedRow([op({ entityType: 'balanceTracking', type: 'delete', data: {} })], {
        type: 'investment',
      }).fallback
    ).toBe('An investment')
    expect(
      describeRefusedRow([op({ entityType: 'balanceTracking', data: {} })], undefined).kind
    ).toBe('balance')
  })

  it.each([
    ['incomeSource', 'income', 'An income entry'],
    ['savingsGoal', 'savings', 'A savings entry'],
    ['userProfile', 'profile', 'A profile'],
    ['category', 'category', 'A category'],
  ] as const)('%s → %s / %s', (entityType, kind, fallback) => {
    const notice = describeRefusedRow([op({ entityType, data: {} })], undefined)
    expect(notice).toMatchObject({ kind, fallback, name: null })
  })
})

describe('handleRejectedOperations — reverting', () => {
  beforeEach(() => {
    dismissAllRefusalNotices()
  })

  it('ONE notice per row, even when a create arrives with its follow-ups', async () => {
    const d = deps()
    await handleRejectedOperations(
      [op({ type: 'create' }), op({}), op({ entityId: 'row-2', data: { name: 'Gym' } })],
      d
    )
    const notices = (d.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(notices.map((n: { key: string }) => n.key)).toEqual(['expense:row-1', 'expense:row-2'])
  })

  it('a refused create: drops ops for the row still queued, then removes it with a TOMBSTONE', async () => {
    const d = deps()
    // Queued after 75.1's D1 swept the queue — e.g. an edit made mid-push.
    d.queued.push(op({ id: 'late', entityId: 'row-1' }), op({ id: 'other', entityId: 'row-9' }))

    await handleRejectedOperations([op({ type: 'create' })], d)

    expect(d.queued.map((o) => o.id)).toEqual(['other'])
    expect(d.applied).toEqual([
      [
        expect.objectContaining({
          entityType: 'expense',
          entityId: 'row-1',
          isDeleted: true,
        }),
      ],
    ])
    expect(d.requestFullRepull).not.toHaveBeenCalled()
  })

  it('names a refused create from the local row BEFORE the tombstone removes it', async () => {
    let rowPresent = true
    const d = deps({
      lookupLocalRow: vi.fn(() => (rowPresent ? { name: 'Local name' } : undefined)),
      applyChanges: vi.fn(() => {
        rowPresent = false
      }),
    })
    await handleRejectedOperations([op({ type: 'create', data: {} })], d)
    const notices = (d.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? []
    expect(notices[0]?.name).toBe('Local name')
  })

  it('refused updates and deletes: ONE full re-pull for the whole sync, no tombstone', async () => {
    const d = deps()
    await handleRejectedOperations(
      [op({}), op({ entityId: 'row-2' }), op({ type: 'delete', entityId: 'row-3' })],
      d
    )
    expect(d.requestFullRepull).toHaveBeenCalledTimes(1)
    expect(d.applyChanges).not.toHaveBeenCalled()
  })

  it('one row that cannot be read gets a fallback notice, and the other rows are still handled', async () => {
    const d = deps({
      lookupLocalRow: vi.fn((_type, id: string) => {
        if (id === 'row-bad') throw new Error('corrupt store')
        return undefined
      }),
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await handleRejectedOperations(
      [op({ entityId: 'row-bad', data: {} }), op({ entityId: 'row-2', data: { name: 'Gym' } })],
      d
    )
    error.mockRestore()
    const notices = (d.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? []
    expect(notices.map((n: { key: string; name: string | null }) => [n.key, n.name])).toEqual([
      ['expense:row-bad', null],
      ['expense:row-2', 'Gym'],
    ])
    expect(d.requestFullRepull).toHaveBeenCalledTimes(1)
  })

  it('a throwing re-pull request does not swallow the notices', async () => {
    const d = deps({
      requestFullRepull: vi.fn(() => {
        throw new Error('service gone')
      }),
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await handleRejectedOperations([op({})], d)
    error.mockRestore()
    expect(d.notify).toHaveBeenCalledTimes(1)
  })

  it('a failing queue removal does not stop the revert or the notice', async () => {
    const d = deps()
    d.queued.push(op({ id: 'late' }))
    d.queue.removeBatch = vi.fn(async () => {
      throw new Error('QuotaExceededError')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await handleRejectedOperations([op({ type: 'create' })], d)
    error.mockRestore()
    expect(d.applyChanges).toHaveBeenCalledTimes(1)
    expect(d.notify).toHaveBeenCalledTimes(1)
  })
})

describe('refusalNoticeStore', () => {
  beforeEach(() => {
    dismissAllRefusalNotices()
  })

  const notice = (key: string) => ({
    key,
    entityType: 'expense' as const,
    name: 'Rent',
    kind: 'expense',
    fallback: 'An expense',
    outcome: 'changed-back' as const,
  })

  it('shows a row once: a notice already on screen is not added again', () => {
    addRefusalNotices([notice('a'), notice('a')])
    addRefusalNotices([notice('a'), notice('b')])
    expect(getRefusalNotices().map((n) => n.key)).toEqual(['a', 'b'])
  })

  it('a later refusal of the same row with a DIFFERENT outcome replaces it, moved to the end', () => {
    addRefusalNotices([notice('a'), notice('b')])
    addRefusalNotices([{ ...notice('a'), outcome: 'restored' }])
    expect(getRefusalNotices().map((n) => [n.key, n.outcome])).toEqual([
      ['b', 'changed-back'],
      ['a', 'restored'],
    ])
  })

  it('dismissing empties it — nothing is kept, so it cannot grow for the session', () => {
    addRefusalNotices([notice('a'), notice('b')])
    dismissRefusalNotice('a')
    expect(getRefusalNotices().map((n) => n.key)).toEqual(['b'])
    dismissAllRefusalNotices()
    expect(getRefusalNotices()).toEqual([])
  })
})
