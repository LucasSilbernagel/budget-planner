/**
 * Best-effort and never throws: one failing store must not abort the rest, and after account erasure
 * a local failure must not surface as a deletion failure.
 */

import { getSyncPurgeHandle } from '@/lib/sync/purgeHandle'
import { resetRefusalNotices } from '@/lib/sync/refusalNoticeStore'
import { useBalanceStore } from '@/stores/balanceStore'
import { useCategoryStore } from '@/stores/categoryStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useIncomeStore } from '@/stores/incomeStore'
import { useProfileStore } from '@/stores/profileStore'
import {
  RETIREMENT_PLANNER_PARKED_KEY_PREFIX,
  useRetirementPlannerStore,
} from '@/stores/retirementPlannerStore'
import { useSavingsStore } from '@/stores/savingsStore'
import { createSyncQueue } from '@budget-planner/core/sync'

function safely(step: () => void): void {
  try {
    step()
  } catch (error) {
    console.error('purgeLocalFinancialData: a local cleanup step failed', error)
  }
}

export async function purgeLocalFinancialData(userId?: string): Promise<void> {
  safely(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useIncomeStore.persist.clearStorage()
  })
  safely(() => {
    useExpenseStore.setState({ expenses: [] })
    useExpenseStore.persist.clearStorage()
  })
  safely(() => {
    useSavingsStore.setState({ savingsGoals: [] })
    useSavingsStore.persist.clearStorage()
  })
  safely(() => {
    useCategoryStore.getState().reset()
    useCategoryStore.persist.clearStorage()
  })
  safely(() => {
    useRetirementPlannerStore.getState().resetPlan()
    useRetirementPlannerStore.persist.clearStorage()
  })
  safely(() => {
    const parked: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(RETIREMENT_PLANNER_PARKED_KEY_PREFIX)) {
        parked.push(key)
      }
    }
    for (const key of parked) {
      localStorage.removeItem(key)
    }
  })
  safely(() => {
    useProfileStore.getState().reset()
    useProfileStore.persist.clearStorage()
  })
  safely(() => {
    useBalanceStore.getState().reset()
    useBalanceStore.persist.clearStorage()
  })
  safely(() => {
    resetRefusalNotices()
  })

  // The table sort is deliberately not purged: it is a display preference, like currency.

  // Clear through the live sync service when one runs: it holds the queue in memory and would write
  // the cleared ops back.
  if (userId) {
    const live = getSyncPurgeHandle(userId)
    let cleared = false
    if (live) {
      try {
        await live.clearQueue()
        cleared = true
      } catch (error) {
        console.error('purgeLocalFinancialData: the live sync queue could not be cleared', error)
      }
    }
    if (!cleared) {
      try {
        await createSyncQueue(userId).clear()
      } catch (error) {
        console.error('purgeLocalFinancialData: failed to clear the sync queue', error)
      }
    }
  }
}
