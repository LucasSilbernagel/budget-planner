/**
 * Financial Calculation Server Functions
 *
 * Server-side financial calculation functions for the Budget Planner application.
 * These functions provide RPC-style backend communication for paid tier users.
 *
 * Architecture: TanStack Start Server Functions
 * Security: Only accessible to authenticated users with active subscriptions
 */

import {
  type CompoundingInput,
  type ForecastingResult,
  type ForecastingScenario,
  type RetirementInput,
  type RetirementResult,
  type YearlyProjection,
  calculateCompoundingProjection,
  calculateFinancialForecast,
  calculateRetirementRequirement,
  calculateSafeMonthlyWithdrawal,
} from '@budget-planner/core'
import type { Request } from '@tanstack/start'
import { getCurrentUserSession } from '../api/auth/paddle'
import type { ApiResult } from '../api/auth/paddle'

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
 * Input for net worth projection calculation
 */
export interface NetWorthProjectionInput {
  currentAssets: number // In cents
  currentLiabilities: number // In cents
  monthlySavings: number // In cents
  expectedReturnRate: number // Annual return rate as decimal (e.g., 0.07 for 7%)
  timeHorizonYears: number
}

/**
 * Result of net worth projection calculation
 */
export interface NetWorthProjectionResult {
  yearlyProjections: YearlyNetWorthProjection[]
  finalNetWorth: number // In cents
}

/**
 * Yearly net worth projection data point
 */
export interface YearlyNetWorthProjection {
  year: number
  assets: number // In cents
  liabilities: number // In cents
  netWorth: number // In cents
}

/**
 * Input for complex aggregation calculation
 */
export interface AggregationInput {
  values: number[] // Array of values in cents
  operation: 'sum' | 'average' | 'median' | 'max' | 'min'
}

/**
 * Result of complex aggregation calculation
 */
export interface AggregationResult {
  result: number // In cents
  operation: string
  count: number
}

// ============================================================================
// Helper: Get authenticated user with subscription check
// ============================================================================

/**
 * Get authenticated user context and verify premium subscription
 * Returns user if authenticated and has active subscription, otherwise returns error
 */
async function getAuthenticatedUser(request: Request): Promise<ApiResult<any>> {
  const userResult = await getCurrentUserSession(request)

  if (!userResult.success) {
    return userResult
  }

  const user = userResult.data

  if (!user) {
    return {
      success: false,
      error: 'Authentication required for financial calculations',
    }
  }

  // Check if user has access to premium features
  if (user.subscriptionStatus !== 'active') {
    return {
      success: false,
      error: 'Premium feature: Please upgrade to access server-side calculations',
    }
  }

  return { success: true, data: user }
}

// ============================================================================
// Server Function: Retirement Calculation
// ============================================================================

/**
 * Server Function: Calculate retirement requirement
 * Calculates how much in assets is needed for a desired retirement income
 * Uses the Safe Withdrawal Model: FV = Ir × (12 / r)
 *
 * @param request - TanStack Start Request object for authentication
 * @param input - Retirement calculation input (desired income, return rate)
 * @returns Promise with ApiResult containing retirement requirement
 */
export async function retirementCalculation(
  request: Request,
  input: RetirementInput
): Promise<FinancialApiResult<RetirementResult>> {
  // Verify user authentication and subscription
  const userResult = await getAuthenticatedUser(request)

  if (!userResult.success) {
    return userResult as FinancialApiResult<RetirementResult>
  }

  try {
    // Validate input - check for undefined/null first
    if (input.desiredMonthlyIncome === undefined || input.annualReturnRate === undefined) {
      return {
        success: false,
        error: 'Missing required parameters: desiredMonthlyIncome and annualReturnRate',
      }
    }

    if (input.desiredMonthlyIncome === null || input.annualReturnRate === null) {
      return {
        success: false,
        error: 'Parameters cannot be null: desiredMonthlyIncome and annualReturnRate',
      }
    }

    if (input.desiredMonthlyIncome <= 0) {
      return {
        success: false,
        error: 'Desired monthly income must be positive',
      }
    }

    if (input.annualReturnRate <= 0 || input.annualReturnRate >= 1) {
      return {
        success: false,
        error: 'Annual return rate must be between 0 and 1 (exclusive)',
      }
    }

    // Perform calculation using core function
    const result = calculateRetirementRequirement(input)

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error in retirement calculation',
    }
  }
}

// ============================================================================
// Server Function: Safe Withdrawal Calculation
// ============================================================================

/**
 * Server Function: Calculate safe monthly withdrawal amount
 * Calculates how much can be withdrawn monthly from a given asset value
 *
 * @param request - TanStack Start Request object for authentication
 * @param assets - Total asset value in cents
 * @param annualReturnRate - Expected annual return rate as decimal
 * @returns Promise with ApiResult containing safe monthly withdrawal amount in cents
 */
export async function safeWithdrawalCalculation(
  request: Request,
  assets: number,
  annualReturnRate: number
): Promise<FinancialApiResult<number>> {
  // Verify user authentication and subscription
  const userResult = await getAuthenticatedUser(request)

  if (!userResult.success) {
    return userResult as FinancialApiResult<number>
  }

  try {
    // Validate input - check for undefined/null first
    if (assets === undefined || annualReturnRate === undefined) {
      return {
        success: false,
        error: 'Missing required parameters: assets and annualReturnRate',
      }
    }

    if (assets === null || annualReturnRate === null) {
      return {
        success: false,
        error: 'Parameters cannot be null: assets and annualReturnRate',
      }
    }

    if (assets < 0) {
      return {
        success: false,
        error: 'Asset value cannot be negative',
      }
    }

    if (annualReturnRate < 0 || annualReturnRate >= 1) {
      return {
        success: false,
        error: 'Annual return rate must be between 0 and 1 (exclusive)',
      }
    }

    // Perform calculation
    const result = calculateSafeMonthlyWithdrawal(assets, annualReturnRate)

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error in withdrawal calculation',
    }
  }
}

// ============================================================================
// Server Function: Compounding Projection
// ============================================================================

/**
 * Server Function: Calculate compounding projection
 * Projects growth of investments over time with compounding
 *
 * @param request - TanStack Start Request object for authentication
 * @param input - Compounding calculation input (principal, rate, time, contributions)
 * @returns Promise with ApiResult containing yearly projections
 */
export async function compoundingProjection(
  request: Request,
  input: CompoundingInput
): Promise<FinancialApiResult<YearlyProjection[]>> {
  // Verify user authentication and subscription
  const userResult = await getAuthenticatedUser(request)

  if (!userResult.success) {
    return userResult as FinancialApiResult<YearlyProjection[]>
  }

  try {
    // Validate input - check for undefined/null first
    if (
      input.principal === undefined ||
      input.annualReturnRate === undefined ||
      input.years === undefined
    ) {
      return {
        success: false,
        error: 'Missing required parameters: principal, annualReturnRate, and years',
      }
    }

    if (input.principal === null || input.annualReturnRate === null || input.years === null) {
      return {
        success: false,
        error: 'Parameters cannot be null: principal, annualReturnRate, and years',
      }
    }

    if (input.principal < 0) {
      return {
        success: false,
        error: 'Principal cannot be negative',
      }
    }

    if (input.annualReturnRate < 0) {
      return {
        success: false,
        error: 'Return rate cannot be negative',
      }
    }

    if (input.years <= 0) {
      return {
        success: false,
        error: 'Time horizon must be positive',
      }
    }

    // Perform calculation
    const result = calculateCompoundingProjection(input)

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error in projection calculation',
    }
  }
}

// ============================================================================
// Server Function: Net Worth Projection
// ============================================================================

/**
 * Server Function: Calculate net worth projection over time
 * Projects net worth based on current assets, liabilities, and savings rate
 *
 * @param request - TanStack Start Request object for authentication
 * @param input - Net worth projection input parameters
 * @returns Promise with ApiResult containing yearly net worth projections
 */
export async function netWorthProjection(
  request: Request,
  input: NetWorthProjectionInput
): Promise<FinancialApiResult<NetWorthProjectionResult>> {
  // Verify user authentication and subscription
  const userResult = await getAuthenticatedUser(request)

  if (!userResult.success) {
    return userResult as FinancialApiResult<NetWorthProjectionResult>
  }

  try {
    // Validate input - check for undefined/null first
    if (
      input.currentAssets === undefined ||
      input.currentLiabilities === undefined ||
      input.monthlySavings === undefined ||
      input.expectedReturnRate === undefined ||
      input.timeHorizonYears === undefined
    ) {
      return {
        success: false,
        error:
          'Missing required parameters: currentAssets, currentLiabilities, monthlySavings, expectedReturnRate, timeHorizonYears',
      }
    }

    if (
      input.currentAssets === null ||
      input.currentLiabilities === null ||
      input.monthlySavings === null ||
      input.expectedReturnRate === null ||
      input.timeHorizonYears === null
    ) {
      return {
        success: false,
        error: 'Parameters cannot be null',
      }
    }

    if (input.timeHorizonYears <= 0) {
      return {
        success: false,
        error: 'Time horizon must be positive',
      }
    }

    if (input.expectedReturnRate < 0 || input.expectedReturnRate >= 1) {
      return {
        success: false,
        error: 'Return rate must be between 0 and 1 (exclusive)',
      }
    }

    // Work directly in cents to avoid precision loss from conversion
    // Inputs are already in cents per the interface definition
    const currentAssetsCents = input.currentAssets
    const currentLiabilitiesCents = input.currentLiabilities
    const monthlySavingsCents = input.monthlySavings

    // Calculate yearly projections
    const yearlyProjections: YearlyNetWorthProjection[] = []
    let assetsCents = currentAssetsCents
    const liabilitiesCents = currentLiabilitiesCents

    // Add initial state (year 0) before starting projections
    yearlyProjections.push({
      year: 0,
      assets: assetsCents,
      liabilities: liabilitiesCents,
      netWorth: assetsCents - liabilitiesCents,
    })

    for (let year = 1; year <= input.timeHorizonYears; year++) {
      // Grow assets with compound interest
      assetsCents = Math.round(assetsCents * (1 + input.expectedReturnRate))

      // Add monthly savings (converted to yearly)
      assetsCents += Math.round(monthlySavingsCents * 12)

      // Calculate net worth at the beginning of the year
      const netWorthCents = assetsCents - liabilitiesCents

      yearlyProjections.push({
        year,
        assets: assetsCents,
        liabilities: liabilitiesCents,
        netWorth: netWorthCents,
      })

      // For simplicity, assume liabilities stay constant (or could add logic for debt paydown)
      // This is a simplified model - could be enhanced
    }

    const finalNetWorth = yearlyProjections[yearlyProjections.length - 1]?.netWorth || 0

    return {
      success: true,
      data: {
        yearlyProjections,
        finalNetWorth,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error in net worth projection',
    }
  }
}

// ============================================================================
// Server Function: Complex Aggregation
// ============================================================================

/**
 * Server Function: Perform complex aggregation on array of values
 * Supports sum, average, median, max, and min operations
 *
 * @param request - TanStack Start Request object for authentication
 * @param input - Aggregation input with values and operation type
 * @returns Promise with ApiResult containing aggregation result
 */
export async function complexAggregation(
  request: Request,
  input: AggregationInput
): Promise<FinancialApiResult<AggregationResult>> {
  // Verify user authentication and subscription
  const userResult = await getAuthenticatedUser(request)

  if (!userResult.success) {
    return userResult as FinancialApiResult<AggregationResult>
  }

  try {
    // Validate input - check type first, then undefined/null, then content
    if (!Array.isArray(input.values)) {
      return {
        success: false,
        error: 'Values must be an array',
      }
    }

    if (input.values === undefined || input.operation === undefined) {
      return {
        success: false,
        error: 'Missing required parameters: values and operation',
      }
    }

    if (input.values === null || input.operation === null) {
      return {
        success: false,
        error: 'Parameters cannot be null: values and operation',
      }
    }

    if (input.values.length === 0) {
      return {
        success: false,
        error: 'Values array must not be empty',
      }
    }

    if (!['sum', 'average', 'median', 'max', 'min'].includes(input.operation)) {
      return {
        success: false,
        error: 'Invalid operation. Must be one of: sum, average, median, max, min',
      }
    }

    // Validate that all values are numbers
    if (!input.values.every((v) => typeof v === 'number' && !Number.isNaN(v))) {
      return {
        success: false,
        error: 'All values must be valid numbers',
      }
    }

    // Perform the requested aggregation
    let result: number
    const sortedValues = [...input.values].sort((a, b) => a - b)

    switch (input.operation) {
      case 'sum':
        result = input.values.reduce((acc, val) => acc + val, 0)
        break
      case 'average':
        result = input.values.reduce((acc, val) => acc + val, 0) / input.values.length
        break
      case 'median': {
        const mid = Math.floor(sortedValues.length / 2)
        result =
          sortedValues.length % 2 !== 0
            ? sortedValues[mid]
            : (sortedValues[mid - 1] + sortedValues[mid]) / 2
        break
      }
      case 'max':
        result = Math.max(...input.values)
        break
      case 'min':
        result = Math.min(...input.values)
        break
      default:
        // This should never be reached due to validation above
        result = 0
    }

    return {
      success: true,
      data: {
        result,
        operation: input.operation,
        count: input.values.length,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error in aggregation calculation',
    }
  }
}
