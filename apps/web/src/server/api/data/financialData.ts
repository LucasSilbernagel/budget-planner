/**
 * Financial Data Server Functions
 * 
 * Handles CRUD operations for financial data (income sources, expenses, savings, balance).
 * Provides synchronization between client and server for paid tier users.
 * 
 * Architecture: TanStack Start Server Functions with PostgreSQL (Drizzle ORM)
 * Data Sovereignty: ALL data stored in DanubeData PostgreSQL (Germany - EU) for CLOUD Act immunity (NFR1, NFR2)
 */

import type { Request } from '@tanstack/start'
import { getCurrentUserSession } from '../auth/paddle'
import type { ApiResult } from '../auth/paddle'
import { db } from '@budget-planner/db'
import { incomeSources, expenses, savingsGoals, balanceTracking } from '@budget-planner/db/src/schema'
import { eq, and } from 'drizzle-orm'
import type { IncomeSource, NewIncomeSource, Expense, NewExpense, SavingsGoal, NewSavingsGoal, BalanceTracking, NewBalanceTracking } from '@budget-planner/db'

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
 */
export interface CreateIncomeSourceInput {
  name: string
  amount: number
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'annually'
  profileId?: string
}

/**
 * Input for updating an income source
 */
export interface UpdateIncomeSourceInput {
  id: number
  name?: string
  amount?: number
  frequency?: 'weekly' | 'biweekly' | 'monthly' | 'annually'
  profileId?: string
}

/**
 * Input for creating an expense (with profile context)
 */
export interface CreateExpenseInput {
  name: string
  amount: number
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'annually'
  profileId?: string
}

/**
 * Input for updating an expense
 */
export interface UpdateExpenseInput {
  id: number
  name?: string
  amount?: number
  frequency?: 'weekly' | 'biweekly' | 'monthly' | 'annually'
  profileId?: string
}

/**
 * Input for creating a savings goal (with profile context)
 */
export interface CreateSavingsGoalInput {
  name: string
  targetAmount: number
  currentBalance: number
  profileId?: string
}

/**
 * Input for updating a savings goal
 */
export interface UpdateSavingsGoalInput {
  id: number
  name?: string
  targetAmount?: number
  currentBalance?: number
  profileId?: string
}

/**
 * Input for creating balance tracking (with profile context)
 */
export interface CreateBalanceTrackingInput {
  type: 'investment' | 'debt'
  name: string
  currentBalance: number
  maxContributionLimit?: number | null
  monthlyContribution: number
  profileId?: string
}

/**
 * Input for updating balance tracking
 */
export interface UpdateBalanceTrackingInput {
  id: number
  type?: 'investment' | 'debt'
  name?: string
  currentBalance?: number
  maxContributionLimit?: number | null
  monthlyContribution?: number
  profileId?: string
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
  profileId?: string
): Promise<FinancialApiResult<IncomeSource[]>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    let whereClause = eq(incomeSources.userId, ctx.userId)
    if (activeProfileId) {
      whereClause = and(whereClause, eq(incomeSources.profileId, activeProfileId))
    }
    const sources = await db.select().from(incomeSources).where(whereClause).orderBy(incomeSources.createdAt)
    return { success: true, data: sources }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get income sources' }
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
    const activeProfileId = data.profileId || ctx.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required' }
    }
    if (!data.name || !data.amount || !data.frequency) {
      return { success: false, error: 'Name, amount, and frequency are required' }
    }
    const [newSource] = await db.insert(incomeSources).values({
      userId: ctx.userId,
      profileId: activeProfileId,
      name: data.name,
      amount: data.amount,
      frequency: data.frequency,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NewIncomeSource).returning()
    return { success: true, data: newSource }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create income source' }
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
    const activeProfileId = data.profileId || ctx.profileId
    const [existing] = await db.select().from(incomeSources).where(and(eq(incomeSources.id, id), eq(incomeSources.userId, ctx.userId), activeProfileId ? eq(incomeSources.profileId, activeProfileId) : undefined)).limit(1)
    if (!existing) {
      return { success: false, error: 'Income source not found or not authorized' }
    }
    const updateObj: Partial<NewIncomeSource> = { ...data, updatedAt: new Date() }
    const [updated] = await db.update(incomeSources).set(updateObj).where(and(eq(incomeSources.id, id), eq(incomeSources.userId, ctx.userId))).returning()
    return { success: true, data: updated }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update income source' }
  }
}

export async function deleteIncomeSource(
  request: Request,
  id: number,
  profileId?: string
): Promise<FinancialApiResult<void>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    const [existing] = await db.select().from(incomeSources).where(and(eq(incomeSources.id, id), eq(incomeSources.userId, ctx.userId), activeProfileId ? eq(incomeSources.profileId, activeProfileId) : undefined)).limit(1)
    if (!existing) {
      return { success: false, error: 'Income source not found or not authorized' }
    }
    await db.delete(incomeSources).where(and(eq(incomeSources.id, id), eq(incomeSources.userId, ctx.userId)))
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete income source' }
  }
}

// ============================================================================
// Expenses
// ============================================================================

export async function getExpenses(
  request: Request,
  profileId?: string
): Promise<FinancialApiResult<Expense[]>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    let whereClause = eq(expenses.userId, ctx.userId)
    if (activeProfileId) {
      whereClause = and(whereClause, eq(expenses.profileId, activeProfileId))
    }
    const list = await db.select().from(expenses).where(whereClause).orderBy(expenses.createdAt)
    return { success: true, data: list }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get expenses' }
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
    const activeProfileId = data.profileId || ctx.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required' }
    }
    if (!data.name || !data.amount || !data.frequency) {
      return { success: false, error: 'Name, amount, and frequency are required' }
    }
    const [newExpense] = await db.insert(expenses).values({
      userId: ctx.userId,
      profileId: activeProfileId,
      name: data.name,
      amount: data.amount,
      frequency: data.frequency,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NewExpense).returning()
    return { success: true, data: newExpense }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create expense' }
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
    const activeProfileId = data.profileId || ctx.profileId
    const [existing] = await db.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.userId, ctx.userId), activeProfileId ? eq(expenses.profileId, activeProfileId) : undefined)).limit(1)
    if (!existing) {
      return { success: false, error: 'Expense not found or not authorized' }
    }
    const updateObj: Partial<NewExpense> = { ...data, updatedAt: new Date() }
    const [updated] = await db.update(expenses).set(updateObj).where(and(eq(expenses.id, id), eq(expenses.userId, ctx.userId))).returning()
    return { success: true, data: updated }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update expense' }
  }
}

export async function deleteExpense(
  request: Request,
  id: number,
  profileId?: string
): Promise<FinancialApiResult<void>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    const [existing] = await db.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.userId, ctx.userId), activeProfileId ? eq(expenses.profileId, activeProfileId) : undefined)).limit(1)
    if (!existing) {
      return { success: false, error: 'Expense not found or not authorized' }
    }
    await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.userId, ctx.userId)))
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete expense' }
  }
}

// ============================================================================
// Savings Goals
// ============================================================================

export async function getSavingsGoals(
  request: Request,
  profileId?: string
): Promise<FinancialApiResult<SavingsGoal[]>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    let whereClause = eq(savingsGoals.userId, ctx.userId)
    if (activeProfileId) {
      whereClause = and(whereClause, eq(savingsGoals.profileId, activeProfileId))
    }
    const goals = await db.select().from(savingsGoals).where(whereClause).orderBy(savingsGoals.createdAt)
    return { success: true, data: goals }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get savings goals' }
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
    const activeProfileId = data.profileId || ctx.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required' }
    }
    if (!data.name || !data.targetAmount) {
      return { success: false, error: 'Name and target amount are required' }
    }
    const [newGoal] = await db.insert(savingsGoals).values({
      userId: ctx.userId,
      profileId: activeProfileId,
      name: data.name,
      targetAmount: data.targetAmount,
      currentBalance: data.currentBalance || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NewSavingsGoal).returning()
    return { success: true, data: newGoal }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create savings goal' }
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
    const activeProfileId = data.profileId || ctx.profileId
    const [existing] = await db.select().from(savingsGoals).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, ctx.userId), activeProfileId ? eq(savingsGoals.profileId, activeProfileId) : undefined)).limit(1)
    if (!existing) {
      return { success: false, error: 'Savings goal not found or not authorized' }
    }
    const updateObj: Partial<NewSavingsGoal> = { ...data, updatedAt: new Date() }
    const [updated] = await db.update(savingsGoals).set(updateObj).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, ctx.userId))).returning()
    return { success: true, data: updated }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update savings goal' }
  }
}

export async function deleteSavingsGoal(
  request: Request,
  id: number,
  profileId?: string
): Promise<FinancialApiResult<void>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    const [existing] = await db.select().from(savingsGoals).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, ctx.userId), activeProfileId ? eq(savingsGoals.profileId, activeProfileId) : undefined)).limit(1)
    if (!existing) {
      return { success: false, error: 'Savings goal not found or not authorized' }
    }
    await db.delete(savingsGoals).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, ctx.userId)))
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete savings goal' }
  }
}

// ============================================================================
// Balance Tracking
// ============================================================================

export async function getBalanceTracking(
  request: Request,
  profileId?: string
): Promise<FinancialApiResult<BalanceTracking[]>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    let whereClause = eq(balanceTracking.userId, ctx.userId)
    if (activeProfileId) {
      whereClause = and(whereClause, eq(balanceTracking.profileId, activeProfileId))
    }
    const entries = await db.select().from(balanceTracking).where(whereClause).orderBy(balanceTracking.createdAt)
    return { success: true, data: entries }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get balance tracking' }
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
    const activeProfileId = data.profileId || ctx.profileId
    if (!activeProfileId) {
      return { success: false, error: 'Profile ID required' }
    }
    if (!data.name || !data.type || !data.currentBalance) {
      return { success: false, error: 'Name, type, and current balance are required' }
    }
    const [newEntry] = await db.insert(balanceTracking).values({
      userId: ctx.userId,
      profileId: activeProfileId,
      type: data.type,
      name: data.name,
      currentBalance: data.currentBalance,
      maxContributionLimit: data.maxContributionLimit ?? null,
      monthlyContribution: data.monthlyContribution ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NewBalanceTracking).returning()
    return { success: true, data: newEntry }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create balance tracking' }
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
    const activeProfileId = data.profileId || ctx.profileId
    const [existing] = await db.select().from(balanceTracking).where(and(eq(balanceTracking.id, id), eq(balanceTracking.userId, ctx.userId), activeProfileId ? eq(balanceTracking.profileId, activeProfileId) : undefined)).limit(1)
    if (!existing) {
      return { success: false, error: 'Balance tracking entry not found or not authorized' }
    }
    const updateObj: Partial<NewBalanceTracking> = { ...data, updatedAt: new Date() }
    const [updated] = await db.update(balanceTracking).set(updateObj).where(and(eq(balanceTracking.id, id), eq(balanceTracking.userId, ctx.userId))).returning()
    return { success: true, data: updated }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update balance tracking' }
  }
}

export async function deleteBalanceTracking(
  request: Request,
  id: number,
  profileId?: string
): Promise<FinancialApiResult<void>> {
  try {
    const ctx = await getAuthenticatedUserContext(request)
    if (!ctx.success || !ctx.userId) {
      return { success: false, error: ctx.error || 'Authentication required' }
    }
    const activeProfileId = profileId || ctx.profileId
    const [existing] = await db.select().from(balanceTracking).where(and(eq(balanceTracking.id, id), eq(balanceTracking.userId, ctx.userId), activeProfileId ? eq(balanceTracking.profileId, activeProfileId) : undefined)).limit(1)
    if (!existing) {
      return { success: false, error: 'Balance tracking entry not found or not authorized' }
    }
    await db.delete(balanceTracking).where(and(eq(balanceTracking.id, id), eq(balanceTracking.userId, ctx.userId)))
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete balance tracking' }
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
): Promise<FinancialApiResult<{
  incomeSources: IncomeSource[]
  expenses: Expense[]
  savingsGoals: SavingsGoal[]
  balanceTracking: BalanceTracking[]
}>> {
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
      const srcs = await Promise.all(data.incomeSources.map(s => createIncomeSource(request, { ...s, profileId: activeProfileId })))
      results.incomeSources = srcs.filter(r => r.success).map(r => r.data!) as IncomeSource[]
    }
    if (data.expenses?.length) {
      const exps = await Promise.all(data.expenses.map(e => createExpense(request, { ...e, profileId: activeProfileId })))
      results.expenses = exps.filter(r => r.success).map(r => r.data!) as Expense[]
    }
    if (data.savingsGoals?.length) {
      const goals = await Promise.all(data.savingsGoals.map(g => createSavingsGoal(request, { ...g, profileId: activeProfileId })))
      results.savingsGoals = goals.filter(r => r.success).map(r => r.data!) as SavingsGoal[]
    }
    if (data.balanceTracking?.length) {
      const tracking = await Promise.all(data.balanceTracking.map(t => createBalanceTracking(request, { ...t, profileId: activeProfileId })))
      results.balanceTracking = tracking.filter(r => r.success).map(r => r.data!) as BalanceTracking[]
    }
    return { success: true, data: results }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to synchronize financial data' }
  }
}
