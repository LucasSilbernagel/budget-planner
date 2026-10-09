import type {
	IncomeBasis,
	RetirementAccumulationResult,
	solveRetirementAccumulation,
} from '@budget-planner/core/finance/retirement'

// Mirrors core's module-private MAX_PROJECTION_YEARS.
const MAX_PROJECTION_YEARS = 100

const SOLVER_ERROR_COPY: Record<string, string> = {
	'Annual return rate must be positive (greater than 0)':
		'Please enter a valid return rate (must be greater than 0%)',
	'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.':
		'Please enter a valid return rate (must be greater than 0%)',
	'Annual return rate must be at least 0.1% to avoid precision issues in calculations.':
		'Return rate must be at least 0.1% to ensure accurate calculations',
	'Annual return rate must be a finite number':
		'Please enter a valid expected annual return (while saving)',
	'Annual return rate must be a non-negative finite number':
		'Please enter a valid expected annual return (while saving) — it cannot be negative',
	'Post-retirement return rate must be a finite number':
		'Please enter a valid post-retirement annual return',
	'Post-retirement return rate must be a non-negative finite number':
		'Please enter a valid post-retirement annual return — it cannot be negative',
	'Calculation overflow: Required assets exceeds safe integer limit. Try a smaller income or higher return rate.':
		'The calculated amount is too large. Please try smaller values.',
	'Calculation overflow: Required assets exceeds safe integer limit.':
		'The calculated amount is too large. Please try smaller values.',
	'Calculation overflow: Withdrawal amount exceeds safe integer limit.':
		'The calculated amount is too large. Please try smaller values.',
	'Number of years must not exceed 100 to prevent performance issues and calculation overflow.':
		'Please enter a projection period of 100 years or less',
	// With two rates this also fires on a long life expectancy, so it must not blame income alone.
	'Required nest egg exceeds safe integer limit.':
		'These numbers are too large to plan for. Check your life expectancy, and the gap between your two return rates — a big gap over a very long retirement grows beyond what can be calculated.',
	'Projection overflow: nest egg exceeds safe integer limit. Try smaller values or fewer months.':
		'Your savings grow beyond what can be calculated. Please try smaller amounts.',
	'Current saved amount must be a finite number':
		'We could not read your saved amount. Please check your investment accounts on the Balance Tracking page.',
	'Monthly savings must be a finite number':
		'We could not read your monthly savings. Please check the monthly contributions on your Balance Tracking page.',
	'Current age must be a finite number': 'Please enter a valid current age.',
	'Life expectancy must be a finite number': 'Please enter a valid life expectancy.',
	'Desired annual income must be a finite number':
		'Please enter a valid desired retirement income.',
}

// Keyed on exact core error strings, so a reworded core guard silently loses its detail line.
export function describeSolverError(error: unknown): string | null {
	return error instanceof Error ? (SOLVER_ERROR_COPY[error.message] ?? null) : null
}

// Re-checks the safe-integer bound: × 12 happens after parseCurrencyToCents' guard.
export function toAnnualIncomeCents(amountCents: number, basis: IncomeBasis): number {
	if (basis === 'annual') {
		return amountCents
	}

	const annualCents = amountCents * 12

	if (!Number.isSafeInteger(annualCents)) {
		throw new Error('Invalid currency: value exceeds safe integer limit')
	}

	return annualCents
}

// Stops at retirement when reachable, else life expectancy: a curve still accumulating past
// retirement would contradict the deplete plan. Floored at 1, capped at MAX_PROJECTION_YEARS.
export function chartHorizonYears(
	input: Parameters<typeof solveRetirementAccumulation>[0],
	result: RetirementAccumulationResult
): number {
	const yearsToRetirement =
		result.reachable && result.earliestRetirementAge !== null
			? Math.ceil(result.earliestRetirementAge - input.currentAge)
			: null

	const horizon =
		yearsToRetirement === null
			? Math.max(0, input.lifeExpectancy - input.currentAge)
			: Math.max(1, yearsToRetirement)

	return Math.min(MAX_PROJECTION_YEARS, horizon)
}
