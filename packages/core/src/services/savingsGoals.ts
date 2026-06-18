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

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Client-side Savings Goal interface for free tier
 * Uses number IDs (for localStorage/IndexedDB) and string timestamps
 * Omits userId for free tier (no authentication)
 */
export interface ClientSavingsGoal {
  id: number
  name: string
  targetAmount: number // In cents
  currentBalance: number // In cents
  createdAt: string // ISO string for localStorage serialization
  updatedAt: string // ISO string for localStorage serialization
  // Optional UI display fields
  progress?: number // Percentage (0-100)
  status?: SavingsGoalStatus
}

/**
 * Client-side new Savings Goal (without ID and timestamps)
 */
export interface ClientNewSavingsGoal {
  name: string
  targetAmount: number // In cents
  currentBalance: number // In cents
}

/**
 * Savings Goal Status for UI display
 */
export type SavingsGoalStatus = 'on-track' | 'behind' | 'complete' | 'not-started'

/**
 * Savings Goal with progress calculation
 * Used for display purposes
 */
export interface SavingsGoalWithProgress extends ClientSavingsGoal {
  progress: number // Percentage (0-100)
  status: SavingsGoalStatus
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
  targetAmount: number // In cents
  currentBalance: number // In cents
  userId?: number // Optional for free tier (null), required for paid tier
}

/**
 * Input type for updating an existing savings goal
 * Uses number IDs to align with database serial and client-side negative IDs
 */
export interface UpdateSavingsGoalInput {
  id: number // Number ID: positive for DB (serial), negative for client-side
  name?: string
  targetAmount?: number // In cents
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
  const progress = calculateSavingsGoalProgress(savingsGoal.targetAmount, savingsGoal.currentBalance)
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
 * - targetAmount: Required, positive integer (in cents)
 * - currentBalance: Required, non-negative integer (in cents), <= targetAmount
 */
export function validateSavingsGoal(input: Partial<ClientNewSavingsGoal>): ValidationError[] {
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

  // Target amount validation
  if (input.targetAmount === undefined || input.targetAmount === null) {
    errors.push({
      field: 'targetAmount',
      message: 'Target amount is required',
      value: input.targetAmount,
    })
  } else if (typeof input.targetAmount !== 'number' || !Number.isInteger(input.targetAmount)) {
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
  } else if (input.targetAmount !== undefined && input.currentBalance > input.targetAmount) {
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
 * Temporary ID counter for client-side savings goals
 * Note: In production with backend, IDs will come from the database
 * Using negative IDs to avoid conflicts with other entity types
 * Start at -20000 to avoid conflicts with income (-10000) and expense IDs
 */
let savingsGoalTempIdCounter = -20000

/**
 * Generate a temporary ID for client-side savings goal storage
 * 
 * @returns Negative number ID for client-side use
 */
export function generateSavingsGoalTempId(): number {
  savingsGoalTempIdCounter -= 1
  return savingsGoalTempIdCounter
}

/**
 * Reset temporary ID counter (useful for testing)
 */
export function resetSavingsGoalTempId(): void {
  savingsGoalTempIdCounter = -20000
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
  userId?: number
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
