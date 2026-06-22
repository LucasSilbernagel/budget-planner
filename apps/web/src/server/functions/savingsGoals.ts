/**
 * Savings Goals Server Functions
 * 
 * Server-side functions for savings goal CRUD operations.
 * Used for paid tier with server-side persistence to Scaleway PostgreSQL.
 * 
 * Architecture: TanStack Start Server Functions (RPC-style)
 * Database: Scaleway PostgreSQL via Drizzle ORM
 * 
 * NOTE: Free tier uses client-side only (localStorage/IndexedDB) and does NOT
 * use these server functions. Free tier is handled in the Zustand store.
 */

import { and, eq, desc } from 'drizzle-orm'
import { db } from '@budget-planner/db'
import { savingsGoals } from '@budget-planner/db/src/schema'
import type { SavingsGoal as DbSavingsGoal } from '@budget-planner/db'

// Legacy constant for backward compatibility during migration to UUID profile IDs
// TODO: Update this to use proper UUID when all code is migrated
const LEGACY_DEFAULT_PROFILE_ID = 1

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * API Result type for consistent response format
 */
export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Input type for creating a savings goal
 */
export interface CreateSavingsGoalInput {
  name: string
  targetAmount: number // In cents
  currentBalance: number // In cents
  userId: string // Required for paid tier (from users table)
  profileId?: number // Profile ID for data isolation (required for paid tier) - TODO: migrate to UUID
}

/**
 * Input type for updating a savings goal
 */
export interface UpdateSavingsGoalInput {
  id: number
  name?: string
  targetAmount?: number // In cents
  currentBalance?: number // In cents
}

/**
 * Output type for savings goal (with calculated fields)
 */
export interface SavingsGoalOutput extends DbSavingsGoal {
  progress: number
  status: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate progress percentage for a savings goal
 */
function calculateProgress(targetAmount: number, currentBalance: number): number {
  if (targetAmount <= 0) return 0
  return Math.round((currentBalance / targetAmount) * 100)
}

/**
 * Get status based on progress percentage
 */
function getStatus(progress: number): string {
  if (progress >= 100) return 'complete'
  if (progress >= 75) return 'on-track'
  if (progress >= 25) return 'in-progress'
  if (progress > 0) return 'started'
  return 'not-started'
}

/**
 * Add progress and status to database savings goal
 */
function withProgress(goal: DbSavingsGoal): SavingsGoalOutput {
  const progress = calculateProgress(goal.targetAmount, goal.currentBalance)
  return {
    ...goal,
    progress,
    status: getStatus(progress),
  }
}

// ============================================================================
// Server Functions
// ============================================================================

/**
 * GET /savings-goals
 * Fetch all savings goals for a user and profile
 * 
 * @param userId - User ID to fetch savings goals for
 * @param profileId - Profile ID to filter by (optional for backward compatibility)
 * @returns Array of savings goals with progress information
 */
export async function getSavingsGoals(userId: string, profileId?: number): Promise<ApiResult<SavingsGoalOutput[]>> {
  try {
    // Build where clause
    let whereClause = eq(savingsGoals.userId, userId)
    
    if (profileId !== undefined) {
      whereClause = and(whereClause, eq(savingsGoals.profileId, profileId))
    }
    
    // Fetch all savings goals for the user and profile, ordered by creation date (newest first)
    const goals = await db
      .select()
      .from(savingsGoals)
      .where(whereClause)
      .orderBy(desc(savingsGoals.createdAt))

    // Add progress and status to each goal
    const goalsWithProgress = goals.map(withProgress)

    return {
      success: true,
      data: goalsWithProgress,
    }
  } catch (error) {
    console.error('Error fetching savings goals:', error)
    return {
      success: false,
      error: 'Failed to fetch savings goals',
    }
  }
}

/**
 * GET /savings-goals/:id
 * Fetch a single savings goal by ID
 * 
 * @param id - Savings goal ID
 * @param userId - User ID (for authorization)
 * @param profileId - Profile ID to filter by (optional for backward compatibility)
 * @returns Single savings goal with progress information
 */
export async function getSavingsGoal(id: number, userId: string, profileId?: number): Promise<ApiResult<SavingsGoalOutput>> {
  try {
    let whereClause = and(
      eq(savingsGoals.id, id),
      eq(savingsGoals.userId, userId)
    )
    
    if (profileId !== undefined) {
      whereClause = and(whereClause, eq(savingsGoals.profileId, profileId))
    }
    
    const goal = await db
      .select()
      .from(savingsGoals)
      .where(whereClause)
      .limit(1)

    if (!goal.length) {
      return {
        success: false,
        error: 'Savings goal not found',
      }
    }

    return {
      success: true,
      data: withProgress(goal[0]),
    }
  } catch (error) {
    console.error('Error fetching savings goal:', error)
    return {
      success: false,
      error: 'Failed to fetch savings goal',
    }
  }
}

/**
 * POST /savings-goals
 * Create a new savings goal
 * 
 * @param input - Savings goal data to create
 * @returns Created savings goal with progress information
 */
export async function createSavingsGoal(input: CreateSavingsGoalInput): Promise<ApiResult<SavingsGoalOutput>> {
  try {
    // Validate input
    if (!input.name || input.name.trim() === '') {
      return {
        success: false,
        error: 'Name is required',
      }
    }

    if (!input.targetAmount || input.targetAmount <= 0) {
      return {
        success: false,
        error: 'Target amount must be positive',
      }
    }

    if (input.currentBalance !== undefined && input.currentBalance !== null) {
      if (input.currentBalance < 0) {
        return {
          success: false,
          error: 'Current balance cannot be negative',
        }
      }
      if (input.currentBalance > input.targetAmount) {
        return {
          success: false,
          error: 'Current balance cannot exceed target amount',
        }
      }
    }

    // Insert into database
    // Note: profileId type mismatch - schema expects UUID but input is number
    // This needs to be resolved during full migration to UUID profile IDs
    const [newGoal] = await db
      .insert(savingsGoals)
      .values({
        userId: input.userId,
        profileId: input.profileId || LEGACY_DEFAULT_PROFILE_ID, // Default to profile 1 for backward compatibility
        name: input.name.trim(),
        targetAmount: input.targetAmount,
        currentBalance: input.currentBalance ?? 0,
      })
      .returning()

    return {
      success: true,
      data: withProgress(newGoal),
    }
  } catch (error) {
    console.error('Error creating savings goal:', error)
    return {
      success: false,
      error: 'Failed to create savings goal',
    }
  }
}

/**
 * PUT /savings-goals/:id
 * Update an existing savings goal
 * 
 * @param input - Savings goal data to update
 * @param userId - User ID (for authorization)
 * @param profileId - Profile ID to filter by (optional for backward compatibility)
 * @returns Updated savings goal with progress information
 */
export async function updateSavingsGoal(input: UpdateSavingsGoalInput, userId: string, profileId?: number): Promise<ApiResult<SavingsGoalOutput>> {
  try {
    // Validate input
    if (!input.id) {
      return {
        success: false,
        error: 'ID is required',
      }
    }

    // Build where clause
    let whereClause = and(
      eq(savingsGoals.id, input.id),
      eq(savingsGoals.userId, userId)
    )
    
    if (profileId !== undefined) {
      whereClause = and(whereClause, eq(savingsGoals.profileId, profileId))
    }

    // Check if goal exists and belongs to user
    const existingGoal = await db
      .select()
      .from(savingsGoals)
      .where(whereClause)
      .limit(1)

    if (!existingGoal.length) {
      return {
        success: false,
        error: 'Savings goal not found or access denied',
      }
    }

    // Validate updates
    if (input.name !== undefined && (input.name.trim() === '')) {
      return {
        success: false,
        error: 'Name cannot be empty',
      }
    }

    if (input.targetAmount !== undefined) {
      if (input.targetAmount <= 0) {
        return {
          success: false,
          error: 'Target amount must be positive',
        }
      }
    }

    if (input.currentBalance !== undefined) {
      if (input.currentBalance < 0) {
        return {
          success: false,
          error: 'Current balance cannot be negative',
        }
      }
      if (input.currentBalance > (input.targetAmount ?? existingGoal[0].targetAmount)) {
        return {
          success: false,
          error: 'Current balance cannot exceed target amount',
        }
      }
    }

    // Update in database
    const [updatedGoal] = await db
      .update(savingsGoals)
      .set({
        name: input.name !== undefined ? input.name.trim() : existingGoal[0].name,
        targetAmount: input.targetAmount ?? existingGoal[0].targetAmount,
        currentBalance: input.currentBalance ?? existingGoal[0].currentBalance,
        updatedAt: new Date(),
      })
      .where(whereClause)
      .returning()

    return {
      success: true,
      data: withProgress(updatedGoal),
    }
  } catch (error) {
    console.error('Error updating savings goal:', error)
    return {
      success: false,
      error: 'Failed to update savings goal',
    }
  }
}

/**
 * DELETE /savings-goals/:id
 * Delete a savings goal
 * 
 * @param id - Savings goal ID to delete
 * @param userId - User ID (for authorization)
 * @param profileId - Profile ID to filter by (optional for backward compatibility)
 * @returns Success/failure result
 */
export async function deleteSavingsGoal(id: number, userId: string, profileId?: number): Promise<ApiResult<void>> {
  try {
    // Build where clause
    let whereClause = and(
      eq(savingsGoals.id, id),
      eq(savingsGoals.userId, userId)
    )
    
    if (profileId !== undefined) {
      whereClause = and(whereClause, eq(savingsGoals.profileId, profileId))
    }

    // Check if goal exists and belongs to user
    const existingGoal = await db
      .select()
      .from(savingsGoals)
      .where(whereClause)
      .limit(1)

    if (!existingGoal.length) {
      return {
        success: false,
        error: 'Savings goal not found or access denied',
      }
    }

    // Delete from database
    await db
      .delete(savingsGoals)
      .where(whereClause)

    return {
      success: true,
    }
  } catch (error) {
    console.error('Error deleting savings goal:', error)
    return {
      success: false,
      error: 'Failed to delete savings goal',
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  getSavingsGoals as getAllSavingsGoals,
  getSavingsGoal as getSavingsGoalById,
}
