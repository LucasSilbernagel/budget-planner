/**
 * Savings Goals Service
 *
 * Core service layer for savings goal operations.
 * Provides type definitions, validation, and business logic for savings goals.
 *
 * Architecture:
 * - Pure TypeScript functions, no side effects
 * - Works with both client-side (free tier) and server-side (paid tier) data
 * - Database types imported from @budget-planner/db
 */

import type { SavingsGoal as DbSavingsGoal } from '@budget-planner/db'
import { calculateProgress as calculateSavingsGoalProgress } from '../utils/savingsGoalCalculations'
import { generateUuid } from '../utils/uuid'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Client-side Savings Goal interface for free tier
 * Uses number IDs (for localStorage/IndexedDB) and string timestamps
 * Omits userId for free tier (no authentication)
 */
export interface ClientSavingsGoal {
  // Client-generatable uuid PK (Story 5-14): the row carries the SAME id on every
  // device, so a server pull reconciles by this id with no duplicates. Replaces
  // the old negative-integer temp id.
  id: string
  name: string
  // null ⇒ savings account (no target); a positive integer ⇒ goal (Story 16-1).
  // "No target" is an absent value, never a sentinel 0.
  targetAmount: number | null // In cents (null = account)
  currentBalance: number // In cents
  createdAt: string // ISO string for localStorage serialization
  updatedAt: string // ISO string for localStorage serialization
  // Optional UI display fields (progress is null for accounts)
  progress?: number | null // Percentage (0-100), or null for accounts
  status?: SavingsGoalStatus
}

/**
 * Client-side new Savings Goal (without ID and timestamps)
 */
export interface ClientNewSavingsGoal {
  name: string
  targetAmount: number | null // In cents (null = account, no target)
  currentBalance: number // In cents
}

/**
 * Savings Goal Status for UI display
 * 'account' signals a goal-less savings account (no target, no progress).
 */
export type SavingsGoalStatus = 'on-track' | 'behind' | 'complete' | 'not-started' | 'account'

/**
 * Savings Goal with progress calculation
 * Used for display purposes. `progress` is null for accounts (no target).
 */
export interface SavingsGoalWithProgress extends ClientSavingsGoal {
  progress: number | null // Percentage (0-100), or null for accounts
  status: SavingsGoalStatus
}

/**
 * Type guard: an entry is a savings account (no target) when targetAmount is null.
 * Single source of truth for the goal-vs-account discriminator (Story 16-1).
 */
export function isSavingsAccount(goal: {
  targetAmount: number | null
}): boolean {
  return goal.targetAmount == null
}

/**
 * Database Savings Goal type (re-exported for convenience)
 * Uses serial IDs and Date objects
 */
export type DatabaseSavingsGoal = DbSavingsGoal

/**
 * Input type for creating a new savings goal in the database
 */
export interface CreateSavingsGoalInput {
  name: string
  targetAmount: number | null // In cents (null = account, no target)
  currentBalance: number // In cents
  userId?: number // Optional for free tier (null), required for paid tier
}

/**
 * Input type for updating an existing savings goal
 * Uses number IDs to align with database serial and client-side negative IDs
 */
export interface UpdateSavingsGoalInput {
  id: string // uuid PK (Story 5-14) — shared client/server identity
  name?: string
  targetAmount?: number | null // In cents (null = clear target → account)
  currentBalance?: number // In cents
}

/**
 * Result type for savings goal operations
 */
export interface SavingsGoalResult {
  success: boolean
  data?: ClientSavingsGoal | DatabaseSavingsGoal
  error?: string
}

/**
 * Filter options for querying savings goals
 */
export interface SavingsGoalFilter {
  status?: SavingsGoalStatus
  search?: string // Search by name
}

// ============================================================================
// Progress Calculation
// ============================================================================

/**
 * Calculate progress percentage for a savings goal
 * Re-exports from savingsGoalCalculations for convenience
 */
export { calculateProgress } from '../utils/savingsGoalCalculations'

/**
 * Determine status based on progress percentage
 *
 * @param progress - Progress percentage (0-100)
 * @returns Status enum value
 */
export function getStatusFromProgress(progress: number): SavingsGoalStatus {
  if (progress >= 100) return 'complete'
  if (progress > 0) return 'on-track'
  return 'not-started'
}

/**
 * Calculate progress and status for a savings goal
 *
 * @param savingsGoal - Savings goal with targetAmount and currentBalance
 * @returns SavingsGoalWithProgress with calculated fields
 */
export function withProgress(savingsGoal: ClientSavingsGoal): SavingsGoalWithProgress {
  // Accounts (no target) have no meaningful progress — return it as absent
  // (null), never 0, so the UI can distinguish "account" from "0% of a goal".
  if (isSavingsAccount(savingsGoal)) {
    return {
      ...savingsGoal,
      progress: null,
      status: 'account',
    }
  }

  const progress = calculateSavingsGoalProgress(
    savingsGoal.targetAmount as number,
    savingsGoal.currentBalance
  )
  return {
    ...savingsGoal,
    progress,
    status: getStatusFromProgress(progress),
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validation errors for savings goal inputs
 */
export interface ValidationError {
  field: string
  message: string
  value: unknown
}

/**
 * Validate savings goal input
 *
 * @param input - Savings goal input to validate
 * @returns Array of validation errors (empty if valid)
 *
 * Form Validation (from Dev Notes):
 * - name: Required, max 100 characters
 * - targetAmount: Optional. When provided (goal), must be a positive integer (in
 *   cents). When null/absent (account, Story 16-1), the target checks are skipped.
 * - currentBalance: Required, non-negative integer (in cents). Must be
 *   <= targetAmount only for goals (skipped for accounts).
 */
export function validateSavingsGoal(input: Partial<ClientNewSavingsGoal>): ValidationError[] {
  const errors: ValidationError[] = []

  // An entry is a goal only when a non-null target is provided; null/undefined
  // means a savings account (no target) and the target checks are skipped.
  const isGoal = input.targetAmount !== undefined && input.targetAmount !== null

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

  // Target amount validation — only for goals (a provided, non-null target).
  if (isGoal) {
    if (typeof input.targetAmount !== 'number' || !Number.isInteger(input.targetAmount)) {
      errors.push({
        field: 'targetAmount',
        message: 'Target amount must be an integer (in cents)',
        value: input.targetAmount,
      })
    } else if (input.targetAmount <= 0) {
      errors.push({
        field: 'targetAmount',
        message: 'Target amount must be positive',
        value: input.targetAmount,
      })
    }
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
  } else if (input.currentBalance < 0) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance cannot be negative',
      value: input.currentBalance,
    })
  } else if (
    isGoal &&
    typeof input.targetAmount === 'number' &&
    input.currentBalance > input.targetAmount
  ) {
    // "Balance exceeds target" only applies to goals — an account has no target.
    errors.push({
      field: 'currentBalance',
      message: 'Current balance cannot exceed target amount',
      value: input.currentBalance,
    })
  }

  return errors
}

/**
 * Check if savings goal input is valid
 *
 * @param input - Savings goal input to validate
 * @returns true if valid, false otherwise
 */
export function isValidSavingsGoal(input: Partial<ClientNewSavingsGoal>): boolean {
  return validateSavingsGoal(input).length === 0
}

// ============================================================================
// Sorting and Filtering
// ============================================================================

/**
 * Sort savings goals by creation date (newest first)
 *
 * AC 2: When viewing the savings goals list, all goals are displayed sorted by creation date (newest first)
 *
 * @param goals - Array of savings goals to sort
 * @returns New array sorted by createdAt (descending)
 */
export function sortByCreationDate(goals: ClientSavingsGoal[]): ClientSavingsGoal[] {
  return [...goals].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA // Newest first
  })
}

/**
 * Filter savings goals by status
 *
 * @param goals - Array of savings goals with progress
 * @param filter - Filter options
 * @returns Filtered array of savings goals
 */
export function filterSavingsGoals(
  goals: SavingsGoalWithProgress[],
  filter: SavingsGoalFilter
): SavingsGoalWithProgress[] {
  return goals.filter((goal) => {
    if (filter.status && goal.status !== filter.status) return false
    if (filter.search) {
      const searchLower = filter.search.toLowerCase()
      if (!goal.name.toLowerCase().includes(searchLower)) return false
    }
    return true
  })
}

// ============================================================================
// ID Generation for Client-side Storage
// ============================================================================

/**
 * Generate a client-generatable uuid for a savings goal (Story 5-14).
 *
 * Replaces the old negative-integer temp-id counter: the id is now a uuid the
 * client mints up front so a row created offline has the SAME id everywhere and a
 * server pull reconciles by id (no duplicates). Name kept for call-site stability.
 *
 * @returns A uuid string
 */
export function generateSavingsGoalTempId(): string {
  return generateUuid()
}

/**
 * No-op retained for backward compatibility (Story 5-14).
 *
 * uuid generation is stateless, so there is no counter to reset. Kept so existing
 * test/setup call sites compile unchanged.
 */
export function resetSavingsGoalTempId(): void {
  // Intentionally empty — uuid ids are stateless (no counter to reset).
}

/**
 * Convert new savings goal input to client savings goal (add ID and timestamps)
 *
 * @param input - New savings goal input
 * @param userId - Optional user ID (0 for free tier)
 * @returns Client savings goal with ID and timestamps
 */
export function toClientSavingsGoal(
  input: ClientNewSavingsGoal,
  _userId?: number
): ClientSavingsGoal {
  const now = new Date().toISOString()
  return {
    ...input,
    id: generateSavingsGoalTempId(),
    createdAt: now,
    updatedAt: now,
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  calculateSavingsGoalProgress,
  getStatusFromProgress as getSavingsGoalStatus,
  withProgress as withSavingsGoalProgress,
}
