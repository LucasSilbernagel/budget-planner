/**
 * Retirement Modeler with Safe Withdrawal Model
 * 
 * Implements the Safe Withdrawal Model for retirement planning:
 * FV = Ir × (12 / r)
 * 
 * Where:
 * - FV = Future Value (required assets at retirement)
 * - Ir = Desired retirement income (monthly)
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
 * @returns Retirement calculation result
 * @throws Error if annualReturnRate is 0 or negative
 */
export function calculateRetirementRequirement(
  input: RetirementInput
): RetirementResult {
  // Validate input
  if (input.annualReturnRate <= 0) {
    throw new Error(
      'Annual return rate must be positive (greater than 0)'
    )
  }

  // Convert cents to dollars for calculation
  const monthlyIncomeDollars = input.monthlyIncome / 100

  // Calculate required assets using Safe Withdrawal Model
  // FV = Ir × (12 / r)
  const requiredAssetsDollars = monthlyIncomeDollars * (12 / input.annualReturnRate)

  // Convert back to cents
  const requiredAssets = Math.round(requiredAssetsDollars * 100)

  return {
    requiredAssets,
    requiredAssetsFormatted: formatCurrency(requiredAssets),
    monthlyIncome: input.monthlyIncome,
    monthlyIncomeFormatted: formatCurrency(input.monthlyIncome),
    annualReturnRate: input.annualReturnRate,
    annualReturnRatePercentage: input.annualReturnRate * 100,
  }
}

/**
 * Calculates the required future value directly
 * 
 * @param monthlyIncome - Desired monthly retirement income in cents
 * @param annualReturnRate - Annual rate of return as decimal
 * @returns Required assets in cents
 */
export function calculateRequiredAssets(
  monthlyIncome: number,
  annualReturnRate: number
): number {
  if (annualReturnRate <= 0) {
    throw new Error(
      'Annual return rate must be positive (greater than 0)'
    )
  }

  const monthlyIncomeDollars = monthlyIncome / 100
  const requiredAssetsDollars = monthlyIncomeDollars * (12 / annualReturnRate)
  return Math.round(requiredAssetsDollars * 100)
}

/**
 * Formats a value in cents as currency
 * @param cents - Value in cents
 * @returns Formatted currency string
 */
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

/**
 * Calculates how much monthly income can be safely withdrawn from a given asset value
 * Reverse calculation: Ir = FV × (r / 12)
 * 
 * @param assets - Current assets in cents
 * @param annualReturnRate - Annual rate of return as decimal
 * @returns Safe monthly withdrawal amount in cents
 */
export function calculateSafeMonthlyWithdrawal(
  assets: number,
  annualReturnRate: number
): number {
  if (annualReturnRate <= 0) {
    throw new Error(
      'Annual return rate must be positive (greater than 0)'
    )
  }

  const assetsDollars = assets / 100
  const monthlyWithdrawalDollars = assetsDollars * (annualReturnRate / 12)
  return Math.round(monthlyWithdrawalDollars * 100)
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
 * Calculates compound growth projection over multiple years
 * Formula: FV = P × (1 + r)^n + C × [((1 + r)^n - 1) / r]
 * Where P = principal, r = annual return, n = years, C = annual contribution
 * 
 * @param input - Compounding projection input
 * @returns Array of yearly projections
 */
export function calculateCompoundingProjection(
  input: CompoundingInput
): YearlyProjection[] {
  const { principal, annualContribution, annualReturnRate, years } = input

  if (annualReturnRate <= 0) {
    throw new Error('Annual return rate must be positive (greater than 0)')
  }
  if (years < 0) {
    throw new Error('Number of years must be non-negative')
  }

  const projections: YearlyProjection[] = []
  let currentBalance = principal

  for (let year = 1; year <= years; year++) {
    const startingBalance = currentBalance
    const contribution = annualContribution

    // Calculate growth: startingBalance * (1 + r)
    const growth = startingBalance * (1 + annualReturnRate)
    // Add contribution
    currentBalance = growth + contribution

    projections.push({
      year,
      startingBalance,
      annualContribution: contribution,
      endingBalance: Math.round(currentBalance),
    })
  }

  return projections
}
