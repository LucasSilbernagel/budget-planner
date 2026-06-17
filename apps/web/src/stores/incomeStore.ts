import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Frequency } from '@budget-planner/db'

// Client-side type for income source (with string timestamps for localStorage)
// For free tier without auth, userId defaults to 0
interface ClientIncomeSource {
  id: number
  userId: number
  name: string
  amount: number
  frequency: Frequency
  createdAt: string  // ISO string for localStorage serialization
  updatedAt: string  // ISO string for localStorage serialization
}

interface ClientNewIncomeSource {
  userId?: number  // Optional for free tier (no auth yet)
  name: string
  amount: number
  frequency: Frequency
}

// Define the type for our store state
interface IncomeState {
  incomeSources: ClientIncomeSource[]
  addIncomeSource: (incomeSource: ClientNewIncomeSource) => void
  updateIncomeSource: (id: number, updates: Partial<ClientNewIncomeSource>) => void
  deleteIncomeSource: (id: number) => void
  getIncomeSourceById: (id: number) => ClientIncomeSource | undefined
  getIncomeSourcesByFrequency: (frequency: Frequency) => ClientIncomeSource[]
  getTotalIncome: () => number
}

// Helper to generate a temporary ID for client-side storage
// Note: In production with backend, IDs will come from the database
// Using negative IDs for temporary client-side entries to avoid conflicts
// Start at -10000 to avoid conflicts with expense IDs
let incomeTempIdCounter = -10000
const generateIncomeTempId = (): number => {
  incomeTempIdCounter -= 1
  return incomeTempIdCounter
}

// Convert ClientNewIncomeSource to ClientIncomeSource (add id, userId, and timestamps as ISO strings)
// For free tier without auth, userId defaults to 0
const toClientIncomeSource = (newSource: ClientNewIncomeSource): ClientIncomeSource => ({
  ...newSource,
  userId: newSource.userId ?? 0,  // Default to 0 for free tier (no auth)
  id: generateIncomeTempId(),
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
          incomeSources: state.incomeSources.filter(
            (source) => source.id !== id
          ),
        }))
      },

      // Get income source by ID
      getIncomeSourceById: (id) => {
        return get().incomeSources.find((source) => source.id === id)
      },

      // Get income sources filtered by frequency
      getIncomeSourcesByFrequency: (frequency) => {
        return get().incomeSources.filter(
          (source) => source.frequency === frequency
        )
      },

      // Calculate total income (sum of all amounts in cents)
      getTotalIncome: () => {
        return get().incomeSources.reduce(
          (sum, source) => sum + source.amount,
          0
        )
      },
    }),
    {
      name: 'budget-planner-income-v1',
      partialize: (state) => ({
        incomeSources: state.incomeSources,
      }),
    }
  )
)

// Selector hooks for better performance
export const useIncomeSources = () =>
  useIncomeStore((state) => state.incomeSources)

export const useTotalIncome = () =>
  useIncomeStore((state) => state.getTotalIncome())

export const useIncomeByFrequency = (frequency: Frequency) =>
  useIncomeStore((state) => state.getIncomeSourcesByFrequency(frequency))

// Client-side persistence enabled via Zustand persist middleware
// Data persists in localStorage across page refreshes
// Uses string timestamps for proper serialization
// Note: These types are for client-side storage; db package types are for database
