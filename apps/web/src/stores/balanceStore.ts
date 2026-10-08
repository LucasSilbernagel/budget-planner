import type {
  BalanceTrackingFilter,
  BalanceTrackingWithTimeline,
  ClientBalanceTracking,
  ClientNewBalanceTracking,
} from '@budget-planner/core/services/balanceTracking'
import {
  debtOwedCents,
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
import { BALANCE_TRACKING_STORAGE_KEY } from './overview-data-storage-keys'
import { useProfileStore } from './profileStore'

interface BalanceState {
  entries: ClientBalanceTracking[]

  filter: BalanceTrackingFilter

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

const STORAGE_KEY = BALANCE_TRACKING_STORAGE_KEY

export const useBalanceStore = create<BalanceState>()(
  persist(
    (set, get) => ({
      entries: [],
      filter: {},

      addBalanceEntry: (data: ClientNewBalanceTracking): ClientBalanceTracking | null => {
        const errors = validateBalanceTracking(data)
        if (errors.length > 0) {
          console.warn('Validation errors:', errors)
          return null
        }

        const newEntry: ClientBalanceTracking = {
          ...toClientBalanceTracking(data),
          sortOrder: nextSortOrder(get().entries),
          profileId: useProfileStore.getState().activeProfileId ?? null,
        }

        set((state) => ({
          entries: sortByDisplayOrder([...state.entries, newEntry]),
        }))

        syncEntityCreate('balanceTracking', newEntry)
        return newEntry
      },

      updateBalanceEntry: (
        id: string,
        data: Partial<ClientNewBalanceTracking>
      ): ClientBalanceTracking | null => {
        const previous = get().entries.find((e) => e.id === id)
        if (!previous) {
          return null
        }

        // Validate the merged entry: a partial omitting a required field is valid once the existing
        // values fill it in.
        const errors = validateBalanceTracking({ ...previous, ...data })
        if (errors.length > 0) {
          console.warn('Validation errors:', errors)
          return null
        }

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

        set((_state) => ({
          entries: sortByDisplayOrder(updatedEntries),
        }))

        const updatedEntry = updatedEntries.find((e) => e.id === id)
        if (updatedEntry) {
          syncEntityUpdate('balanceTracking', updatedEntry, previous)
        }
        return updatedEntry || null
      },

      deleteBalanceEntry: (id: string): boolean => {
        const existing = get().entries.find((e) => e.id === id)
        if (!existing) {
          return false
        }

        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        }))

        syncEntityDelete('balanceTracking', existing)
        return true
      },

      setFilter: (filter: BalanceTrackingFilter) => {
        set({ filter })
      },

      clearFilter: () => {
        set({ filter: {} })
      },

      reset: () => {
        set({
          entries: [],
          filter: {},
        })
      },
    }),
    {
      name: STORAGE_KEY,
      skipHydration: true,
      // Unpartitioned backfill still gives each profile's rows the same relative order as the SQL's
      // per-profile numbering (a subset of a sorted sequence stays sorted). Don't add partitioning.
      version: 4,
      migrate: (persisted) => {
        const state = persisted as { entries?: unknown }
        // Sanitize before dereferencing rows: a throwing migrate fails rehydration and silently empties the list.
        const raw = Array.isArray(state?.entries) ? state.entries : []
        const rows = raw.filter(
          (row): row is ClientBalanceTracking => typeof row === 'object' && row !== null
        )
        return {
          // Backfill runs last so the id tiebreaker sees the final uuids, not the legacy ids.
          entries: backfillSortOrder(
            withUuidIds(rows).map((entry) => {
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

/**
 * Holds every profile's rows: each hook deriving from entries must scope to the active profile.
 * getState() callers (sync seeding, purge) are deliberately unscoped.
 */

export const useBalanceEntries = (): ClientBalanceTracking[] => {
  const rows = useBalanceStore((state) => state.entries)
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useMemo(() => scopeToActiveProfile(rows, activeProfileId), [rows, activeProfileId])
}

export const useBalanceEntriesWithTimeline = (): BalanceTrackingWithTimeline[] => {
  const rows = useBalanceEntries()
  return useMemo(() => rows.map(withTimeline), [rows])
}

export const useFilteredBalanceEntries = (): BalanceTrackingWithTimeline[] => {
  const rows = useBalanceEntriesWithTimeline()
  const filter = useBalanceStore((state) => state.filter)
  return useMemo(() => filterBalanceTracking(rows, filter), [rows, filter])
}

export const useBalanceEntriesByType = (type: FinanceType): BalanceTrackingWithTimeline[] => {
  const rows = useBalanceEntriesWithTimeline()
  return useMemo(() => rows.filter((entry) => entry.type === type), [rows, type])
}

export const useInvestmentEntries = (): BalanceTrackingWithTimeline[] =>
  useBalanceEntriesByType('investment')

export const useDebtEntries = (): BalanceTrackingWithTimeline[] => useBalanceEntriesByType('debt')

export const useAssetEntries = (): BalanceTrackingWithTimeline[] => useBalanceEntriesByType('asset')

/** Debts are summed as the amount owed, so a negative debt cannot raise net worth. */
function totalBalanceOfType(
  entries: readonly ClientBalanceTracking[],
  activeProfileId: string | null,
  type: FinanceType
): number {
  const read = type === 'debt' ? debtOwedCents : (cents: number) => cents
  return scopeToActiveProfile(entries, activeProfileId)
    .filter((e) => e.type === type)
    .reduce((sum, entry) => sum + read(entry.currentBalance), 0)
}

export const useTotalInvestmentBalance = (): number => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useBalanceStore((state) =>
    totalBalanceOfType(state.entries, activeProfileId, 'investment')
  )
}

/**
 * Derive from the state argument: a selector calling a store method diverges between the
 * server render and hydration.
 */
export const useTotalAssetBalance = (): number => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useBalanceStore((state) => totalBalanceOfType(state.entries, activeProfileId, 'asset'))
}

export const useTotalDebtBalance = (): number => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useBalanceStore((state) => totalBalanceOfType(state.entries, activeProfileId, 'debt'))
}

export const useBalanceFilter = (): BalanceTrackingFilter =>
  useBalanceStore((state) => state.filter)

export const useBalanceEntryCount = (): number => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useBalanceStore((state) => scopeToActiveProfile(state.entries, activeProfileId).length)
}

export const useBalanceActions = () =>
  useBalanceStore((state) => ({
    addBalanceEntry: state.addBalanceEntry,
    updateBalanceEntry: state.updateBalanceEntry,
    deleteBalanceEntry: state.deleteBalanceEntry,
    setFilter: state.setFilter,
    clearFilter: state.clearFilter,
    reset: state.reset,
  }))

export type { FinanceType }

// Stores register themselves: the cascade importing them would create an import cycle.
registerProfileScopedCollection(useBalanceStore, 'entries')
