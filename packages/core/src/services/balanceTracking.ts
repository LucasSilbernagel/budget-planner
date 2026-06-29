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
import {
  DebtCalculationResult,
  DebtSubType,
  calculateDebtMetrics,
  calculateMonthsToLimit,
} from '../utils/balanceCalculations'
import { generateUuid } from '../utils/uuid'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Client-side Balance Tracking interface for free tier
 * Uses number IDs (for localStorage/IndexedDB) and string timestamps
 * Omits userId for free tier (no authentication)
 */
export interface ClientBalanceTracking {
  // Client-generatable uuid PK (Story 5-14): the row carries the SAME id on every
  // device, so a server pull reconciles by this id with no duplicates. Replaces
  // the old negative-integer temp id.
  id: string
  type: FinanceType
  name: string
  currentBalance: number // In cents (can be negative for debts)
  maxContributionLimit?: number // In cents, optional
  monthlyContribution: number // In cents (default 0)
  createdAt: string // ISO string for localStorage serialization
  updatedAt: string // ISO string for localStorage serialization
  // Optional UI display fields
  monthsToLimit?: number | null
  // Debt-specific fields
  debtSubType?: DebtSubType // Sub-type for debt entries (credit-card, mortgage, loan, other)
  originalBalance?: number // Original loan amount in cents (for mortgage/loan progress calculation)
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
  // Debt-specific fields
  debtSubType?: DebtSubType // Sub-type for debt entries
  originalBalance?: number // Original loan amount in cents (for mortgage/loan)
}

/**
 * Balance Tracking with timeline calculation
 * Used for display purposes
 */
export interface BalanceTrackingWithTimeline extends ClientBalanceTracking {
  monthsToLimit: number | null
  // Debt-specific display fields
  debtProgress?: number | null
  debtProgressLabel?: string
  debtTimeline?: number | null
  debtTimelineLabel?: string
}

/**
 * Database Balance Tracking type (re-exported for convenience)
 * Uses serial IDs (positive integers) from PostgreSQL sequence
 * Note: Differs from ClientBalanceTracking which uses negative IDs for client-side storage
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
  id: string // uuid PK (Story 5-14) — shared client/server identity
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
export { calculateMonthsToLimit } from '../utils/balanceCalculations'

/**
 * Determine display type properties based on FinanceType
 *
 * @param type - Finance type ('investment' or 'debt')
 * @returns Display properties for theming, or undefined if type is invalid
 */
export function getTypeDisplayProperties(type: FinanceType):
  | {
      theme: 'success' | 'danger'
      icon: string
      label: string
      colorClass: string
      bgColorClass: string
    }
  | undefined {
  // Validate type parameter
  if (type !== 'investment' && type !== 'debt') {
    return undefined
  }

  const properties: Record<
    FinanceType,
    {
      theme: 'success' | 'danger'
      icon: string
      label: string
      colorClass: string
      bgColorClass: string
    }
  > = {
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
 * For debts, also calculates debt-specific metrics based on debtSubType
 *
 * @param entry - Balance tracking entry
 * @returns BalanceTrackingWithTimeline with calculated fields
 */
export function withTimeline(entry: ClientBalanceTracking): BalanceTrackingWithTimeline {
  const monthsToLimit = calculateMonthsToLimit(
    entry.currentBalance,
    entry.maxContributionLimit,
    entry.monthlyContribution
  )

  // Calculate debt-specific metrics if this is a debt
  let debtProgress: number | null = null
  let debtProgressLabel = 'No limit'
  let debtTimeline: number | null = null
  let debtTimelineLabel = 'No payment set'

  if (entry.type === 'debt' && entry.debtSubType) {
    const result = calculateDebtMetrics(
      entry.currentBalance,
      entry.maxContributionLimit,
      entry.monthlyContribution,
      entry.debtSubType,
      entry.originalBalance
    )
    debtProgress = result.progress
    debtProgressLabel = result.progressLabel
    debtTimeline = result.timeline
    debtTimelineLabel = result.timelineLabel
  }

  return {
    ...entry,
    monthsToLimit,
    debtProgress,
    debtProgressLabel,
    debtTimeline,
    debtTimelineLabel,
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
export function validateBalanceTracking(
  input: Partial<ClientNewBalanceTracking>
): ValidationError[] {
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
  } else if (typeof input.currentBalance !== 'number' || !Number.isFinite(input.currentBalance)) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance must be a finite number (in cents)',
      value: input.currentBalance,
    })
  } else if (!Number.isInteger(input.currentBalance)) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance must be an integer (in cents, not a float)',
      value: input.currentBalance,
    })
  }

  // Max contribution limit validation (optional)
  if (input.maxContributionLimit !== undefined && input.maxContributionLimit !== null) {
    if (
      typeof input.maxContributionLimit !== 'number' ||
      !Number.isFinite(input.maxContributionLimit)
    ) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit must be a finite number (in cents)',
        value: input.maxContributionLimit,
      })
    } else if (!Number.isInteger(input.maxContributionLimit)) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit must be an integer (in cents, not a float)',
        value: input.maxContributionLimit,
      })
    } else if (input.maxContributionLimit < 0) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit cannot be negative',
        value: input.maxContributionLimit,
      })
    } else if (Math.abs(input.maxContributionLimit) > Number.MAX_SAFE_INTEGER / 100) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit exceeds safe integer bounds',
        value: input.maxContributionLimit,
      })
    }
  }

  // Monthly contribution validation
  if (input.monthlyContribution !== undefined && input.monthlyContribution !== null) {
    if (
      typeof input.monthlyContribution !== 'number' ||
      !Number.isFinite(input.monthlyContribution)
    ) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution must be a finite number (in cents)',
        value: input.monthlyContribution,
      })
    } else if (!Number.isInteger(input.monthlyContribution)) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution must be an integer (in cents, not a float)',
        value: input.monthlyContribution,
      })
    } else if (input.monthlyContribution < 0) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution cannot be negative',
        value: input.monthlyContribution,
      })
    } else if (Math.abs(input.monthlyContribution) > Number.MAX_SAFE_INTEGER / 100) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution exceeds safe integer bounds',
        value: input.monthlyContribution,
      })
    }
  }

  // Bounds validation for currentBalance (already validated as integer above)
  if (
    input.currentBalance !== undefined &&
    Math.abs(input.currentBalance) > Number.MAX_SAFE_INTEGER / 100
  ) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance exceeds safe integer bounds',
      value: input.currentBalance,
    })
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
 * @returns New array sorted by createdAt (descending), or empty array if entries is null/undefined
 */
export function sortByCreationDate(entries: ClientBalanceTracking[]): ClientBalanceTracking[] {
  // Handle null/undefined entries
  if (!entries) {
    return []
  }

  return [...entries].sort((a, b) => {
    // Validate dates
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()

    // Handle invalid dates - push to end
    if (!Number.isFinite(dateA)) return 1
    if (!Number.isFinite(dateB)) return -1

    return dateB - dateA // Newest first
  })
}

/**
 * Filter balance tracking entries by type and/or search
 *
 * @param entries - Array of balance tracking entries with timeline
 * @param filter - Filter options
 * @returns Filtered array of balance tracking entries, or empty array if entries is null/undefined
 */
export function filterBalanceTracking(
  entries: BalanceTrackingWithTimeline[],
  filter: BalanceTrackingFilter
): BalanceTrackingWithTimeline[] {
  // Handle null/undefined entries or filter
  if (!entries || !filter) {
    return []
  }

  return entries.filter((entry) => {
    if (filter.type && entry.type !== filter.type) return false
    if (filter.search) {
      // If search is not a string, return false (exclude entry)
      if (typeof filter.search !== 'string') return false
      const searchLower = filter.search.toLowerCase()
      const entryName = typeof entry.name === 'string' ? entry.name.toLowerCase() : ''
      if (!entryName.includes(searchLower)) return false
    }
    return true
  })
}

// ============================================================================
// ID Generation for Client-side Storage
// ============================================================================

/**
 * Generate a client-generatable uuid for a balance tracking entry (Story 5-14).
 *
 * Replaces the old localStorage-backed negative-integer counter: the id is now a
 * uuid the client mints up front so a row created offline has the SAME id on every
 * device and a server pull reconciles by id (no duplicates). Being stateless, it
 * also drops the cross-tab counter coordination the old scheme needed. Name kept
 * for call-site stability.
 *
 * @returns A uuid string
 */
export function generateBalanceTrackingTempId(): string {
  return generateUuid()
}

/**
 * No-op retained for backward compatibility (Story 5-14).
 *
 * uuid generation is stateless, so there is no counter to reset. Kept so existing
 * test/setup call sites compile unchanged.
 */
export function resetBalanceTrackingTempId(): void {
  // Intentionally empty — uuid ids are stateless (no counter to reset).
}

/**
 * Convert new balance tracking input to client balance tracking (add ID and timestamps)
 *
 * @param input - New balance tracking input
 * @returns Client balance tracking with ID and timestamps
 */
export function toClientBalanceTracking(input: ClientNewBalanceTracking): ClientBalanceTracking {
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

// Re-export debt calculation types
export type { DebtSubType, DebtCalculationResult }
export { calculateDebtMetrics }

export {
  calculateMonthsToLimit as calculateBalanceTimeline,
  calculateMonthsToLimit as calculateBalanceMonthsToLimit,
  withTimeline as withBalanceTrackingTimeline,
}
