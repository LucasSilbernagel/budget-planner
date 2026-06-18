/**
 * Balance Tracking Service
 * 
 * Core service layer for balance tracking operations.
 * Provides type definitions, validation, and business logic for investment and debt tracking.
 * 
 * Architecture:
 * - Pure TypeScript functions, no side effects
 * - Works with both client-side (free tier) and server-side (paid tier) data
 * - Database types imported from @budget-planner/db
 */

import type { BalanceTracking as DbBalanceTracking, FinanceType } from '@budget-planner/db'
import { calculateMonthsToLimit as calculateBalanceTimeline } from './utils/balanceCalculations'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Client-side Balance Tracking interface for free tier
 * Uses number IDs (for localStorage/IndexedDB) and string timestamps
 * Omits userId for free tier (no authentication)
 */
export interface ClientBalanceTracking {
  id: number
  type: FinanceType
  name: string
  currentBalance: number // In cents (can be negative for debts)
  maxContributionLimit?: number // In cents, optional
  monthlyContribution: number // In cents (default 0)
  createdAt: string // ISO string for localStorage serialization
  updatedAt: string // ISO string for localStorage serialization
  // Optional UI display fields
  monthsToLimit?: number | null
}

/**
 * Client-side new Balance Tracking (without ID and timestamps)
 */
export interface ClientNewBalanceTracking {
  type: FinanceType
  name: string
  currentBalance: number // In cents
  maxContributionLimit?: number // In cents, optional
  monthlyContribution: number // In cents (default 0)
}

/**
 * Balance Tracking with timeline calculation
 * Used for display purposes
 */
export interface BalanceTrackingWithTimeline extends ClientBalanceTracking {
  monthsToLimit: number | null
}

/**
 * Database Balance Tracking type (re-exported for convenience)
 * Uses serial IDs and Date objects
 */
export type DatabaseBalanceTracking = DbBalanceTracking

/**
 * Input type for creating a new balance tracking entry in the database
 */
export interface CreateBalanceTrackingInput {
  type: FinanceType
  name: string
  currentBalance: number // In cents
  maxContributionLimit?: number // In cents, optional
  monthlyContribution: number // In cents
  userId?: number // Optional for free tier (null), required for paid tier
}

/**
 * Input type for updating an existing balance tracking entry
 * Uses number IDs to align with database serial and client-side negative IDs
 */
export interface UpdateBalanceTrackingInput {
  id: number // Number ID: positive for DB (serial), negative for client-side
  type?: FinanceType
  name?: string
  currentBalance?: number // In cents
  maxContributionLimit?: number // In cents, optional
  monthlyContribution?: number // In cents
}

/**
 * Result type for balance tracking operations
 */
export interface BalanceTrackingResult {
  success: boolean
  data?: ClientBalanceTracking | DatabaseBalanceTracking
  error?: string
}

/**
 * Filter options for querying balance tracking entries
 */
export interface BalanceTrackingFilter {
  type?: FinanceType
  search?: string // Search by name
}

// ============================================================================
// Timeline Calculation
// ============================================================================

/**
 * Calculate months to max contribution limit
 * Re-exports from balanceCalculations for convenience
 */
export { calculateBalanceTimeline as calculateMonthsToLimit } from './utils/balanceCalculations'

/**
 * Determine display type properties based on FinanceType
 * 
 * @param type - Finance type ('investment' or 'debt')
 * @returns Display properties for theming
 */
export function getTypeDisplayProperties(type: FinanceType): {
  theme: 'success' | 'danger'
  icon: string
  label: string
  colorClass: string
  bgColorClass: string
} {
  const properties = {
    investment: {
      theme: 'success' as const,
      icon: '↗',
      label: 'Investment',
      colorClass: 'text-green-600 dark:text-green-400',
      bgColorClass: 'bg-green-100 dark:bg-green-900/30',
    },
    debt: {
      theme: 'danger' as const,
      icon: '↓',
      label: 'Debt',
      colorClass: 'text-red-600 dark:text-red-400',
      bgColorClass: 'bg-red-100 dark:bg-red-900/30',
    },
  }
  return properties[type]
}

/**
 * Calculate months to limit and create display object
 * 
 * @param entry - Balance tracking entry
 * @returns BalanceTrackingWithTimeline with calculated fields
 */
export function withTimeline(entry: ClientBalanceTracking): BalanceTrackingWithTimeline {
  const monthsToLimit = calculateBalanceTimeline(
    entry.currentBalance,
    entry.maxContributionLimit,
    entry.monthlyContribution
  )
  return {
    ...entry,
    monthsToLimit,
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validation errors for balance tracking inputs
 */
export interface ValidationError {
  field: string
  message: string
  value: unknown
}

/**
 * Validate balance tracking input
 * 
 * @param input - Balance tracking input to validate
 * @returns Array of validation errors (empty if valid)
 * 
 * Form Validation (from Dev Notes):
 * - name: Required, max 100 characters
 * - type: Required, must be 'investment' or 'debt'
 * - currentBalance: Required, integer (in cents, can be negative)
 * - maxContributionLimit: Optional, non-negative integer (in cents)
 * - monthlyContribution: Optional, non-negative integer (in cents)
 */
export function validateBalanceTracking(input: Partial<ClientNewBalanceTracking>): ValidationError[] {
  const errors: ValidationError[] = []

  // Name validation
  if (input.name === undefined || input.name === null || input.name.trim() === '') {
    errors.push({
      field: 'name',
      message: 'Name is required',
      value: input.name,
    })
  } else if (input.name.length > 100) {
    errors.push({
      field: 'name',
      message: 'Name must be 100 characters or less',
      value: input.name,
    })
  }

  // Type validation
  const validTypes: FinanceType[] = ['investment', 'debt']
  if (input.type === undefined || input.type === null) {
    errors.push({
      field: 'type',
      message: 'Type is required',
      value: input.type,
    })
  } else if (!validTypes.includes(input.type)) {
    errors.push({
      field: 'type',
      message: 'Type must be either "investment" or "debt"',
      value: input.type,
    })
  }

  // Current balance validation
  if (input.currentBalance === undefined || input.currentBalance === null) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance is required',
      value: input.currentBalance,
    })
  } else if (typeof input.currentBalance !== 'number' || !Number.isInteger(input.currentBalance)) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance must be an integer (in cents)',
      value: input.currentBalance,
    })
  }

  // Max contribution limit validation (optional)
  if (input.maxContributionLimit !== undefined && input.maxContributionLimit !== null) {
    if (typeof input.maxContributionLimit !== 'number' || !Number.isInteger(input.maxContributionLimit)) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit must be an integer (in cents)',
        value: input.maxContributionLimit,
      })
    } else if (input.maxContributionLimit < 0) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit cannot be negative',
        value: input.maxContributionLimit,
      })
    }
  }

  // Monthly contribution validation
  if (input.monthlyContribution !== undefined && input.monthlyContribution !== null) {
    if (typeof input.monthlyContribution !== 'number' || !Number.isInteger(input.monthlyContribution)) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution must be an integer (in cents)',
        value: input.monthlyContribution,
      })
    } else if (input.monthlyContribution < 0) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution cannot be negative',
        value: input.monthlyContribution,
      })
    }
  }

  return errors
}

/**
 * Check if balance tracking input is valid
 * 
 * @param input - Balance tracking input to validate
 * @returns true if valid, false otherwise
 */
export function isValidBalanceTracking(input: Partial<ClientNewBalanceTracking>): boolean {
  return validateBalanceTracking(input).length === 0
}

// ============================================================================
// Sorting and Filtering
// ============================================================================

/**
 * Sort balance tracking entries by creation date (newest first)
 * 
 * AC 2: When viewing the balance tracking list, all entries are displayed sorted by creation date (newest first)
 * 
 * @param entries - Array of balance tracking entries to sort
 * @returns New array sorted by createdAt (descending)
 */
export function sortByCreationDate(entries: ClientBalanceTracking[]): ClientBalanceTracking[] {
  return [...entries].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA // Newest first
  })
}

/**
 * Filter balance tracking entries by type and/or search
 * 
 * @param entries - Array of balance tracking entries with timeline
 * @param filter - Filter options
 * @returns Filtered array of balance tracking entries
 */
export function filterBalanceTracking(
  entries: BalanceTrackingWithTimeline[],
  filter: BalanceTrackingFilter
): BalanceTrackingWithTimeline[] {
  return entries.filter((entry) => {
    if (filter.type && entry.type !== filter.type) return false
    if (filter.search) {
      const searchLower = filter.search.toLowerCase()
      if (!entry.name.toLowerCase().includes(searchLower)) return false
    }
    return true
  })
}

// ============================================================================
// ID Generation for Client-side Storage
// ============================================================================

/**
 * Temporary ID counter for client-side balance tracking
 * Note: In production with backend, IDs will come from the database
 * Using negative IDs to avoid conflicts with other entity types
 * Start at -30000 to avoid conflicts with income (-10000), expense, and savings goal IDs
 */
let balanceTrackingTempIdCounter = -30000

/**
 * Generate a temporary ID for client-side balance tracking storage
 * 
 * @returns Negative number ID for client-side use
 */
export function generateBalanceTrackingTempId(): number {
  balanceTrackingTempIdCounter -= 1
  return balanceTrackingTempIdCounter
}

/**
 * Reset temporary ID counter (useful for testing)
 */
export function resetBalanceTrackingTempId(): void {
  balanceTrackingTempIdCounter = -30000
}

/**
 * Convert new balance tracking input to client balance tracking (add ID and timestamps)
 * 
 * @param input - New balance tracking input
 * @param userId - Optional user ID (0 for free tier)
 * @returns Client balance tracking with ID and timestamps
 */
export function toClientBalanceTracking(
  input: ClientNewBalanceTracking,
  userId?: number
): ClientBalanceTracking {
  const now = new Date().toISOString()
  return {
    ...input,
    id: generateBalanceTrackingTempId(),
    createdAt: now,
    updatedAt: now,
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  calculateBalanceTimeline as calculateBalanceMonthsToLimit,
  withTimeline as withBalanceTrackingTimeline,
}
