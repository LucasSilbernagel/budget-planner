/**
 * Financial Data Server Functions
 *
 * Handles CRUD operations for financial data (income sources, expenses, savings, balance).
 * Provides synchronization between client and server for paid tier users.
 *
 * Architecture: TanStack Start Server Functions with PostgreSQL (Drizzle ORM)
 * Data Sovereignty: ALL data stored in DanubeData PostgreSQL (Germany - EU) for CLOUD Act immunity (NFR1, NFR2)
 */

import { db } from '@budget-planner/db'
import type { BalanceTracking, Expense, IncomeSource, SavingsGoal } from '@budget-planner/db'
import {
  balanceTracking,
  expenses,
  incomeSources,
  savingsGoals,
} from '@budget-planner/db/src/schema'
import { and, eq } from 'drizzle-orm'
import { getCurrentUserSession } from '../auth/paddle'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Generic API result type for consistent response format
 */
export interface FinancialApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Input for creating an income source (with profile context)
 * For paid tier: profileId is required
 */
export interface CreateIncomeSourceInput {
  name: string
  amount: number
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'annually'
  profileId: string
}

/**
 * Input for updating an income source
 * For paid tier: profileId is required
 */
export interface UpdateIncomeSourceInput {
  id: number
  name?: string
  amount?: number
  frequency?: 'weekly' | 'biweekly' | 'monthly' | 'annually'
  profileId: string
}

/**
 * Input for creating an expense (with profile context)
 * For paid tier: profileId is required
 */
export interface CreateExpenseInput {
  name: string
  amount: number
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'annually'
  profileId: string
}

/**
 * Input for updating an expense
 * For paid tier: profileId is required
 */
export interface UpdateExpenseInput {
  id: number
  name?: string
  amount?: number
  frequency?: 'weekly' | 'biweekly' | 'monthly' | 'annually'
  profileId: string
}

/**
 * Input for creating a savings goal (with profile context)
 * For paid tier: profileId is required
 */
export interface CreateSavingsGoalInput {
  name: string
  targetAmount: number
  currentBalance: number
  profileId: string
}

/**
 * Input for updating a savings goal
 * For paid tier: profileId is required
 */
export interface UpdateSavingsGoalInput {
  id: number
  name?: string
  targetAmount?: number
  currentBalance?: number
  profileId: string
}

/**
 * Input for creating balance tracking (with profile context)
 * For paid tier: profileId is required
 */
export interface CreateBalanceTrackingInput {
  type: 'investment' | 'debt'
  name: string
  currentBalance: number
  maxContributionLimit?: number | null
  monthlyContribution: number
  profileId: string
}

/**
 * Input for updating balance tracking
 * For paid tier: profileId is required
 */
export interface UpdateBalanceTrackingInput {
  id: number
  type?: 'investment' | 'debt'
  name?: string
  currentBalance?: number
  maxContributionLimit?: number | null
  monthlyContribution?: number
  profileId: string
}

// ============================================================================
// Helper: Get authenticated user context
// ============================================================================

async function getAuthenticatedUserContext(request: Request): Promise<{
  success: boolean
  userId?: string
  profileId?: string
  error?: string
}> {
  const userResult = await getCurrentUserSession(request)
  if (!userResult.success || !userResult.data) {
    return { success: false, error: userResult.error || 'Authentication required' }
  }
  const profileId = request.headers.get('x-profile-id') || undefined
  return { success: true, userId: userResult.data.userId, profileId }
}

// ============================================================================
// Income Sources
// ============================================================================

export async function getIncomeSources(
  request: Request,
  profileId: string
): Promise<FinancialApiResult<IncomeSource[]>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    const whereClause = and(
      eq(incomeSources.userId, ctx.userId),
      eq(incomeSources.profileId, activeProfileId)
    )
    const sources = await db
      .select()
      .from(incomeSources)
      .where(whereClause)
      .orderBy(incomeSources.createdAt)
    return { success: true, data: sources }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get income sources',
    }
  }
}

export async function createIncomeSource(
  request: Request,
  data: CreateIncomeSourceInput
): Promise<FinancialApiResult<IncomeSource>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    // For paid tier, profileId is required in the input
    const activeProfileId = data.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    if (!data.name || !data.amount || !data.frequency) {
      return { success: false, error: 'Name, amount, and frequency are required' }
    }
    if (data.amount < 0) {
      return { success: false, error: 'Amount cannot be negative' }
    }
    const [newSource] = await db
      .insert(incomeSources)
      .values({
        userId: ctx.userId,
        profileId: activeProfileId,
        name: data.name,
        amount: data.amount,
        frequency: data.frequency,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    return { success: true, data: newSource }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create income source',
    }
  }
}

export async function updateIncomeSource(
  request: Request,
  id: number,
  data: UpdateIncomeSourceInput
): Promise<FinancialApiResult<IncomeSource>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    // For paid tier, profileId is required
    const activeProfileId = data.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }

    // Validate numeric fields
    if (data.amount !== undefined && data.amount < 0) {
      return { success: false, error: 'Amount cannot be negative' }
    }

    const [existing] = await db
      .select()
      .from(incomeSources)
      .where(
        and(
          eq(incomeSources.id, id),
          eq(incomeSources.userId, ctx.userId),
          eq(incomeSources.profileId, activeProfileId)
        )
      )
      .limit(1)
    if (!existing) {
      return { success: false, error: 'Income source not found or not authorized' }
    }
    const updateObj = {
      ...data,
      updatedAt: new Date(),
      id: undefined, // Don't update the ID
    }
    const [updated] = await db
      .update(incomeSources)
      .set(updateObj)
      .where(
        and(
          eq(incomeSources.id, id),
          eq(incomeSources.userId, ctx.userId),
          eq(incomeSources.profileId, activeProfileId)
        )
      )
      .returning()
    return { success: true, data: updated }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update income source',
    }
  }
}

export async function deleteIncomeSource(
  request: Request,
  id: number,
  profileId: string
): Promise<FinancialApiResult<void>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    const [existing] = await db
      .select()
      .from(incomeSources)
      .where(
        and(
          eq(incomeSources.id, id),
          eq(incomeSources.userId, ctx.userId),
          eq(incomeSources.profileId, activeProfileId)
        )
      )
      .limit(1)
    if (!existing) {
      return { success: false, error: 'Income source not found or not authorized' }
    }
    await db
      .delete(incomeSources)
      .where(
        and(
          eq(incomeSources.id, id),
          eq(incomeSources.userId, ctx.userId),
          eq(incomeSources.profileId, activeProfileId)
        )
      )
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete income source',
    }
  }
}

// ============================================================================
// Expenses
// ============================================================================

export async function getExpenses(
  request: Request,
  profileId: string
): Promise<FinancialApiResult<Expense[]>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    const whereClause = and(
      eq(expenses.userId, ctx.userId),
      eq(expenses.profileId, activeProfileId)
    )
    const list = await db.select().from(expenses).where(whereClause).orderBy(expenses.createdAt)
    return { success: true, data: list }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get expenses',
    }
  }
}

export async function createExpense(
  request: Request,
  data: CreateExpenseInput
): Promise<FinancialApiResult<Expense>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = data.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    if (!data.name || !data.amount || !data.frequency) {
      return { success: false, error: 'Name, amount, and frequency are required' }
    }
    if (data.amount < 0) {
      return { success: false, error: 'Amount cannot be negative' }
    }
    const [newExpense] = await db
      .insert(expenses)
      .values({
        userId: ctx.userId,
        profileId: activeProfileId,
        name: data.name,
        amount: data.amount,
        frequency: data.frequency,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    return { success: true, data: newExpense }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create expense',
    }
  }
}

export async function updateExpense(
  request: Request,
  id: number,
  data: UpdateExpenseInput
): Promise<FinancialApiResult<Expense>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = data.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }

    // Validate numeric fields
    if (data.amount !== undefined && data.amount < 0) {
      return { success: false, error: 'Amount cannot be negative' }
    }

    const [existing] = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.id, id),
          eq(expenses.userId, ctx.userId),
          eq(expenses.profileId, activeProfileId)
        )
      )
      .limit(1)
    if (!existing) {
      return { success: false, error: 'Expense not found or not authorized' }
    }
    const updateObj = {
      ...data,
      updatedAt: new Date(),
      id: undefined,
    }
    const [updated] = await db
      .update(expenses)
      .set(updateObj)
      .where(
        and(
          eq(expenses.id, id),
          eq(expenses.userId, ctx.userId),
          eq(expenses.profileId, activeProfileId)
        )
      )
      .returning()
    return { success: true, data: updated }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update expense',
    }
  }
}

export async function deleteExpense(
  request: Request,
  id: number,
  profileId: string
): Promise<FinancialApiResult<void>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    const [existing] = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.id, id),
          eq(expenses.userId, ctx.userId),
          eq(expenses.profileId, activeProfileId)
        )
      )
      .limit(1)
    if (!existing) {
      return { success: false, error: 'Expense not found or not authorized' }
    }
    await db
      .delete(expenses)
      .where(
        and(
          eq(expenses.id, id),
          eq(expenses.userId, ctx.userId),
          eq(expenses.profileId, activeProfileId)
        )
      )
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete expense',
    }
  }
}

// ============================================================================
// Savings Goals
// ============================================================================

export async function getSavingsGoals(
  request: Request,
  profileId: string
): Promise<FinancialApiResult<SavingsGoal[]>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    const whereClause = and(
      eq(savingsGoals.userId, ctx.userId),
      eq(savingsGoals.profileId, activeProfileId)
    )
    const goals = await db
      .select()
      .from(savingsGoals)
      .where(whereClause)
      .orderBy(savingsGoals.createdAt)
    return { success: true, data: goals }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get savings goals',
    }
  }
}

export async function createSavingsGoal(
  request: Request,
  data: CreateSavingsGoalInput
): Promise<FinancialApiResult<SavingsGoal>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = data.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    if (!data.name || !data.targetAmount) {
      return { success: false, error: 'Name and target amount are required' }
    }
    if (data.targetAmount < 0) {
      return { success: false, error: 'Target amount cannot be negative' }
    }
    if (data.currentBalance !== undefined && data.currentBalance < 0) {
      return { success: false, error: 'Current balance cannot be negative' }
    }
    const [newGoal] = await db
      .insert(savingsGoals)
      .values({
        userId: ctx.userId,
        profileId: activeProfileId,
        name: data.name,
        targetAmount: data.targetAmount,
        currentBalance: data.currentBalance || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    return { success: true, data: newGoal }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create savings goal',
    }
  }
}

export async function updateSavingsGoal(
  request: Request,
  id: number,
  data: UpdateSavingsGoalInput
): Promise<FinancialApiResult<SavingsGoal>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = data.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }

    // Validate numeric fields
    if (data.targetAmount !== undefined && data.targetAmount < 0) {
      return { success: false, error: 'Target amount cannot be negative' }
    }
    if (data.currentBalance !== undefined && data.currentBalance < 0) {
      return { success: false, error: 'Current balance cannot be negative' }
    }

    const [existing] = await db
      .select()
      .from(savingsGoals)
      .where(
        and(
          eq(savingsGoals.id, id),
          eq(savingsGoals.userId, ctx.userId),
          eq(savingsGoals.profileId, activeProfileId)
        )
      )
      .limit(1)
    if (!existing) {
      return { success: false, error: 'Savings goal not found or not authorized' }
    }
    const updateObj = {
      ...data,
      updatedAt: new Date(),
      id: undefined,
    }
    const [updated] = await db
      .update(savingsGoals)
      .set(updateObj)
      .where(
        and(
          eq(savingsGoals.id, id),
          eq(savingsGoals.userId, ctx.userId),
          eq(savingsGoals.profileId, activeProfileId)
        )
      )
      .returning()
    return { success: true, data: updated }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update savings goal',
    }
  }
}

export async function deleteSavingsGoal(
  request: Request,
  id: number,
  profileId: string
): Promise<FinancialApiResult<void>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    const [existing] = await db
      .select()
      .from(savingsGoals)
      .where(
        and(
          eq(savingsGoals.id, id),
          eq(savingsGoals.userId, ctx.userId),
          eq(savingsGoals.profileId, activeProfileId)
        )
      )
      .limit(1)
    if (!existing) {
      return { success: false, error: 'Savings goal not found or not authorized' }
    }
    await db
      .delete(savingsGoals)
      .where(
        and(
          eq(savingsGoals.id, id),
          eq(savingsGoals.userId, ctx.userId),
          eq(savingsGoals.profileId, activeProfileId)
        )
      )
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete savings goal',
    }
  }
}

// ============================================================================
// Balance Tracking
// ============================================================================

export async function getBalanceTracking(
  request: Request,
  profileId: string
): Promise<FinancialApiResult<BalanceTracking[]>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    const whereClause = and(
      eq(balanceTracking.userId, ctx.userId),
      eq(balanceTracking.profileId, activeProfileId)
    )
    const entries = await db
      .select()
      .from(balanceTracking)
      .where(whereClause)
      .orderBy(balanceTracking.createdAt)
    return { success: true, data: entries }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get balance tracking',
    }
  }
}

export async function createBalanceTracking(
  request: Request,
  data: CreateBalanceTrackingInput
): Promise<FinancialApiResult<BalanceTracking>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = data.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    if (!data.name || !data.type || data.currentBalance === undefined) {
      return { success: false, error: 'Name, type, and current balance are required' }
    }
    if (data.currentBalance < 0) {
      return { success: false, error: 'Current balance cannot be negative' }
    }
    if (data.monthlyContribution !== undefined && data.monthlyContribution < 0) {
      return { success: false, error: 'Monthly contribution cannot be negative' }
    }
    if (
      data.maxContributionLimit !== undefined &&
      data.maxContributionLimit !== null &&
      data.maxContributionLimit < 0
    ) {
      return { success: false, error: 'Max contribution limit cannot be negative' }
    }
    const [newEntry] = await db
      .insert(balanceTracking)
      .values({
        userId: ctx.userId,
        profileId: activeProfileId,
        type: data.type,
        name: data.name,
        currentBalance: data.currentBalance,
        maxContributionLimit: data.maxContributionLimit ?? null,
        monthlyContribution: data.monthlyContribution ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    return { success: true, data: newEntry }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create balance tracking',
    }
  }
}

export async function updateBalanceTracking(
  request: Request,
  id: number,
  data: UpdateBalanceTrackingInput
): Promise<FinancialApiResult<BalanceTracking>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = data.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }

    // Validate numeric fields
    if (data.currentBalance !== undefined && data.currentBalance < 0) {
      return { success: false, error: 'Current balance cannot be negative' }
    }
    if (data.monthlyContribution !== undefined && data.monthlyContribution < 0) {
      return { success: false, error: 'Monthly contribution cannot be negative' }
    }
    if (
      data.maxContributionLimit !== undefined &&
      data.maxContributionLimit !== null &&
      data.maxContributionLimit < 0
    ) {
      return { success: false, error: 'Max contribution limit cannot be negative' }
    }

    const [existing] = await db
      .select()
      .from(balanceTracking)
      .where(
        and(
          eq(balanceTracking.id, id),
          eq(balanceTracking.userId, ctx.userId),
          eq(balanceTracking.profileId, activeProfileId)
        )
      )
      .limit(1)
    if (!existing) {
      return { success: false, error: 'Balance tracking entry not found or not authorized' }
    }
    const updateObj = {
      ...data,
      updatedAt: new Date(),
      id: undefined,
    }
    const [updated] = await db
      .update(balanceTracking)
      .set(updateObj)
      .where(
        and(
          eq(balanceTracking.id, id),
          eq(balanceTracking.userId, ctx.userId),
          eq(balanceTracking.profileId, activeProfileId)
        )
      )
      .returning()
    return { success: true, data: updated }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update balance tracking',
    }
  }
}

export async function deleteBalanceTracking(
  request: Request,
  id: number,
  profileId: string
): Promise<FinancialApiResult<void>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for paid tier' }
    }
    const [existing] = await db
      .select()
      .from(balanceTracking)
      .where(
        and(
          eq(balanceTracking.id, id),
          eq(balanceTracking.userId, ctx.userId),
          eq(balanceTracking.profileId, activeProfileId)
        )
      )
      .limit(1)
    if (!existing) {
      return { success: false, error: 'Balance tracking entry not found or not authorized' }
    }
    await db
      .delete(balanceTracking)
      .where(
        and(
          eq(balanceTracking.id, id),
          eq(balanceTracking.userId, ctx.userId),
          eq(balanceTracking.profileId, activeProfileId)
        )
      )
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete balance tracking',
    }
  }
}

// ============================================================================
// Bulk Synchronization
// ============================================================================

export async function syncFinancialData(
  request: Request,
  data: {
    incomeSources?: CreateIncomeSourceInput[]
    expenses?: CreateExpenseInput[]
    savingsGoals?: CreateSavingsGoalInput[]
    balanceTracking?: CreateBalanceTrackingInput[]
  }
): Promise<
  FinancialApiResult<{
    incomeSources: IncomeSource[]
    expenses: Expense[]
    savingsGoals: SavingsGoal[]
    balanceTracking: BalanceTracking[]
  }>
> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = ctx.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required for sync' }
    }
    const results = {
      incomeSources: [] as IncomeSource[],
      expenses: [] as Expense[],
      savingsGoals: [] as SavingsGoal[],
      balanceTracking: [] as BalanceTracking[],
    }
    if (data.incomeSources?.length) {
      const srcs = await Promise.all(
        data.incomeSources.map((s) =>
          createIncomeSource(request, { ...s, profileId: activeProfileId })
        )
      )
      results.incomeSources = srcs
        .filter((r) => r.success && r.data)
        .map((r) => r.data) as IncomeSource[]
    }
    if (data.expenses?.length) {
      const exps = await Promise.all(
        data.expenses.map((e) => createExpense(request, { ...e, profileId: activeProfileId }))
      )
      results.expenses = exps.filter((r) => r.success && r.data).map((r) => r.data) as Expense[]
    }
    if (data.savingsGoals?.length) {
      const goals = await Promise.all(
        data.savingsGoals.map((g) =>
          createSavingsGoal(request, { ...g, profileId: activeProfileId })
        )
      )
      results.savingsGoals = goals
        .filter((r) => r.success && r.data)
        .map((r) => r.data) as SavingsGoal[]
    }
    if (data.balanceTracking?.length) {
      const tracking = await Promise.all(
        data.balanceTracking.map((t) =>
          createBalanceTracking(request, { ...t, profileId: activeProfileId })
        )
      )
      results.balanceTracking = tracking
        .filter((r) => r.success && r.data)
        .map((r) => r.data) as BalanceTracking[]
    }
    return { success: true, data: results }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to synchronize financial data',
    }
  }
}
