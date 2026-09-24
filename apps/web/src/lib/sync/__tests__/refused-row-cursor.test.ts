/**
 * What the pull cursor does when a row is REFUSED (Story 66.2, AC-4).
 *
 * ## The decision this pins, and why it is a decision at all
 *
 * ⚠️⚠️ The cursor is persisted BEFORE the web layer ever sees the rows.
 * `SynchronizationService.pull()` sets `this.state.lastPullTimestamp = newCursor`
 * and only THEN calls `notifyChangesPulledCallbacks(applied)`. `ChangesPulledCallback`
 * returns `void` and its throw is swallowed. So `applyServerChanges.ts` — which
 * is where this story's guard lives, and where the epic put it — structurally
 * CANNOT hold the cursor back. This test records that as observed behaviour
 * rather than leaving it to be rediscovered.
 *
 * Two options existed and the smaller diff is not self-evidently right:
 *
 *   (A) ADVANCE — CHOSEN. A validation failure is not transient: a row that is
 *       malformed today is malformed on every future pull. Holding the cursor
 *       below it would re-fetch the same poison row forever AND block every
 *       later change behind it, because the server's filter is
 *       `updatedAt > cursor`. One bad row would become a permanent, total sync
 *       stall. Advancing keeps a one-row problem a one-row problem.
 *   (B) HOLD — rejected. It needs validation moved into core's `pull()` so a
 *       refused change can join the `earliestSuppressed` set (`synchronization.ts`),
 *       which changes `applied`/`PullResult` semantics and the conflict contract,
 *       and it buys the stall above.
 *
 * ⚠️ The cost of (A) is real and is NOT hidden: within a session the refused row
 * is skipped by every subsequent poll.
 *
 * ⚠️⚠️ But "this device will never see it again" would be WRONG, and the story
 * said so before its code review corrected it. `lastPullTimestamp` lives in
 * `SynchronizationService`'s in-memory state — `synchronization.ts` initialises
 * it to `null` and never persists it — and `hooks/useSync.ts` builds a fresh
 * service per mount. So a page RELOAD pulls from `since = null`, re-fetches the
 * whole snapshot, and re-refuses (and re-warns about) the same row. The same
 * happens on a profile switch, which calls `resetPullCursor()` explicitly. The
 * row is skipped for the rest of the session, not forgotten forever.
 *
 * ⚠️ Either way the user is never told, which is why the refusal is at least
 * reported to the developer (see `server-row-validation.test.ts`).
 *
 * ⚠️ `earliestSuppressed` is NOT this mechanism. It exists for a change
 * suppressed by a still-queued LOCAL edit — a conflict that RESOLVES once the
 * local op pushes. A malformed row never resolves, which is exactly why reusing
 * that path would be wrong.
 */

import { createSynchronizationService } from '@budget-planner/core/sync'
import type { ServerChange, SynchronizationService } from '@budget-planner/core/sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIncomeStore } from '../../../stores/incomeStore'
import { applyServerChangesToStores } from '../applyServerChanges'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '22222222-2222-4222-8222-222222222222'
const GOOD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ISO = '2026-09-01T00:00:00.000Z'

function incomeChange(id: string, amount: unknown, updatedAt: number): ServerChange {
  return {
    entityType: 'incomeSource',
    entityId: id,
    data: {
      id,
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
    updatedAt,
    isDeleted: false,
  }
}

describe('AC-4: the pull cursor when a row is refused', () => {
  let service: SynchronizationService
  let fetchServerChanges: ReturnType<typeof vi.fn>
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
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
  })

  afterEach(() => {
    warn.mockRestore()
    service.destroy()
  })

  it('advances PAST a refused row, so one bad row cannot stall the whole sync', async () => {
    fetchServerChanges.mockResolvedValue([incomeChange(BAD_ID, '500000', 1500)])

    const result = await service.pull()

    // Core applied it (core does not validate); the web layer refused to write it.
    expect(result.success).toBe(true)
    expect(result.conflicts).toEqual([])
    expect(result.lastPullTimestamp).toBe(1500)
    expect(service.getState().lastPullTimestamp).toBe(1500)
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('the next pull asks from the ADVANCED cursor — the poison row is not re-fetched', async () => {
    fetchServerChanges.mockResolvedValueOnce([incomeChange(BAD_ID, '500000', 1500)])
    await service.pull()

    fetchServerChanges.mockResolvedValueOnce([])
    await service.pull()

    expect(fetchServerChanges).toHaveBeenNthCalledWith(1, null)
    // ⚠️ THE POINT: 1500, not null. The refused row is behind the cursor now.
    expect(fetchServerChanges).toHaveBeenNthCalledWith(2, 1500)
  })

  it('a LATER valid row still lands — the refusal does not block what follows it', async () => {
    fetchServerChanges.mockResolvedValueOnce([
      incomeChange(BAD_ID, '500000', 1500),
      incomeChange(GOOD_ID, 500_000, 1600),
    ])

    await service.pull()

    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(GOOD_ID)
    expect(service.getState().lastPullTimestamp).toBe(1600)
  })

  it('a refused row is NOT reported as a conflict — the two are different things', async () => {
    // A conflict is a server change suppressed by a still-queued local edit, and
    // it RESOLVES when that edit pushes. A malformed row never resolves. Counting
    // one as the other would hold the cursor (via `earliestSuppressed`) and stall
    // sync permanently — the exact outcome option (A) exists to avoid.
    const conflicts: unknown[] = []
    service.onConflict((c) => conflicts.push(c))
    fetchServerChanges.mockResolvedValue([incomeChange(BAD_ID, '500000', 1500)])

    const result = await service.pull()

    expect(result.conflicts).toEqual([])
    expect(conflicts).toEqual([])
    expect(service.getState().conflictOperations).toEqual([])
  })

  it('⚠️ a RELOAD re-fetches the refused row — the skip is per-session, not permanent', async () => {
    fetchServerChanges.mockResolvedValueOnce([incomeChange(BAD_ID, '500000', 1500)])
    await service.pull()
    expect(service.getState().lastPullTimestamp).toBe(1500)

    // A reload is a NEW service: `lastPullTimestamp` is in-memory only.
    const reloaded = createSynchronizationService(USER_ID, {
      autoSync: false,
      debug: false,
      processOperation: async () => ({ success: true }),
      fetchServerChanges,
    })
    try {
      reloaded.onChangesPulled((changes) => applyServerChangesToStores(changes))
      fetchServerChanges.mockResolvedValueOnce([incomeChange(BAD_ID, '500000', 1500)])
      await reloaded.pull()
      // Pulled from scratch, not from 1500 — and refused again.
      expect(fetchServerChanges).toHaveBeenLastCalledWith(null)
      expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
    } finally {
      reloaded.destroy()
    }
  })

  it('CONTROL: a valid row advances the cursor the same way and DOES land', async () => {
    // Without this, "the cursor advanced" would be indistinguishable from "the
    // cursor always advances no matter what", which is the claim under test.
    fetchServerChanges.mockResolvedValue([incomeChange(GOOD_ID, 500_000, 1500)])

    const result = await service.pull()

    expect(result.lastPullTimestamp).toBe(1500)
    expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })
})
