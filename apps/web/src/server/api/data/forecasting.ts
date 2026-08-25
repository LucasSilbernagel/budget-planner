/**
 * Premium Forecasting Server Functions
 *
 * Server-side functions for premium forecasting features.
 * Only available for paid tier users.
 *
 * Architecture: TanStack Start Server Functions with PostgreSQL
 */

import {
  type ForecastingResult,
  type ForecastingScenario,
  type GoalCalculation,
  calculateFinancialForecast,
  calculateGoalTimeline,
} from '@budget-planner/core'
import type { Frequency, SubscriptionStatus } from '@budget-planner/db'
import type { UserSession } from '../auth/paddle'
import type { ApiResult } from '../auth/paddle'

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
      // Rebuilt rather than cast across generics: on the failure path `data` is
      // absent, so the only meaningful fields are `success` and `error`. The cast
      // asserted an overlap between `UserSession | null` and `ForecastingResult`
      // that does not exist.
      return { success: false, error: userResult.error }
    }

    const user = userResult.data

    if (!user) {
      return {
        success: false,
        error: 'Authentication required for premium features',
      }
    }

    // Check if user has access to premium features
    if (user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'lifetime') {
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

    const result = calculateFinancialForecast(currentData, data.scenario, data.years)

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
      // See `calculateForecastServer` above — rebuilt, not cast.
      return { success: false, error: userResult.error }
    }

    const user = userResult.data

    if (!user) {
      return {
        success: false,
        error: 'Authentication required for premium features',
      }
    }

    // Check if user has access to premium features
    if (user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'lifetime') {
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
  // ⚠️ `SubscriptionStatus`, not `string`. The value here is `user.subscriptionStatus`,
  // which is already the pg enum union (`packages/db/src/schema.ts:568`); declaring
  // it `string` widened it back out and forced three assignments in
  // `hooks/usePremiumAccess.ts` to fail against the union THEY correctly declare.
): Promise<ApiResult<{ hasAccess: boolean; subscriptionStatus: SubscriptionStatus }>> {
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
        // Both an active subscription and a permanent lifetime purchase
        // (story 25-2) grant premium access.
        hasAccess: user.subscriptionStatus === 'active' || user.subscriptionStatus === 'lifetime',
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
 *
 * Exported so server functions (e.g. sync) can resolve the authenticated user
 * through the same path used by the data API.
 */
export async function getUserContext(request: Request): Promise<ApiResult<UserSession | null>> {
  const { getCurrentUserSession } = await import('../auth/paddle')
  return getCurrentUserSession(request)
}
