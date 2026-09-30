// @vitest-environment jsdom
// jsdom supplies `localStorage`, which core's sync queue persists to. The
// default `node` environment has none, on every Node (`src/test/webstorage.ts`).
/**
 * A malformed server row cannot cost the user a local edit (story 75.4, FR123),
 * driven through the web chain exactly as `hooks/useSync.ts` wires it.
 *
 * Before this story core dropped the queued local op when the server row won
 * last-writer-wins, and only THEN handed the row to `applyServerChangesToStores`,
 * which refused it. The store kept the local value, the op that would have
 * pushed it was gone, and the two devices disagreed for good. MEASURED red at
 * `6331ba5` with a copy of this file stripped of the story's NEW API (the
 * `onServerChangesRefused` wiring and the `result.refused` assertion), because
 * this file as written throws a TypeError on `6331ba5` before reaching the
 * mechanism: `expected [] to deeply equal [ 'update' ]`, meaning the queue was
 * empty. The control passed on `6331ba5` too.
 */

import { createSynchronizationService } from '@budget-planner/core/sync'
import type { ServerChange, SynchronizationService } from '@budget-planner/core/sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIncomeStore } from '../../../stores/incomeStore'
import { applyServerChangesToStores, reportRefusedServerChanges } from '../applyServerChanges'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '22222222-2222-4222-8222-222222222222'
const INCOME_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ISO = '2026-09-01T00:00:00.000Z'

const LOCAL_ROW = {
  id: INCOME_X,
  userId: USER_ID,
  profileId: PROFILE_ID,
  name: 'Salary (edited here)',
  amount: 610_000,
  frequency: 'monthly',
  sortOrder: 0,
  createdAt: ISO,
  updatedAt: ISO,
}

function serverRow(amount: unknown): ServerChange {
  return {
    entityType: 'incomeSource',
    entityId: INCOME_X,
    data: {
      id: INCOME_X,
      userId: USER_ID,
      profileId: PROFILE_ID,
      name: 'Salary',
      amount,
      frequency: 'monthly',
      categoryId: null,
      sortOrder: 0,
      isDeleted: false,
      createdAt: ISO,
      updatedAt: ISO,
    },
    updatedAt: 2_000,
    isDeleted: false,
  }
}

describe('story 75.4: a malformed server row does not discard the local edit (web chain)', () => {
  let service: SynchronizationService
  let fetchServerChanges: ReturnType<typeof vi.fn>
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.useFakeTimers()
    useIncomeStore.setState({ incomeSources: [LOCAL_ROW] as any })
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchServerChanges = vi.fn()
    service = createSynchronizationService(USER_ID, {
      autoSync: false,
      debug: false,
      processOperation: async () => ({ success: true }),
      fetchServerChanges,
    })
    // Exactly the wiring `hooks/useSync.ts` performs.
    service.onChangesPulled((changes) => applyServerChangesToStores(changes))
    service.onServerChangesRefused(reportRefusedServerChanges)
    // The recorded repro's local edit: an update at t=1000, no baseVersion.
    vi.setSystemTime(1_000)
    await service.queueUpdate(
      'incomeSource',
      INCOME_X,
      { name: LOCAL_ROW.name, amount: LOCAL_ROW.amount },
      USER_ID
    )
  })

  afterEach(() => {
    service.destroy()
    warn.mockRestore()
    vi.useRealTimers()
  })

  const queuedFor = (id: string) =>
    service
      .getQueue()
      .getAll()
      .filter((op) => op.entityId === id)
      .map((op) => op.type)

  it('keeps the queued edit AND the local value when the server row has a STRING amount', async () => {
    fetchServerChanges.mockResolvedValueOnce([serverRow('500000')])

    const result = await service.pull()

    // Positive anchors: the pull ran and moved past the refused row.
    expect(fetchServerChanges).toHaveBeenCalledTimes(1)
    expect(result.lastPullTimestamp).toBe(2_000)
    expect(result.refused.map((r) => r.entityId)).toEqual([INCOME_X])

    expect(queuedFor(INCOME_X)).toEqual(['update'])
    expect(useIncomeStore.getState().incomeSources).toEqual([LOCAL_ROW])
    expect(service.getState().conflictOperations).toEqual([])

    // Reported once, through the one reporter, without the value.
    expect(warn).toHaveBeenCalledTimes(1)
    const [message, context] = warn.mock.calls[0] ?? []
    expect(String(message)).toContain('refused a malformed server row')
    expect(context).toEqual({
      entityType: 'incomeSource',
      entityId: INCOME_X,
      fields: ['amount:invalid_type'],
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('500000')
  })

  it('CONTROL: a VALID newer server row still wins, replacing the local value and the edit', async () => {
    fetchServerChanges.mockResolvedValueOnce([serverRow(500_000)])

    const result = await service.pull()

    expect(result.applied).toHaveLength(1)
    expect(queuedFor(INCOME_X)).toEqual([])
    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amount).toBe(500_000)
    expect(service.getState().conflictOperations).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })
})
