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
 *  - story 86.1: when a live sync service is registered for that user, the queue
 *    is cleared THROUGH it (its in-memory queue would otherwise write the cleared
 *    ops back); the fresh `createSyncQueue` is only the fallback. The end-to-end
 *    proof with a real service is `__tests__/purge-live-queue.test.tsx`.
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
  RETIREMENT_PLANNER_PARKED_KEY_PREFIX: 'budget-planner-retirement-planner-v1:',
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

import { registerSyncPurgeHandle } from '@/lib/sync/purgeHandle'
import {
  type RefusalNotice,
  addRefusalNotices,
  dismissRefusalNotice,
  getRefusalNotices,
  reconcileNotSyncedNotices,
  resetRefusalNotices,
} from '@/lib/sync/refusalNoticeStore'
import { purgeLocalFinancialData } from './purge-local-financial-data'

beforeEach(() => {
  vi.clearAllMocks()
  h.queueClear.mockResolvedValue(undefined)
  h.createSyncQueue.mockReturnValue({ clear: h.queueClear })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
let unregister: (() => void) | null = null
afterEach(() => {
  unregister?.()
  unregister = null
  vi.restoreAllMocks()
})

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

  // Story 86.1 (FR139): the live service's own queue, with the fresh queue as fallback.
  describe('with a live sync service registered (story 86.1)', () => {
    it('clears the queue THROUGH the live service for that user, not a fresh queue', async () => {
      const clearQueue = vi.fn().mockResolvedValue(undefined)
      unregister = registerSyncPurgeHandle({ userId: 'user-9', clearQueue })

      await purgeLocalFinancialData('user-9')

      expect(clearQueue).toHaveBeenCalledTimes(1)
      expect(h.createSyncQueue).not.toHaveBeenCalled()
    })

    it("falls back to a fresh queue when the live service is ANOTHER user's", async () => {
      const clearQueue = vi.fn().mockResolvedValue(undefined)
      unregister = registerSyncPurgeHandle({ userId: 'someone-else', clearQueue })

      await purgeLocalFinancialData('user-9')

      expect(clearQueue).not.toHaveBeenCalled()
      expect(h.createSyncQueue).toHaveBeenCalledWith('user-9')
      expect(h.queueClear).toHaveBeenCalledTimes(1)
    })

    it('falls back to a fresh queue, and never rejects, when the live clear fails (a torn-down service)', async () => {
      const clearQueue = vi.fn().mockRejectedValue(new Error('Sync service destroyed'))
      unregister = registerSyncPurgeHandle({ userId: 'user-9', clearQueue })

      await expect(purgeLocalFinancialData('user-9')).resolves.toBeUndefined()

      expect(clearQueue).toHaveBeenCalledTimes(1)
      expect(h.createSyncQueue).toHaveBeenCalledWith('user-9')
      expect(h.queueClear).toHaveBeenCalledTimes(1)
    })

    it('with no userId never touches the live service', async () => {
      const clearQueue = vi.fn().mockResolvedValue(undefined)
      unregister = registerSyncPurgeHandle({ userId: 'user-9', clearQueue })

      await purgeLocalFinancialData()

      expect(clearQueue).not.toHaveBeenCalled()
      expect(h.createSyncQueue).not.toHaveBeenCalled()
    })

    it('an old registration cannot unregister a newer one', async () => {
      const old = vi.fn().mockResolvedValue(undefined)
      const next = vi.fn().mockResolvedValue(undefined)
      const unregisterOld = registerSyncPurgeHandle({ userId: 'user-9', clearQueue: old })
      unregister = registerSyncPurgeHandle({ userId: 'user-9', clearQueue: next })
      unregisterOld()

      await purgeLocalFinancialData('user-9')

      expect(next).toHaveBeenCalledTimes(1)
      expect(old).not.toHaveBeenCalled()
    })
  })

  it('removes the retirement plans parked for other accounts, and nothing else (story 90.1, D4)', async () => {
    // This file runs in node (no DOM): a Map-backed stand-in with the Storage
    // methods the purge uses, including index-based `key()` iteration.
    const items = new Map<string, string>([
      ['budget-planner-retirement-planner-v1:aaaa', '{}'],
      ['budget-planner-retirement-planner-v1:bbbb', '{}'],
      ['budget-planner-currency-v1', 'kept'],
    ])
    vi.stubGlobal('localStorage', {
      get length() {
        return items.size
      },
      key: (index: number) => [...items.keys()][index] ?? null,
      getItem: (key: string) => items.get(key) ?? null,
      removeItem: (key: string) => {
        items.delete(key)
      },
    })
    try {
      await purgeLocalFinancialData('')
    } finally {
      vi.unstubAllGlobals()
    }
    expect([...items.keys()]).toEqual(['budget-planner-currency-v1'])
  })

  it('with an empty-string userId also skips the sync queue', async () => {
    await purgeLocalFinancialData('')
    expect(h.incomeClear).toHaveBeenCalledTimes(1)
    expect(h.createSyncQueue).not.toHaveBeenCalled()
  })

  // Story 92.1 (deferred-work, code review of 86-1, LOW #3). The REAL notice store
  // (not mocked): it is in-memory only, and mocking it would let a missing reset
  // pass. A dismissal has no getter, so it is observed by behaviour: a dismissed
  // not-synced notice stays hidden on the next reconcile until the dismissal is
  // forgotten.
  describe('refusal notices (story 92.1)', () => {
    const refused: RefusalNotice = {
      key: 'incomeSource:gone',
      entityType: 'incomeSource',
      name: 'Salary',
      kind: 'income',
      fallback: 'An income entry',
      outcome: 'removed',
    }
    const notSynced: RefusalNotice = {
      key: 'expense:stuck',
      entityType: 'expense',
      name: 'Rent',
      kind: 'expense',
      fallback: 'An expense',
      outcome: 'not-synced',
      change: 'update',
    }
    afterEach(() => {
      resetRefusalNotices()
    })

    it.each([
      ['a userId', 'user-9'],
      ['no userId', undefined],
    ])('forgets every notice and every dismissal (with %s)', async (_label, userId) => {
      reconcileNotSyncedNotices([notSynced])
      dismissRefusalNotice(notSynced.key)
      addRefusalNotices([refused])
      expect(getRefusalNotices().map((n) => n.key)).toEqual([refused.key])

      await purgeLocalFinancialData(userId)

      expect(getRefusalNotices()).toEqual([])
      // The dismissal is gone too: the same escalated edit is shown again.
      reconcileNotSyncedNotices([notSynced])
      expect(getRefusalNotices().map((n) => n.key)).toEqual([notSynced.key])
    })
  })
})
