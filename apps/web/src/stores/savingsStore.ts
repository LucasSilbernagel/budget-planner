import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Client-side type for savings goal (with string timestamps for localStorage)
// For free tier without auth, userId defaults to 0
interface ClientSavingsGoal {
  id: number
  userId: number
  name: string
  targetAmount: number  // Amount in cents
  currentBalance: number  // Amount in cents
  createdAt: string  // ISO string for localStorage serialization
  updatedAt: string  // ISO string for localStorage serialization
}

interface ClientNewSavingsGoal {
  userId?: number  // Optional for free tier (no auth yet)
  name: string
  targetAmount: number  // Amount in cents
  currentBalance: number  // Amount in cents
}

// Define the type for our store state
interface SavingsState {
  savingsGoals: ClientSavingsGoal[]
  addSavingsGoal: (goal: ClientNewSavingsGoal) => void
  updateSavingsGoal: (id: number, updates: Partial<ClientNewSavingsGoal>) => void
  deleteSavingsGoal: (id: number) => void
  getSavingsGoalById: (id: number) => ClientSavingsGoal | undefined
  getTotalSavings: () => number
  getSavingsProgress: (id: number) => number // Returns percentage (0-100)
}

// Helper to generate a temporary ID for client-side storage
// Note: In production with backend, IDs will come from the database
// Using negative IDs for temporary client-side entries to avoid conflicts
// Start at -30000 to avoid conflicts with income and expense IDs
let savingsTempIdCounter = -30000
const generateSavingsTempId = (): number => {
  savingsTempIdCounter -= 1
  return savingsTempIdCounter
}

// Convert ClientNewSavingsGoal to ClientSavingsGoal (add id, userId, and timestamps as ISO strings)
// For free tier without auth, userId defaults to 0
const toClientSavingsGoal = (newGoal: ClientNewSavingsGoal): ClientSavingsGoal => ({
  ...newGoal,
  userId: newGoal.userId ?? 0,  // Default to 0 for free tier (no auth)
  id: generateSavingsTempId(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

export const useSavingsStore = create<SavingsState>()(
  persist(
    (set, get) => ({
      // Initial state
      savingsGoals: [],

      // Add a new savings goal
      addSavingsGoal: (newGoal) => {
        const goal = toClientSavingsGoal(newGoal)
        set((state) => ({
          savingsGoals: [...state.savingsGoals, goal],
        }))
      },

      // Update an existing savings goal
      updateSavingsGoal: (id, updates) => {
        set((state) => ({
          savingsGoals: state.savingsGoals.map((goal) =>
            goal.id === id
              ? { ...goal, ...updates, updatedAt: new Date().toISOString() }
              : goal
          ),
        }))
      },

      // Delete a savings goal
      deleteSavingsGoal: (id) => {
        set((state) => ({
          savingsGoals: state.savingsGoals.filter(
            (goal) => goal.id !== id
          ),
        }))
      },

      // Get savings goal by ID
      getSavingsGoalById: (id) => {
        return get().savingsGoals.find((goal) => goal.id === id)
      },

      // Calculate total savings (sum of all current balances)
      getTotalSavings: () => {
        return get().savingsGoals.reduce(
          (sum, goal) => sum + goal.currentBalance,
          0
        )
      },

      // Calculate progress percentage for a specific savings goal
      getSavingsProgress: (id) => {
        const goal = get().savingsGoals.find((g) => g.id === id)
        if (!goal || goal.targetAmount === 0) return 0
        return Math.min(100, Math.round((goal.currentBalance / goal.targetAmount) * 100))
      },
    }),
    {
      name: 'budget-planner-savings-v1',
      partialize: (state) => ({
        savingsGoals: state.savingsGoals,
      }),
    }
  )
)

// Selector hooks for better performance
export const useSavingsGoals = () =>
  useSavingsStore((state) => state.savingsGoals)

export const useTotalSavings = () =>
  useSavingsStore((state) => state.getTotalSavings())

// Client-side persistence enabled via Zustand persist middleware
// Data persists in localStorage across page refreshes
// Uses string timestamps for proper serialization
// Note: These types are for client-side storage; db package types are for database
