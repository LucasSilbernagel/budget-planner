/**
 * Retirement Modeler Server Functions
 *
 * Server-side calculation functions for retirement planning.
 * Uses the Safe Withdrawal Model: FV = Ir × (12 / r)
 *
 * Architecture: TanStack Start Server Functions for RPC-style backend communication
 */

import {
  type CompoundingInput,
  type RetirementInput,
  type RetirementResult,
  type YearlyProjection,
  calculateCompoundingProjection,
  calculateRetirementRequirement,
  calculateSafeMonthlyWithdrawal,
} from '@budget-planner/core'

// Imported for local use AND re-exported so existing importers of this module
// keep working; the single declaration lives in `../result` (it used to be
// duplicated here and in the other barrel, identically).
import type { ApiResult } from '../result'

export type { ApiResult }

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
