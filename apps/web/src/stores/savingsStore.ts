import type {
  ClientNewSavingsGoal,
  ClientSavingsGoal,
} from '@budget-planner/core/services/savingsGoals'
import { withProgress } from '@budget-planner/core/services/savingsGoals'
import type { SavingsGoalWithProgress } from '@budget-planner/core/services/savingsGoals'
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { backfillSortOrder, nextSortOrder, sortByDisplayOrder } from '../lib/ordering'
import { registerProfileScopedCollection } from '../lib/profile-cascade'
import { scopeToActiveProfile } from '../lib/profile-scope'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { withUuidIds } from '../lib/uuid'
import { SAVINGS_GOALS_STORAGE_KEY } from './overview-data-storage-keys'
import { useProfileStore } from './profileStore'

interface SavingsState {
  savingsGoals: ClientSavingsGoal[]

  addSavingsGoal: (goal: ClientNewSavingsGoal) => ClientSavingsGoal
  updateSavingsGoal: (
    id: string,
    updates: Partial<ClientNewSavingsGoal>
  ) => ClientSavingsGoal | undefined
  deleteSavingsGoal: (id: string) => boolean

  getSavingsGoalById: (id: string) => ClientSavingsGoal | undefined
  getSavingsGoalsWithProgress: () => SavingsGoalWithProgress[]
  getTotalSavings: () => number
  getTotalTargetAmount: () => number
  getSavingsProgress: (id: string) => number | null
  getOverallProgress: () => number
}

import { toClientSavingsGoal } from '@budget-planner/core/services/savingsGoals'

export { SAVINGS_GOALS_STORAGE_KEY }

/**
 * Selector hooks must call these with the state rows, never the equivalent store METHOD: methods
 * close over get() and read live state during hydration, causing a mismatch.
 */
function savingsGoalsWithProgressFrom(
  goals: readonly ClientSavingsGoal[]
): SavingsGoalWithProgress[] {
  return goals.map((goal) => withProgress(goal))
}

function totalSavingsFrom(goals: readonly ClientSavingsGoal[]): number {
  return goals.reduce((sum, goal) => sum + goal.currentBalance, 0)
}

function totalTargetAmountFrom(goals: readonly ClientSavingsGoal[]): number {
  return goals.reduce((sum, goal) => sum + (goal.targetAmount ?? 0), 0)
}

function overallProgressFrom(goals: readonly ClientSavingsGoal[]): number {
  const withTarget = goals.filter((goal) => goal.targetAmount != null)
  const totalBalance = totalSavingsFrom(withTarget)
  const totalTarget = totalTargetAmountFrom(withTarget)
  if (totalTarget <= 0) return 0
  return Math.min(100, Math.round((totalBalance / totalTarget) * 100))
}

export const useSavingsStore = create<SavingsState>()(
  persist(
    (set, get) => ({
      savingsGoals: [],

      addSavingsGoal: (newGoal: ClientNewSavingsGoal) => {
        const goal: ClientSavingsGoal = {
          ...toClientSavingsGoal(newGoal),
          sortOrder: nextSortOrder(get().savingsGoals),
          profileId: useProfileStore.getState().activeProfileId ?? null,
        }
        set((state) => ({
          savingsGoals: sortByDisplayOrder([...state.savingsGoals, goal]),
        }))
        syncEntityCreate('savingsGoal', goal)
        return goal
      },

      updateSavingsGoal: (id: string, updates: Partial<ClientNewSavingsGoal>) => {
        const state = get()
        const index = state.savingsGoals.findIndex((g) => g.id === id)

        if (index === -1) {
          return undefined
        }

        const previousGoal = state.savingsGoals[index]
        if (previousGoal === undefined) {
          return undefined
        }
        const updatedGoal: ClientSavingsGoal = {
          ...previousGoal,
          ...updates,
          updatedAt: new Date().toISOString(),
        }

        set((state) => ({
          savingsGoals: sortByDisplayOrder([
            ...state.savingsGoals.slice(0, index),
            updatedGoal,
            ...state.savingsGoals.slice(index + 1),
          ]),
        }))

        syncEntityUpdate('savingsGoal', updatedGoal, previousGoal)
        return updatedGoal
      },

      deleteSavingsGoal: (id: string) => {
        const state = get()
        const existing = state.savingsGoals.find((g) => g.id === id)

        if (existing) {
          set((state) => ({
            savingsGoals: state.savingsGoals.filter((g) => g.id !== id),
          }))
          syncEntityDelete('savingsGoal', existing)
        }

        return existing !== undefined
      },

      getSavingsGoalById: (id: string) => {
        return get().savingsGoals.find((goal) => goal.id === id)
      },

      getSavingsGoalsWithProgress: () => {
        return savingsGoalsWithProgressFrom(get().savingsGoals)
      },

      getTotalSavings: () => {
        return totalSavingsFrom(get().savingsGoals)
      },

      getTotalTargetAmount: () => {
        return totalTargetAmountFrom(get().savingsGoals)
      },

      // null for an account (no target): absent progress, not 0%.
      getSavingsProgress: (id: string) => {
        const goal = get().savingsGoals.find((g) => g.id === id)
        if (!goal) return 0
        if (goal.targetAmount == null) return null
        if (goal.targetAmount === 0) return 0
        return Math.min(100, Math.round((goal.currentBalance / goal.targetAmount) * 100))
      },

      // Goals only: account balances count toward neither numerator nor denominator.
      getOverallProgress: () => {
        return overallProgressFrom(get().savingsGoals)
      },
    }),
    {
      name: SAVINGS_GOALS_STORAGE_KEY,
      skipHydration: true,
      // Unpartitioned backfill still gives each profile's rows the same relative order as the SQL's
      // per-profile numbering (a subset of a sorted sequence stays sorted). Don't add partitioning.
      version: 3,
      migrate: (persisted) => {
        const state = persisted as { savingsGoals?: unknown }
        // Sanitize before dereferencing rows: a throwing migrate fails rehydration and silently empties the list.
        const raw = Array.isArray(state?.savingsGoals) ? state.savingsGoals : []
        const rows = raw.filter(
          (row): row is ClientSavingsGoal => typeof row === 'object' && row !== null
        )
        return {
          // Backfill runs last so the id tiebreaker sees the final uuids, not the legacy ids.
          savingsGoals: backfillSortOrder(
            withUuidIds(rows).map((goal) => ({
              ...goal,
              allocationMode: goal.allocationMode ?? 'automatic',
              monthlyAllocation: goal.monthlyAllocation ?? null,
            }))
          ),
        }
      },
      partialize: (state) => ({
        savingsGoals: state.savingsGoals,
      }),
    }
  )
)

/**
 * Holds every profile's rows: each hook deriving from them must scope to the active profile.
 * Store methods are deliberately unscoped (sync seeding, purge operate on every row).
 */
export const useSavingsGoals = (): ClientSavingsGoal[] => {
  const rows = useSavingsStore((state) => state.savingsGoals)
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useMemo(() => scopeToActiveProfile(rows, activeProfileId), [rows, activeProfileId])
}

export const useSavingsGoalsWithProgress = () => {
  const rows = useSavingsGoals()
  return useMemo(() => savingsGoalsWithProgressFrom(rows), [rows])
}

export const useTotalSavings = () => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useSavingsStore((state) =>
    totalSavingsFrom(scopeToActiveProfile(state.savingsGoals, activeProfileId))
  )
}

export const useTotalTargetAmount = () => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useSavingsStore((state) =>
    totalTargetAmountFrom(scopeToActiveProfile(state.savingsGoals, activeProfileId))
  )
}

export const useOverallSavingsProgress = () => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useSavingsStore((state) =>
    overallProgressFrom(scopeToActiveProfile(state.savingsGoals, activeProfileId))
  )
}

export const useSavingsActions = () => ({
  addSavingsGoal: useSavingsStore((state) => state.addSavingsGoal),
  updateSavingsGoal: useSavingsStore((state) => state.updateSavingsGoal),
  deleteSavingsGoal: useSavingsStore((state) => state.deleteSavingsGoal),
  getSavingsGoalById: useSavingsStore((state) => state.getSavingsGoalById),
})

// Stores register themselves: the cascade importing them would create an import cycle.
registerProfileScopedCollection(useSavingsStore, 'savingsGoals')
