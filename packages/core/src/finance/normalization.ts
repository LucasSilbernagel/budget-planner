/**
 * Frequency Normalization Engine
 *
 * Normalizes financial values to a monthly base for consistent aggregation.
 * Multipliers are based on the average number of periods per month:
 * - Weekly: 4.333 (52 weeks / 12 months)
 * - Biweekly: 2.167 (26 biweekly periods / 12 months)
 * - Monthly: 1
 * - Annually: 0.0833 (1 / 12)
 *
 * Architecture Requirement: FR5 - Core calculations
 */

// Local frequency type for finance module independence
export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'annually'

// Interface for financial items that can be normalized
export interface NormalizableFinancialItem {
  amount: number // In cents
  frequency: Frequency
}

// Frequency multipliers for monthly normalization: periods per month.
// ⚠️ These are NOT exact in float (`26 / 12` is 2.1666666666666665), so
// `normalizeToMonthly` does not multiply by them: it uses `PERIODS_PER_YEAR`
// below. They stay for `getNormalizationMultiplier` (sort ranking) and
// `denormalizeFromMonthly` (measured exact, story 105.1 D2).
const FREQUENCY_MULTIPLIERS: Record<Frequency, number> = {
  weekly: 52 / 12, // 52 weeks / 12 months = 4.333333...
  biweekly: 26 / 12, // 26 biweekly periods / 12 months = 2.166666...
  monthly: 1, // 1 month / 12 months = 1/12, but we're normalizing TO monthly, so multiply by 1
  annually: 1 / 12, // 1 / 12 = 0.083333...
}

/**
 * Story 105.1 (FR173): periods per YEAR, an integer, so `normalizeToMonthly` can
 * multiply exactly and divide once. `amount × 26 / 12` rounds an exact half cent
 * the same way at every amount; `amount × (26 / 12)` did not (27¢ biweekly gave
 * 58.49999999999999 → 58, not 59; 120,989 misses in 0..1,999,999, MEASURED).
 * `amount × 52` stays below 2^53 for |amount| ≤ MAX_SAFE_INTEGER / 100. That bound
 * is enforced only by `validateBalanceTracking`; income and expense amounts are
 * bounded by the int32 sync schema (and, from story 106.1, the forms). A corrupt
 * local amount far above it can come out inexact or Infinity (deferred-work).
 */
const PERIODS_PER_YEAR: Record<Frequency, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  annually: 1,
}

/**
 * Validates that a frequency string is a valid Frequency type
 * @param frequency - The frequency string to validate
 * @throws Error if frequency is not valid
 */
export function validateFrequency(frequency: unknown): asserts frequency is Frequency {
  if (typeof frequency !== 'string' || !(frequency in FREQUENCY_MULTIPLIERS)) {
    throw new Error('Invalid frequency')
  }
}

/**
 * Validates that an amount is a finite number
 * @param amount - The amount to validate
 * @throws Error if amount is not a finite number
 */
export function validateAmount(amount: unknown): asserts amount is number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error('Amount must be a finite number')
  }
}

/**
 * Normalizes an amount to its monthly equivalent based on frequency
 * @param amount - The amount in cents (integer)
 * @param frequency - The frequency of the amount
 * @returns The monthly normalized amount in cents (rounded to nearest integer)
 */
export function normalizeToMonthly(amount: unknown, frequency: unknown): number {
  validateAmount(amount)
  validateFrequency(frequency)
  // Multiply first, divide once (story 105.1): see `PERIODS_PER_YEAR`.
  return Math.round((amount * PERIODS_PER_YEAR[frequency]) / 12)
}

/**
 * Annualizes an amount: one year of it, in cents (story 111.1, FR179).
 *
 * `amount × periods per year`, rounded once. For an integer amount the product is
 * already exact (below `MAX_SAFE_INTEGER / 52`, the bound `PERIODS_PER_YEAR`
 * records), so the rounding only touches a fractional, corrupt or hand-edited
 * amount. Used by the forecast, whose rows are YEARS. Every other surface stays
 * monthly-canonical (`normalizeToMonthly`, then × 12 for a yearly view), so the
 * two can differ by a few cents per non-monthly entry: see `forecasting.ts`.
 * @param amount - The amount in cents (integer)
 * @param frequency - The frequency of the amount
 * @returns The annual amount in cents (rounded to nearest integer)
 */
export function normalizeToAnnual(amount: unknown, frequency: unknown): number {
  validateAmount(amount)
  validateFrequency(frequency)
  return Math.round(amount * PERIODS_PER_YEAR[frequency])
}

/**
 * Gets the normalization multiplier for a given frequency
 * @param frequency - The frequency
 * @returns The multiplier value
 */
export function getNormalizationMultiplier(frequency: Frequency): number {
  return FREQUENCY_MULTIPLIERS[frequency]
}

/**
 * Denormalizes a monthly amount back to its original frequency
 * @param monthlyAmount - The monthly amount in cents
 * @param frequency - The target frequency
 * @returns The denormalized amount in cents (rounded to nearest integer)
 */
export function denormalizeFromMonthly(monthlyAmount: unknown, frequency: unknown): number {
  validateAmount(monthlyAmount)
  validateFrequency(frequency)
  const multiplier = FREQUENCY_MULTIPLIERS[frequency]
  const denormalized = monthlyAmount / multiplier
  return Math.round(denormalized)
}

/**
 * Calculates the total monthly normalized value from an array of amounts with frequencies
 * @param items - Array of NormalizableFinancialItem
 * @returns The total monthly normalized amount in cents
 */
export function calculateTotalMonthlyNormalized(items: unknown): number {
  if (!Array.isArray(items)) {
    throw new Error('Items must be an array')
  }

  return items.reduce((sum, item) => {
    validateAmount(item?.amount)
    validateFrequency(item?.frequency)
    return sum + normalizeToMonthly(item.amount, item.frequency)
  }, 0)
}

/**
 * The annual twin of `calculateTotalMonthlyNormalized` (story 111.1): each item
 * annualized exactly by `normalizeToAnnual`, then summed.
 * @param items - Array of NormalizableFinancialItem
 * @returns The total annual amount in cents
 */
export function calculateTotalAnnualNormalized(items: unknown): number {
  if (!Array.isArray(items)) {
    throw new Error('Items must be an array')
  }

  return items.reduce((sum, item) => {
    validateAmount(item?.amount)
    validateFrequency(item?.frequency)
    return sum + normalizeToAnnual(item.amount, item.frequency)
  }, 0)
}

/**
 * The most one non-monthly entry can drift in a year between the two rounding
 * rules (story 111.1 review, D1): monthly-canonical `round(a × P / 12) × 12`
 * against the forecast's exact `a × P`. MEASURED over amounts 0..1,999,999 at
 * create-story: weekly -4..4, biweekly -4..6, annually -5..6; monthly is exact.
 */
export const ROUNDING_DRIFT_CENTS_PER_ENTRY_YEAR = 6

/**
 * Worst-case cents a forecast can disagree with a MONTHLY-canonical figure after
 * `years`, from rounding alone (story 111.1 review, D1, Lucas 2026-10-07): 6¢ per
 * non-monthly entry per year. The caller passes the frequency of every recurring
 * flow that reaches both sides (income, expenses, counted investment
 * contributions and debt payments). Use it so a shortfall of rounding cents is
 * never reported as overspending: the builder's over-contribution line (111.1)
 * and the no-savings-rows warning (112.1).
 *
 * An unknown frequency counts as non-monthly (the safe side). `years` that is not
 * a positive finite number gives 0.
 * @param frequencies - One entry per recurring flow
 * @param years - Projection years the shortfall accumulated over
 * @returns The tolerance in cents
 */
export function roundingDriftToleranceCents(
  frequencies: readonly unknown[],
  years: number
): number {
  if (!Number.isFinite(years) || years <= 0) return 0
  const nonMonthly = frequencies.filter((frequency) => frequency !== 'monthly').length
  return ROUNDING_DRIFT_CENTS_PER_ENTRY_YEAR * nonMonthly * Math.floor(years)
}

// Note: Frequency and NormalizableFinancialItem are already exported directly above
