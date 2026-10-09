import { describe, expect, it } from 'vitest'
import {
	calculateYearsToNetWorthTarget,
	createNetWorthProjection,
	isNetWorthProjectionInput,
	isTimeHorizon,
	type NetWorthProjectionInput,
	projectNetWorthSimple,
} from './projection'

const toCents = (dollars: number): number => Math.round(dollars * 100)

const BASE_INPUT: NetWorthProjectionInput = {
	currentAssetsCents: toCents(100000),
	currentLiabilitiesCents: toCents(0),
	monthlyNetIncomeCents: toCents(5000),
	assetReturnRate: 0.07,
	incomeGrowthRate: 0.03,
	timeHorizon: '10y',
}

describe('Projection Input Validation', () => {
	it('should accept valid input without throwing', () => {
		expect(() => createNetWorthProjection(BASE_INPUT)).not.toThrow()
	})

	it('should throw error for negative current assets', () => {
		const invalidInput = { ...BASE_INPUT, currentAssetsCents: toCents(-1000) }
		expect(() => createNetWorthProjection(invalidInput)).toThrow(
			'Current assets cannot be negative'
		)
	})

	it('should throw error for negative current liabilities', () => {
		const invalidInput = { ...BASE_INPUT, currentLiabilitiesCents: toCents(-1000) }
		expect(() => createNetWorthProjection(invalidInput)).toThrow(
			'Current liabilities cannot be negative'
		)
	})

	it('should throw error for asset return rate below -100%', () => {
		const invalidInput = { ...BASE_INPUT, assetReturnRate: -1.5 }
		expect(() => createNetWorthProjection(invalidInput)).toThrow(
			'Asset return rate must be between -100% and +100%'
		)
	})

	it('should throw error for asset return rate above +100%', () => {
		const invalidInput = { ...BASE_INPUT, assetReturnRate: 1.5 }
		expect(() => createNetWorthProjection(invalidInput)).toThrow(
			'Asset return rate must be between -100% and +100%'
		)
	})

	it('should throw error for income growth rate below -100%', () => {
		const invalidInput = { ...BASE_INPUT, incomeGrowthRate: -1.5 }
		expect(() => createNetWorthProjection(invalidInput)).toThrow(
			'Income growth rate must be between -100% and +100%'
		)
	})

	it('should throw error for custom time horizon without customYears', () => {
		const invalidInput: NetWorthProjectionInput = {
			...BASE_INPUT,
			timeHorizon: 'custom',
		}
		expect(() => createNetWorthProjection(invalidInput)).toThrow(
			'Custom years must be provided for custom time horizon'
		)
	})

	it('should throw error for custom time horizon with zero years', () => {
		const invalidInput: NetWorthProjectionInput = {
			...BASE_INPUT,
			timeHorizon: 'custom',
			customYears: 0,
		}
		expect(() => createNetWorthProjection(invalidInput)).toThrow(
			'Custom time horizon must be positive'
		)
	})

	it('should throw error for custom time horizon exceeding 50 years', () => {
		const invalidInput: NetWorthProjectionInput = {
			...BASE_INPUT,
			timeHorizon: 'custom',
			customYears: 51,
		}
		expect(() => createNetWorthProjection(invalidInput)).toThrow(
			'Custom time horizon cannot exceed 50 years'
		)
	})
})

describe('Basic Projection Calculations', () => {
	it('should create a projection with 1 year horizon', () => {
		const input: NetWorthProjectionInput = {
			...BASE_INPUT,
			timeHorizon: '1y',
		}

		const result = createNetWorthProjection(input)

		expect(result.timeline.length).toBe(13)
		expect(result.summary.totalMonths).toBe(12)
	})

	it('should create a projection with 5 year horizon', () => {
		const input: NetWorthProjectionInput = {
			...BASE_INPUT,
			timeHorizon: '5y',
		}

		const result = createNetWorthProjection(input)

		expect(result.timeline.length).toBe(61)
		expect(result.summary.totalMonths).toBe(60)
	})

	it('should create a projection with 10 year horizon', () => {
		const result = createNetWorthProjection(BASE_INPUT)

		expect(result.timeline.length).toBe(121)
		expect(result.summary.totalMonths).toBe(120)
	})

	it('should create a projection with custom time horizon', () => {
		const input: NetWorthProjectionInput = {
			...BASE_INPUT,
			timeHorizon: 'custom',
			customYears: 3,
		}

		const result = createNetWorthProjection(input)

		expect(result.timeline.length).toBe(37)
		expect(result.summary.totalMonths).toBe(36)
	})

	it('should have correct starting net worth', () => {
		const result = createNetWorthProjection(BASE_INPUT)

		expect(result.timeline[0].netWorthCents).toBe(toCents(100000))
		expect(result.summary.startingNetWorthCents).toBe(toCents(100000))
	})

	it('should calculate assets compounding correctly over time', () => {
		const input: NetWorthProjectionInput = {
			currentAssetsCents: toCents(10000),
			currentLiabilitiesCents: toCents(0),
			monthlyNetIncomeCents: toCents(0),
			assetReturnRate: 0.12,
			incomeGrowthRate: 0,
			timeHorizon: '1y',
		}

		const result = createNetWorthProjection(input)

		const monthlyRate = (1 + 0.12) ** (1 / 12) - 1
		const expectedFV = 10000 * (1 + monthlyRate) ** 12
		const expectedCents = Math.round(expectedFV * 100)

		const endingAssets = result.timeline[12].assetsCents
		const tolerance = 2

		expect(Math.abs(endingAssets - expectedCents)).toBeLessThanOrEqual(tolerance)
	})
})

describe('Compound Interest Accuracy', () => {
	it('should correctly calculate compound interest with monthly compounding', () => {
		const input: NetWorthProjectionInput = {
			currentAssetsCents: toCents(1000),
			currentLiabilitiesCents: toCents(0),
			monthlyNetIncomeCents: toCents(0),
			assetReturnRate: 0.12,
			incomeGrowthRate: 0,
			timeHorizon: '1y',
		}

		const result = createNetWorthProjection(input)
		const endingNetWorth = result.timeline[12].netWorthCents / 100

		const monthlyRate = (1 + 0.12) ** (1 / 12) - 1
		const expectedValue = 1000 * (1 + monthlyRate) ** 12

		expect(endingNetWorth).toBeCloseTo(expectedValue, 0.1)
	})

	it('should handle zero return rate correctly', () => {
		const input: NetWorthProjectionInput = {
			currentAssetsCents: toCents(10000),
			currentLiabilitiesCents: toCents(0),
			monthlyNetIncomeCents: toCents(1000),
			assetReturnRate: 0,
			incomeGrowthRate: 0,
			timeHorizon: '1y',
		}

		const result = createNetWorthProjection(input)

		const endingNetWorth = result.timeline[12].netWorthCents / 100

		expect(endingNetWorth).toBe(22000)
	})

	it('should handle negative return rate correctly', () => {
		const input: NetWorthProjectionInput = {
			currentAssetsCents: toCents(10000),
			currentLiabilitiesCents: toCents(0),
			monthlyNetIncomeCents: toCents(0),
			assetReturnRate: -0.5,
			incomeGrowthRate: 0,
			timeHorizon: 'custom',
			customYears: 2,
		}

		const result = createNetWorthProjection(input)

		const endingNetWorth = result.timeline[24].netWorthCents / 100

		expect(endingNetWorth).toBeLessThan(10000)
		expect(endingNetWorth).toBeGreaterThan(0)
	})
})

describe('Edge Cases', () => {
	it('should handle zero starting assets', () => {
		const input: NetWorthProjectionInput = {
			currentAssetsCents: toCents(0),
			currentLiabilitiesCents: toCents(0),
			monthlyNetIncomeCents: toCents(1000),
			assetReturnRate: 0.07,
			incomeGrowthRate: 0,
			timeHorizon: '1y',
		}

		const result = createNetWorthProjection(input)

		expect(result.summary.startingNetWorthCents).toBe(0)
		expect(result.timeline[12].netWorthCents).toBeGreaterThan(0)
	})

	it('should handle zero monthly net income', () => {
		const input: NetWorthProjectionInput = {
			currentAssetsCents: toCents(10000),
			currentLiabilitiesCents: toCents(0),
			monthlyNetIncomeCents: toCents(0),
			assetReturnRate: 0.07,
			incomeGrowthRate: 0,
			timeHorizon: '1y',
		}

		const result = createNetWorthProjection(input)

		expect(result.timeline[12].netWorthCents).toBeGreaterThan(toCents(10000))
	})

	it('should handle liabilities correctly', () => {
		const input: NetWorthProjectionInput = {
			currentAssetsCents: toCents(100000),
			currentLiabilitiesCents: toCents(50000),
			monthlyNetIncomeCents: toCents(5000),
			assetReturnRate: 0.07,
			incomeGrowthRate: 0,
			timeHorizon: '1y',
		}

		const result = createNetWorthProjection(input)

		expect(result.summary.startingNetWorthCents).toBe(toCents(50000))

		expect(result.timeline[12].liabilitiesCents).toBe(toCents(50000))
	})

	it('should handle -100% return rate (everything goes to zero)', () => {
		const input: NetWorthProjectionInput = {
			currentAssetsCents: toCents(10000),
			currentLiabilitiesCents: toCents(0),
			monthlyNetIncomeCents: toCents(0),
			assetReturnRate: -1,
			incomeGrowthRate: 0,
			timeHorizon: '1y',
		}

		const result = createNetWorthProjection(input)

		expect(result.timeline[12].assetsCents).toBe(0)
	})
})

describe('Assets/Liabilities Separation', () => {
	const DEBT_DOMINATED: NetWorthProjectionInput = {
		currentAssetsCents: toCents(1000),
		currentLiabilitiesCents: toCents(300000),
		monthlyNetIncomeCents: toCents(0),
		assetReturnRate: 0.07,
		incomeGrowthRate: 0,
		timeHorizon: 'custom',
		customYears: 10,
	}

	it('does not diverge exponentially when liabilities exceed assets', () => {
		const result = createNetWorthProjection(DEBT_DOMINATED)

		expect(result.summary.startingNetWorthCents).toBe(toCents(-299000))

		expect(result.summary.endingNetWorthCents).toBeGreaterThan(result.summary.startingNetWorthCents)

		// Load-bearing: net worth can never fall below the liability alone; any geometric debt
		// growth breaks this bound.
		expect(result.summary.endingNetWorthCents).toBeGreaterThan(toCents(-300000))
	})

	it('compounds the assets alone, at the full return rate', () => {
		const result = createNetWorthProjection(DEBT_DOMINATED)

		// $1,000 at 7% for 10 years = $1,967.15. Ranged: the model rounds to whole cents monthly.
		const finalAssets = result.timeline[120]?.assetsCents ?? Number.NaN
		expect(finalAssets).toBeGreaterThan(196_600)
		expect(finalAssets).toBeLessThan(196_800)
	})

	it('holds liabilities flat at every point in the timeline', () => {
		const result = createNetWorthProjection(DEBT_DOMINATED)

		expect(result.timeline).toHaveLength(121)
		for (const point of result.timeline) {
			expect(point.liabilitiesCents).toBe(toCents(300000))
		}
	})

	it('projects a debts-only position as a flat line at the liability', () => {
		const result = createNetWorthProjection({
			...DEBT_DOMINATED,
			currentAssetsCents: toCents(0),
		})

		for (const point of result.timeline) {
			expect(point.netWorthCents).toBe(toCents(-300000))
		}
	})

	it('projects an assets-only position identically to the same assets carrying debt', () => {
		const assetsOnly = createNetWorthProjection({
			...DEBT_DOMINATED,
			currentLiabilitiesCents: toCents(0),
		})
		const withDebt = createNetWorthProjection(DEBT_DOMINATED)

		expect(assetsOnly.timeline[120]?.assetsCents).toBe(withDebt.timeline[120]?.assetsCents)
		expect(assetsOnly.summary.endingNetWorthCents).toBe(
			withDebt.summary.endingNetWorthCents + toCents(300000)
		)
	})

	it('applies contributions to assets in a net-negative position', () => {
		const withContributions = createNetWorthProjection({
			...DEBT_DOMINATED,
			monthlyNetIncomeCents: toCents(500),
		})
		const withoutContributions = createNetWorthProjection(DEBT_DOMINATED)

		const difference =
			withContributions.summary.endingNetWorthCents -
			withoutContributions.summary.endingNetWorthCents
		expect(difference).toBeGreaterThan(toCents(60000))
		expect(difference).toBeLessThan(toCents(90000))
	})

	const SPENDING_DEFICIT: NetWorthProjectionInput = {
		currentAssetsCents: toCents(50000),
		currentLiabilitiesCents: toCents(200000),
		monthlyNetIncomeCents: toCents(-500),
		assetReturnRate: 0.07,
		incomeGrowthRate: 0,
		timeHorizon: 'custom',
		customYears: 30,
	}

	it('does not compound a negative asset balance', () => {
		const result = createNetWorthProjection(SPENDING_DEFICIT)

		let checkedMonths = 0
		for (let month = 1; month < result.timeline.length; month++) {
			const previous = result.timeline[month - 1]?.assetsCents ?? Number.NaN
			const current = result.timeline[month]?.assetsCents ?? Number.NaN
			if (previous < 0) {
				expect(current - previous).toBe(toCents(-500))
				checkedMonths++
			}
		}

		// Guard against a vacuous pass: the scenario must actually reach the negative region.
		expect(checkedMonths).toBeGreaterThan(50)
	})

	it('keeps a spending deficit linear rather than geometric', () => {
		const result = createNetWorthProjection(SPENDING_DEFICIT)
		const finalAssets = result.timeline[360]?.assetsCents ?? Number.NaN

		// Floor: 360 months x -$500 against $50,000 of starting assets.
		expect(finalAssets).toBeGreaterThanOrEqual(toCents(50000) + 360 * toCents(-500))

		expect(finalAssets).toBeGreaterThan(toCents(-150000))
	})

	it('projects a zero return rate as flat assets plus contributions', () => {
		const result = createNetWorthProjection({
			...DEBT_DOMINATED,
			assetReturnRate: 0,
			monthlyNetIncomeCents: toCents(100),
		})

		expect(result.timeline[120]?.assetsCents).toBe(toCents(1000) + 120 * toCents(100))
	})
})

describe('Years to Target Calculation', () => {
	it('should return 0 if already at target', () => {
		const years = calculateYearsToNetWorthTarget(toCents(100000), toCents(0), 0.07, toCents(100000))

		expect(years).toBe(0)
	})

	it('should return null if target cannot be reached', () => {
		const years = calculateYearsToNetWorthTarget(toCents(100000), toCents(0), 0, toCents(200000))

		expect(years).toBeNull()
	})

	it('should return null if no savings and negative return', () => {
		const years = calculateYearsToNetWorthTarget(
			toCents(100000),
			toCents(-1000),
			-0.1,
			toCents(200000)
		)

		expect(years).toBeNull()
	})

	it('should calculate years to reach a target with positive growth', () => {
		const years = calculateYearsToNetWorthTarget(
			toCents(100000),
			toCents(5000),
			0.07,
			toCents(500000)
		)

		expect(years).toBeGreaterThan(0)
		expect(years).toBeLessThan(20)
	})
})

describe('Type Guards', () => {
	it('should correctly identify TimeHorizon values', () => {
		expect(isTimeHorizon('1y')).toBe(true)
		expect(isTimeHorizon('5y')).toBe(true)
		expect(isTimeHorizon('10y')).toBe(true)
		expect(isTimeHorizon('custom')).toBe(true)
		expect(isTimeHorizon('invalid')).toBe(false)
		expect(isTimeHorizon(123)).toBe(false)
	})

	it('should correctly identify NetWorthProjectionInput objects', () => {
		expect(isNetWorthProjectionInput(BASE_INPUT)).toBe(true)
		expect(isNetWorthProjectionInput({})).toBe(false)
		expect(isNetWorthProjectionInput(null)).toBe(false)
		expect(isNetWorthProjectionInput(undefined)).toBe(false)
	})
})

describe('Summary Statistics', () => {
	it('should calculate correct summary statistics', () => {
		const result = createNetWorthProjection(BASE_INPUT)

		expect(result.summary.startingNetWorthCents).toBe(toCents(100000))
		expect(result.summary.endingNetWorthCents).toBe(result.timeline.at(-1)?.netWorthCents)
		expect(result.summary.totalGrowthCents).toBe(
			result.summary.endingNetWorthCents - result.summary.startingNetWorthCents
		)

		const expectedGrowthPct =
			(result.summary.endingNetWorthCents / result.summary.startingNetWorthCents) * 100
		expect(result.summary.growthPercentage).toBeCloseTo(expectedGrowthPct, 0.01)
	})

	it('should handle division by zero for growth percentage', () => {
		const input: NetWorthProjectionInput = {
			currentAssetsCents: toCents(0),
			currentLiabilitiesCents: toCents(0),
			monthlyNetIncomeCents: toCents(1000),
			assetReturnRate: 0.07,
			incomeGrowthRate: 0,
			timeHorizon: '1y',
		}

		const result = createNetWorthProjection(input)

		expect(result.summary.growthPercentage).toBe(0)
	})
})

describe('Simplified Projection Function', () => {
	it('should create projection with simplified inputs', () => {
		const result = projectNetWorthSimple(toCents(100000), toCents(5000), 0.07, 10)

		expect(result.summary.startingNetWorthCents).toBe(toCents(100000))
		expect(result.summary.totalMonths).toBe(120)
		expect(result.input.currentLiabilitiesCents).toBe(0)
		expect(result.input.incomeGrowthRate).toBe(0)
	})
})
