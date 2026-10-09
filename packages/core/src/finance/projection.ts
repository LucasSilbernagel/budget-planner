export type TimeHorizon = '1y' | '5y' | '10y' | 'custom'

export type NetWorthProjectionInput = {
	currentAssetsCents: number

	currentLiabilitiesCents: number

	monthlyNetIncomeCents: number

	// Decimal, e.g. 0.06 for 6%.
	assetReturnRate: number

	incomeGrowthRate: number

	timeHorizon: TimeHorizon

	customYears?: number
}

export type ProjectionPoint = {
	month: number

	year: number

	assetsCents: number

	liabilitiesCents: number

	netWorthCents: number

	monthlyNetIncomeCents: number
}

export type NetWorthProjectionResult = {
	input: NetWorthProjectionInput

	timeline: ProjectionPoint[]

	summary: {
		totalMonths: number

		startingNetWorthCents: number

		endingNetWorthCents: number

		totalGrowthCents: number

		/** Growth percentage (ending / starting) */
		growthPercentage: number

		averageMonthlyGrowthCents: number
	}
}

function validateProjectionInput(input: NetWorthProjectionInput): void {
	if (input.currentAssetsCents < 0) {
		throw new Error('Current assets cannot be negative')
	}

	if (input.currentLiabilitiesCents < 0) {
		throw new Error('Current liabilities cannot be negative')
	}

	if (input.assetReturnRate < -1 || input.assetReturnRate > 1) {
		throw new Error('Asset return rate must be between -100% and +100%')
	}

	if (input.incomeGrowthRate < -1 || input.incomeGrowthRate > 1) {
		throw new Error('Income growth rate must be between -100% and +100%')
	}

	if (input.timeHorizon === 'custom' && input.customYears !== undefined) {
		if (input.customYears <= 0) {
			throw new Error('Custom time horizon must be positive')
		}
		if (input.customYears > 50) {
			throw new Error('Custom time horizon cannot exceed 50 years')
		}
	}
}

function getYearsFromHorizon(horizon: TimeHorizon, customYears?: number): number {
	switch (horizon) {
		case '1y':
			return 1
		case '5y':
			return 5
		case '10y':
			return 10
		case 'custom':
			if (customYears === undefined || customYears <= 0) {
				throw new Error('Custom years must be provided for custom time horizon')
			}
			return customYears
		default:
			return 10
	}
}

// monthlyRate = (1 + annualRate)^(1/12) - 1
function calculateMonthlyRate(annualRate: number): number {
	if (annualRate === -1) {
		return -1
	}
	return (1 + annualRate) ** (1 / 12) - 1
}

function calculateCompoundGrowth(presentValue: number, rate: number, periods: number): number {
	if (periods === 0) {
		return presentValue
	}
	if (rate === -1) {
		return 0
	}
	return presentValue * (1 + rate) ** periods
}

export function createNetWorthProjection(input: NetWorthProjectionInput): NetWorthProjectionResult {
	validateProjectionInput(input)

	const totalYears = getYearsFromHorizon(input.timeHorizon, input.customYears)
	const totalMonths = Math.floor(totalYears * 12)

	const monthlyAssetRate = calculateMonthlyRate(input.assetReturnRate)
	const monthlyIncomeGrowthRate = calculateMonthlyRate(input.incomeGrowthRate)

	const timeline: ProjectionPoint[] = []
	let currentAssetsCents = input.currentAssetsCents
	const currentLiabilitiesCents = input.currentLiabilitiesCents
	let currentMonthlyNetIncomeCents = input.monthlyNetIncomeCents

	const startingNetWorthCents = currentAssetsCents - currentLiabilitiesCents

	for (let month = 0; month <= totalMonths; month++) {
		const year = Math.floor(month / 12)

		if (month > 0) {
			// Only a positive balance earns a return: compounding a shortfall would grow it geometrically.
			if (currentAssetsCents > 0) {
				currentAssetsCents = Math.round(
					calculateCompoundGrowth(currentAssetsCents, monthlyAssetRate, 1)
				)
			}

			currentAssetsCents += currentMonthlyNetIncomeCents

			currentMonthlyNetIncomeCents = Math.round(
				calculateCompoundGrowth(currentMonthlyNetIncomeCents, monthlyIncomeGrowthRate, 1)
			)
		}

		const netWorthCents = currentAssetsCents - currentLiabilitiesCents

		timeline.push({
			month,
			year,
			assetsCents: currentAssetsCents,
			liabilitiesCents: currentLiabilitiesCents,
			netWorthCents,
			monthlyNetIncomeCents: currentMonthlyNetIncomeCents,
		})
	}

	const timelineLength = timeline.length
	// biome-ignore lint/style/noNonNullAssertion: month 0 is always pushed, so timeline is non-empty; ?. would widen lastPoint to undefined and break the .netWorthCents access below.
	const lastPoint = timeline[timelineLength - 1]!
	const endingNetWorthCents = lastPoint.netWorthCents
	const totalGrowthCents = endingNetWorthCents - startingNetWorthCents
	const growthPercentage =
		startingNetWorthCents !== 0 ? (endingNetWorthCents / startingNetWorthCents) * 100 : 0
	const averageMonthlyGrowthCents = totalMonths > 0 ? Math.round(totalGrowthCents / totalMonths) : 0

	return {
		input: {
			...input,
			customYears: input.timeHorizon === 'custom' ? input.customYears : undefined,
		},
		timeline,
		summary: {
			totalMonths,
			startingNetWorthCents,
			endingNetWorthCents,
			totalGrowthCents,
			growthPercentage,
			averageMonthlyGrowthCents,
		},
	}
}

export function projectNetWorthSimple(
	currentNetWorthCents: number,
	monthlySavingsCents: number,
	annualReturnRate: number,
	years: number
): NetWorthProjectionResult {
	return createNetWorthProjection({
		currentAssetsCents: currentNetWorthCents,
		currentLiabilitiesCents: 0,
		monthlyNetIncomeCents: monthlySavingsCents,
		assetReturnRate: annualReturnRate,
		incomeGrowthRate: 0,
		timeHorizon: 'custom',
		customYears: years,
	})
}

export function calculateYearsToNetWorthTarget(
	currentNetWorthCents: number,
	monthlySavingsCents: number,
	annualReturnRate: number,
	targetNetWorthCents: number,
	maxYears = 50
): number | null {
	if (currentNetWorthCents >= targetNetWorthCents) {
		return 0
	}

	if (monthlySavingsCents <= 0 && annualReturnRate <= 0) {
		return null
	}

	const result = createNetWorthProjection({
		currentAssetsCents: currentNetWorthCents,
		currentLiabilitiesCents: 0,
		monthlyNetIncomeCents: monthlySavingsCents,
		assetReturnRate: annualReturnRate,
		incomeGrowthRate: 0,
		timeHorizon: 'custom',
		customYears: maxYears,
	})

	for (const point of result.timeline) {
		if (point.netWorthCents >= targetNetWorthCents) {
			return point.year + point.month / 12
		}
	}

	return null
}

export function isNetWorthProjectionInput(obj: unknown): obj is NetWorthProjectionInput {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		'currentAssetsCents' in obj &&
		'currentLiabilitiesCents' in obj &&
		'monthlyNetIncomeCents' in obj &&
		'assetReturnRate' in obj &&
		'incomeGrowthRate' in obj &&
		'timeHorizon' in obj
	)
}

export function isTimeHorizon(value: unknown): value is TimeHorizon {
	return typeof value === 'string' && ['1y', '5y', '10y', 'custom'].includes(value)
}
