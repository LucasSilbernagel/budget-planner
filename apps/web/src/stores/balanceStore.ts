import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Finance type for balance tracking
export type FinanceType = 'investment' | 'debt'

// Client-side type for balance tracking (with string timestamps for localStorage)
// For free tier without auth, userId defaults to 0
interface ClientBalanceTracking {
  id: number
  userId: number
  type: FinanceType
  name: string
  currentBalance: number  // Amount in cents
  maxContributionLimit: number | null  // Amount in cents (nullable)
  monthlyContribution: number  // Amount in cents
  createdAt: string  // ISO string for localStorage serialization
  updatedAt: string  // ISO string for localStorage serialization
}

interface ClientNewBalanceTracking {
  userId?: number  // Optional for free tier (no auth yet)
  type: FinanceType
  name: string
  currentBalance: number  // Amount in cents
  maxContributionLimit?: number | null  // Amount in cents (nullable)
  monthlyContribution: number  // Amount in cents
}

// Define the type for our store state
interface BalanceState {
  balanceEntries: ClientBalanceTracking[]
  addBalanceEntry: (entry: ClientNewBalanceTracking) => void
  updateBalanceEntry: (id: number, updates: Partial<ClientNewBalanceTracking>) => void
  deleteBalanceEntry: (id: number) => void
  getBalanceEntryById: (id: number) => ClientBalanceTracking | undefined
  getTotalInvestments: () => number
  getTotalDebts: () => number
  getNetWorth: () => number
}

// Helper to generate a temporary ID for client-side storage
// Note: In production with backend, IDs will come from the database
// Using negative IDs for temporary client-side entries to avoid conflicts
// Start at -40000 to avoid conflicts with other IDs
let balanceTempIdCounter = -40000
const generateBalanceTempId = (): number => {
  balanceTempIdCounter -= 1
  return balanceTempIdCounter
}

// Convert ClientNewBalanceTracking to ClientBalanceTracking (add id, userId, and timestamps as ISO strings)
// For free tier without auth, userId defaults to 0
const toClientBalanceTracking = (newEntry: ClientNewBalanceTracking): ClientBalanceTracking => ({
  ...newEntry,
  userId: newEntry.userId ?? 0,  // Default to 0 for free tier (no auth)
  id: generateBalanceTempId(),
  maxContributionLimit: newEntry.maxContributionLimit ?? null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

export const useBalanceStore = create<BalanceState>()(
  persist(
    (set, get) => ({
      // Initial state
      balanceEntries: [],

      // Add a new balance entry
      addBalanceEntry: (newEntry) => {
        const entry = toClientBalanceTracking(newEntry)
        set((state) => ({
          balanceEntries: [...state.balanceEntries, entry],
        }))
      },

      // Update an existing balance entry
      updateBalanceEntry: (id, updates) => {
        set((state) => ({
          balanceEntries: state.balanceEntries.map((entry) =>
            entry.id === id
              ? { ...entry, ...updates, updatedAt: new Date().toISOString() }
              : entry
          ),
        }))
      },

      // Delete a balance entry
      deleteBalanceEntry: (id) => {
        set((state) => ({
          balanceEntries: state.balanceEntries.filter(
            (entry) => entry.id !== id
          ),
        }))
      },

      // Get balance entry by ID
      getBalanceEntryById: (id) => {
        return get().balanceEntries.find((entry) => entry.id === id)
      },

      // Calculate total investments (sum of all investment balances)
      getTotalInvestments: () => {
        return get().balanceEntries
          .filter((entry) => entry.type === 'investment')
          .reduce((sum, entry) => sum + entry.currentBalance, 0)
      },

      // Calculate total debts (sum of all debt balances)
      getTotalDebts: () => {
        return get().balanceEntries
          .filter((entry) => entry.type === 'debt')
          .reduce((sum, entry) => sum + entry.currentBalance, 0)
      },

      // Calculate net worth (investments - debts)
      getNetWorth: () => {
        return get().getTotalInvestments() - get().getTotalDebts()
      },
    }),
    {
      name: 'budget-planner-balance-v1',
      partialize: (state) => ({
        balanceEntries: state.balanceEntries,
      }),
    }
  )
)

// Selector hooks for better performance
export const useBalanceEntries = () =>
  useBalanceStore((state) => state.balanceEntries)

export const useTotalInvestments = () =>
  useBalanceStore((state) => state.getTotalInvestments())

export const useTotalDebts = () =>
  useBalanceStore((state) => state.getTotalDebts())

export const useNetWorth = () =>
  useBalanceStore((state) => state.getNetWorth())

// Client-side persistence enabled via Zustand persist middleware
// Data persists in localStorage across page refreshes
// Uses string timestamps for proper serialization
// Note: These types are for client-side storage; db package types are for database
