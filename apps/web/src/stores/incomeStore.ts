import { calculateTotalMonthlyNormalized } from '@budget-planner/core'
import type { Frequency } from '@budget-planner/db'
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { backfillSortOrder, nextSortOrder, sortByDisplayOrder } from '../lib/ordering'
import { registerProfileScopedCollection } from '../lib/profile-cascade'
import { scopeToActiveProfile } from '../lib/profile-scope'
import { countUnreadableRows, toNormalizableItems } from '../lib/readable-rows'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { generateUUID, withUuidIds } from '../lib/uuid'
import { INCOME_STORAGE_KEY } from './overview-data-storage-keys'
import { useProfileStore } from './profileStore'

interface ClientIncomeSource {
  id: string
  // Null/absent means unscoped (visible under every profile). Not on the input type: an edit must
  // never re-home a row.
  profileId?: string | null
  userId: number | string
  name: string
  amount: number
  frequency: Frequency
  categoryId: string | null
  // An order, not an index: deletes leave gaps on purpose.
  sortOrder?: number
  createdAt: string
  updatedAt: string
}

interface ClientNewIncomeSource {
  userId?: number
  name: string
  amount: number
  frequency: Frequency
  categoryId?: string | null
}

interface IncomeState {
  incomeSources: ClientIncomeSource[]
  addIncomeSource: (incomeSource: ClientNewIncomeSource) => void
  updateIncomeSource: (id: string, updates: Partial<ClientNewIncomeSource>) => void
  deleteIncomeSource: (id: string) => void
  getIncomeSourceById: (id: string) => ClientIncomeSource | undefined
  getIncomeSourcesByFrequency: (frequency: Frequency) => ClientIncomeSource[]
  /** Monthly-normalized cents; denormalize for display. */
  getTotalIncome: () => number
  getUnreadableIncomeCount: () => number
}

const toClientIncomeSource = (newSource: ClientNewIncomeSource): ClientIncomeSource => ({
  ...newSource,
  // Explicit null so the sync payload never carries undefined.
  categoryId: newSource.categoryId ?? null,
  userId: newSource.userId ?? 0,
  id: generateUUID(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

/**
 * Selector hooks must call these with the state rows, never the equivalent store METHOD: methods
 * close over get() and read live state during hydration, causing a mismatch. Must return a number.
 */
function totalIncomeFrom(rows: readonly ClientIncomeSource[]): number {
  return calculateTotalMonthlyNormalized(toNormalizableItems(rows))
}

function incomeSourcesByFrequencyFrom(
  rows: readonly ClientIncomeSource[],
  frequency: Frequency
): ClientIncomeSource[] {
  return rows.filter((row) => row.frequency === frequency)
}

function unreadableIncomeCountFrom(rows: readonly ClientIncomeSource[]): number {
  return countUnreadableRows(rows)
}
export const useIncomeStore = create<IncomeState>()(
  persist(
    (set, get) => ({
      incomeSources: [],

      addIncomeSource: (newIncomeSource) => {
        const incomeSource: ClientIncomeSource = {
          ...toClientIncomeSource(newIncomeSource),
          sortOrder: nextSortOrder(get().incomeSources),
          profileId: useProfileStore.getState().activeProfileId ?? null,
        }
        set((state) => ({
          incomeSources: sortByDisplayOrder([...state.incomeSources, incomeSource]),
        }))
        syncEntityCreate('incomeSource', incomeSource)
      },

      updateIncomeSource: (id, updates) => {
        const previous = get().incomeSources.find((source) => source.id === id)
        if (!previous) {
          return
        }
        const updated = { ...previous, ...updates, updatedAt: new Date().toISOString() }
        set((state) => ({
          incomeSources: sortByDisplayOrder(
            state.incomeSources.map((source) => (source.id === id ? updated : source))
          ),
        }))
        syncEntityUpdate('incomeSource', updated, previous)
      },

      deleteIncomeSource: (id) => {
        const existing = get().incomeSources.find((source) => source.id === id)
        set((state) => ({
          incomeSources: state.incomeSources.filter((source) => source.id !== id),
        }))
        if (existing) {
          syncEntityDelete('incomeSource', existing)
        }
      },

      getIncomeSourceById: (id) => {
        return get().incomeSources.find((source) => source.id === id)
      },

      getIncomeSourcesByFrequency: (frequency) => {
        return incomeSourcesByFrequencyFrom(get().incomeSources, frequency)
      },

      /** Rows core cannot read are excluded, never coerced; getUnreadableIncomeCount discloses them. */
      getTotalIncome: () => {
        return totalIncomeFrom(get().incomeSources)
      },

      getUnreadableIncomeCount: () => {
        return unreadableIncomeCountFrom(get().incomeSources)
      },
    }),
    {
      name: INCOME_STORAGE_KEY,
      skipHydration: true,
      // migrate runs on ANY version mismatch, including a downgrade, so every step must be idempotent.
      // The `-v1` in the storage key is part of the key, not this version.
      version: 3,
      migrate: (persisted) => {
        const state = persisted as { incomeSources?: unknown }
        // Sanitize before dereferencing rows: a throwing migrate fails rehydration and silently empties the list.
        const raw = Array.isArray(state?.incomeSources) ? state.incomeSources : []
        const rows = raw.filter(
          (row): row is ClientIncomeSource => typeof row === 'object' && row !== null
        )
        return {
          // Backfill runs last so the id tiebreaker sees the final uuids, not the legacy ids.
          incomeSources: backfillSortOrder(
            withUuidIds(rows).map((row) => ({
              ...row,
              categoryId: row.categoryId ?? null,
            }))
          ),
        }
      },
      partialize: (state) => ({
        incomeSources: state.incomeSources,
      }),
    }
  )
)

/**
 * Holds every profile's rows: each hook deriving from them must scope to the active profile.
 * Store methods are deliberately unscoped (sync seeding, purge operate on every row).
 */
export const useIncomeSources = (): ClientIncomeSource[] => {
  const rows = useIncomeStore((state) => state.incomeSources)
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useMemo(() => scopeToActiveProfile(rows, activeProfileId), [rows, activeProfileId])
}

export const useTotalIncome = () => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useIncomeStore((state) =>
    totalIncomeFrom(scopeToActiveProfile(state.incomeSources, activeProfileId))
  )
}

export const useUnreadableIncomeCount = () => {
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useIncomeStore((state) =>
    unreadableIncomeCountFrom(scopeToActiveProfile(state.incomeSources, activeProfileId))
  )
}

export const useIncomeByFrequency = (frequency: Frequency): ClientIncomeSource[] => {
  const rows = useIncomeSources()
  return useMemo(() => incomeSourcesByFrequencyFrom(rows, frequency), [rows, frequency])
}

// Stores register themselves: the cascade importing them would create an import cycle.
registerProfileScopedCollection(useIncomeStore, 'incomeSources')
