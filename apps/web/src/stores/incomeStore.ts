import type { Frequency } from '@budget-planner/db'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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
  createdAt: string // ISO string for localStorage serialization
  updatedAt: string // ISO string for localStorage serialization
}

interface ClientNewIncomeSource {
  userId?: number // Optional for free tier (no auth yet)
  name: string
  amount: number
  frequency: Frequency
}

// Define the type for our store state
interface IncomeState {
  incomeSources: ClientIncomeSource[]
  addIncomeSource: (incomeSource: ClientNewIncomeSource) => void
  updateIncomeSource: (id: string, updates: Partial<ClientNewIncomeSource>) => void
  deleteIncomeSource: (id: string) => void
  getIncomeSourceById: (id: string) => ClientIncomeSource | undefined
  getIncomeSourcesByFrequency: (frequency: Frequency) => ClientIncomeSource[]
  getTotalIncome: () => number
}

// Convert ClientNewIncomeSource to ClientIncomeSource (add id, userId, and timestamps as ISO strings)
// For free tier without auth, userId defaults to 0. The id is a client-generated
// uuid (Story 5-14) so an offline-created row keeps the SAME id once synced.
const toClientIncomeSource = (newSource: ClientNewIncomeSource): ClientIncomeSource => ({
  ...newSource,
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
      },

      // Update an existing income source
      updateIncomeSource: (id, updates) => {
        set((state) => ({
          incomeSources: state.incomeSources.map((source) =>
            source.id === id
              ? { ...source, ...updates, updatedAt: new Date().toISOString() }
              : source
          ),
        }))
      },

      // Delete an income source
      deleteIncomeSource: (id) => {
        set((state) => ({
          incomeSources: state.incomeSources.filter((source) => source.id !== id),
        }))
      },

      // Get income source by ID
      getIncomeSourceById: (id) => {
        return get().incomeSources.find((source) => source.id === id)
      },

      // Get income sources filtered by frequency
      getIncomeSourcesByFrequency: (frequency) => {
        return get().incomeSources.filter((source) => source.frequency === frequency)
      },

      // Calculate total income (sum of all amounts in cents)
      getTotalIncome: () => {
        return get().incomeSources.reduce((sum, source) => sum + source.amount, 0)
      },
    }),
    {
      name: 'budget-planner-income-v1',
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration)
      skipHydration: true,
      // v1 (Story 5-14): entity ids became uuid strings. Convert any legacy
      // negative-integer ids persisted under v0 to fresh uuids on first load so
      // they don't break sync push (uuid column) / pull reconciliation.
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { incomeSources?: ClientIncomeSource[] }
        return { incomeSources: withUuidIds(state?.incomeSources) }
      },
      partialize: (state) => ({
        incomeSources: state.incomeSources,
      }),
    }
  )
)

// Selector hooks for better performance
export const useIncomeSources = () => useIncomeStore((state) => state.incomeSources)

export const useTotalIncome = () => useIncomeStore((state) => state.getTotalIncome())

export const useIncomeByFrequency = (frequency: Frequency) =>
  useIncomeStore((state) => state.getIncomeSourcesByFrequency(frequency))

// Client-side persistence enabled via Zustand persist middleware
// Data persists in localStorage across page refreshes
// Uses string timestamps for proper serialization
// Note: These types are for client-side storage; db package types are for database
