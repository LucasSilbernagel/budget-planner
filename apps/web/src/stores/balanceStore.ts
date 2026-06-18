/**
 * Balance Tracking Store
 * 
 * Zustand store for client-side balance tracking state management.
 * Provides state, selectors, and actions for balance tracking entries.
 * 
 * Architecture:
 * - Uses Zustand for state management
 * - Persists to localStorage via persist middleware
 * - Works with core service layer for business logic
 * - Supports both free tier (client-side) and paid tier (server-side)
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ClientBalanceTracking,
  ClientNewBalanceTracking,
  BalanceTrackingFilter,
  BalanceTrackingWithTimeline,
} from '@budget-planner/core/services/balanceTracking'
import {
  toClientBalanceTracking,
  validateBalanceTracking,
  withTimeline,
  sortByCreationDate,
  filterBalanceTracking,
} from '@budget-planner/core/services/balanceTracking'
import type { FinanceType } from '@budget-planner/db'

// ============================================================================
// State Definition
// ============================================================================

/**
 * Balance store state
 */
interface BalanceState {
  // Balance tracking entries (client-side storage)
  entries: ClientBalanceTracking[]

  // Filter state
  filter: BalanceTrackingFilter

  // Actions
  addBalanceEntry: (data: ClientNewBalanceTracking) => ClientBalanceTracking | null
  updateBalanceEntry: (id: number, data: Partial<ClientNewBalanceTracking>) => ClientBalanceTracking | null
  deleteBalanceEntry: (id: number) => boolean
  setFilter: (filter: BalanceTrackingFilter) => void
  clearFilter: () => void
  reset: () => void
}

// ============================================================================
// Store Creation
// ============================================================================

/**
 * Storage key for localStorage persistence
 */
const STORAGE_KEY = 'budget-planner:balance-tracking'

/**
 * Create balance store with persistence
 */
export const useBalanceStore = create<BalanceState>()(
  persist(
    (set, get) => ({
      // Initial state
      entries: [],
      filter: {},

      // Add a new balance entry
      addBalanceEntry: (data: ClientNewBalanceTracking): ClientBalanceTracking | null => {
        // Validate input
        const errors = validateBalanceTracking(data)
        if (errors.length > 0) {
          console.warn('Validation errors:', errors)
          return null
        }

        // Convert to client entry with ID and timestamps
        const newEntry = toClientBalanceTracking(data)

        // Update state
        set((state) => ({
          entries: sortByCreationDate([...state.entries, newEntry]),
        }))

        return newEntry
      },

      // Update an existing balance entry
      updateBalanceEntry: (id: number, data: Partial<ClientNewBalanceTracking>): ClientBalanceTracking | null => {
        // Validate input
        const errors = validateBalanceTracking(data)
        if (errors.length > 0) {
          console.warn('Validation errors:', errors)
          return null
        }

        // Find and update entry
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

        // Check if entry was found
        const entryExists = get().entries.some((e) => e.id === id)
        if (!entryExists) {
          return null
        }

        // Update state
        set((state) => ({
          entries: sortByCreationDate(updatedEntries),
        }))

        // Return updated entry
        const updatedEntry = updatedEntries.find((e) => e.id === id)
        return updatedEntry || null
      },

      // Delete a balance entry
      deleteBalanceEntry: (id: number): boolean => {
        const entryExists = get().entries.some((e) => e.id === id)
        if (!entryExists) {
          return false
        }

        // Filter out the deleted entry
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        }))

        return true
      },

      // Set filter
      setFilter: (filter: BalanceTrackingFilter) => {
        set({ filter })
      },

      // Clear filter
      clearFilter: () => {
        set({ filter: {} })
      },

      // Reset store to initial state
      reset: () => {
        set({
          entries: [],
          filter: {},
        })
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        entries: state.entries,
      }),
    }
  )
)

// ============================================================================
// Selectors
// ============================================================================

/**
 * Get all balance entries
 */
export const useBalanceEntries = (): ClientBalanceTracking[] =>
  useBalanceStore((state) => state.entries)

/**
 * Get balance entries with timeline calculations
 */
export const useBalanceEntriesWithTimeline = (): BalanceTrackingWithTimeline[] =>
  useBalanceStore((state) => state.entries.map(withTimeline))

/**
 * Get filtered balance entries with timeline
 */
export const useFilteredBalanceEntries = (): BalanceTrackingWithTimeline[] =>
  useBalanceStore((state) => {
    const entriesWithTimeline = state.entries.map(withTimeline)
    return filterBalanceTracking(entriesWithTimeline, state.filter)
  })

/**
 * Get entries by type (investment or debt)
 */
export const useBalanceEntriesByType = (type: FinanceType): BalanceTrackingWithTimeline[] =>
  useBalanceStore((state) => {
    const entriesWithTimeline = state.entries.map(withTimeline)
    return entriesWithTimeline.filter((entry) => entry.type === type)
  })

/**
 * Get investment entries
 */
export const useInvestmentEntries = (): BalanceTrackingWithTimeline[] =>
  useBalanceEntriesByType('investment')

/**
 * Get debt entries
 */
export const useDebtEntries = (): BalanceTrackingWithTimeline[] =>
  useBalanceEntriesByType('debt')

/**
 * Get total investment balance
 */
export const useTotalInvestmentBalance = (): number =>
  useBalanceStore((state) =>
    state.entries
      .filter((e) => e.type === 'investment')
      .reduce((sum, entry) => sum + entry.currentBalance, 0)
  )

/**
 * Get total debt balance
 */
export const useTotalDebtBalance = (): number =>
  useBalanceStore((state) =>
    state.entries
      .filter((e) => e.type === 'debt')
      .reduce((sum, entry) => sum + entry.currentBalance, 0)
  )

/**
 * Get net balance (investments - debts)
 */
export const useNetBalance = (): number =>
  useBalanceStore((state) =>
    state.entries.reduce((sum, entry) => {
      // Investments add to balance, debts subtract
      return sum + (entry.type === 'investment' ? entry.currentBalance : -entry.currentBalance)
    }, 0)
  )

/**
 * Get current filter
 */
export const useBalanceFilter = (): BalanceTrackingFilter =>
  useBalanceStore((state) => state.filter)

/**
 * Get entry count
 */
export const useBalanceEntryCount = (): number =>
  useBalanceStore((state) => state.entries.length)

// ============================================================================
// Action Hooks
// ============================================================================

/**
 * Get all balance actions
 */
export const useBalanceActions = () =>
  useBalanceStore((state) => ({
    addBalanceEntry: state.addBalanceEntry,
    updateBalanceEntry: state.updateBalanceEntry,
    deleteBalanceEntry: state.deleteBalanceEntry,
    setFilter: state.setFilter,
    clearFilter: state.clearFilter,
    reset: state.reset,
  }))

// Re-export types
export type { FinanceType }
