import type { Frequency } from '@budget-planner/db'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Client-side type for expense (with string timestamps for localStorage)
// For free tier without auth, userId defaults to 0
interface ClientExpense {
  id: number
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
  updateExpense: (id: number, updates: Partial<ClientNewExpense>) => void
  deleteExpense: (id: number) => void
  getExpenseById: (id: number) => ClientExpense | undefined
  getExpensesByFrequency: (frequency: Frequency) => ClientExpense[]
  getTotalExpenses: () => number
}

// Helper to generate a temporary ID for client-side storage
// Note: In production with backend, IDs will come from the database
// Using negative IDs for temporary client-side entries to avoid conflicts
// Start at -20000 to avoid conflicts with income IDs
let expenseTempIdCounter = -20000
const generateExpenseTempId = (): number => {
  // Check existing IDs and find the minimum to avoid conflicts
  // This is a simple approach; for production, use a more robust ID system
  expenseTempIdCounter -= 1
  return expenseTempIdCounter
}

// Convert ClientNewExpense to ClientExpense (add id, userId, and timestamps as ISO strings)
// For free tier without auth, userId defaults to 0
const toClientExpense = (newExpense: ClientNewExpense): ClientExpense => ({
  ...newExpense,
  userId: newExpense.userId ?? 0, // Default to 0 for free tier (no auth)
  id: generateExpenseTempId(),
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
      },

      // Update an existing expense
      updateExpense: (id, updates) => {
        set((state) => ({
          expenses: state.expenses.map((expense) =>
            expense.id === id
              ? { ...expense, ...updates, updatedAt: new Date().toISOString() }
              : expense
          ),
        }))
      },

      // Delete an expense
      deleteExpense: (id) => {
        set((state) => ({
          expenses: state.expenses.filter((expense) => expense.id !== id),
        }))
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
