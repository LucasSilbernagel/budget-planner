/**
 * Premium Forecasting Server Functions
 * 
 * Server-side functions for premium forecasting features.
 * Only available for paid tier users.
 * 
 * Architecture: TanStack Start Server Functions with PostgreSQL
 */

import type { UserSession } from '../auth/paddle'
import type { ApiResult } from '../auth/paddle'
import {
  calculateFinancialForecast,
  calculateGoalTimeline,
  type ForecastingScenario,
  type ForecastingResult,
  type GoalCalculation,
} from '@budget-planner/core'
import type { Frequency } from '@budget-planner/db'

/**
 * Financial item for forecasting
 */
export interface ForecastFinancialItem {
  name: string
  amount: number // In cents
  frequency: Frequency
}

/**
 * Request input for financial forecast
 */
export interface ForecastRequest {
  income: ForecastFinancialItem[]
  expenses: ForecastFinancialItem[]
  savings: number // Current savings in cents
  investments: number // Current investments in cents
  scenario: ForecastingScenario
  years: number
}

/**
 * Server Function: Calculate financial forecast
 * Only available for paid tier users
 */
export async function calculateForecastServer(
  request: Request,
  data: ForecastRequest
): Promise<ApiResult<ForecastingResult>> {
  try {
    const userResult = await getUserContext(request)
    
    if (!userResult.success) {
      return userResult as ApiResult<ForecastingResult>
    }
    
    const user = userResult.data
    
    if (!user) {
      return {
        success: false,
        error: 'Authentication required for premium features',
      }
    }

    // Check if user has access to premium features
    if (user.subscriptionStatus !== 'active') {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to access forecasting tools',
      }
    }

    // Convert request data to format expected by core functions
    const currentData = {
      income: data.income.map((item) => ({
        amount: item.amount,
        frequency: item.frequency,
      })),
      expenses: data.expenses.map((item) => ({
        amount: item.amount,
        frequency: item.frequency,
      })),
      savings: data.savings,
      investments: data.investments,
    }

    const result = calculateFinancialForecast(
      currentData,
      data.scenario,
      data.years
    )

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to calculate forecast',
    }
  }
}

/**
 * Server Function: Calculate goal timeline
 * Only available for paid tier users
 */
export async function calculateGoalTimelineServer(
  request: Request,
  data: {
    targetAmount: number // In cents
    currentAmount: number // In cents
    monthlyContribution: number // In cents
    annualReturnRate: number // As decimal
  }
): Promise<ApiResult<GoalCalculation>> {
  try {
    const userResult = await getUserContext(request)
    
    if (!userResult.success) {
      return userResult as ApiResult<GoalCalculation>
    }
    
    const user = userResult.data
    
    if (!user) {
      return {
        success: false,
        error: 'Authentication required for premium features',
      }
    }

    // Check if user has access to premium features
    if (user.subscriptionStatus !== 'active') {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to access goal tracking',
      }
    }

    const result = calculateGoalTimeline(
      data.targetAmount,
      data.currentAmount,
      data.monthlyContribution,
      data.annualReturnRate
    )

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to calculate goal timeline',
    }
  }
}

/**
 * Server Function: Check premium feature access
 */
export async function checkPremiumAccessServer(
  request: Request
): Promise<ApiResult<{ hasAccess: boolean; subscriptionStatus: string }>> {
  try {
    const userResult = await getUserContext(request)
    
    if (!userResult.success) {
      return {
        success: false,
        error: userResult.error,
      }
    }
    
    const user = userResult.data
    
    if (!user) {
      return {
        success: true,
        data: {
          hasAccess: false,
          subscriptionStatus: 'free',
        },
      }
    }

    return {
      success: true,
      data: {
        hasAccess: user.subscriptionStatus === 'active',
        subscriptionStatus: user.subscriptionStatus,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check premium access',
    }
  }
}

/**
 * Get user context from request
 * Extracts user session from request headers/cookies
 */
async function getUserContext(request: Request): Promise<ApiResult<UserSession | null>> {
  const { getCurrentUserSession } = await import('../auth/paddle')
  return getCurrentUserSession(request)
}
