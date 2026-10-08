import type { SyncOperation } from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type RefusalNotice,
  addRefusalNotices,
  dismissAllRefusalNotices,
  dismissRefusalNotice,
  getRefusalNotices,
  reconcileNotSyncedNotices,
  resetRefusalNotices,
} from '../refusalNoticeStore'
import { describeNotSyncedRow, describeNotSyncedRows } from '../refusedEdits'

function op(overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id: 'op-1',
    type: 'update',
    entityType: 'expense',
    entityId: 'row-1',
    data: { name: 'Rent' },
    timestamp: 1_000,
    deviceId: 'device',
    userId: 'user',
    ...overrides,
  }
}

function notSynced(key: string, name = 'Rent'): RefusalNotice {
  return {
    key,
    entityType: 'expense',
    name,
    kind: 'expense',
    fallback: 'An expense',
    outcome: 'not-synced',
    change: 'update',
  }
}

const keysAndOutcomes = () => getRefusalNotices().map((n) => `${n.key}=${n.outcome}`)

beforeEach(() => {
  resetRefusalNotices()
})

describe('describeNotSyncedRow — naming a row whose edit keeps failing', () => {
  it('names it exactly as a refusal is named, with the not-synced outcome', () => {
    expect(describeNotSyncedRow([op()], undefined)).toEqual({
      key: 'expense:row-1',
      entityType: 'expense',
      name: 'Rent',
      kind: 'expense',
      fallback: 'An expense',
      outcome: 'not-synced',
      change: 'update',
    })
  })

  it("says what is pending from the device's side: a delete wins over a create, a create over an update", () => {
    // Created then deleted: already gone here, so it is a pending delete.
    expect(
      describeNotSyncedRow([op({ type: 'create' }), op({ type: 'delete' })], undefined).change
    ).toBe('delete')
    expect(describeNotSyncedRow([op(), op({ type: 'delete' })], undefined).change).toBe('delete')
    expect(describeNotSyncedRow([op(), op({ type: 'create' })], undefined).change).toBe('create')
    expect(describeNotSyncedRow([op()], undefined).change).toBe('update')
  })

  it('a delete has no name in its data: the local row supplies it', () => {
    const notice = describeNotSyncedRow([op({ type: 'delete', data: {} })], { name: 'Gym' })
    expect(notice.name).toBe('Gym')
  })

  it('groups escalated ops ONE notice per row, and survives an unreadable row', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const notices = describeNotSyncedRows(
      [
        op({ id: 'a' }),
        op({ id: 'b', data: { name: 'Rent 2' }, timestamp: 2_000 }),
        op({ id: 'c', entityId: 'row-2', data: {} }),
      ],
      (_entityType, id) => {
        if (id === 'row-2') throw new Error('store unavailable')
        return 
      }
    )

    expect(notices.map((n) => [n.key, n.name])).toEqual([
      ['expense:row-1', 'Rent 2'],
      ['expense:row-2', null],
    ])
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})

describe('reconcileNotSyncedNotices', () => {
  it('adds a notice for an escalated row, once', () => {
    reconcileNotSyncedNotices([notSynced('expense:row-1')])
    const first = getRefusalNotices()
    reconcileNotSyncedNotices([notSynced('expense:row-1')])

    expect(keysAndOutcomes()).toEqual(['expense:row-1=not-synced'])
    // Same array, so no re-render.
    expect(getRefusalNotices()).toBe(first)
  })

  it('rewrites an on-screen not-synced notice in place when its wording changed', () => {
    reconcileNotSyncedNotices([notSynced('expense:row-1'), notSynced('expense:row-2', 'Gym')])
    reconcileNotSyncedNotices([
      { ...notSynced('expense:row-1', 'Rent (flat)'), change: 'delete' },
      notSynced('expense:row-2', 'Gym'),
    ])

    const notices = getRefusalNotices()
    expect(notices.map((n) => [n.key, n.name, n.change])).toEqual([
      ['expense:row-1', 'Rent (flat)', 'delete'],
      ['expense:row-2', 'Gym', 'update'],
    ])
  })

  it('clears a notice by itself once its row is no longer escalated', () => {
    reconcileNotSyncedNotices([notSynced('expense:row-1'), notSynced('expense:row-2')])
    reconcileNotSyncedNotices([notSynced('expense:row-2')])

    expect(keysAndOutcomes()).toEqual(['expense:row-2=not-synced'])
  })

  it('never removes or replaces a REFUSAL notice, even for the same row', () => {
    addRefusalNotices([{ ...notSynced('expense:row-1'), outcome: 'changed-back' }])
    addRefusalNotices([{ ...notSynced('expense:row-9'), outcome: 'removed' }])

    reconcileNotSyncedNotices([notSynced('expense:row-1')])
    expect(keysAndOutcomes()).toEqual(['expense:row-1=changed-back', 'expense:row-9=removed'])

    reconcileNotSyncedNotices([])
    expect(keysAndOutcomes()).toEqual(['expense:row-1=changed-back', 'expense:row-9=removed'])
  })

  it('a later refusal of the row replaces its not-synced notice (75.2 replace rule)', () => {
    reconcileNotSyncedNotices([notSynced('expense:row-1')])
    addRefusalNotices([{ ...notSynced('expense:row-1'), outcome: 'changed-back' }])

    expect(keysAndOutcomes()).toEqual(['expense:row-1=changed-back'])
  })

  it('a dismissed notice stays dismissed while the row stays escalated', () => {
    reconcileNotSyncedNotices([notSynced('expense:row-1')])
    expect(keysAndOutcomes()).toEqual(['expense:row-1=not-synced'])

    dismissRefusalNotice('expense:row-1')
    reconcileNotSyncedNotices([notSynced('expense:row-1')])
    reconcileNotSyncedNotices([notSynced('expense:row-1')])

    expect(getRefusalNotices()).toEqual([])
  })

  it('"Dismiss all" keeps every not-synced notice dismissed too', () => {
    reconcileNotSyncedNotices([notSynced('expense:row-1'), notSynced('expense:row-2')])
    dismissAllRefusalNotices()
    reconcileNotSyncedNotices([notSynced('expense:row-1'), notSynced('expense:row-2')])

    expect(getRefusalNotices()).toEqual([])
  })

  it('forgets a dismissal once the row stops being escalated, so a NEW escalation shows again', () => {
    reconcileNotSyncedNotices([notSynced('expense:row-1')])
    dismissRefusalNotice('expense:row-1')
    reconcileNotSyncedNotices([])
    reconcileNotSyncedNotices([notSynced('expense:row-1')])

    expect(keysAndOutcomes()).toEqual(['expense:row-1=not-synced'])
  })

  it('dismissing a REFUSAL records nothing: a later not-synced notice for that row shows', () => {
    addRefusalNotices([{ ...notSynced('expense:row-1'), outcome: 'changed-back' }])
    dismissRefusalNotice('expense:row-1')
    reconcileNotSyncedNotices([notSynced('expense:row-1')])

    expect(keysAndOutcomes()).toEqual(['expense:row-1=not-synced'])
  })

  it('the teardown reset forgets every notice AND every dismissal', () => {
    reconcileNotSyncedNotices([notSynced('expense:row-1'), notSynced('expense:row-2')])
    dismissRefusalNotice('expense:row-1')

    resetRefusalNotices()
    expect(getRefusalNotices()).toEqual([])

    reconcileNotSyncedNotices([notSynced('expense:row-1')])
    expect(keysAndOutcomes()).toEqual(['expense:row-1=not-synced'])
  })
})
