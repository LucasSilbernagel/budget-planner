import { describe, expect, it } from 'vitest'
import {
	ASSETS_NEGATIVE,
	calculateFinancialForecast,
	FORECAST_OUT_OF_RANGE,
	type ForecastInputData,
	type ForecastingScenario,
} from '../forecasting'

const FLAT = {
	name: 'Scenario',
	incomeGrowthRate: 0,
	expenseGrowthRate: 0,
	oneTimeEvents: [],
} satisfies ForecastingScenario

const HOUSE = 30_000_000

function data(assets?: number): ForecastInputData {
	return {
		income: [{ amount: 600_000, frequency: 'monthly' }],
		expenses: [{ amount: 300_000, frequency: 'monthly' }],
		savings: 1_000_000,
		investments: 0,
		balanceAccounts: [],
		...(assets === undefined ? {} : { assets }),
	}
}

describe('assets count in net worth', () => {
	it('adds the assets to the starting net worth', () => {
		const result = calculateFinancialForecast(data(HOUSE), FLAT, 3)
		expect(result.summary.startingNetWorth).toBe(1_000_000 + HOUSE)
	})

	it('lifts every year of BOTH series by exactly the asset total, and leaves the growth unchanged', () => {
		const without = calculateFinancialForecast(data(), FLAT, 3)
		const withAssets = calculateFinancialForecast(data(HOUSE), FLAT, 3)

		// Savings close year n at 1,000,000 + n × 3,600,000.
		expect(withAssets.projection.map((row) => row.netWorth)).toEqual([
			4_600_000 + HOUSE,
			8_200_000 + HOUSE,
			11_800_000 + HOUSE,
		])
		expect(withAssets.baseline.map((row) => row.netWorth)).toEqual([
			4_600_000 + HOUSE,
			8_200_000 + HOUSE,
			11_800_000 + HOUSE,
		])
		for (const series of ['baseline', 'projection'] as const) {
			withAssets[series].forEach((row, i) => {
				const plain = without[series][i]
				expect(row.netWorth - (plain?.netWorth ?? 0)).toBe(HOUSE)
				expect(row.assets).toBe(HOUSE)
				expect(row.savings).toBe(plain?.savings)
				expect(row.investments).toBe(plain?.investments)
				expect(row.income).toBe(plain?.income)
				expect(row.expenses).toBe(plain?.expenses)
				expect(row.netIncome).toBe(plain?.netIncome)
				expect(row.debts).toBe(plain?.debts)
			})
		}
		expect(withAssets.summary.endingNetWorth).toBe(11_800_000 + HOUSE)
		expect(withAssets.summary.totalGrowth).toBe(without.summary.totalGrowth)
		expect(withAssets.summary.averageAnnualGrowth).toBe(without.summary.averageAnnualGrowth)
	})

	it('stays constant over a long period with growing investments beside it (no multiplier)', () => {
		const input = {
			...data(HOUSE),
			investments: 1_000_007,
			balanceAccounts: [
				{
					type: 'investment',
					balance: 1_000_007,
					contribution: 0,
					frequency: 'monthly',
					annualReturn: 0.07,
				},
			],
		} satisfies ForecastInputData
		const result = calculateFinancialForecast(input, FLAT, 30)
		for (const row of result.projection) {
			expect(row.assets).toBe(HOUSE)
			expect(row.netWorth).toBe(row.savings + row.investments + HOUSE - (row.debts ?? 0))
		}
	})

	it('counts against nothing: a debt still subtracts, the asset still adds', () => {
		const input = {
			...data(HOUSE),
			balanceAccounts: [
				{
					type: 'debt',
					balance: 500_000,
					contribution: 0,
					frequency: 'monthly',
					contributionRecordedAsExpense: true,
				},
			],
		} satisfies ForecastInputData
		const result = calculateFinancialForecast(input, FLAT, 2)
		expect(result.summary.startingNetWorth).toBe(1_000_000 + HOUSE - 500_000)
		expect(result.projection.map((row) => row.netWorth)).toEqual([
			4_600_000 + HOUSE - 500_000,
			8_200_000 + HOUSE - 500_000,
		])
	})

	it('0 is a value: the key is present and nothing changes', () => {
		const without = calculateFinancialForecast(data(), FLAT, 3)
		const zero = calculateFinancialForecast(data(0), FLAT, 3)
		expect(zero.summary).toEqual(without.summary)
		expect(zero.projection.map((row) => row.assets)).toEqual([0, 0, 0])
		expect(zero.baseline.map((row) => row.assets)).toEqual([0, 0, 0])
		expect(zero.projection.map((row) => row.netWorth)).toEqual(
			without.projection.map((row) => row.netWorth)
		)
	})
})

describe('the baseline uses its OWN assets', () => {
	it('a separate baseline input with different assets moves only the baseline', () => {
		const plain = calculateFinancialForecast(data(), FLAT, 3)
		const result = calculateFinancialForecast(data(HOUSE), FLAT, 3, data(10_000_000))
		result.baseline.forEach((row, i) => {
			expect(row.assets).toBe(10_000_000)
			expect(row.netWorth).toBe((plain.baseline[i]?.netWorth ?? 0) + 10_000_000)
		})
		result.projection.forEach((row, i) => {
			expect(row.assets).toBe(HOUSE)
			expect(row.netWorth).toBe((plain.projection[i]?.netWorth ?? 0) + HOUSE)
		})
		expect(result.summary.startingNetWorth).toBe(1_000_000 + HOUSE)
	})

	it('a baseline input without assets has no `assets` key, even when the projection has one', () => {
		const result = calculateFinancialForecast(data(HOUSE), FLAT, 2, data())
		for (const row of result.baseline) expect(row).not.toHaveProperty('assets')
		for (const row of result.projection) expect(row.assets).toBe(HOUSE)
	})
})

describe('assets are validated like every starting figure', () => {
	it('refuses a negative total', () => {
		expect(() => calculateFinancialForecast(data(-1), FLAT, 3)).toThrow(ASSETS_NEGATIVE)
		expect(ASSETS_NEGATIVE).toBe('Asset values must be 0 or more')
	})

	it('refuses a negative total on the baseline input too', () => {
		expect(() => calculateFinancialForecast(data(HOUSE), FLAT, 3, data(-1))).toThrow(
			ASSETS_NEGATIVE
		)
	})

	it.each([
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['-Infinity', Number.NEGATIVE_INFINITY],
		['a string', '5' as unknown as number],
		['null', null as unknown as number],
	])('refuses %s as validateAmount does', (_label, assets) => {
		expect(() => calculateFinancialForecast(data(assets), FLAT, 3)).toThrow(
			'Amount must be a finite number'
		)
	})

	it('refuses a projection whose net worth would overflow with the assets (FORECAST_OUT_OF_RANGE)', () => {
		const huge = {
			...data(Number.MAX_VALUE),
			savings: Number.MAX_VALUE,
			savingsAccounts: undefined,
		} satisfies ForecastInputData
		expect(() => calculateFinancialForecast(huge, FLAT, 1)).toThrow(FORECAST_OUT_OF_RANGE)
	})
})

describe('without assets the output is unchanged', () => {
	it('no `assets` key on any row when none is given', () => {
		const result = calculateFinancialForecast(data(), FLAT, 3)
		for (const row of [...result.baseline, ...result.projection]) {
			expect(row).not.toHaveProperty('assets')
		}
		expect(result.summary.startingNetWorth).toBe(1_000_000)
	})

	it('an explicit `assets: undefined` is the same as absent', () => {
		const absent = calculateFinancialForecast(data(), FLAT, 3)
		const explicit = calculateFinancialForecast({ ...data(), assets: undefined }, FLAT, 3)
		expect(explicit).toEqual(absent)
		for (const row of explicit.projection) expect(row).not.toHaveProperty('assets')
	})
})
