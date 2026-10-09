import { describe, expect, it } from 'vitest'
import { calculateFinancialForecast, type ForecastingScenario } from '../forecasting'

const FLAT = {
	name: 'Scenario',
	incomeGrowthRate: 0,
	expenseGrowthRate: 0,
	oneTimeEvents: [],
} satisfies ForecastingScenario

function data(contribution: number) {
	return {
		income: [{ amount: 600000, frequency: 'monthly' as const }],
		expenses: [{ amount: 300000, frequency: 'monthly' as const }],
		savings: 1000000,
		investments: 5000000,
		savingsAccounts: [{ balance: 1000000, monthlyContribution: 0 }],
		balanceAccounts: [
			{
				type: 'investment' as const,
				balance: 5000000,
				contribution,
				frequency: 'monthly' as const,
				annualReturn: 0.06,
			},
		],
	}
}

describe('calculateFinancialForecast with a separate baseline', () => {
	it('projects the baseline from the baseline data and the projection from the scenario data', () => {
		const result = calculateFinancialForecast(data(300000), FLAT, 10, data(50000))

		expect(result.baseline.at(-1)?.netWorth).toBe(47862714)
		expect(result.projection.at(-1)?.netWorth).toBe(57405101)
		expect(result.summary.endingNetWorth).toBe(57405101)
	})

	it('gives the same baseline as running the baseline data alone', () => {
		const alone = calculateFinancialForecast(data(50000), FLAT, 10)
		const split = calculateFinancialForecast(data(300000), FLAT, 10, data(50000))

		expect(split.baseline).toEqual(alone.baseline)
	})

	it('leaves the projection exactly as it is without a baseline', () => {
		const without = calculateFinancialForecast(data(300000), FLAT, 10)
		const withBaseline = calculateFinancialForecast(data(300000), FLAT, 10, data(50000))

		expect(withBaseline.projection).toEqual(without.projection)
		expect(withBaseline.summary).toEqual(without.summary)
	})

	it('gives the same result as before when the baseline data equals the scenario data', () => {
		const without = calculateFinancialForecast(data(300000), FLAT, 10)
		const same = calculateFinancialForecast(data(300000), FLAT, 10, data(300000))

		expect(same).toEqual(without)
	})

	it('refuses a bad baseline row like a bad scenario row', () => {
		const bad = { ...data(50000), investments: 1 }

		expect(() => calculateFinancialForecast(data(300000), FLAT, 10, bad)).toThrow(
			'Investment balances must add up to the starting investments'
		)
	})
})
