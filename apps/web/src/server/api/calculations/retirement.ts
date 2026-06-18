/**
 * Retirement Modeler Server Functions
 * 
 * Server-side calculation functions for retirement planning.
 * Uses the Safe Withdrawal Model: FV = Ir × (12 / r)
 * 
 * Architecture: TanStack Start Server Functions for RPC-style backend communication
 */

import { calculateRetirementRequirement, calculateSafeMonthlyWithdrawal, calculateCompoundingProjection, type RetirementInput, type RetirementResult, type CompoundingInput, type YearlyProjection } from '@budget-planner/core'

/**
 * Result type for API responses
 */
export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Server Function: Calculate retirement requirement
 * Calculates how much in assets is needed for a desired retirement income
 */
export async function calculateRetirementServer(
  input: RetirementInput
): Promise<ApiResult<RetirementResult>> {
  try {
    const result = calculateRetirementRequirement(input)
    return {
      success: true,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Server Function: Calculate safe monthly withdrawal
 * Calculates how much can be withdrawn monthly from a given asset value
 */
export async function calculateSafeWithdrawalServer(
  assets: number,
  annualReturnRate: number
): Promise<ApiResult<number>> {
  try {
    const result = calculateSafeMonthlyWithdrawal(assets, annualReturnRate)
    return {
      success: true,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Server Function: Calculate compounding projection
 * Projects growth of investments over time
 */
export async function calculateProjectionServer(
  input: CompoundingInput
): Promise<ApiResult<YearlyProjection[]>> {
  try {
    const result = calculateCompoundingProjection(input)
    return {
      success: true,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
