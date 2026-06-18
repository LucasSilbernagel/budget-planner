/**
 * Balance Tracking Server Functions
 * 
 * Server functions for balance tracking operations (paid tier).
 * Provides backend API endpoints for CRUD operations on balance tracking entries.
 * 
 * Architecture:
 * - TanStack Start Server Functions
 * - Works with Scaleway PostgreSQL via Drizzle ORM
 * - Only used for paid tier (requires authentication)
 * - Free tier uses client-side storage via Zustand
 */

import { db } from '@budget-planner/db'
import { balanceTracking } from '@budget-planner/db/src/schema'
import { eq, and } from 'drizzle-orm'
import type { BalanceTracking, NewBalanceTracking } from '@budget-planner/db'

// ============================================================================
// Server Function Types
// ============================================================================

/**
 * Input for creating a new balance tracking entry
 */
export interface CreateBalanceTrackingServerInput {
  type: 'investment' | 'debt'
  name: string
  currentBalance: number // In cents
  maxContributionLimit?: number // In cents, optional
  monthlyContribution: number // In cents
}

/**
 * Input for updating an existing balance tracking entry
 */
export interface UpdateBalanceTrackingServerInput {
  id: number
  type?: 'investment' | 'debt'
  name?: string
  currentBalance?: number // In cents
  maxContributionLimit?: number // In cents, optional
  monthlyContribution?: number // In cents
}

/**
 * Result type for balance tracking server operations
 */
export interface BalanceTrackingServerResult {
  success: boolean
  data?: BalanceTracking
  error?: string
}

/**
 * Result type for multiple balance tracking entries
 */
export interface BalanceTrackingListServerResult {
  success: boolean
  data?: BalanceTracking[]
  error?: string
}

// ============================================================================
// Server Functions
// ============================================================================

/**
 * Get all balance tracking entries for a user
 * GET /api/balance-tracking
 */
export async function getBalanceTrackingEntries(
  userId: number
): Promise<BalanceTrackingListServerResult> {
  try {
    const entries = await db
      .select()
      .from(balanceTracking)
      .where(eq(balanceTracking.userId, userId))
      .orderBy(balanceTracking.createdAt)

    return {
      success: true,
      data: entries,
    }
  } catch (error) {
    console.error('Failed to fetch balance tracking entries:', error)
    return {
      success: false,
      error: 'Failed to fetch balance tracking entries',
    }
  }
}

/**
 * Get a single balance tracking entry by ID
 * GET /api/balance-tracking/:id
 */
export async function getBalanceTrackingEntry(
  id: number,
  userId: number
): Promise<BalanceTrackingServerResult> {
  try {
    const entry = await db
      .select()
      .from(balanceTracking)
      .where(and(eq(balanceTracking.id, id), eq(balanceTracking.userId, userId)))
      .limit(1)

    if (!entry || entry.length === 0) {
      return {
        success: false,
        error: 'Balance tracking entry not found',
      }
    }

    return {
      success: true,
      data: entry[0],
    }
  } catch (error) {
    console.error('Failed to fetch balance tracking entry:', error)
    return {
      success: false,
      error: 'Failed to fetch balance tracking entry',
    }
  }
}

/**
 * Create a new balance tracking entry
 * POST /api/balance-tracking
 */
export async function createBalanceTrackingEntry(
  input: CreateBalanceTrackingServerInput,
  userId: number
): Promise<BalanceTrackingServerResult> {
  try {
    // Convert cents to dollars for database storage
    // Note: The schema stores amounts in cents as integers
    const newEntry: NewBalanceTracking = {
      userId,
      type: input.type,
      name: input.name,
      currentBalance: input.currentBalance,
      maxContributionLimit: input.maxContributionLimit,
      monthlyContribution: input.monthlyContribution,
    }

    const result = await db.insert(balanceTracking).values(newEntry).returning()

    if (!result || result.length === 0) {
      return {
        success: false,
        error: 'Failed to create balance tracking entry',
      }
    }

    return {
      success: true,
      data: result[0],
    }
  } catch (error) {
    console.error('Failed to create balance tracking entry:', error)
    return {
      success: false,
      error: 'Failed to create balance tracking entry',
    }
  }
}

/**
 * Update an existing balance tracking entry
 * PUT /api/balance-tracking/:id
 */
export async function updateBalanceTrackingEntry(
  id: number,
  input: UpdateBalanceTrackingServerInput,
  userId: number
): Promise<BalanceTrackingServerResult> {
  try {
    // Check if entry exists and belongs to user
    const existingEntry = await db
      .select()
      .from(balanceTracking)
      .where(and(eq(balanceTracking.id, id), eq(balanceTracking.userId, userId)))
      .limit(1)

    if (!existingEntry || existingEntry.length === 0) {
      return {
        success: false,
        error: 'Balance tracking entry not found',
      }
    }

    // Build update object
    const updateData: Partial<NewBalanceTracking> = {}
    if (input.type !== undefined) updateData.type = input.type
    if (input.name !== undefined) updateData.name = input.name
    if (input.currentBalance !== undefined) updateData.currentBalance = input.currentBalance
    if (input.maxContributionLimit !== undefined) updateData.maxContributionLimit = input.maxContributionLimit
    if (input.monthlyContribution !== undefined) updateData.monthlyContribution = input.monthlyContribution

    const result = await db
      .update(balanceTracking)
      .set(updateData)
      .where(and(eq(balanceTracking.id, id), eq(balanceTracking.userId, userId)))
      .returning()

    if (!result || result.length === 0) {
      return {
        success: false,
        error: 'Failed to update balance tracking entry',
      }
    }

    return {
      success: true,
      data: result[0],
    }
  } catch (error) {
    console.error('Failed to update balance tracking entry:', error)
    return {
      success: false,
      error: 'Failed to update balance tracking entry',
    }
  }
}

/**
 * Delete a balance tracking entry
 * DELETE /api/balance-tracking/:id
 */
export async function deleteBalanceTrackingEntry(
  id: number,
  userId: number
): Promise<BalanceTrackingServerResult> {
  try {
    // Check if entry exists and belongs to user
    const existingEntry = await db
      .select()
      .from(balanceTracking)
      .where(and(eq(balanceTracking.id, id), eq(balanceTracking.userId, userId)))
      .limit(1)

    if (!existingEntry || existingEntry.length === 0) {
      return {
        success: false,
        error: 'Balance tracking entry not found',
      }
    }

    await db
      .delete(balanceTracking)
      .where(and(eq(balanceTracking.id, id), eq(balanceTracking.userId, userId)))

    return {
      success: true,
    }
  } catch (error) {
    console.error('Failed to delete balance tracking entry:', error)
    return {
      success: false,
      error: 'Failed to delete balance tracking entry',
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  getBalanceTrackingEntries as getAllBalanceTracking,
  getBalanceTrackingEntry as getBalanceTracking,
  createBalanceTrackingEntry as createBalanceTracking,
  updateBalanceTrackingEntry as updateBalanceTracking,
  deleteBalanceTrackingEntry as deleteBalanceTracking,
}
