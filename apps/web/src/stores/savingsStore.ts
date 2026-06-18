import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ClientSavingsGoal,
  ClientNewSavingsGoal,
} from '@budget-planner/core/services/savingsGoals'
import {
  sortByCreationDate,
  withProgress,
} from '@budget-planner/core/services/savingsGoals'
import type { SavingsGoalWithProgress } from '@budget-planner/core/services/savingsGoals'

// Define the type for our store state
interface SavingsState {
  savingsGoals: ClientSavingsGoal[]

  // CRUD operations
  addSavingsGoal: (goal: ClientNewSavingsGoal) => ClientSavingsGoal
  updateSavingsGoal: (id: number, updates: Partial<ClientNewSavingsGoal>) => ClientSavingsGoal | undefined
  deleteSavingsGoal: (id: number) => boolean

  // Query operations
  getSavingsGoalById: (id: number) => ClientSavingsGoal | undefined
  getSavingsGoalsWithProgress: () => SavingsGoalWithProgress[]
  getTotalSavings: () => number
  getTotalTargetAmount: () => number
  getSavingsProgress: (id: number) => number // Returns percentage (0-100)
  getOverallProgress: () => number // Returns percentage across all goals
}

// Helper to generate a temporary ID for client-side storage
// Note: In production with backend, IDs will come from the database
// Using negative IDs for temporary client-side entries to avoid conflicts
// Start at -20000 to match the core service constant
import { generateSavingsGoalTempId, toClientSavingsGoal } from '@budget-planner/core/services/savingsGoals'

// Storage key for localStorage
// Using the key specified in Dev Notes: localStorage: `budget-planner:savings-goals`
export const SAVINGS_GOALS_STORAGE_KEY = 'budget-planner:savings-goals'

export const useSavingsStore = create<SavingsState>()(
  persist(
    (set, get) => ({
      // Initial state
      savingsGoals: [],

      // Add a new savings goal
      addSavingsGoal: (newGoal: ClientNewSavingsGoal) => {
        const goal = toClientSavingsGoal(newGoal)
        set((state) => ({
          savingsGoals: sortByCreationDate([...state.savingsGoals, goal]),
        }))
        return goal
      },

      // Update an existing savings goal
      updateSavingsGoal: (id: number, updates: Partial<ClientNewSavingsGoal>) => {
        const state = get()
        const index = state.savingsGoals.findIndex((g) => g.id === id)

        if (index === -1) {
          return undefined
        }

        const updatedGoal: ClientSavingsGoal = {
          ...state.savingsGoals[index],
          ...updates,
          updatedAt: new Date().toISOString(),
        }

        set((state) => ({
          savingsGoals: sortByCreationDate([
            ...state.savingsGoals.slice(0, index),
            updatedGoal,
            ...state.savingsGoals.slice(index + 1),
          ]),
        }))

        return updatedGoal
      },

      // Delete a savings goal
      deleteSavingsGoal: (id: number) => {
        const state = get()
        const exists = state.savingsGoals.some((g) => g.id === id)

        if (exists) {
          set((state) => ({
            savingsGoals: state.savingsGoals.filter((g) => g.id !== id),
          }))
        }

        return exists
      },

      // Get savings goal by ID
      getSavingsGoalById: (id: number) => {
        return get().savingsGoals.find((goal) => goal.id === id)
      },

      // Get all savings goals with progress calculated
      getSavingsGoalsWithProgress: () => {
        return get().savingsGoals.map(withProgress)
      },

      // Calculate total savings (sum of all current balances)
      getTotalSavings: () => {
        return get().savingsGoals.reduce(
          (sum, goal) => sum + goal.currentBalance,
          0
        )
      },

      // Calculate total target amount across all goals
      getTotalTargetAmount: () => {
        return get().savingsGoals.reduce(
          (sum, goal) => sum + goal.targetAmount,
          0
        )
      },

      // Calculate progress percentage for a specific savings goal
      getSavingsProgress: (id: number) => {
        const goal = get().savingsGoals.find((g) => g.id === id)
        if (!goal || goal.targetAmount === 0) return 0
        return Math.min(100, Math.round((goal.currentBalance / goal.targetAmount) * 100))
      },

      // Calculate overall progress percentage across all savings goals
      getOverallProgress: () => {
        const state = get()
        const totalBalance = state.savingsGoals.reduce(
          (sum, goal) => sum + goal.currentBalance,
          0
        )
        const totalTarget = state.savingsGoals.reduce(
          (sum, goal) => sum + goal.targetAmount,
          0
        )
        if (totalTarget <= 0) return 0
        return Math.min(100, Math.round((totalBalance / totalTarget) * 100))
      },
    }),
    {
      name: SAVINGS_GOALS_STORAGE_KEY,
      partialize: (state) => ({
        savingsGoals: state.savingsGoals,
      }),
    }
  )
)

// Selector hooks for better performance
export const useSavingsGoals = () =>
  useSavingsStore((state) => state.savingsGoals)

export const useSavingsGoalsWithProgress = () =>
  useSavingsStore((state) => state.getSavingsGoalsWithProgress())

export const useTotalSavings = () =>
  useSavingsStore((state) => state.getTotalSavings())

export const useTotalTargetAmount = () =>
  useSavingsStore((state) => state.getTotalTargetAmount())

export const useOverallSavingsProgress = () =>
  useSavingsStore((state) => state.getOverallProgress())

// Selector for actions
export const useSavingsActions = () => ({
  addSavingsGoal: useSavingsStore((state) => state.addSavingsGoal),
  updateSavingsGoal: useSavingsStore((state) => state.updateSavingsGoal),
  deleteSavingsGoal: useSavingsStore((state) => state.deleteSavingsGoal),
  getSavingsGoalById: useSavingsStore((state) => state.getSavingsGoalById),
})

// Client-side persistence enabled via Zustand persist middleware
// Data persists in localStorage across page refreshes
// Uses string timestamps for proper serialization
// Note: These types are for client-side storage; db package types are for database
// Integration with core service layer for type safety and business logic
