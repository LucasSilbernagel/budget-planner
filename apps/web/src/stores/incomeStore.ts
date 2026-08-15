import { calculateTotalMonthlyNormalized } from '@budget-planner/core'
import type { Frequency } from '@budget-planner/db'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { countUnreadableRows, toNormalizableItems } from '../lib/readable-rows'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { generateUUID, withUuidIds } from '../lib/uuid'

// Client-side type for income source (with string timestamps for localStorage)
// For free tier without auth, userId defaults to 0
interface ClientIncomeSource {
  // Client-generatable uuid PK (Story 5-14): the row carries the SAME id on every
  // device, so a server pull reconciles by this id with no duplicates. Replaces
  // the old negative-integer temp id.
  id: string
  userId: number
  name: string
  amount: number
  frequency: Frequency
  // User-defined category (Story 30.4a, FR54). NULL/absent = uncategorized,
  // which is a permanently valid state — no form gains a required field.
  categoryId: string | null
  createdAt: string // ISO string for localStorage serialization
  updatedAt: string // ISO string for localStorage serialization
}

interface ClientNewIncomeSource {
  userId?: number // Optional for free tier (no auth yet)
  name: string
  amount: number
  frequency: Frequency
  categoryId?: string | null
}

// Define the type for our store state
interface IncomeState {
  incomeSources: ClientIncomeSource[]
  addIncomeSource: (incomeSource: ClientNewIncomeSource) => void
  updateIncomeSource: (id: string, updates: Partial<ClientNewIncomeSource>) => void
  deleteIncomeSource: (id: string) => void
  getIncomeSourceById: (id: string) => ClientIncomeSource | undefined
  getIncomeSourcesByFrequency: (frequency: Frequency) => ClientIncomeSource[]
  /** Monthly-normalized cents (story 32.1) — denormalize for display. */
  getTotalIncome: () => number
  /** Rows excluded from `getTotalIncome` because core could not read them. */
  getUnreadableIncomeCount: () => number
}

// Convert ClientNewIncomeSource to ClientIncomeSource (add id, userId, and timestamps as ISO strings)
// For free tier without auth, userId defaults to 0. The id is a client-generated
// uuid (Story 5-14) so an offline-created row keeps the SAME id once synced.
const toClientIncomeSource = (newSource: ClientNewIncomeSource): ClientIncomeSource => ({
  ...newSource,
  // Explicitly null rather than undefined so the persisted shape matches the
  // v2 migration's backfill and the sync payload never carries `undefined`.
  categoryId: newSource.categoryId ?? null,
  userId: newSource.userId ?? 0, // Default to 0 for free tier (no auth)
  id: generateUUID(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

export const useIncomeStore = create<IncomeState>()(
  persist(
    (set, get) => ({
      // Initial state
      incomeSources: [],

      // Add a new income source
      addIncomeSource: (newIncomeSource) => {
        const incomeSource = toClientIncomeSource(newIncomeSource)
        set((state) => ({
          incomeSources: [...state.incomeSources, incomeSource],
        }))
        // Paid tier: also push to the server (no-op for the free tier).
        syncEntityCreate('incomeSource', incomeSource)
      },

      // Update an existing income source
      updateIncomeSource: (id, updates) => {
        const previous = get().incomeSources.find((source) => source.id === id)
        if (!previous) {
          return
        }
        const updated = { ...previous, ...updates, updatedAt: new Date().toISOString() }
        set((state) => ({
          incomeSources: state.incomeSources.map((source) => (source.id === id ? updated : source)),
        }))
        // Paid tier: queue the update with the pre-edit row as the baseVersion.
        syncEntityUpdate('incomeSource', updated, previous)
      },

      // Delete an income source
      deleteIncomeSource: (id) => {
        const existing = get().incomeSources.find((source) => source.id === id)
        set((state) => ({
          incomeSources: state.incomeSources.filter((source) => source.id !== id),
        }))
        // Paid tier: queue a tombstone so the delete propagates to other devices.
        if (existing) {
          syncEntityDelete('incomeSource', existing)
        }
      },

      // Get income source by ID
      getIncomeSourceById: (id) => {
        return get().incomeSources.find((source) => source.id === id)
      },

      // Get income sources filtered by frequency
      getIncomeSourcesByFrequency: (frequency) => {
        return get().incomeSources.filter((source) => source.frequency === frequency)
      },

      /**
       * Total income as MONTHLY-NORMALIZED cents (story 32.1, FR58).
       *
       * ⚠️ This used to raw-`reduce` `amount` across mixed frequencies, adding a
       * weekly $200 to a monthly $1,500 as if the units matched — the FR58
       * defect. It now delegates to core, which is what makes it equal to the
       * Overview's figure BY CONSTRUCTION rather than by coincidence:
       * `calculateGrossPeriodIncome` (behind `calculateNetIncomeResult`) is a
       * thin wrapper over this same function.
       *
       * ⚠️ Callers must denormalize for display —
       * `denormalizeFromMonthly(total, duration)`. Never re-derive the
       * multipliers; they are core-private on purpose.
       *
       * ⚠️ MUST return a `number`. `useTotalIncome` below calls this INSIDE a
       * zustand selector, so an object return would fail v4's `Object.is`
       * equality every render and spin an infinite re-render loop.
       *
       * Rows core cannot read are excluded, never coerced — see
       * `lib/readable-rows` for why, and `getUnreadableIncomeCount` for the
       * count the UI discloses.
       */
      getTotalIncome: () => {
        return calculateTotalMonthlyNormalized(toNormalizableItems(get().incomeSources))
      },

      /**
       * How many persisted rows `getTotalIncome` had to exclude because core
       * could not read them (corrupt frequency or non-finite amount).
       *
       * Exists so the page can DISCLOSE the omission instead of silently
       * under-reporting the user's money.
       */
      getUnreadableIncomeCount: () => {
        return countUnreadableRows(get().incomeSources)
      },
    }),
    {
      name: 'budget-planner-income-v1',
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration)
      skipHydration: true,
      // v1 (Story 5-14): entity ids became uuid strings — convert any legacy
      // negative-integer ids persisted under v0 to fresh uuids so they don't
      // break sync push (uuid column) / pull reconciliation.
      // v2 (Story 30.4a): backfill `categoryId: null` so a row written before
      // categories existed is explicitly uncategorized rather than carrying an
      // absent key. Both steps run for a v0/v1 payload.
      //
      // ⚠️ `migrate` runs on ANY version MISMATCH, not only on an upgrade
      // (correction by code review 30.4a — the previous comment claimed
      // "only ... BELOW version", which is false). zustand 4.5.7 gates on
      // `deserializedStorageValue.version !== options.version`, so a payload
      // written by a NEWER build (a downgrade) is put through this same function.
      // Both steps here are idempotent, which is the only reason that is safe
      // today — a future v3 must not assume it is only ever called upward.
      // Note also that when `version` is absent or non-numeric zustand skips
      // `migrate` entirely and uses the raw state, so `categoryId` stays
      // undefined rather than null on such a payload.
      //
      // ⚠️ The persist KEY is unchanged. The `-v1` suffix in the name is part of
      // the storage key, NOT the numeric `version` — renaming it would orphan
      // every existing row instead of migrating it (see profileStore's note).
      version: 2,
      migrate: (persisted) => {
        const state = persisted as { incomeSources?: unknown }
        // ⚠️ Sanitize BEFORE anything dereferences a row (code review 30.4a).
        // The persisted array is untrusted JSON, not `ClientIncomeSource[]` — the
        // cast asserts a shape nobody verified. A single null/non-object entry
        // (truncated write, hand-edited storage, an older bug) made both
        // `withUuidIds`' `item.id` and the `categoryId` backfill throw, and a
        // throwing `migrate` fails rehydration entirely: the store keeps its
        // empty default and the user's whole income list silently disappears.
        // `withUuidIds` must therefore receive an already-clean array.
        const raw = Array.isArray(state?.incomeSources) ? state.incomeSources : []
        const rows = raw.filter(
          (row): row is ClientIncomeSource => typeof row === 'object' && row !== null
        )
        return {
          incomeSources: withUuidIds(rows).map((row) => ({
            ...row,
            categoryId: row.categoryId ?? null,
          })),
        }
      },
      partialize: (state) => ({
        incomeSources: state.incomeSources,
      }),
    }
  )
)

// Selector hooks for better performance
export const useIncomeSources = () => useIncomeStore((state) => state.incomeSources)

/** Monthly-normalized cents (story 32.1) — denormalize before display. */
export const useTotalIncome = () => useIncomeStore((state) => state.getTotalIncome())

export const useUnreadableIncomeCount = () =>
  useIncomeStore((state) => state.getUnreadableIncomeCount())

export const useIncomeByFrequency = (frequency: Frequency) =>
  useIncomeStore((state) => state.getIncomeSourcesByFrequency(frequency))

// Client-side persistence enabled via Zustand persist middleware
// Data persists in localStorage across page refreshes
// Uses string timestamps for proper serialization
// Note: These types are for client-side storage; db package types are for database
