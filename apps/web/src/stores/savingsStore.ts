import type {
  ClientNewSavingsGoal,
  ClientSavingsGoal,
} from '@budget-planner/core/services/savingsGoals'
import { withProgress } from '@budget-planner/core/services/savingsGoals'
import type { SavingsGoalWithProgress } from '@budget-planner/core/services/savingsGoals'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { backfillSortOrder, nextSortOrder, sortByDisplayOrder } from '../lib/ordering'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { withUuidIds } from '../lib/uuid'

// Define the type for our store state
interface SavingsState {
  savingsGoals: ClientSavingsGoal[]

  // CRUD operations
  addSavingsGoal: (goal: ClientNewSavingsGoal) => ClientSavingsGoal
  updateSavingsGoal: (
    id: string,
    updates: Partial<ClientNewSavingsGoal>
  ) => ClientSavingsGoal | undefined
  deleteSavingsGoal: (id: string) => boolean

  // Query operations
  getSavingsGoalById: (id: string) => ClientSavingsGoal | undefined
  getSavingsGoalsWithProgress: () => SavingsGoalWithProgress[]
  getTotalSavings: () => number
  getTotalTargetAmount: () => number
  getSavingsProgress: (id: string) => number | null // Percentage (0-100), null for accounts
  getOverallProgress: () => number // Returns percentage across all goals
}

// Helper to generate a temporary ID for client-side storage
// Note: In production with backend, IDs will come from the database
// Using negative IDs for temporary client-side entries to avoid conflicts
// Start at -20000 to match the core service constant
import { toClientSavingsGoal } from '@budget-planner/core/services/savingsGoals'

// Storage key for localStorage
// Using the key specified in Dev Notes: localStorage: `budget-planner:savings-goals`
export const SAVINGS_GOALS_STORAGE_KEY = 'budget-planner:savings-goals'

export const useSavingsStore = create<SavingsState>()(
  persist(
    (set, get) => ({
      // Initial state
      savingsGoals: [],

      // Add a new savings goal
      addSavingsGoal: (newGoal: ClientNewSavingsGoal) => {
        // Story 34.1a (AC-3, AC-7): this list used to run every add through core's
        // `sortByCreationDate`, which is NEWEST-FIRST — so a new goal landed at the
        // TOP. FR60 normalizes all four lists to oldest-first + append-at-bottom,
        // which makes this a deliberate behaviour CHANGE here, not a preservation.
        const goal: ClientSavingsGoal = {
          ...toClientSavingsGoal(newGoal),
          sortOrder: nextSortOrder(get().savingsGoals),
        }
        set((state) => ({
          savingsGoals: sortByDisplayOrder([...state.savingsGoals, goal]),
        }))
        // Paid tier: also push to the server (no-op for the free tier).
        syncEntityCreate('savingsGoal', goal)
        return goal
      },

      // Update an existing savings goal
      updateSavingsGoal: (id: string, updates: Partial<ClientNewSavingsGoal>) => {
        const state = get()
        const index = state.savingsGoals.findIndex((g) => g.id === id)

        if (index === -1) {
          return undefined
        }

        const previousGoal = state.savingsGoals[index]
        const updatedGoal: ClientSavingsGoal = {
          ...previousGoal,
          ...updates,
          updatedAt: new Date().toISOString(),
        }

        set((state) => ({
          // Story 34.1a (AC-7): was `sortByCreationDate`, which re-asserted
          // `createdAt` as the ordering authority on EVERY edit — silently
          // clobbering any explicit position on the next update to any row.
          savingsGoals: sortByDisplayOrder([
            ...state.savingsGoals.slice(0, index),
            updatedGoal,
            ...state.savingsGoals.slice(index + 1),
          ]),
        }))

        // Paid tier: queue the update with the pre-edit row as the baseVersion.
        syncEntityUpdate('savingsGoal', updatedGoal, previousGoal)
        return updatedGoal
      },

      // Delete a savings goal
      deleteSavingsGoal: (id: string) => {
        const state = get()
        const existing = state.savingsGoals.find((g) => g.id === id)

        if (existing) {
          set((state) => ({
            savingsGoals: state.savingsGoals.filter((g) => g.id !== id),
          }))
          // Paid tier: queue a tombstone so the delete propagates to other devices.
          syncEntityDelete('savingsGoal', existing)
        }

        return existing !== undefined
      },

      // Get savings goal by ID
      getSavingsGoalById: (id: string) => {
        return get().savingsGoals.find((goal) => goal.id === id)
      },

      // Get all savings goals with progress calculated
      getSavingsGoalsWithProgress: () => {
        return get().savingsGoals.map(withProgress)
      },

      // Calculate total savings (sum of ALL current balances — accounts included)
      getTotalSavings: () => {
        return get().savingsGoals.reduce((sum, goal) => sum + goal.currentBalance, 0)
      },

      // Calculate total target amount across goals only. Accounts (null target,
      // Story 16-1) contribute no target and are excluded.
      getTotalTargetAmount: () => {
        return get().savingsGoals.reduce((sum, goal) => sum + (goal.targetAmount ?? 0), 0)
      },

      // Calculate progress percentage for a specific savings goal. Returns null
      // for an account (no target) — "no target" is absent progress, not 0%.
      getSavingsProgress: (id: string) => {
        const goal = get().savingsGoals.find((g) => g.id === id)
        if (!goal) return 0
        // Account (no target): progress is absent, not 0%.
        if (goal.targetAmount == null) return null
        // Legacy guard: a 0 target still yields 0% (never divide by zero).
        if (goal.targetAmount === 0) return 0
        return Math.min(100, Math.round((goal.currentBalance / goal.targetAmount) * 100))
      },

      // Calculate overall progress across GOALS only. An account balance must not
      // count toward goal progress (neither numerator nor denominator).
      getOverallProgress: () => {
        const goals = get().savingsGoals.filter((goal) => goal.targetAmount != null)
        const totalBalance = goals.reduce((sum, goal) => sum + goal.currentBalance, 0)
        const totalTarget = goals.reduce((sum, goal) => sum + (goal.targetAmount ?? 0), 0)
        if (totalTarget <= 0) return 0
        return Math.min(100, Math.round((totalBalance / totalTarget) * 100))
      },
    }),
    {
      name: SAVINGS_GOALS_STORAGE_KEY,
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration)
      skipHydration: true,
      // v1 (Story 5-14): convert any legacy negative-integer ids to fresh uuids.
      // v2 (Story 26.1): backfill the allocation fields so pre-26.1 rows load as
      // 'automatic' with no manual amount — the free-tier counterpart to the DB
      // migration's server-side default. Non-destructive: existing values (incl.
      // an already-set manual amount) are preserved.
      // v3 (Story 34.1a, FR60): backfill an explicit `sortOrder` — dense 0..n-1
      // assigned by createdAt ASC with id ASC as the tiebreaker.
      //
      // ⚠️ SCOPE OF THE "same rule as the SQL" CLAIM, narrowed by code review 34.1a.
      // The SQL in migrations/0013_purple_retro_girl.sql numbers
      // `PARTITION BY "userId","profileId"`; this backfill numbers the whole
      // persisted array with NO partition. The two therefore agree only for a
      // SINGLE-PROFILE array — which is the only coherent state, since this array is
      // rendered as one list and a multi-profile array would already be showing the
      // user two profiles' rows interleaved.
      //
      // That multi-profile state IS currently reachable: pulled rows carry
      // `profileId` (getSyncChanges sends whole rows) and `switchProfile` does not
      // clear these arrays. That is a PRE-EXISTING defect, logged in
      // deferred-work.md; fixing it makes every array single-profile by
      // construction and makes the two rules identical without any partition logic
      // here. Do not add partitioning to this function — it would encode agreement
      // with the SQL for a state in which the list is already wrong on screen.
      //
      // ⚠️ This list previously displayed NEWEST-FIRST, so ordering the backfill by
      // createdAt ASC REVERSES it once, on purpose (34.1a decision 1). The app is
      // pre-launch, so no user's data is affected.
      version: 3,
      migrate: (persisted) => {
        const state = persisted as { savingsGoals?: unknown }
        // ⚠️ Sanitize BEFORE anything dereferences a row. This store was missing
        // the guard incomeStore/expenseStore already had (added by code review
        // 30.4a): the persisted array is untrusted JSON, and a single null entry
        // made `withUuidIds`' `item.id` — and now the sortOrder backfill's
        // `createdAt` read — throw. A throwing `migrate` fails rehydration
        // entirely, so the store keeps its empty default and the user's whole
        // savings list silently disappears.
        const raw = Array.isArray(state?.savingsGoals) ? state.savingsGoals : []
        const rows = raw.filter(
          (row): row is ClientSavingsGoal => typeof row === 'object' && row !== null
        )
        return {
          // The backfill runs LAST, over rows that already have their uuid ids —
          // the `id` tiebreaker must see the final ids, not the legacy ones it
          // would otherwise sort by and then discard.
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

// Selector hooks for better performance
export const useSavingsGoals = () => useSavingsStore((state) => state.savingsGoals)

export const useSavingsGoalsWithProgress = () =>
  useSavingsStore((state) => state.getSavingsGoalsWithProgress())

export const useTotalSavings = () => useSavingsStore((state) => state.getTotalSavings())

export const useTotalTargetAmount = () => useSavingsStore((state) => state.getTotalTargetAmount())

export const useOverallSavingsProgress = () =>
  useSavingsStore((state) => state.getOverallProgress())

// Selector for actions
export const useSavingsActions = () => ({
  addSavingsGoal: useSavingsStore((state) => state.addSavingsGoal),
  updateSavingsGoal: useSavingsStore((state) => state.updateSavingsGoal),
  deleteSavingsGoal: useSavingsStore((state) => state.deleteSavingsGoal),
  getSavingsGoalById: useSavingsStore((state) => state.getSavingsGoalById),
})

// Client-side persistence enabled via Zustand persist middleware
// Data persists in localStorage across page refreshes
// Uses string timestamps for proper serialization
// Note: These types are for client-side storage; db package types are for database
// Integration with core service layer for type safety and business logic
