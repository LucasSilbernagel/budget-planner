import type { Frequency } from '@budget-planner/db'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { generateUUID, withUuidIds } from '../lib/uuid'

// Client-side type for expense (with string timestamps for localStorage)
// For free tier without auth, userId defaults to 0
interface ClientExpense {
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

interface ClientNewExpense {
  userId?: number // Optional for free tier (no auth yet)
  name: string
  amount: number
  frequency: Frequency
}

// Define the type for our store state
interface ExpenseState {
  expenses: ClientExpense[]
  addExpense: (expense: ClientNewExpense) => void
  updateExpense: (id: string, updates: Partial<ClientNewExpense>) => void
  deleteExpense: (id: string) => void
  getExpenseById: (id: string) => ClientExpense | undefined
  getExpensesByFrequency: (frequency: Frequency) => ClientExpense[]
  getTotalExpenses: () => number
}

// Convert ClientNewExpense to ClientExpense (add id, userId, and timestamps as ISO strings)
// For free tier without auth, userId defaults to 0. The id is a client-generated
// uuid (Story 5-14) so an offline-created row keeps the SAME id once synced.
const toClientExpense = (newExpense: ClientNewExpense): ClientExpense => ({
  ...newExpense,
  userId: newExpense.userId ?? 0, // Default to 0 for free tier (no auth)
  id: generateUUID(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

export const useExpenseStore = create<ExpenseState>()(
  persist(
    (set, get) => ({
      // Initial state
      expenses: [],

      // Add a new expense
      addExpense: (newExpense) => {
        const expense = toClientExpense(newExpense)
        set((state) => ({
          expenses: [...state.expenses, expense],
        }))
        // Paid tier: also push to the server (no-op for the free tier).
        syncEntityCreate('expense', expense)
      },

      // Update an existing expense
      updateExpense: (id, updates) => {
        const previous = get().expenses.find((expense) => expense.id === id)
        if (!previous) {
          return
        }
        const updated = { ...previous, ...updates, updatedAt: new Date().toISOString() }
        set((state) => ({
          expenses: state.expenses.map((expense) => (expense.id === id ? updated : expense)),
        }))
        // Paid tier: queue the update with the pre-edit row as the baseVersion.
        syncEntityUpdate('expense', updated, previous)
      },

      // Delete an expense
      deleteExpense: (id) => {
        const existing = get().expenses.find((expense) => expense.id === id)
        set((state) => ({
          expenses: state.expenses.filter((expense) => expense.id !== id),
        }))
        // Paid tier: queue a tombstone so the delete propagates to other devices.
        if (existing) {
          syncEntityDelete('expense', existing)
        }
      },

      // Get expense by ID
      getExpenseById: (id) => {
        return get().expenses.find((expense) => expense.id === id)
      },

      // Get expenses filtered by frequency
      getExpensesByFrequency: (frequency) => {
        return get().expenses.filter((expense) => expense.frequency === frequency)
      },

      // Calculate total expenses (sum of all amounts in cents)
      getTotalExpenses: () => {
        return get().expenses.reduce((sum, expense) => sum + expense.amount, 0)
      },
    }),
    {
      name: 'budget-planner-expenses-v1',
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration)
      skipHydration: true,
      // v1 (Story 5-14): convert any legacy negative-integer ids to fresh uuids.
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { expenses?: ClientExpense[] }
        return { expenses: withUuidIds(state?.expenses) }
      },
      partialize: (state) => ({
        expenses: state.expenses,
      }),
    }
  )
)

// Selector hooks for better performance
export const useExpenses = () => useExpenseStore((state) => state.expenses)

export const useTotalExpenses = () => useExpenseStore((state) => state.getTotalExpenses())

export const useExpenseByFrequency = (frequency: Frequency) =>
  useExpenseStore((state) => state.getExpensesByFrequency(frequency))

// Client-side persistence enabled via Zustand persist middleware
// Data persists in localStorage across page refreshes
// Dates are stored as ISO strings for proper serialization
