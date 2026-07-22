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
 * Whether a desired retirement-income figure is entered as a monthly or an
 * annual amount.
 */
export type IncomeBasis = 'monthly' | 'annual'

/**
 * Converts a desired retirement-income amount to the monthly figure the Safe
 * Withdrawal Model expects, applied AT THE BOUNDARY so the SWM core
 * (`calculateRequiredAssets` / `calculateRetirementRequirement`) stays
 * monthly-only and unchanged.
 *
 * Annual amounts are divided by 12 and rounded to the nearest cent, so entering
 * an annual figure is numerically equal to entering `annual / 12` as a monthly
 * amount: `monthly = Math.round(annualCents / 12)`. Monthly amounts pass through
 * unchanged.
 *
 * @param amountCents - Entered desired-income amount in cents
 * @param basis - Whether the entered amount is a 'monthly' or 'annual' figure
 * @returns Monthly income in cents
 * @throws Error if amountCents is not a finite number
 */
export function toMonthlyIncomeCents(amountCents: number, basis: IncomeBasis): number {
  if (!Number.isFinite(amountCents)) {
    throw new Error('Income amount must be a finite number')
  }

  return basis === 'annual' ? Math.round(amountCents / 12) : amountCents
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

/* -------------------------------------------------------------------------- */
/* Retirement Accumulation Solver (Story 26.6)                                */
/*                                                                            */
/* Derives the earliest age at which the projected nest egg meets the         */
/* required nest egg, under one of two target models:                         */
/*   - deplete:   draw a growing income until life expectancy, hitting $0     */
/*   - perpetual: safe withdrawal that never touches principal (FV = Ir×12/r) */
/*                                                                            */
/* The accumulation projection is MONTHLY-compounded and intentionally        */
/* distinct from `calculateCompoundingProjection` above (which compounds      */
/* annually over whole years). Only monthly compounding reproduces the source */
/* spreadsheet's figures at an arbitrary month count (e.g. $788,649 @ 202mo). */
/* All amounts are integer cents. Pure functions, no side effects.            */
/*                                                                            */
/* Architecture Requirement: FR42 - Retirement accumulation planner.          */
/* -------------------------------------------------------------------------- */

/**
 * Which target the required nest egg is sized against.
 * - `deplete`: the nest egg is drawn down to zero by life expectancy.
 * - `perpetual`: the nest egg is never depleted (safe-withdrawal in perpetuity).
 */
export type RetirementModel = 'deplete' | 'perpetual'

/**
 * Longest retirement horizon (in years) the earliest-age search will scan.
 * Bounds the loop for non-physical life expectancies; every realistic human
 * span is far below this.
 */
const MAX_RETIREMENT_SEARCH_YEARS = 150

/**
 * Projects the accumulated retirement nest egg after `months` of monthly
 * compounding: the future value of the current savings plus the future value of
 * an ordinary (end-of-month) monthly-contribution annuity, at a monthly rate of
 * `annualReturnRate / 12`.
 *
 * Formula (monthly rate `i = annualReturnRate / 12`, `n = months`):
 *   `nestEgg = principal · (1 + i)^n  +  monthlyContribution · ((1 + i)^n − 1) / i`
 * When `i = 0` (zero return) this degrades to the linear
 *   `nestEgg = principal + monthlyContribution · n`.
 *
 * This is a *monthly*-compounded projection, deliberately NOT
 * `calculateCompoundingProjection` (which compounds annually over whole years):
 * only monthly compounding reproduces the source-spreadsheet figures at an
 * arbitrary month count. Verified: `principal = $59,541`, `contribution =
 * $1,799/mo`, `rate = 6%`, `n = 202` → `$788,649.23` → **$788,649** to the dollar.
 *
 * A negative principal or contribution is treated as 0 so the result is never
 * negative and never `NaN`.
 *
 * @param principalCents - Current amount saved, in cents (negative treated as 0)
 * @param monthlyContributionCents - Monthly contribution, in cents (negative treated as 0)
 * @param annualReturnRate - Annual rate of return as a decimal (>= 0; 0 = linear)
 * @param months - Number of whole months to project (integer >= 0)
 * @returns Projected nest egg in cents (>= 0, never NaN)
 * @throws Error if an input is non-finite, `annualReturnRate` is negative,
 *   `months` is negative or non-integer, or the result overflows the safe-integer range
 */
export function projectAccumulatedNestEgg(
  principalCents: number,
  monthlyContributionCents: number,
  annualReturnRate: number,
  months: number
): number {
  if (!Number.isFinite(principalCents)) {
    throw new Error('Principal must be a finite number')
  }

  if (!Number.isFinite(monthlyContributionCents)) {
    throw new Error('Monthly contribution must be a finite number')
  }

  if (!Number.isFinite(annualReturnRate)) {
    throw new Error('Annual return rate must be a finite number')
  }

  if (!Number.isFinite(months)) {
    throw new Error('Number of months must be a finite number')
  }

  if (annualReturnRate < 0) {
    throw new Error('Annual return rate must be non-negative')
  }

  if (months < 0) {
    throw new Error('Number of months must be non-negative')
  }

  if (!Number.isInteger(months)) {
    throw new Error('Number of months must be an integer')
  }

  const principalDollars = Math.max(0, principalCents) / 100
  const contributionDollars = Math.max(0, monthlyContributionCents) / 100
  const monthlyRate = annualReturnRate / 12

  // Nothing saved and nothing contributed → 0, regardless of rate/months. Guards
  // the `0 × Infinity = NaN` case when `months` is astronomically large (which
  // would otherwise trip the overflow guard with a misleading message).
  if (principalDollars === 0 && contributionDollars === 0) {
    return 0
  }

  let futureValueDollars: number
  if (monthlyRate === 0) {
    // Zero-return: linear accumulation, no compounding.
    futureValueDollars = principalDollars + contributionDollars * months
  } else {
    const growthFactor = (1 + monthlyRate) ** months
    // FV of the principal + FV of an ordinary (end-of-month) contribution annuity.
    futureValueDollars =
      principalDollars * growthFactor + contributionDollars * ((growthFactor - 1) / monthlyRate)
  }

  const nestEggCents = Math.round(futureValueDollars * 100)

  if (!Number.isSafeInteger(nestEggCents)) {
    throw new Error(
      'Projection overflow: nest egg exceeds safe integer limit. Try smaller values or fewer months.'
    )
  }

  return nestEggCents
}

/**
 * Computes the nest egg required at retirement for the chosen target model.
 *
 * **deplete** — the desired annual income is drawn each year, growing at the
 * return rate, from `retirementAge` until `lifeExpectancy` (begin-of-year
 * withdrawals), reaching zero at life expectancy. Because the withdrawal growth
 * rate equals the discount (return) rate, the growing-annuity present value
 * collapses to exactly one year of income per retirement year:
 *   `required = yearsInRetirement × desiredAnnualIncome`,
 *   where `yearsInRetirement = max(0, lifeExpectancy − retirementAge)`.
 * This branch is defined for any finite rate (including 0).
 *
 * **perpetual** — the shipped Safe Withdrawal Model `FV = Ir × (12 / r)` fed the
 * monthly-equivalent income (equivalently `desiredAnnualIncome / rate`),
 * independent of `retirementAge` and `lifeExpectancy`. Reuses
 * `calculateRequiredAssets`, so it THROWS on a non-positive / sub-precision rate
 * (the shipped house contract). `solveRetirementAccumulation` guards that case
 * up front and reports it as not-reachable rather than throwing.
 *
 * @returns Required nest egg in cents (>= 0)
 * @throws Error on non-finite inputs, or (perpetual only) a non-positive /
 *   sub-precision `annualReturnRate`, or safe-integer overflow.
 */
export function calculateRequiredNestEgg(
  desiredAnnualIncomeCents: number,
  annualReturnRate: number,
  retirementAge: number,
  lifeExpectancy: number,
  model: RetirementModel
): number {
  if (!Number.isFinite(desiredAnnualIncomeCents)) {
    throw new Error('Desired annual income must be a finite number')
  }

  if (!Number.isFinite(annualReturnRate)) {
    throw new Error('Annual return rate must be a finite number')
  }

  if (model === 'perpetual') {
    // Reuse the shipped Safe Withdrawal Model (FV = Ir × 12/r) on the monthly
    // income. Throws on rate <= 0 / below the precision floor.
    const monthlyIncomeCents = toMonthlyIncomeCents(desiredAnnualIncomeCents, 'annual')
    return calculateRequiredAssets(monthlyIncomeCents, annualReturnRate)
  }

  if (!Number.isFinite(retirementAge)) {
    throw new Error('Retirement age must be a finite number')
  }

  if (!Number.isFinite(lifeExpectancy)) {
    throw new Error('Life expectancy must be a finite number')
  }

  const yearsInRetirement = Math.max(0, lifeExpectancy - retirementAge)
  const requiredCents = Math.round(Math.max(0, desiredAnnualIncomeCents) * yearsInRetirement)

  if (!Number.isSafeInteger(requiredCents)) {
    throw new Error('Required nest egg exceeds safe integer limit.')
  }

  return requiredCents
}

/**
 * Inputs to the retirement accumulation solver. All monetary values are integer
 * cents; ages and life expectancy are in years; the return rate is a decimal.
 */
export interface RetirementAccumulationInput {
  currentAge: number
  currentSavedCents: number // principal, cents
  monthlySavingsCents: number // monthly contribution, cents
  annualReturnRate: number // decimal, e.g. 0.06 for 6%
  desiredAnnualIncomeCents: number // desired retirement income, cents/year
  lifeExpectancy: number // age
  model: RetirementModel
}

/**
 * Result of the retirement accumulation solve.
 * `savedPerYearCents` is always present; the remaining outputs are `null` when
 * `reachable` is `false` (no feasible retirement before life expectancy).
 */
export interface RetirementAccumulationResult {
  reachable: boolean
  savedPerYearCents: number // monthlySavings × 12
  monthsToRetirement: number | null
  yearsToRetirement: number | null // months / 12
  earliestRetirementAge: number | null // currentAge + years
  projectedNestEggCents: number | null // at the earliest reachable retirement
  requiredNestEggCents: number | null
}

/**
 * Finds the earliest retirement age at which the projected nest egg meets the
 * model's required nest egg.
 *
 * Searches month by month from `currentAge`. At each candidate month count the
 * projected nest egg (which increases with time) is compared against the
 * required nest egg (constant for `perpetual`; decreasing with a later
 * retirement age for `deplete`) — so at most one crossing exists. The search is
 * bounded by `lifeExpectancy` (retiring at or after it is not a feasible
 * retirement) and by `MAX_RETIREMENT_SEARCH_YEARS` (so a non-physical life
 * expectancy cannot make it iterate an unreasonable number of times), which
 * together guarantee prompt termination. "Not reachable" means no feasible
 * retirement strictly before life expectancy.
 *
 * Inputs are validated up front — a non-finite age, life expectancy, saved
 * amount, income, or a non-finite/negative return rate throws (matching the rest
 * of the module). Given valid inputs the bounded search never loops for an
 * unreasonable number of iterations and never produces `NaN`:
 * - `currentAge >= lifeExpectancy` → not reachable.
 * - `perpetual` with a sub-precision return rate (`[0, MIN_ANNUAL_RETURN_RATE)`)
 *   → the required principal is unbounded → not reachable (guarded here rather
 *   than letting the shipped `calculateRequiredAssets` throw).
 *
 * @returns The solve result. `savedPerYearCents` is always populated (finite).
 */
export function solveRetirementAccumulation(
  input: RetirementAccumulationInput
): RetirementAccumulationResult {
  const {
    currentAge,
    currentSavedCents,
    monthlySavingsCents,
    annualReturnRate,
    desiredAnnualIncomeCents,
    lifeExpectancy,
    model,
  } = input

  if (!Number.isFinite(currentAge)) {
    throw new Error('Current age must be a finite number')
  }

  if (!Number.isFinite(lifeExpectancy)) {
    throw new Error('Life expectancy must be a finite number')
  }

  if (!Number.isFinite(monthlySavingsCents)) {
    throw new Error('Monthly savings must be a finite number')
  }

  if (!Number.isFinite(currentSavedCents)) {
    throw new Error('Current saved amount must be a finite number')
  }

  if (!Number.isFinite(desiredAnnualIncomeCents)) {
    throw new Error('Desired annual income must be a finite number')
  }

  if (!Number.isFinite(annualReturnRate) || annualReturnRate < 0) {
    throw new Error('Annual return rate must be a non-negative finite number')
  }

  const savedPerYearCents = Math.max(0, monthlySavingsCents) * 12

  const notReachable: RetirementAccumulationResult = {
    reachable: false,
    savedPerYearCents,
    monthsToRetirement: null,
    yearsToRetirement: null,
    earliestRetirementAge: null,
    projectedNestEggCents: null,
    requiredNestEggCents: null,
  }

  // No retirement window: already at or past life expectancy.
  if (currentAge >= lifeExpectancy) {
    return notReachable
  }

  // Perpetual safe-withdrawal needs a return at or above the precision floor; a
  // rate in [0, MIN_ANNUAL_RETURN_RATE) makes the required principal unbounded →
  // not reachable (rather than throwing out of the search). The rate is already
  // validated finite and non-negative above.
  if (model === 'perpetual' && annualReturnRate < MIN_ANNUAL_RETURN_RATE) {
    return notReachable
  }

  // Bound the search by life expectancy (retiring at/after it is meaningless, and
  // AC-6 defines "not reachable" as no feasible retirement BEFORE life expectancy)
  // AND by MAX_RETIREMENT_SEARCH_YEARS, so a non-physical life expectancy cannot
  // make the loop run for an unreasonable number of iterations.
  const maxMonths = Math.min(
    Math.ceil((lifeExpectancy - currentAge) * 12),
    MAX_RETIREMENT_SEARCH_YEARS * 12
  )

  for (let months = 0; months < maxMonths; months++) {
    const retirementAge = currentAge + months / 12
    if (retirementAge >= lifeExpectancy) {
      break
    }

    const projectedNestEggCents = projectAccumulatedNestEgg(
      currentSavedCents,
      monthlySavingsCents,
      annualReturnRate,
      months
    )
    const requiredNestEggCents = calculateRequiredNestEgg(
      desiredAnnualIncomeCents,
      annualReturnRate,
      retirementAge,
      lifeExpectancy,
      model
    )

    if (projectedNestEggCents >= requiredNestEggCents) {
      return {
        reachable: true,
        savedPerYearCents,
        monthsToRetirement: months,
        yearsToRetirement: months / 12,
        earliestRetirementAge: retirementAge,
        projectedNestEggCents,
        requiredNestEggCents,
      }
    }
  }

  return notReachable
}
