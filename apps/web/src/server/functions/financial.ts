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
  type RetirementInput,
  type RetirementResult,
  type YearlyProjection,
  calculateCompoundingProjection,
  calculateRetirementRequirement,
  calculateSafeMonthlyWithdrawal,
} from '@budget-planner/core'
import { z } from 'zod'
import { getCurrentUserSession } from '../api/auth/paddle'
import type { UserSession } from '../api/auth/paddle'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Discriminated failure classification driving the HTTP status of a served
 * `/api/calculations/*` route. Preferred over substring-matching the free-text
 * `error` message, which misclassifies any future message that happens to
 * contain a token like "Premium".
 */
export type FinancialErrorCode = 'AUTH' | 'PREMIUM' | 'VALIDATION'

/**
 * Generic API result type for consistent response format
 */
export interface FinancialApiResult<T> {
  success: boolean
  data?: T
  error?: string
  /** Set on failures so the route maps status from a code, not the message. */
  code?: FinancialErrorCode
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
// Boundary input schemas (Story 5.8 — AC-15)
// ============================================================================

/**
 * Runtime validation for the parsed JSON body at each `/api/calculations/*`
 * boundary. The functions below additionally enforce business rules (positivity,
 * ranges); these schemas only guarantee the *shape and types* so a string-typed
 * number (`"5000"`) or a wrong-shape body is rejected with 400 before it flows
 * into arithmetic. Unknown keys are stripped by zod's default object behavior.
 */
const finiteNumber = z.number().finite()

export const retirementInputSchema = z.object({
  monthlyIncome: finiteNumber,
  annualReturnRate: finiteNumber,
})

export const netWorthProjectionInputSchema = z.object({
  currentAssets: finiteNumber,
  currentLiabilities: finiteNumber,
  monthlySavings: finiteNumber,
  expectedReturnRate: finiteNumber,
  timeHorizonYears: finiteNumber,
})

export const withdrawalBodySchema = z.object({
  assets: finiteNumber,
  annualReturnRate: finiteNumber,
})

/**
 * Cap the aggregation array length. Without it a huge `values` array does an
 * O(n log n) sort and spreads into `Math.max(...)` (which throws RangeError at
 * ~100k args) before any guard runs — the same DoS class the netWorthProjection
 * `MAX_TIME_HORIZON_YEARS` cap defends against.
 */
const MAX_AGGREGATION_VALUES = 10_000

export const aggregationInputSchema = z.object({
  values: z.array(finiteNumber).max(MAX_AGGREGATION_VALUES),
  operation: z.enum(['sum', 'average', 'median', 'max', 'min']),
})

export const compoundingInputSchema = z.object({
  principal: finiteNumber,
  annualContribution: finiteNumber,
  annualReturnRate: finiteNumber,
  years: finiteNumber,
})

/**
 * Discriminated result of a boundary parse. The success arm guarantees `data`,
 * so callers narrow with `if (!parsed.success)` and then use `parsed.data`
 * directly — no `!parsed.data` guard that would misroute a legitimately-falsy
 * parsed value (e.g. `0`) into the error branch.
 */
export type CalcParseResult<T> =
  | { success: true; data: T }
  | { success: false; code: FinancialErrorCode; error: string }

/**
 * Validate a raw (parsed-JSON) body against a boundary schema, returning a
 * VALIDATION-coded failure on mismatch so the route maps it to 400 via
 * {@link httpStatusForResult}.
 */
export function parseCalcInput<T>(schema: z.ZodType<T>, raw: unknown): CalcParseResult<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION',
      error: parsed.error.issues[0]?.message ?? 'Invalid request body',
    }
  }
  return { success: true, data: parsed.data }
}

// ============================================================================
// Helper: Map a calculation result to an HTTP status code
// ============================================================================

/**
 * Translate a {@link FinancialApiResult} into the HTTP status the served
 * `/api/calculations/*` route should return. Success is always 200; failures
 * are classified from the error message so the served boundary preserves the
 * auth/premium/validation distinction (401 / 403 / 400).
 */
export function httpStatusForResult(result: FinancialApiResult<unknown>): number {
  if (result.success) {
    return 200
  }

  // Prefer the discriminated code when present.
  switch (result.code) {
    case 'AUTH':
      return 401
    case 'PREMIUM':
      return 403
    case 'VALIDATION':
      return 400
  }

  // Back-compat fallback for results predating the `code` field.
  const error = result.error ?? ''

  if (error.includes('No user session') || error.includes('Authentication required')) {
    return 401
  }

  if (error.includes('Premium')) {
    return 403
  }

  return 400
}

// ============================================================================
// Helper: Get authenticated user with subscription check
// ============================================================================

/**
 * Get authenticated user context and verify premium subscription
 * Returns user if authenticated and has active subscription, otherwise returns error
 */
async function getAuthenticatedUser(request: Request): Promise<FinancialApiResult<UserSession>> {
  const userResult = await getCurrentUserSession(request)

  if (!userResult.success) {
    return { success: false, code: 'AUTH', error: userResult.error }
  }

  const user = userResult.data

  if (!user) {
    return {
      success: false,
      code: 'AUTH',
      error: 'Authentication required for financial calculations',
    }
  }

  // Check if user has access to premium features
  if (user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'lifetime') {
    return {
      success: false,
      code: 'PREMIUM',
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
    return { success: false, error: userResult.error, code: userResult.code }
  }

  try {
    // Validate input - check for undefined/null first.
    // NOTE: the field is `monthlyIncome` to match @budget-planner/core's
    // RetirementInput (the exact shape the client posts); calculateRetirementRequirement
    // reads input.monthlyIncome, so any other field name silently computes NaN.
    if (input.monthlyIncome === undefined || input.annualReturnRate === undefined) {
      return {
        success: false,
        error: 'Missing required parameters: monthlyIncome and annualReturnRate',
      }
    }

    if (input.monthlyIncome === null || input.annualReturnRate === null) {
      return {
        success: false,
        error: 'Parameters cannot be null: monthlyIncome and annualReturnRate',
      }
    }

    if (input.monthlyIncome <= 0) {
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
    return { success: false, error: userResult.error, code: userResult.code }
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
    return { success: false, error: userResult.error, code: userResult.code }
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
    return { success: false, error: userResult.error, code: userResult.code }
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
        code: 'VALIDATION',
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
        code: 'VALIDATION',
        error: 'Parameters cannot be null',
      }
    }

    // Reject non-finite inputs (NaN / Infinity). Unlike the other calculators
    // (which delegate to core fns that throw on non-finite/overflow), this one
    // computes the projection inline, so without these guards NaN/Infinity flow
    // through and return success:true with garbage.
    if (
      !Number.isFinite(input.currentAssets) ||
      !Number.isFinite(input.currentLiabilities) ||
      !Number.isFinite(input.monthlySavings) ||
      !Number.isFinite(input.expectedReturnRate) ||
      !Number.isFinite(input.timeHorizonYears)
    ) {
      return {
        success: false,
        code: 'VALIDATION',
        error: 'All parameters must be finite numbers',
      }
    }

    // Monetary inputs are cents and must stay within safe-integer precision so
    // the compounding arithmetic below stays exact.
    if (
      !Number.isSafeInteger(input.currentAssets) ||
      !Number.isSafeInteger(input.currentLiabilities) ||
      !Number.isSafeInteger(input.monthlySavings)
    ) {
      return {
        success: false,
        code: 'VALIDATION',
        error: 'Monetary parameters must be safe integers (in cents)',
      }
    }

    if (input.timeHorizonYears <= 0) {
      return {
        success: false,
        code: 'VALIDATION',
        error: 'Time horizon must be positive',
      }
    }

    // Bound the loop: an astronomically large horizon is both a DoS vector and
    // pushes the compounded total past the safe-integer range.
    const MAX_TIME_HORIZON_YEARS = 200
    if (input.timeHorizonYears > MAX_TIME_HORIZON_YEARS) {
      return {
        success: false,
        code: 'VALIDATION',
        error: `Time horizon must not exceed ${MAX_TIME_HORIZON_YEARS} years`,
      }
    }

    if (input.expectedReturnRate < 0 || input.expectedReturnRate >= 1) {
      return {
        success: false,
        code: 'VALIDATION',
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

      // Guard against silent precision loss once the compounded total exceeds
      // the safe-integer range (returning garbage past Number.MAX_SAFE_INTEGER).
      if (!Number.isSafeInteger(assetsCents)) {
        return {
          success: false,
          code: 'VALIDATION',
          error: 'Projection exceeds the supported numeric range',
        }
      }

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
    return { success: false, error: userResult.error, code: userResult.code }
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
        // Non-empty is guaranteed by the `values.length === 0` guard above, so both
        // reads land; `?? 0` only satisfies `noUncheckedIndexedAccess`.
        const upper = sortedValues[mid] ?? 0
        const lower = sortedValues[mid - 1] ?? upper
        result = sortedValues.length % 2 !== 0 ? upper : (lower + upper) / 2
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
