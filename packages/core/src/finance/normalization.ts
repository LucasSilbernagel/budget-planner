export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'annually'

export interface NormalizableFinancialItem {
	amount: number
	frequency: Frequency
}

// Inexact in float (`26 / 12`), so normalizeToMonthly uses PERIODS_PER_YEAR instead.
const FREQUENCY_MULTIPLIERS: Record<Frequency, number> = {
	weekly: 52 / 12,
	biweekly: 26 / 12,
	monthly: 1,
	annually: 1 / 12,
}

// Integer periods per year: multiply, then divide once, so a half cent rounds the same at every
// amount (`× (26 / 12)` doesn't). `amount × 52` is exact below MAX_SAFE_INTEGER / 100.
const PERIODS_PER_YEAR: Record<Frequency, number> = {
	weekly: 52,
	biweekly: 26,
	monthly: 12,
	annually: 1,
}

export function validateFrequency(frequency: unknown): asserts frequency is Frequency {
	if (typeof frequency !== 'string' || !(frequency in FREQUENCY_MULTIPLIERS)) {
		throw new Error('Invalid frequency')
	}
}

export function validateAmount(amount: unknown): asserts amount is number {
	if (typeof amount !== 'number' || !Number.isFinite(amount)) {
		throw new Error('Amount must be a finite number')
	}
}

export function normalizeToMonthly(amount: unknown, frequency: unknown): number {
	validateAmount(amount)
	validateFrequency(frequency)
	return Math.round((amount * PERIODS_PER_YEAR[frequency]) / 12)
}

// Rounded once. The forecast's rows are years; other surfaces are monthly-canonical, so the two
// can differ by a few cents per non-monthly entry.
export function normalizeToAnnual(amount: unknown, frequency: unknown): number {
	validateAmount(amount)
	validateFrequency(frequency)
	return Math.round(amount * PERIODS_PER_YEAR[frequency])
}

export function getNormalizationMultiplier(frequency: Frequency): number {
	return FREQUENCY_MULTIPLIERS[frequency]
}

export function denormalizeFromMonthly(monthlyAmount: unknown, frequency: unknown): number {
	validateAmount(monthlyAmount)
	validateFrequency(frequency)
	const multiplier = FREQUENCY_MULTIPLIERS[frequency]
	const denormalized = monthlyAmount / multiplier
	return Math.round(denormalized)
}

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

// Max yearly drift per non-monthly entry between monthly-canonical `round(a × P / 12) × 12` and
// exact `a × P` (measured: weekly ±4, biweekly -4..6, annually -5..6).
export const ROUNDING_DRIFT_CENTS_PER_ENTRY_YEAR = 6

// So a shortfall of rounding cents is never reported as overspending. Unknown frequencies
// count as non-monthly.
export function roundingDriftToleranceCents(
	frequencies: readonly unknown[],
	years: number
): number {
	if (!Number.isFinite(years) || years <= 0) return 0
	const nonMonthly = frequencies.filter((frequency) => frequency !== 'monthly').length
	return ROUNDING_DRIFT_CENTS_PER_ENTRY_YEAR * nonMonthly * Math.floor(years)
}
