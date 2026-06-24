/**
 * Retirement Modeler with Safe Withdrawal Model
 *
 * Implements the Safe Withdrawal Model for retirement planning:
 * FV = Ir × (12 / r)
 *
 * Where:
 * - FV = Future Value (required assets at retirement)
 * - Ir = Desired monthly retirement income (monthly)
 * - r = Annual rate of return (as decimal, e.g., 0.06 for 6%)
 *
 * This formula determines how much you need in retirement assets to safely
 * withdraw your desired monthly income without depleting the principal,
 * assuming the principal continues to earn the specified return.
 *
 * Example: For $5000/month income with 6% return:
 * FV = 5000 × (12 / 0.06) = 5000 × 200 = $1,000,000
 *
 * Architecture Requirement: FR8 - Retirement modeler
 */

import { type CurrencyOptions, formatCurrency } from '../format/currency'

/**
 * Minimum annual return rate to prevent precision issues
 * Rates below this threshold produce extremely large required assets
 */
const MIN_ANNUAL_RETURN_RATE = 0.001 // 0.1%

/**
 * Input parameters for retirement calculation
 */
export interface RetirementInput {
  monthlyIncome: number // Desired monthly retirement income in cents
  annualReturnRate: number // Annual rate of return as decimal (e.g., 0.06 for 6%)
}

/**
 * Result of retirement calculation
 */
export interface RetirementResult {
  requiredAssets: number // Required assets in cents
  requiredAssetsFormatted: string // Human-readable formatted value
  monthlyIncome: number // Input monthly income in cents
  monthlyIncomeFormatted: string // Human-readable formatted value
  annualReturnRate: number // Input annual return rate
  annualReturnRatePercentage: number // Annual return rate as percentage
}

/**
 * Calculates the required future value of assets for safe retirement withdrawal
 * Formula: FV = Ir × (12 / r)
 *
 * @param input - Retirement input parameters
 * @param currencyOptions - Optional currency formatting options
 * @returns Retirement calculation result
 * @throws Error if annualReturnRate is <= 0 or below minimum threshold (division by zero protection)
 */
export function calculateRetirementRequirement(
  input: RetirementInput,
  currencyOptions: Partial<CurrencyOptions> = {}
): RetirementResult {
  // Validate input - check for positive rate
  if (input.annualReturnRate <= 0) {
    throw new Error(
      'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.'
    )
  }

  // Check for very small rates that cause precision issues
  if (input.annualReturnRate < MIN_ANNUAL_RETURN_RATE) {
    throw new Error(
      `Annual return rate must be at least ${
        MIN_ANNUAL_RETURN_RATE * 100
      }% to avoid precision issues in calculations.`
    )
  }

  // Convert cents to dollars for calculation
  const monthlyIncomeDollars = input.monthlyIncome / 100

  // Calculate required assets using Safe Withdrawal Model
  // FV = Ir × (12 / r)
  // Use high-precision calculation
  const requiredAssetsDollars = monthlyIncomeDollars * (12 / input.annualReturnRate)

  // Convert back to cents with overflow check
  const requiredAssets = Math.round(requiredAssetsDollars * 100)

  // Check for overflow
  if (!Number.isSafeInteger(requiredAssets)) {
    throw new Error(
      'Calculation overflow: Required assets exceeds safe integer limit. Try a smaller income or higher return rate.'
    )
  }

  return {
    requiredAssets,
    requiredAssetsFormatted: formatCurrency(requiredAssets, currencyOptions),
    monthlyIncome: input.monthlyIncome,
    monthlyIncomeFormatted: formatCurrency(input.monthlyIncome, currencyOptions),
    annualReturnRate: input.annualReturnRate,
    annualReturnRatePercentage: input.annualReturnRate * 100,
  }
}

/**
 * Calculates the required future value directly using Safe Withdrawal Model
 * Formula: FV = Ir × (12 / r)
 *
 * @param monthlyIncome - Desired monthly retirement income in cents
 * @param annualReturnRate - Annual rate of return as decimal (e.g., 0.06 for 6%)
 * @returns Required assets in cents
 * @throws Error if annualReturnRate is <= 0 or below minimum threshold (division by zero protection)
 */
export function calculateRequiredAssets(monthlyIncome: number, annualReturnRate: number): number {
  // Validate inputs are finite numbers
  if (!Number.isFinite(monthlyIncome)) {
    throw new Error('Monthly income must be a finite number')
  }

  if (!Number.isFinite(annualReturnRate)) {
    throw new Error('Annual return rate must be a finite number')
  }

  // Validate rate
  if (annualReturnRate <= 0) {
    throw new Error(
      'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.'
    )
  }

  // Prevent precision issues with very small rates
  if (annualReturnRate < MIN_ANNUAL_RETURN_RATE) {
    throw new Error(
      `Annual return rate must be at least ${
        MIN_ANNUAL_RETURN_RATE * 100
      }% to avoid precision issues in calculations.`
    )
  }

  const monthlyIncomeDollars = monthlyIncome / 100
  const requiredAssetsDollars = monthlyIncomeDollars * (12 / annualReturnRate)
  const requiredAssets = Math.round(requiredAssetsDollars * 100)

  // Overflow check
  if (!Number.isSafeInteger(requiredAssets)) {
    throw new Error('Calculation overflow: Required assets exceeds safe integer limit.')
  }

  return requiredAssets
}

/**
 * Calculates how much monthly income can be safely withdrawn from a given asset value
 * Reverse calculation: Ir = FV × (r / 12)
 *
 * @param assets - Current assets in cents
 * @param annualReturnRate - Annual rate of return as decimal
 * @returns Safe monthly withdrawal amount in cents
 * @throws Error if annualReturnRate is <= 0 or below minimum threshold
 */
export function calculateSafeMonthlyWithdrawal(assets: number, annualReturnRate: number): number {
  // Validate inputs are finite numbers
  if (!Number.isFinite(assets)) {
    throw new Error('Assets must be a finite number')
  }

  if (!Number.isFinite(annualReturnRate)) {
    throw new Error('Annual return rate must be a finite number')
  }

  // Validate rate
  if (annualReturnRate <= 0) {
    throw new Error(
      'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.'
    )
  }

  // Prevent precision issues with very small rates
  if (annualReturnRate < MIN_ANNUAL_RETURN_RATE) {
    throw new Error(
      `Annual return rate must be at least ${
        MIN_ANNUAL_RETURN_RATE * 100
      }% to avoid precision issues in calculations.`
    )
  }

  const assetsDollars = assets / 100
  const monthlyWithdrawalDollars = assetsDollars * (annualReturnRate / 12)
  const result = Math.round(monthlyWithdrawalDollars * 100)

  // Overflow check
  if (!Number.isSafeInteger(result)) {
    throw new Error('Calculation overflow: Withdrawal amount exceeds safe integer limit.')
  }

  return result
}

/**
 * Input parameters for compounding projection
 */
export interface CompoundingInput {
  principal: number // Initial investment in cents
  annualContribution: number // Annual contribution in cents
  annualReturnRate: number // Annual rate of return as decimal
  years: number // Number of years to project
}

/**
 * Result of compounding projection for a single year
 */
export interface YearlyProjection {
  year: number
  startingBalance: number
  annualContribution: number
  endingBalance: number
}

/**
 * Maximum years for projection to prevent performance issues and overflow
 */
const MAX_PROJECTION_YEARS = 100

/**
 * Calculates compound growth projection over multiple years
 * Formula: FV = P × (1 + r)^n + C × [((1 + r)^n - 1) / r]
 * Where P = principal, r = annual return, n = years, C = annual contribution
 *
 * Handles edge cases:
 * - Validates that annualReturnRate is positive
 * - Validates that years is non-negative and within safe limits
 * - Handles zero contribution scenarios (treats as 0)
 * - Handles zero principal scenarios (starts from 0)
 * - Prevents floating point precision issues by rounding intermediate results
 * - Prevents overflow by checking safe integer limits
 *
 * @param input - Compounding projection input
 * @returns Array of yearly projections
 * @throws Error if annualReturnRate is <= 0, years is < 0, or years > MAX_PROJECTION_YEARS
 */
export function calculateCompoundingProjection(input: CompoundingInput): YearlyProjection[] {
  const { principal, annualContribution, annualReturnRate, years } = input

  // Validate inputs are finite numbers
  if (!Number.isFinite(principal)) {
    throw new Error('Principal must be a finite number')
  }

  if (!Number.isFinite(annualContribution)) {
    throw new Error('Annual contribution must be a finite number')
  }

  if (!Number.isFinite(annualReturnRate)) {
    throw new Error('Annual return rate must be a finite number')
  }

  if (!Number.isFinite(years)) {
    throw new Error('Number of years must be a finite number')
  }

  // Validate inputs
  if (annualReturnRate <= 0) {
    throw new Error('Annual return rate must be positive (greater than 0)')
  }

  if (annualReturnRate < MIN_ANNUAL_RETURN_RATE) {
    throw new Error(
      `Annual return rate must be at least ${
        MIN_ANNUAL_RETURN_RATE * 100
      }% to avoid precision issues.`
    )
  }

  if (years < 0) {
    throw new Error('Number of years must be non-negative')
  }

  // Handle edge case: if years is 0, return empty array
  if (years === 0) {
    return []
  }

  // Prevent excessively long projections that cause performance issues and overflow
  if (years > MAX_PROJECTION_YEARS) {
    throw new Error(
      `Number of years must not exceed ${MAX_PROJECTION_YEARS} to prevent performance issues and calculation overflow.`
    )
  }

  const projections: YearlyProjection[] = []
  let currentBalance = principal

  // Ensure non-negative contribution (negative contributions are treated as 0)
  const safeContribution = annualContribution >= 0 ? annualContribution : 0

  for (let year = 1; year <= years; year++) {
    const startingBalance = currentBalance

    // Calculate growth with rounding to prevent floating point accumulation
    // Round intermediate result to prevent precision loss over many iterations
    const growth = Math.round(startingBalance * (1 + annualReturnRate) * 100) / 100

    // Add contribution
    currentBalance = growth + safeContribution

    // Check for overflow before storing
    if (!Number.isSafeInteger(Math.round(currentBalance))) {
      throw new Error(
        `Projection overflow at year ${year}: Result exceeds safe integer limit. Try smaller values or fewer years.`
      )
    }

    projections.push({
      year,
      startingBalance,
      annualContribution: safeContribution,
      endingBalance: Math.round(currentBalance),
    })
  }

  return projections
}
