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
import { useProfileStore } from './profileStore'

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

/**
 * ⚠️ PURE DERIVATIONS — READ BEFORE ADDING A SELECTOR HOOK BELOW (story 38.1, BUG-F).
 *
 * These take the goals array as an ARGUMENT and are shared by the store methods
 * and the selector hooks, so the two can never drift.
 *
 * A selector hook must call one of these with `state.savingsGoals`. It must NOT
 * call the equivalent store METHOD. React hands a selector the server snapshot
 * during hydration (zustand passes `getInitialState` as `getServerSnapshot`), but
 * that snapshot's methods still close over `get()` and return LIVE state — so a
 * `useSavingsStore((s) => s.getTotalSavings())` selector reads rehydrated data
 * while the server rendered the default, and React discards the tree. Measured on
 * six routes, in dev and in a production build (React #418).
 *
 * The methods stay: `getState().getTotalSavings()` callers outside React are
 * unaffected by hydration and read live state on purpose.
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
          // Story 54.4 (FR79): stamp the owning profile, or the row would show under
          // every profile. Read at call time, like `categoryStore`'s create path.
          profileId: useProfileStore.getState().activeProfileId ?? null,
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
        // Unreachable: the `index === -1` branch above already returned.
        if (previousGoal === undefined) {
          return undefined
        }
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
        return savingsGoalsWithProgressFrom(get().savingsGoals)
      },

      // Calculate total savings (sum of ALL current balances — accounts included)
      getTotalSavings: () => {
        return totalSavingsFrom(get().savingsGoals)
      },

      // Calculate total target amount across goals only. Accounts (null target,
      // Story 16-1) contribute no target and are excluded.
      getTotalTargetAmount: () => {
        return totalTargetAmountFrom(get().savingsGoals)
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
        return overallProgressFrom(get().savingsGoals)
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
      // ⚠️ SUPERSEDED BY STORY 54.4 (FR79) — the paragraph above is history. The
      // fix did NOT make these arrays single-profile: FR79 chose to FILTER READS by
      // the active profile rather than clear the arrays on a switch, so a
      // multi-profile array is now the normal, correct state and the list on screen
      // is scoped (`lib/profile-scope`). The conclusion still holds for a different
      // reason: numbering the whole array by createdAt/id gives every profile's rows
      // the SAME RELATIVE order as the SQL's per-partition numbering (a subset of a
      // sorted sequence stays sorted), and `sortOrder` is an order, not an index —
      // only the values differ, never the order. Still do not add partitioning.
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
/**
 * ⚠️ PROFILE-SCOPED (story 54.4, FR79). The array holds rows from every profile
 * this device has seen, and a profile switch does not clear it (FR79's decision),
 * so EVERY hook below that derives from rows must read `activeProfileId` and scope
 * through `lib/profile-scope`. A new hook that reads the raw array puts another
 * profile's money back on screen — the exact defect 54.4 closed.
 *
 * Array hooks scope in `useMemo` (a stable identity across renders); number hooks
 * may scope inside the selector, since a number passes `Object.is`. `getState()`
 * store METHODS are deliberately NOT scoped — their callers (sync seeding, account
 * purge, category usage) operate on every local row on purpose.
 */
export const useSavingsGoals = (): ClientSavingsGoal[] => {
  const rows = useSavingsStore((state) => state.savingsGoals)
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useMemo(() => scopeToActiveProfile(rows, activeProfileId), [rows, activeProfileId])
}

/**
 * Derived in `useMemo` over the profile-scoped rows (story 54.4). It used to build
 * a NEW array inside the zustand selector, failing v4's `Object.is` check and
 * costing one extra re-render per store update; it has no consumers today, and
 * scoping it was the moment to stop carrying that hazard.
 */
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

// Declare this collection to the profile cascade (story 66.3, FR104). Deleting a
// profile destroys the rows STRICTLY stamped with it; see `lib/profile-cascade.ts`
// for why the stores register themselves instead of that module importing them.
registerProfileScopedCollection(useSavingsStore, 'savingsGoals')
