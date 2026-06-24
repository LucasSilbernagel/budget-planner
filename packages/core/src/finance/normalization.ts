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

// Frequency multipliers for monthly normalization
// These are the exact number of periods per month
// Using precise fractions to avoid floating-point accumulation errors
const FREQUENCY_MULTIPLIERS: Record<Frequency, number> = {
  weekly: 52 / 12, // 52 weeks / 12 months = 4.333333...
  biweekly: 26 / 12, // 26 biweekly periods / 12 months = 2.166666...
  monthly: 1, // 1 month / 12 months = 1/12, but we're normalizing TO monthly, so multiply by 1
  annually: 1 / 12, // 1 / 12 = 0.083333...
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
  const multiplier = FREQUENCY_MULTIPLIERS[frequency]
  const normalized = amount * multiplier
  return Math.round(normalized)
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

// Note: Frequency and NormalizableFinancialItem are already exported directly above
