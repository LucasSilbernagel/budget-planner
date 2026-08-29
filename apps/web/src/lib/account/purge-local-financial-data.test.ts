/**
 * purgeLocalFinancialData tests (Story 10-5, AC-5 — code-review patch)
 *
 * Verifies the on-erasure local cleanup:
 *  - all SEVEN financial Zustand stores are reset + their persisted storage cleared
 *    (categories joined the set in Story 30.4a; the retirement plan in Story 44.1);
 *
 *    ⚠️ EVERY STORE THE UTIL TOUCHES MUST BE MOCKED HERE, and not only for
 *    isolation: an unmocked import runs the REAL store inside an otherwise fully
 *    mocked suite, and — worse — nothing then asserts it was purged at all. Story
 *    44.1 added the retirement plan to the util and this file was not updated, so
 *    deleting that purge left every suite green (found in code review);
 *  - the durable paid-tier sync queue (`bp-sync-queue-<userId>`) is cleared too —
 *    it holds raw financial SyncOperation payloads that would otherwise survive
 *    erasure (the review's HIGH finding);
 *  - the util is best-effort: a throw in one store does NOT abort the rest or the
 *    queue clear, and the util never rejects (it runs after the server already
 *    irreversibly deleted the account).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  incomeSetState: vi.fn(),
  incomeClear: vi.fn(),
  expenseSetState: vi.fn(),
  expenseClear: vi.fn(),
  savingsSetState: vi.fn(),
  savingsClear: vi.fn(),
  profileReset: vi.fn(),
  profileClear: vi.fn(),
  balanceReset: vi.fn(),
  balanceClear: vi.fn(),
  categoryReset: vi.fn(),
  categoryClear: vi.fn(),
  retirementPlanReset: vi.fn(),
  retirementPlanClear: vi.fn(),
  queueClear: vi.fn().mockResolvedValue(undefined),
  createSyncQueue: vi.fn(),
}))

vi.mock('@/stores/retirementPlannerStore', () => ({
  useRetirementPlannerStore: {
    getState: () => ({ resetPlan: h.retirementPlanReset }),
    persist: { clearStorage: h.retirementPlanClear },
  },
}))

vi.mock('@/stores/incomeStore', () => ({
  useIncomeStore: { setState: h.incomeSetState, persist: { clearStorage: h.incomeClear } },
}))
vi.mock('@/stores/expenseStore', () => ({
  useExpenseStore: { setState: h.expenseSetState, persist: { clearStorage: h.expenseClear } },
}))
vi.mock('@/stores/savingsStore', () => ({
  useSavingsStore: { setState: h.savingsSetState, persist: { clearStorage: h.savingsClear } },
}))
vi.mock('@/stores/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ reset: h.profileReset }),
    persist: { clearStorage: h.profileClear },
  },
}))
vi.mock('@/stores/balanceStore', () => ({
  useBalanceStore: {
    getState: () => ({ reset: h.balanceReset }),
    persist: { clearStorage: h.balanceClear },
  },
}))
vi.mock('@/stores/categoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ reset: h.categoryReset }),
    persist: { clearStorage: h.categoryClear },
  },
}))
vi.mock('@budget-planner/core/sync', () => ({ createSyncQueue: h.createSyncQueue }))

import { purgeLocalFinancialData } from './purge-local-financial-data'

beforeEach(() => {
  vi.clearAllMocks()
  h.queueClear.mockResolvedValue(undefined)
  h.createSyncQueue.mockReturnValue({ clear: h.queueClear })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('purgeLocalFinancialData', () => {
  it('resets + clears all seven financial stores and the user-scoped sync queue', async () => {
    await purgeLocalFinancialData('user-9')

    expect(h.incomeSetState).toHaveBeenCalledWith({ incomeSources: [] })
    expect(h.incomeClear).toHaveBeenCalledTimes(1)
    expect(h.expenseSetState).toHaveBeenCalledWith({ expenses: [] })
    expect(h.expenseClear).toHaveBeenCalledTimes(1)
    expect(h.savingsSetState).toHaveBeenCalledWith({ savingsGoals: [] })
    expect(h.savingsClear).toHaveBeenCalledTimes(1)
    expect(h.profileReset).toHaveBeenCalledTimes(1)
    expect(h.profileClear).toHaveBeenCalledTimes(1)
    // Story 30.4a: categories are user-authored financial metadata, so they are
    // purged with the rows they categorize — not kept like a display preference.
    expect(h.categoryReset).toHaveBeenCalledTimes(1)
    expect(h.categoryClear).toHaveBeenCalledTimes(1)
    expect(h.balanceReset).toHaveBeenCalledTimes(1)
    expect(h.balanceClear).toHaveBeenCalledTimes(1)
    // Story 44.1: the retirement plan holds the user's age, life expectancy and
    // the income they hope to retire on — personal financial data, so it is
    // purged, unlike the table sort (a display preference) which deliberately is
    // not. "Clear local data" that left someone's retirement income behind would
    // not have cleared their local data.
    expect(h.retirementPlanReset).toHaveBeenCalledTimes(1)
    expect(h.retirementPlanClear).toHaveBeenCalledTimes(1)

    // The durable financial queue must be cleared for THIS user (AC-5 gap fix).
    expect(h.createSyncQueue).toHaveBeenCalledWith('user-9')
    expect(h.queueClear).toHaveBeenCalledTimes(1)
  })

  it('is best-effort: a throwing store does not abort the rest or the queue clear, and never rejects', async () => {
    h.incomeClear.mockImplementationOnce(() => {
      throw new Error('localStorage disabled (private mode)')
    })

    await expect(purgeLocalFinancialData('user-9')).resolves.toBeUndefined()

    // Later stores still cleared despite the early throw.
    expect(h.balanceReset).toHaveBeenCalledTimes(1)
    expect(h.balanceClear).toHaveBeenCalledTimes(1)
    // And the queue clear still ran.
    expect(h.queueClear).toHaveBeenCalledTimes(1)
  })

  it('never rejects even if the sync-queue clear itself fails', async () => {
    h.queueClear.mockRejectedValueOnce(new Error('storage error'))
    await expect(purgeLocalFinancialData('user-9')).resolves.toBeUndefined()
  })

  // Story 17-2: the same purge now backs the all-users "Clear local data" control.
  // Free / unauthenticated users have NO userId and NO sync queue, so the queue
  // step must be skipped rather than build a bogus `bp-sync-queue-undefined` key.
  it('with no userId resets all five stores but does NOT touch the sync queue', async () => {
    await purgeLocalFinancialData()

    expect(h.incomeSetState).toHaveBeenCalledWith({ incomeSources: [] })
    expect(h.incomeClear).toHaveBeenCalledTimes(1)
    expect(h.expenseSetState).toHaveBeenCalledWith({ expenses: [] })
    expect(h.expenseClear).toHaveBeenCalledTimes(1)
    expect(h.savingsSetState).toHaveBeenCalledWith({ savingsGoals: [] })
    expect(h.savingsClear).toHaveBeenCalledTimes(1)
    expect(h.profileReset).toHaveBeenCalledTimes(1)
    expect(h.profileClear).toHaveBeenCalledTimes(1)
    expect(h.balanceReset).toHaveBeenCalledTimes(1)
    expect(h.balanceClear).toHaveBeenCalledTimes(1)

    // No session → no per-user queue → createSyncQueue must never be called.
    expect(h.createSyncQueue).not.toHaveBeenCalled()
    expect(h.queueClear).not.toHaveBeenCalled()
  })

  it('with an empty-string userId also skips the sync queue', async () => {
    await purgeLocalFinancialData('')
    expect(h.incomeClear).toHaveBeenCalledTimes(1)
    expect(h.createSyncQueue).not.toHaveBeenCalled()
  })
})
