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

// Frequency multipliers for monthly normalization
// These are the exact number of periods per month
// Using precise fractions to avoid floating-point accumulation errors
const FREQUENCY_MULTIPLIERS: Record<Frequency, number> = {
  weekly: 52 / 12,       // 52 weeks / 12 months = 4.333333...
  biweekly: 26 / 12,     // 26 biweekly periods / 12 months = 2.166666...
  monthly: 1,            // 1 month / 12 months = 1/12, but we're normalizing TO monthly, so multiply by 1
  annually: 1 / 12,     // 1 / 12 = 0.083333...
}

/**
 * Normalizes an amount to its monthly equivalent based on frequency
 * @param amount - The amount in cents (integer)
 * @param frequency - The frequency of the amount
 * @returns The monthly normalized amount in cents (rounded to nearest integer)
 */
export function normalizeToMonthly(amount: number, frequency: Frequency): number {
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
export function denormalizeFromMonthly(monthlyAmount: number, frequency: Frequency): number {
  const multiplier = FREQUENCY_MULTIPLIERS[frequency]
  const denormalized = monthlyAmount / multiplier
  return Math.round(denormalized)
}

/**
 * Calculates the total monthly normalized value from an array of amounts with frequencies
 * @param items - Array of items with amount and frequency
 * @returns The total monthly normalized amount in cents
 */
export function calculateTotalMonthlyNormalized(
  items: Array<{ amount: number; frequency: Frequency }>
): number {
  const safeItems = items || []
  return safeItems.reduce(
    (sum, item) => sum + normalizeToMonthly(item.amount, item.frequency),
    0
  )
}

// Re-export types for convenience
export type { Frequency }
