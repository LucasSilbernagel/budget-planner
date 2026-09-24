/**
 * Balance Tracking Store
 *
 * Zustand store for client-side balance tracking state management.
 * Provides state, selectors, and actions for balance tracking entries.
 *
 * Architecture:
 * - Uses Zustand for state management
 * - Persists to localStorage via persist middleware
 * - Works with core service layer for business logic
 * - Supports both free tier (client-side) and paid tier (server-side)
 */

import type {
  BalanceTrackingFilter,
  BalanceTrackingWithTimeline,
  ClientBalanceTracking,
  ClientNewBalanceTracking,
} from '@budget-planner/core/services/balanceTracking'
import {
  filterBalanceTracking,
  toClientBalanceTracking,
  validateBalanceTracking,
  withTimeline,
} from '@budget-planner/core/services/balanceTracking'
import type { FinanceType } from '@budget-planner/db'
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { backfillSortOrder, nextSortOrder, sortByDisplayOrder } from '../lib/ordering'
import { registerProfileScopedCollection } from '../lib/profile-cascade'
import { scopeToActiveProfile } from '../lib/profile-scope'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { withUuidIds } from '../lib/uuid'
import { useProfileStore } from './profileStore'

// ============================================================================
// State Definition
// ============================================================================

/**
 * Balance store state
 */
interface BalanceState {
  // Balance tracking entries (client-side storage)
  entries: ClientBalanceTracking[]

  // Filter state
  filter: BalanceTrackingFilter

  // Actions
  addBalanceEntry: (data: ClientNewBalanceTracking) => ClientBalanceTracking | null
  updateBalanceEntry: (
    id: string,
    data: Partial<ClientNewBalanceTracking>
  ) => ClientBalanceTracking | null
  deleteBalanceEntry: (id: string) => boolean
  setFilter: (filter: BalanceTrackingFilter) => void
  clearFilter: () => void
  reset: () => void
}

// ============================================================================
// Store Creation
// ============================================================================

/**
 * Storage key for localStorage persistence
 */
const STORAGE_KEY = 'budget-planner:balance-tracking'

/**
 * Create balance store with persistence
 */
export const useBalanceStore = create<BalanceState>()(
  persist(
    (set, get) => ({
      // Initial state
      entries: [],
      filter: {},

      // Add a new balance entry
      addBalanceEntry: (data: ClientNewBalanceTracking): ClientBalanceTracking | null => {
        // Validate input
        const errors = validateBalanceTracking(data)
        if (errors.length > 0) {
          console.warn('Validation errors:', errors)
          return null
        }

        // Convert to client entry with ID and timestamps.
        // Story 34.1a (AC-3, AC-7): this list used to run every add through core's
        // `sortByCreationDate`, which is NEWEST-FIRST — so a new entry landed at the
        // TOP. FR60 normalizes all four lists to oldest-first + append-at-bottom,
        // which makes this a deliberate behaviour CHANGE here, not a preservation.
        // The position is max+1 over the CURRENT list, so it is computed before the
        // set() (the factory is a pure function and has no list access).
        const newEntry: ClientBalanceTracking = {
          ...toClientBalanceTracking(data),
          sortOrder: nextSortOrder(get().entries),
          // Story 54.4 (FR79): stamp the owning profile, or the row would show under
          // every profile. Read at call time, like `categoryStore`'s create path.
          profileId: useProfileStore.getState().activeProfileId ?? null,
        }

        // Update state
        set((state) => ({
          entries: sortByDisplayOrder([...state.entries, newEntry]),
        }))

        // Paid tier: also push to the server (no-op for the free tier).
        syncEntityCreate('balanceTracking', newEntry)
        return newEntry
      },

      // Update an existing balance entry
      updateBalanceEntry: (
        id: string,
        data: Partial<ClientNewBalanceTracking>
      ): ClientBalanceTracking | null => {
        // Find the pre-edit entry (also the baseVersion source for sync).
        const previous = get().entries.find((e) => e.id === id)
        if (!previous) {
          return null
        }

        // Validate the MERGED entry (the shape actually persisted), not the raw
        // partial — a partial that omits a required field (e.g. `frequency`, or
        // name/type) is still valid when the existing value fills it in.
        const errors = validateBalanceTracking({ ...previous, ...data })
        if (errors.length > 0) {
          console.warn('Validation errors:', errors)
          return null
        }

        // Find and update entry
        const updatedEntries = get().entries.map((entry) => {
          if (entry.id === id) {
            return {
              ...entry,
              ...data,
              updatedAt: new Date().toISOString(),
            }
          }
          return entry
        })

        // Update state
        set((_state) => ({
          // Story 34.1a (AC-7): was `sortByCreationDate`, which re-asserted
          // `createdAt` as the ordering authority on EVERY edit — silently
          // clobbering any explicit position on the next update to any row.
          entries: sortByDisplayOrder(updatedEntries),
        }))

        // Return updated entry
        const updatedEntry = updatedEntries.find((e) => e.id === id)
        // Paid tier: queue the update with the pre-edit row as the baseVersion.
        if (updatedEntry) {
          syncEntityUpdate('balanceTracking', updatedEntry, previous)
        }
        return updatedEntry || null
      },

      // ⚠️ Story 43.4 recorded a validation ASYMMETRY here: `moveBalanceEntry`
      // skipped `validateBalanceTracking` while add/update did not, so a row whose
      // `type` this build did not recognise stayed REORDERABLE but not EDITABLE.
      // Story 48.2 deleted that action, and with it the asymmetry: every surviving
      // path that WRITES ROW DATA now validates.
      //
      // ⚠️ Stated narrowly on purpose (48.2 review). "Every mutation validates"
      // would be false — `deleteBalanceEntry` below is a mutation and runs no
      // validation, correctly, and neither does zustand's persist/rehydrate. The
      // unvalidated path that writes row DATA is `lib/sync/applyServerChanges.ts`,
      // not this file.

      // Delete a balance entry
      deleteBalanceEntry: (id: string): boolean => {
        const existing = get().entries.find((e) => e.id === id)
        if (!existing) {
          return false
        }

        // Filter out the deleted entry
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        }))

        // Paid tier: queue a tombstone so the delete propagates to other devices.
        syncEntityDelete('balanceTracking', existing)
        return true
      },

      // Set filter
      setFilter: (filter: BalanceTrackingFilter) => {
        set({ filter })
      },

      // Clear filter
      clearFilter: () => {
        set({ filter: {} })
      },

      // Reset store to initial state
      reset: () => {
        set({
          entries: [],
          filter: {},
        })
      },
    }),
    {
      name: STORAGE_KEY,
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration)
      skipHydration: true,
      // v1 (Story 5-14): convert any legacy negative-integer ids to fresh uuids.
      // v2 (Story 16-2): backfill a default `frequency` of 'monthly' for legacy rows
      // (pre-frequency entries were implicitly monthly). Required, not optional — the
      // normalization engine throws on an undefined frequency, so an un-backfilled row
      // would crash the timeline math.
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
      // Story 49.1 (FR75) bumped 3 -> 4: strip the removed `maxContributionLimit`
      // key. Nothing reads it any more and no zod gate rejects an extra key, so a
      // lingering value is inert rather than harmful — but a key nothing writes
      // reads as a live field to the next person, and `syncBridge` no longer
      // forwards it, so leaving it would be residue with no owner.
      version: 4,
      migrate: (persisted) => {
        const state = persisted as { entries?: unknown }
        // ⚠️ Sanitize BEFORE anything dereferences a row. This store was missing
        // the guard incomeStore/expenseStore already had (added by code review
        // 30.4a): the persisted array is untrusted JSON, and a single null entry
        // made `withUuidIds`' `item.id` — and now the sortOrder backfill's
        // `createdAt` read — throw. A throwing `migrate` fails rehydration
        // entirely, so the store keeps its empty default and the user's whole
        // balance list silently disappears.
        const raw = Array.isArray(state?.entries) ? state.entries : []
        const rows = raw.filter(
          (row): row is ClientBalanceTracking => typeof row === 'object' && row !== null
        )
        return {
          // The backfill runs LAST, over rows that already have their uuid ids —
          // the `id` tiebreaker must see the final ids, not the legacy ones it
          // would otherwise sort by and then discard.
          entries: backfillSortOrder(
            withUuidIds(rows).map((entry) => {
              // Story 49.1: drop the retired contribution-limit key. Destructured
              // out rather than deleted from the spread result so the discard is
              // visible at the point it happens.
              const { maxContributionLimit: _retiredLimit, ...rest } = entry as typeof entry & {
                maxContributionLimit?: unknown
              }
              return {
                ...rest,
                frequency: rest.frequency ?? 'monthly',
              }
            })
          ),
        }
      },
      partialize: (state) => ({
        entries: state.entries,
      }),
    }
  )
)

// ============================================================================
// Selectors
// ============================================================================

/**
 * ⚠️ PROFILE-SCOPED (story 54.4, FR79). `entries` holds rows from every profile
 * this device has seen, and a profile switch does not clear it (FR79's decision),
 * so EVERY hook below that derives from entries must scope through
 * `lib/profile-scope`. A new hook that reads `state.entries` directly puts another
 * profile's balances back into net worth — the exact defect 54.4 closed.
 *
 * Array hooks derive in `useMemo` over {@link useBalanceEntries} (a stable identity
 * across renders — the old `useBalanceEntriesByType` built a new array inside the
 * selector); number hooks may scope inside the selector, since a number passes
 * `Object.is`. `getState()` callers (sync seeding, account purge) are deliberately
 * unscoped: they operate on every local row on purpose.
 */

/**
 * Get all balance entries for the active profile
 */
export const useBalanceEntries = (): ClientBalanceTracking[] => {
  const rows = useBalanceStore((state) => state.entries)
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useMemo(() => scopeToActiveProfile(rows, activeProfileId), [rows, activeProfileId])
}

/**
 * Get balance entries with timeline calculations
 */
export const useBalanceEntriesWithTimeline = (): BalanceTrackingWithTimeline[] => {
  const rows = useBalanceEntries()
  return useMemo(() => rows.map(withTimeline), [rows])
}

/**
 * Get filtered balance entries with timeline
 */
export const useFilteredBalanceEntries = (): BalanceTrackingWithTimeline[] => {
  const rows = useBalanceEntriesWithTimeline()
  const filter = useBalanceStore((state) => state.filter)
  return useMemo(() => filterBalanceTracking(rows, filter), [rows, filter])
}

/**
 * Get entries by type (investment, debt or asset)
 */
export const useBalanceEntriesByType = (type: FinanceType): BalanceTrackingWithTimeline[] => {
  const rows = useBalanceEntriesWithTimeline()
  return useMemo(() => rows.filter((entry) => entry.type === type), [rows, type])
}

/**
 * Get investment entries
 */
export const useInvestmentEntries = (): BalanceTrackingWithTimeline[] =>
  useBalanceEntriesByType('investment')

/**
 * Get debt entries
 */
export const useDebtEntries = (): BalanceTrackingWithTimeline[] => useBalanceEntriesByType('debt')

/**
 * Get asset entries — things owned outright (property, vehicle, cash). FR70.
 *
 * ⚠️ Added for symmetry with the two selectors above even though, like
 * `useDebtEntries`, it has no production consumer today. The alternative —
 * omitting it — leaves the next caller to hand-roll a filter, which is exactly
 * how the Overview ended up re-deriving its own totals at `HomePage.tsx:214-219`
 * instead of using these. Recorded as a deliberate judgement (story 43.4).
 */
export const useAssetEntries = (): BalanceTrackingWithTimeline[] => useBalanceEntriesByType('asset')

/** Sum of `currentBalance` over the active profile's entries of one type. */
function totalBalanceOfType(
  entries: readonly ClientBalanceTracking[],
  activeProfileId: string | null,
  type: FinanceType
): number {
  return scopeToActiveProfile(entries, activeProfileId)
    .filter((e) => e.type === type)
    .reduce((sum, entry) => sum + entry.currentBalance, 0)
}

/**
 * Get total investment balance
 */
export const useTotalInvestmentBalance = (): number => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useBalanceStore((state) =>
    totalBalanceOfType(state.entries, activeProfileId, 'investment')
  )
}

/**
 * Get total balance of assets owned outright (story 43.4, FR70).
 *
 * ⚠️ Written in the derive-from-the-argument shape, NOT as a call to a store
 * method: story 38.1 (BUG-F) measured that a selector which CALLS a state method
 * diverges between the server render and the first client render on a
 * lazily-mounted route. `stores/__tests__/no-method-selectors.guard.test.ts` is
 * the tripwire — and calls itself a tripwire, not a proof.
 */
export const useTotalAssetBalance = (): number => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useBalanceStore((state) => totalBalanceOfType(state.entries, activeProfileId, 'asset'))
}

/**
 * Get total debt balance
 */
export const useTotalDebtBalance = (): number => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useBalanceStore((state) => totalBalanceOfType(state.entries, activeProfileId, 'debt'))
}

// ⚠️ There is deliberately NO net-balance selector here (story 32.2, FR59).
//
// `useNetBalance` used to live at this spot and returned `investments − debts`.
// Net worth is now `investments + savings − debts`, and savings live in a
// different store this one cannot see — so any selector defined here is
// structurally incapable of returning the right number. Its single consumer had
// already imported it as `useNetBalance as useNetWorth`, i.e. the wrong
// definition wearing the right name at the only call site, which is exactly how
// it survived review. Read `useNetWorth()` (`hooks/useNetWorth.ts`) instead; the
// arithmetic itself lives in `lib/net-worth.ts`.

/**
 * Get current filter
 */
export const useBalanceFilter = (): BalanceTrackingFilter =>
  useBalanceStore((state) => state.filter)

/**
 * Get entry count
 */
export const useBalanceEntryCount = (): number => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useBalanceStore((state) => scopeToActiveProfile(state.entries, activeProfileId).length)
}

// ============================================================================
// Action Hooks
// ============================================================================

/**
 * Get all balance actions
 */
export const useBalanceActions = () =>
  useBalanceStore((state) => ({
    addBalanceEntry: state.addBalanceEntry,
    updateBalanceEntry: state.updateBalanceEntry,
    deleteBalanceEntry: state.deleteBalanceEntry,
    setFilter: state.setFilter,
    clearFilter: state.clearFilter,
    reset: state.reset,
  }))

// Re-export types
export type { FinanceType }

// Declare this collection to the profile cascade (story 66.3, FR104). Deleting a
// profile destroys the rows STRICTLY stamped with it; see `lib/profile-cascade.ts`
// for why the stores register themselves instead of that module importing them.
registerProfileScopedCollection(useBalanceStore, 'entries')
