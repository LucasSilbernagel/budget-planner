// Only the investment-compounding block uses non-zero investments, so only it can see
// the 7% growth. Do not zero its fixtures.

import { describe, expect, it } from 'vitest'
import {
	BALANCE_ROW_NEGATIVE,
	BALANCE_ROW_TYPE,
	BALANCE_ROWS_MISMATCH,
	type BalanceAccountInput,
	calculateFinancialForecast,
	DEFAULT_INVESTMENT_RETURN,
	FORECAST_OUT_OF_RANGE,
	type ForecastingScenario,
	INVESTMENT_RETURN_OUT_OF_RANGE,
	SAVINGS_ROW_NEGATIVE,
	SAVINGS_ROWS_MISMATCH,
	type SavingsAccountInput,
} from '../forecasting'

const CURRENT_DATA = {
	income: [{ amount: 500000, frequency: 'monthly' as const }],
	expenses: [{ amount: 400000, frequency: 'monthly' as const }],
	savings: 100000,
	investments: 0,
}

const FLAT: ForecastingScenario = {
	name: 'flat',
	incomeGrowthRate: 0,
	expenseGrowthRate: 0,
}

const YEARS = 3

describe('calculateFinancialForecast — one-time events', () => {
	it('a NEGATIVE one-time event reduces the projection by exactly its amount', () => {
		const cost = -5000000

		const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		const withCost = calculateFinancialForecast(
			CURRENT_DATA,
			{ ...FLAT, oneTimeEvents: [{ year: 2, amount: cost }] },
			YEARS
		)

		expect(withCost.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth + cost)
		expect(withCost.summary.endingNetWorth).toBeLessThan(baseline.summary.endingNetWorth)
	})

	it('a POSITIVE one-time event increases the projection by exactly its amount', () => {
		const windfall = 5000000

		const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		const withWindfall = calculateFinancialForecast(
			CURRENT_DATA,
			{ ...FLAT, oneTimeEvents: [{ year: 2, amount: windfall }] },
			YEARS
		)

		expect(withWindfall.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth + windfall)
	})

	it('lands the event in the year it names, and only that year', () => {
		const cost = -5000000
		const withCost = calculateFinancialForecast(
			CURRENT_DATA,
			{ ...FLAT, oneTimeEvents: [{ year: 2, amount: cost }] },
			YEARS
		)
		const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

		const netIncomeByYear = (r: typeof withCost) => r.projection.map((p) => p.netIncome)
		const base = netIncomeByYear(baseline)
		const shifted = netIncomeByYear(withCost)

		expect(shifted[1]).toBe(base[1] + cost)
		expect(shifted[0]).toBe(base[0])
		expect(shifted[2]).toBe(base[2])
	})

	it('sums several events in the same year, mixed signs included', () => {
		const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		const mixed = calculateFinancialForecast(
			CURRENT_DATA,
			{
				...FLAT,
				oneTimeEvents: [
					{ year: 2, amount: 3000000 },
					{ year: 2, amount: -5000000 },
				],
			},
			YEARS
		)

		expect(mixed.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth - 2000000)
	})

	it('drops an event dated outside the projection window', () => {
		const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		const outOfRange = calculateFinancialForecast(
			CURRENT_DATA,
			{ ...FLAT, oneTimeEvents: [{ year: YEARS + 5, amount: -5000000 }] },
			YEARS
		)

		// An unchanged endingNetWorth alone is weak; the row check below tells "never matched"
		// from "applied".
		expect(outOfRange.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth)
		expect(outOfRange.projection.map((p) => p.netIncome)).toEqual(
			baseline.projection.map((p) => p.netIncome)
		)
	})

	it('lands a FINAL-year event in the reported net worth, not only in netIncome', () => {
		const cost = -5000000
		const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		const lastYear = calculateFinancialForecast(
			CURRENT_DATA,
			{ ...FLAT, oneTimeEvents: [{ year: YEARS, amount: cost }] },
			YEARS
		)

		expect(lastYear.projection[YEARS - 1].netIncome).toBe(
			baseline.projection[YEARS - 1].netIncome + cost
		)
		expect(lastYear.projection[YEARS - 1].netWorth).toBe(
			baseline.projection[YEARS - 1].netWorth + cost
		)
		expect(lastYear.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth + cost)
		expect(lastYear.summary.totalGrowth).toBe(baseline.summary.totalGrowth + cost)
	})

	it('reports CLOSING balances: year 1 already includes year 1 flow', () => {
		const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		const yearOne = r.projection[0]

		expect(yearOne.netWorth).not.toBe(r.summary.startingNetWorth)
		expect(yearOne.savings).toBe(CURRENT_DATA.savings + yearOne.netIncome)

		expect(r.projection[YEARS - 1].savings).toBe(CURRENT_DATA.savings + yearOne.netIncome * YEARS)
	})

	it('baseline uses the same closing-balance convention as the projection', () => {
		const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

		// Both loops must use the same convention, or baseline vs projection compares
		// different instants.
		expect(r.baseline[0].savings).toBe(CURRENT_DATA.savings + r.baseline[0].netIncome)
		expect(r.baseline.map((b) => b.savings)).toEqual(r.projection.map((p) => p.savings))
	})
})

// Absolute-cents tests: relative tests can't see a uniform scale error. Expected values
// are hand-derived; redo them if fixtures change.
describe('calculateFinancialForecast — annual accumulation', () => {
	it('accumulates a full YEAR of surplus per projection year, not one month', () => {
		const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

		// Net 100000/mo × 12 = 1200000 a year; closing 1300000, 2500000, 3700000.
		expect(r.projection[0].savings, '100000 + 1200000').toBe(1_300_000)
		expect(r.projection[1].savings, '1300000 + 1200000').toBe(2_500_000)
		expect(r.projection[2].savings, '2500000 + 1200000').toBe(3_700_000)

		expect(r.projection[0].netIncome, '100000 × 12').toBe(1_200_000)

		expect(r.projection[0].savings).not.toBe(200_000)
	})

	it('reports the summary in the same annual units', () => {
		const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

		// Growth (3700000 − 100000) / 3 years = 1200000, one year's flow.
		expect(r.summary.startingNetWorth, 'savings 100000 + investments 0').toBe(100_000)
		expect(r.summary.endingNetWorth, 'final row netWorth').toBe(3_700_000)
		expect(r.summary.totalGrowth, '3700000 − 100000').toBe(3_600_000)
		expect(r.summary.averageAnnualGrowth, '3600000 / 3').toBe(1_200_000)
	})

	it('annualizes a weekly item EXACTLY (amount × 52), not through a rounded monthly figure', () => {
		const weekly = calculateFinancialForecast(
			{
				income: [{ amount: 100000, frequency: 'weekly' as const }],
				expenses: [],
				savings: 0,
				investments: 0,
			},
			FLAT,
			1
		)

		// Weekly 100000 × 52 = 5200000. Wrong: round(x × 52/12) × 12 = 5199996; raw x × 12 =
		// 1200000.
		expect(weekly.projection[0].income, '100000 × 52').toBe(5_200_000)
		expect(weekly.projection[0].income).not.toBe(5_199_996)
		expect(weekly.projection[0].netIncome, 'no expenses, so net === gross').toBe(5_200_000)
	})

	it('keeps a row internally consistent: income − expenses === netIncome', () => {
		const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		const row = r.projection[0]

		// 6000000 − 4800000 = 1200000, exact: ×12 is applied after per-item rounding.
		expect(row.income, '500000 × 12').toBe(6_000_000)
		expect(row.expenses, '400000 × 12').toBe(4_800_000)
		expect(row.income - row.expenses, 'must equal the row flow').toBe(row.netIncome)

		expect(row.income).not.toBe(500_000)
	})

	it('offsets a row by exactly its one-time event, leaving the recurring flow annual', () => {
		const cost = -5_000_000
		const withEvent = calculateFinancialForecast(
			CURRENT_DATA,
			{ ...FLAT, oneTimeEvents: [{ year: 2, amount: cost }] },
			YEARS
		)
		const row = withEvent.projection[1]

		// Right: netIncome × 12 + event = −3800000. Wrong: (netIncome + event) × 12 = −58800000;
		// unscaled: netIncome + event = −4900000.
		expect(row.netIncome, '1200000 + (−5000000); over-scaled would be −58800000').toBe(-3_800_000)

		expect(row.income - row.expenses, 'recurring flow only').toBe(1_200_000)
		expect(row.netIncome, 'annual flow + the event, exactly once').toBe(
			row.income - row.expenses + cost
		)
	})

	it('handles empty data without NaN, leaving the opening balance untouched', () => {
		const r = calculateFinancialForecast(
			{ income: [], expenses: [], savings: 250_000, investments: 0 },
			FLAT,
			YEARS
		)

		expect(r.projection[0].netIncome).toBe(0)
		expect(r.projection.map((p) => p.savings)).toEqual([250_000, 250_000, 250_000])
		expect(r.summary.totalGrowth).toBe(0)
		expect(r.summary.averageAnnualGrowth, '0 / 3, not NaN').toBe(0)
		expect(Number.isNaN(r.summary.averageAnnualGrowth)).toBe(false)
	})

	it('annualizes the BASELINE loop too, not only the projection', () => {
		const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

		expect(r.baseline[0].netIncome, '100000 × 12').toBe(1_200_000)
		expect(r.baseline[0].savings, '100000 + 1200000').toBe(1_300_000)
		expect(r.baseline[0].income, '500000 × 12').toBe(6_000_000)

		// Annualizing only one loop would show a 12x phantom gap on a flat forecast.
		expect(r.baseline.map((b) => b.savings)).toEqual(r.projection.map((p) => p.savings))
	})
})

// Non-monthly frequencies on both loops: for a monthly row a raw sum equals the
// normalized total, so only these catch a missing normalization.
describe('calculateFinancialForecast — frequency normalization, both loops', () => {
	const WEEKLY_EXPENSE = {
		income: [],
		expenses: [{ amount: 100000, frequency: 'weekly' as const }],
		savings: 0,
		investments: 0,
	}

	it('normalizes a weekly EXPENSE on the projection row, not just income', () => {
		const r = calculateFinancialForecast(WEEKLY_EXPENSE, FLAT, 1)

		// A raw sum would give 100000 × 12 = 1200000.
		expect(r.projection[0].expenses, '100000 × 52').toBe(5_200_000)
		expect(r.projection[0].netIncome, 'no income, so net === −expenses').toBe(-5_200_000)
	})

	it('normalizes a weekly expense on the BASELINE row too', () => {
		const r = calculateFinancialForecast(WEEKLY_EXPENSE, FLAT, 1)

		// The baseline builds its fields from separate constants, so it needs its own assertion.
		expect(r.baseline[0].expenses, 'same figure via the baseline path').toBe(5_200_000)
		expect(r.baseline[0].netIncome).toBe(-5_200_000)
		expect(r.baseline[0].savings, '0 opening − 5200000').toBe(-5_200_000)
	})

	it('normalizes a weekly INCOME on the baseline row too', () => {
		const r = calculateFinancialForecast(
			{
				income: [{ amount: 100000, frequency: 'weekly' as const }],
				expenses: [],
				savings: 0,
				investments: 0,
			},
			FLAT,
			1
		)

		expect(r.baseline[0].income, '100000 × 52').toBe(5_200_000)
		expect(r.baseline[0].netIncome).toBe(5_200_000)
	})

	// `annually` rows count their full amount. x mod 12 = 1 and 6 would expose a
	// round(x / 12) × 12 round trip in either direction.
	it('counts an annually row in full when r <= 5 (was one cent light)', () => {
		const r = calculateFinancialForecast(
			{
				income: [{ amount: 1_200_013, frequency: 'annually' as const }],
				expenses: [],
				savings: 0,
				investments: 0,
			},
			FLAT,
			1
		)

		expect(r.projection[0].income, '1200013 × 1').toBe(1_200_013)
		expect(r.baseline[0].income, 'same via the baseline').toBe(1_200_013)
	})

	it('counts an annually row in full when r >= 6 (was six cents HEAVY)', () => {
		const r = calculateFinancialForecast(
			{
				income: [{ amount: 1_200_018, frequency: 'annually' as const }],
				expenses: [],
				savings: 0,
				investments: 0,
			},
			FLAT,
			1
		)

		expect(r.projection[0].income, '1200018 × 1').toBe(1_200_018)
		expect(r.baseline[0].income, 'same via the baseline').toBe(1_200_018)
	})

	it('counts an annual 10.00 as 10.00 a year, on both loops (story 111.1 AC 2)', () => {
		const r = calculateFinancialForecast(
			{
				income: [{ amount: 1000, frequency: 'annually' as const }],
				expenses: [{ amount: 1000, frequency: 'annually' as const }],
				savings: 0,
				investments: 0,
			},
			FLAT,
			1
		)
		for (const row of [r.projection[0], r.baseline[0]]) {
			expect(row.income).toBe(1000)
			expect(row.expenses).toBe(1000)
			expect(row.netIncome).toBe(0)
		}
	})

	// Integer oracle over amount × periods; a round-trip error depends on that mod 12, so
	// 0..2399 covers every residue.
	it('year 1 at 0% growth is exactly amount × periods, for every frequency (sweep)', () => {
		const PERIODS = { weekly: 52, biweekly: 26, monthly: 12, annually: 1 } as const
		const misses: string[] = []
		for (const frequency of Object.keys(PERIODS) as (keyof typeof PERIODS)[]) {
			for (let amount = 0; amount < 2400; amount++) {
				const r = calculateFinancialForecast(
					{
						income: [{ amount, frequency }],
						expenses: [{ amount, frequency }],
						savings: 0,
						investments: 0,
					},
					FLAT,
					1
				)
				const want = amount * PERIODS[frequency]
				const p = r.projection[0]
				const b = r.baseline[0]
				if (
					p?.income !== want ||
					p.expenses !== want ||
					b?.income !== want ||
					b.expenses !== want
				) {
					misses.push(`${frequency} ${amount}: ${p?.income}/${b?.income} want ${want}`)
				}
			}
		}
		expect(misses.slice(0, 5)).toEqual([])
		expect(misses).toHaveLength(0)
	})

	// Non-zero growth: at 0% the adjusted and unadjusted arrays are identical.
	it('applies growth to the row fields and still reconciles', () => {
		const r = calculateFinancialForecast(CURRENT_DATA, { ...FLAT, incomeGrowthRate: 0.1 }, 2)

		// Y1: round(500000 × 1.1) × 12 = 6600000; − 4800000 = 1800000.
		expect(r.projection[0].income, 'round(500000 × 1.1) × 12').toBe(6_600_000)
		expect(r.projection[0].expenses, 'ungrown: 400000 × 12').toBe(4_800_000)
		expect(r.projection[0].netIncome, '6600000 − 4800000').toBe(1_800_000)

		// Y2: round(500000 × 1.21) × 12 = 7260000; − 4800000 = 2460000.
		expect(r.projection[1].income, 'round(500000 × 1.21) × 12').toBe(7_260_000)
		expect(r.projection[1].netIncome, '7260000 − 4800000').toBe(2_460_000)

		for (const row of r.projection) {
			expect(row.income - row.expenses).toBe(row.netIncome)
		}

		expect(r.baseline[0].income, 'baseline ignores growth: 500000 × 12').toBe(6_000_000)
	})
})

// Only these fixtures have non-zero investments, so only they see the 7% compounding.
// The baseline grows at 7% too: it means "change nothing", not "stop growing".
describe('calculateFinancialForecast — investment compounding, both loops', () => {
	const INVESTED = { ...CURRENT_DATA, investments: 1_000_000 }

	it('produces two IDENTICAL series for a scenario with no adjustments', () => {
		const r = calculateFinancialForecast(INVESTED, FLAT, YEARS)

		expect(r.baseline).toEqual(r.projection)
	})

	it('grows the BASELINE investments year on year, not just the projection', () => {
		const r = calculateFinancialForecast(INVESTED, FLAT, YEARS)

		// 1000000 × 1.07 per year, rounded: 1070000, 1144900, 1225043.
		expect(
			r.baseline.map((b) => b.investments),
			'iterative 7%, not a flat carry'
		).toEqual([1_070_000, 1_144_900, 1_225_043])

		// Rows report closing balances, so year 1 is already grown.

		// netWorth = savings (100000 + 1200000 × n) + investments.
		expect(
			r.baseline.map((b) => b.netWorth),
			'1300000+1070000, 2500000+1144900, …'
		).toEqual([2_370_000, 3_644_900, 4_925_043])
	})

	it('rounds EVERY year, rather than carrying a fraction and rounding once', () => {
		// 1_000_000 × 1.07 chains are exact in floats and 333_333 can't tell per-year rounding
		// from carry-then-round; 100_007 separates them at year 2.
		const r = calculateFinancialForecast({ ...CURRENT_DATA, investments: 100_007 }, FLAT, YEARS)

		// Rounded each year: 107007, 114497, 122512.
		expect(r.baseline.map((b) => b.investments)).toEqual([107_007, 114_497, 122_512])
		expect(r.projection.map((p) => p.investments)).toEqual([107_007, 114_497, 122_512])

		// A fractional accumulator rounded only on the row gives [107007, 114498, 122513].
		expect(
			r.baseline.map((b) => b.investments),
			'carry-then-round-on-row would give [107007, 114498, 122513]'
		).not.toEqual([107_007, 114_498, 122_513])
	})

	it('keeps the investment series identical under a NON-flat scenario too', () => {
		// No scenario lever touches investments, so the two investment series must agree for
		// every scenario.
		const r = calculateFinancialForecast(
			INVESTED,
			{
				...FLAT,
				incomeGrowthRate: 0.05,
				expenseGrowthRate: 0.03,
				oneTimeEvents: [{ year: 2, amount: -5_000_000 }],
			},
			YEARS
		)

		expect(r.baseline.map((b) => b.investments)).toEqual(r.projection.map((p) => p.investments))
		expect(
			r.baseline.map((b) => b.investments),
			'the same 7% chain as the flat run'
		).toEqual([1_070_000, 1_144_900, 1_225_043])

		expect(r.baseline.map((b) => b.savings)).not.toEqual(r.projection.map((p) => p.savings))
	})
})

// Contributions only move money between the user's own pots, so per-account rows
// split `savings` and never change the totals.
describe('calculateFinancialForecast — savings account rows (100.1)', () => {
	const TWO_ROWS: SavingsAccountInput[] = [
		{ balance: 100000, monthlyContribution: 20000 },
		{ balance: 0, monthlyContribution: 5000 },
	]

	const strip = (r: ReturnType<typeof calculateFinancialForecast>) => ({
		...r,
		projection: r.projection.map(
			({ savingsAccounts: _a, unallocatedSavings: _u, ...rest }) => rest
		),
	})

	it("reports each row's CLOSING balance and the unassigned remainder, by hand", () => {
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, savingsAccounts: TWO_ROWS },
			FLAT,
			YEARS
		)
		// Each row gains contribution × 12; the remaining net income is unassigned.
		expect(r.projection.map((p) => p.savingsAccounts)).toEqual([
			[340000, 60000],
			[580000, 120000],
			[820000, 180000],
		])
		expect(r.projection.map((p) => p.unallocatedSavings)).toEqual([900000, 1800000, 2700000])
	})

	const FIXTURES: Array<{
		label: string
		rows: SavingsAccountInput[]
		scenario: ForecastingScenario
		investments?: number
	}> = [
		{ label: 'one row', rows: [{ balance: 100000, monthlyContribution: 12345 }], scenario: FLAT },
		{
			label: 'three rows',
			rows: [
				{ balance: 30000, monthlyContribution: 1 },
				{ balance: 30000, monthlyContribution: 33333 },
				{ balance: 40000, monthlyContribution: 0 },
			],
			scenario: FLAT,
		},
		{
			label: 'contributions bigger than the surplus',
			rows: [{ balance: 100000, monthlyContribution: 500000 }],
			scenario: FLAT,
		},
		{
			label: 'a one-time event year, growth rates and investments',
			rows: TWO_ROWS,
			scenario: {
				name: 'busy',
				incomeGrowthRate: 0.05,
				expenseGrowthRate: 0.03,
				oneTimeEvents: [
					{ year: 2, amount: -5_000_000 },
					{ year: 3, amount: 777_777 },
				],
			},
			investments: 1_000_007,
		},
	]

	for (const { label, rows, scenario, investments } of FIXTURES) {
		it(`rows + unassigned === savings in every year (${label})`, () => {
			const data = { ...CURRENT_DATA, investments: investments ?? 0 }
			const r = calculateFinancialForecast({ ...data, savingsAccounts: rows }, scenario, 10)
			for (const p of r.projection) {
				const rowSum = (p.savingsAccounts ?? []).reduce((sum, b) => sum + b, 0)
				expect(rowSum + (p.unallocatedSavings ?? Number.NaN), `year ${p.year}`).toBe(p.savings)
			}
		})

		it(`changes no total, no baseline and no summary (${label})`, () => {
			const data = { ...CURRENT_DATA, investments: investments ?? 0 }
			const withRows = calculateFinancialForecast({ ...data, savingsAccounts: rows }, scenario, 10)
			const without = calculateFinancialForecast(data, scenario, 10)
			expect(strip(withRows)).toEqual(without)
			expect(withRows.projection[0]?.savingsAccounts).toHaveLength(rows.length)
		})
	}

	it('applies contributions in full when they exceed what is left over: unassigned goes negative', () => {
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, savingsAccounts: [{ balance: 100000, monthlyContribution: 150000 }] },
			FLAT,
			1
		)
		// 1,500.00 × 12 contributed against 1,000.00 × 12 of net income.
		expect(r.projection[0]?.savingsAccounts).toEqual([1_900_000])
		expect(r.projection[0]?.unallocatedSavings).toBe(-600_000)
		expect(r.projection[0]?.savings).toBe(1_300_000)
	})

	it('leaves the baseline rows without the new fields (rows model the projection only, D6)', () => {
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, savingsAccounts: TWO_ROWS },
			FLAT,
			YEARS
		)
		for (const b of r.baseline) {
			expect(Object.keys(b)).not.toContain('savingsAccounts')
			expect(Object.keys(b)).not.toContain('unallocatedSavings')
		}
	})

	it('adds no new key when no rows are given', () => {
		const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		for (const p of r.projection) {
			expect(Object.keys(p)).not.toContain('savingsAccounts')
			expect(Object.keys(p)).not.toContain('unallocatedSavings')
		}
	})

	it('accepts an empty row list when the starting savings are 0: everything is unassigned', () => {
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, savings: 0, savingsAccounts: [] },
			FLAT,
			1
		)
		expect(r.projection[0]?.savingsAccounts).toEqual([])
		expect(r.projection[0]?.unallocatedSavings).toBe(r.projection[0]?.savings)
	})

	it('refuses rows whose balances do not add up to the starting savings', () => {
		expect(() =>
			calculateFinancialForecast(
				{ ...CURRENT_DATA, savings: 100001, savingsAccounts: TWO_ROWS },
				FLAT,
				YEARS
			)
		).toThrow(SAVINGS_ROWS_MISMATCH)
		expect(() =>
			calculateFinancialForecast({ ...CURRENT_DATA, savingsAccounts: [] }, FLAT, YEARS)
		).toThrow(SAVINGS_ROWS_MISMATCH)
	})

	it('refuses a negative balance or contribution', () => {
		expect(() =>
			calculateFinancialForecast(
				{
					...CURRENT_DATA,
					savingsAccounts: [
						{ balance: 200000, monthlyContribution: 0 },
						{ balance: -100000, monthlyContribution: 0 },
					],
				},
				FLAT,
				YEARS
			)
		).toThrow(SAVINGS_ROW_NEGATIVE)
		expect(() =>
			calculateFinancialForecast(
				{ ...CURRENT_DATA, savingsAccounts: [{ balance: 100000, monthlyContribution: -1 }] },
				FLAT,
				YEARS
			)
		).toThrow(SAVINGS_ROW_NEGATIVE)
	})

	it("refuses a non-finite balance or contribution with validateAmount's message", () => {
		for (const bad of [
			{ balance: Number.NaN, monthlyContribution: 0 },
			{ balance: 100000, monthlyContribution: Number.POSITIVE_INFINITY },
			{ balance: 100000, monthlyContribution: null as unknown as number },
		]) {
			expect(() =>
				calculateFinancialForecast({ ...CURRENT_DATA, savingsAccounts: [bad] }, FLAT, YEARS)
			).toThrow('Amount must be a finite number')
		}
	})
})

// Investment: round(prev × (1 + rate)) + annual contribution. Debt: max(0, prev − annual
// payment). A contribution flagged as already an expense leaves savings alone.
describe('calculateFinancialForecast — investment and debt rows (100.2)', () => {
	// Net 12,000.00/yr. Counted investment 1,200.00/yr; flagged one 50.00/week = 260000/yr;
	// debt 5,000.00 paying 2,400.00/yr.
	const MIXED: BalanceAccountInput[] = [
		{
			type: 'investment',
			annualReturn: 0.07,
			balance: 1_000_000,
			contribution: 10_000,
			frequency: 'monthly',
		},
		{
			type: 'investment',
			annualReturn: 0.07,
			balance: 100_007,
			contribution: 5_000,
			frequency: 'weekly',
			contributionRecordedAsExpense: true,
		},
		{
			type: 'debt',
			balance: 500_000,
			contribution: 20_000,
			frequency: 'monthly',
			contributionRecordedAsExpense: true,
		},
	]
	const MIXED_DATA = { ...CURRENT_DATA, investments: 1_100_007, balanceAccounts: MIXED }

	it('grows, pays down and moves money between buckets, by hand', () => {
		const r = calculateFinancialForecast(MIXED_DATA, FLAT, YEARS)

		// Counted: 1190000, 1393300, 1610831. Flagged: round(100007 × 1.07) + 260000 = 367007,
		// then 652697, 958386. Debt: 260000, 20000, 0.
		expect(r.projection.map((p) => p.balanceAccounts)).toEqual([
			[1_190_000, 367_007, 260_000],
			[1_393_300, 652_697, 20_000],
			[1_610_831, 958_386, 0],
		])
		expect(r.projection.map((p) => p.investments)).toEqual([1_557_007, 2_045_997, 2_569_217])
		expect(r.projection.map((p) => p.debts)).toEqual([260_000, 20_000, 0])
		// Savings: +1,200,000 net − 120,000 counted contribution a year; flagged ones take nothing.
		expect(r.projection.map((p) => p.savings)).toEqual([1_180_000, 2_260_000, 3_340_000])
		expect(r.projection.map((p) => p.netWorth)).toEqual([2_477_007, 4_285_997, 5_909_217])
		// Starting: 100000 + 1100007 − 500000.
		expect(r.summary.startingNetWorth).toBe(700_007)
		expect(r.summary.endingNetWorth).toBe(5_909_217)
	})

	it('models the rows in the baseline too, so a flat scenario keeps baseline === projection (D5, 67.1)', () => {
		const r = calculateFinancialForecast(MIXED_DATA, FLAT, YEARS)
		expect(r.baseline).toEqual(r.projection)
		expect(r.baseline.map((b) => b.debts)).toEqual([260_000, 20_000, 0])
	})

	it('annualises an annual contribution exactly (story 111.1)', () => {
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				investments: 0,
				balanceAccounts: [
					{
						type: 'investment',
						annualReturn: 0.07,
						balance: 0,
						contribution: 1_200_013,
						frequency: 'annually',
					},
				],
			},
			FLAT,
			1
		)
		expect(r.projection[0]?.investments).toBe(1_200_013)
		// Counted, so savings loses it: 100000 + 1200000 − 1200013.
		expect(r.projection[0]?.savings).toBe(99_987)
	})

	it('degrades an unrecognised frequency to monthly, as the chokepoint does', () => {
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				investments: 0,
				balanceAccounts: [
					{
						type: 'investment',
						annualReturn: 0.07,
						balance: 0,
						contribution: 10_000,
						frequency: 'quarterly' as never,
					},
				],
			},
			FLAT,
			1
		)
		expect(r.projection[0]?.investments).toBe(120_000)
	})

	it('one investment row with no contribution compounds exactly like the old single total', () => {
		const withRow = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				investments: 100_007,
				balanceAccounts: [
					{
						type: 'investment',
						annualReturn: 0.07,
						balance: 100_007,
						contribution: 0,
						frequency: 'monthly',
					},
				],
			},
			FLAT,
			YEARS
		)
		const without = calculateFinancialForecast(
			{ ...CURRENT_DATA, investments: 100_007 },
			FLAT,
			YEARS
		)
		// Rounded per year: 107007, 114497, 122512.
		expect(withRow.projection.map((p) => p.investments)).toEqual([107_007, 114_497, 122_512])
		expect(withRow.projection.map((p) => p.investments)).toEqual(
			without.projection.map((p) => p.investments)
		)
		expect(withRow.projection.map((p) => p.netWorth)).toEqual(
			without.projection.map((p) => p.netWorth)
		)
		expect(withRow.summary).toEqual(without.summary)
	})

	it('rounds each investment row on its own, which can differ from one total by a cent (D7, recorded)', () => {
		// Row A: 53503, 57248, 61255; row B: 53504, 57249, 61256. The sum 122511 is one cent
		// below the single-total 122512 in year 3.
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				investments: 100_007,
				balanceAccounts: [
					{
						type: 'investment',
						annualReturn: 0.07,
						balance: 50_003,
						contribution: 0,
						frequency: 'monthly',
					},
					{
						type: 'investment',
						annualReturn: 0.07,
						balance: 50_004,
						contribution: 0,
						frequency: 'monthly',
					},
				],
			},
			FLAT,
			YEARS
		)
		expect(r.projection.map((p) => p.investments)).toEqual([107_007, 114_497, 122_511])
	})

	it('flag parity: a flagged contribution plus its expense row ends where an unflagged one does', () => {
		const row = (flag: boolean): BalanceAccountInput => ({
			type: 'investment',
			annualReturn: 0.07,
			balance: 200_000,
			contribution: 30_000,
			frequency: 'monthly',
			contributionRecordedAsExpense: flag,
		})
		const counted = calculateFinancialForecast(
			{ ...CURRENT_DATA, investments: 200_000, balanceAccounts: [row(false)] },
			FLAT,
			10
		)
		const flaggedWithExpense = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				expenses: [...CURRENT_DATA.expenses, { amount: 30_000, frequency: 'monthly' as const }],
				investments: 200_000,
				balanceAccounts: [row(true)],
			},
			FLAT,
			10
		)
		expect(flaggedWithExpense.summary.endingNetWorth).toBe(counted.summary.endingNetWorth)
		expect(flaggedWithExpense.projection.map((p) => p.investments)).toEqual(
			counted.projection.map((p) => p.investments)
		)
		// Year 1 savings: counted 100000 + 1200000 − 360000 = 940000; flagged 1300000.
		const flaggedNoExpense = calculateFinancialForecast(
			{ ...CURRENT_DATA, investments: 200_000, balanceAccounts: [row(true)] },
			FLAT,
			1
		)
		expect(flaggedNoExpense.projection[0]?.savings).toBe(1_300_000)
		expect(counted.projection[0]?.savings).toBe(940_000)
	})

	it('a debt with no payment stays put and lowers net worth by exactly its balance', () => {
		const withDebt = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				balanceAccounts: [
					{ type: 'debt', balance: 750_000, contribution: 0, frequency: 'monthly' },
				],
			},
			FLAT,
			YEARS
		)
		const without = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		expect(withDebt.projection.map((p) => p.debts)).toEqual([750_000, 750_000, 750_000])
		withDebt.projection.forEach((p, i) => {
			expect(p.netWorth).toBe((without.projection[i]?.netWorth ?? Number.NaN) - 750_000)
		})
		expect(withDebt.summary.startingNetWorth).toBe(without.summary.startingNetWorth - 750_000)
	})

	it('a FLAGGED payment bigger than the debt pays it off and stops at 0; it never touches savings (D4, kept by 102.2 for flagged rows)', () => {
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				balanceAccounts: [
					{
						type: 'debt',
						balance: 100_000,
						contribution: 50_000,
						frequency: 'monthly',
						contributionRecordedAsExpense: true,
					},
				],
			},
			FLAT,
			YEARS
		)
		// 100000 − 600000 → 0, and it stays there.
		expect(r.projection.map((p) => p.debts)).toEqual([0, 0, 0])
		expect(r.projection.map((p) => p.balanceAccounts)).toEqual([[0], [0], [0]])
		const without = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		expect(r.projection.map((p) => p.savings)).toEqual(without.projection.map((p) => p.savings))
	})

	it('keeps the 100.1 invariant with counted, flagged and debt rows: rows + unassigned === savings', () => {
		const r = calculateFinancialForecast(
			{
				...MIXED_DATA,
				savingsAccounts: [
					{ balance: 60_000, monthlyContribution: 20_000 },
					{ balance: 40_000, monthlyContribution: 0 },
				],
			},
			FLAT,
			10
		)
		for (const p of r.projection) {
			const rowSum = (p.savingsAccounts ?? []).reduce((sum, b) => sum + b, 0)
			expect(rowSum + (p.unallocatedSavings ?? Number.NaN), `year ${p.year}`).toBe(p.savings)
		}
		// Y1: 1,200,000 net − 240,000 to savings rows − 120,000 counted = 840,000 unassigned.
		expect(r.projection[0]?.unallocatedSavings).toBe(840_000)
	})

	it('adds no new key when no balance rows are given', () => {
		const r = calculateFinancialForecast({ ...CURRENT_DATA, investments: 100_007 }, FLAT, YEARS)
		for (const row of [...r.baseline, ...r.projection]) {
			expect(Object.keys(row)).not.toContain('debts')
			expect(Object.keys(row)).not.toContain('balanceAccounts')
		}
	})

	it('accepts an empty row list when the starting investments are 0', () => {
		const r = calculateFinancialForecast({ ...CURRENT_DATA, balanceAccounts: [] }, FLAT, 1)
		expect(r.projection[0]?.balanceAccounts).toEqual([])
		expect(r.projection[0]?.debts).toBe(0)
		expect(r.projection[0]?.netWorth).toBe(1_300_000)
	})

	it('refuses investment rows that do not add up to the starting investments', () => {
		expect(() =>
			calculateFinancialForecast({ ...MIXED_DATA, investments: 1_100_008 }, FLAT, YEARS)
		).toThrow(BALANCE_ROWS_MISMATCH)
		expect(() =>
			calculateFinancialForecast(
				{
					...CURRENT_DATA,
					investments: 500_000,
					balanceAccounts: [
						{ type: 'debt', balance: 500_000, contribution: 0, frequency: 'monthly' },
					],
				},
				FLAT,
				YEARS
			)
		).toThrow(BALANCE_ROWS_MISMATCH)
	})

	it('refuses a negative balance or contribution', () => {
		const bad: BalanceAccountInput[] = [
			{
				type: 'investment',
				annualReturn: 0.07,
				balance: -1,
				contribution: 0,
				frequency: 'monthly',
			},
			{ type: 'debt', balance: -1, contribution: 0, frequency: 'monthly' },
			{ type: 'debt', balance: 0, contribution: -1, frequency: 'monthly' },
		]
		for (const row of bad) {
			const investments = row.type === 'investment' ? row.balance : 0
			expect(() =>
				calculateFinancialForecast(
					{ ...CURRENT_DATA, investments, balanceAccounts: [row] },
					FLAT,
					YEARS
				)
			).toThrow(BALANCE_ROW_NEGATIVE)
		}
	})

	it("refuses a non-finite balance or contribution with validateAmount's message", () => {
		const bad: BalanceAccountInput[] = [
			{ type: 'debt', balance: Number.NaN, contribution: 0, frequency: 'monthly' },
			{ type: 'debt', balance: 0, contribution: Number.POSITIVE_INFINITY, frequency: 'monthly' },
			{ type: 'debt', balance: 0, contribution: null as never, frequency: 'monthly' },
		]
		for (const row of bad) {
			expect(() =>
				calculateFinancialForecast({ ...CURRENT_DATA, balanceAccounts: [row] }, FLAT, YEARS)
			).toThrow('Amount must be a finite number')
		}
	})

	it('refuses a row that is neither an investment nor a debt', () => {
		expect(() =>
			calculateFinancialForecast(
				{
					...CURRENT_DATA,
					balanceAccounts: [
						{ type: 'asset' as never, balance: 0, contribution: 0, frequency: 'monthly' },
					],
				},
				FLAT,
				YEARS
			)
		).toThrow(BALANCE_ROW_TYPE)
	})

	it('refuses a debt total that overflows, rather than projecting Infinity', () => {
		expect(() =>
			calculateFinancialForecast(
				{
					...CURRENT_DATA,
					balanceAccounts: [
						{ type: 'debt', balance: 1.7e308, contribution: 0, frequency: 'monthly' },
						{ type: 'debt', balance: 1.7e308, contribution: 0, frequency: 'monthly' },
					],
				},
				FLAT,
				YEARS
			)
		).toThrow(FORECAST_OUT_OF_RANGE)
	})

	it('refuses a debt payment that normalises to Infinity, rather than flooring the debt to 0 (code review)', () => {
		// 1e308 weekly × 52 overflows; unguarded, the debt silently reads 0.
		expect(() =>
			calculateFinancialForecast(
				{
					...CURRENT_DATA,
					balanceAccounts: [
						{ type: 'debt', balance: 100_000, contribution: 1e308, frequency: 'weekly' },
					],
				},
				FLAT,
				YEARS
			)
		).toThrow(FORECAST_OUT_OF_RANGE)
	})

	// An annual figure that overflows must be refused on the baseline too.
	it('refuses an income or expense whose annual figure overflows, on the baseline too (111.1)', () => {
		const huge = (field: 'income' | 'expenses') => ({
			...CURRENT_DATA,
			[field]: [{ amount: 1e307, frequency: 'weekly' as const }],
		})
		for (const field of ['income', 'expenses'] as const) {
			expect(() => calculateFinancialForecast(huge(field), FLAT, YEARS)).toThrow(
				FORECAST_OUT_OF_RANGE
			)
			expect(() => calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS, huge(field))).toThrow(
				FORECAST_OUT_OF_RANGE
			)
		}
	})
})

// An unflagged debt pays min(annual payment, balance) a year, added to `expenses` and
// taken from `netIncome` in both loops.
describe('calculateFinancialForecast — a debt payment stops at payoff (102.2)', () => {
	const debt = (
		balance: number,
		contribution: number,
		over: Partial<BalanceAccountInput> = {}
	): BalanceAccountInput => ({
		type: 'debt',
		balance,
		contribution,
		frequency: 'monthly',
		...over,
	})

	it('pays the full payment while owed, only the remainder in the payoff year, nothing after, by hand', () => {
		// 2,400.00/yr: owed 2,600.00 then 200.00; Y3 pays the 200.00 rest, Y4 nothing.
		// Savings 10,600.00, 20,200.00, 32,000.00, 44,000.00.
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, balanceAccounts: [debt(500_000, 20_000)] },
			FLAT,
			4
		)
		expect(r.projection.map((p) => p.debts)).toEqual([260_000, 20_000, 0, 0])
		expect(r.projection.map((p) => p.expenses)).toEqual([
			5_040_000, 5_040_000, 4_820_000, 4_800_000,
		])
		expect(r.projection.map((p) => p.netIncome)).toEqual([960_000, 960_000, 1_180_000, 1_200_000])
		expect(r.projection.map((p) => p.savings)).toEqual([1_060_000, 2_020_000, 3_200_000, 4_400_000])
		expect(r.projection.map((p) => p.netWorth)).toEqual([800_000, 2_000_000, 3_200_000, 4_400_000])
		expect(r.summary.startingNetWorth).toBe(-400_000)
		expect(r.projection.map((p) => p.income)).toEqual([6_000_000, 6_000_000, 6_000_000, 6_000_000])
	})

	it('deducts in the baseline too, so a flat scenario keeps baseline === projection (D5, 67.1)', () => {
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, balanceAccounts: [debt(500_000, 20_000)] },
			FLAT,
			4
		)
		expect(r.baseline).toEqual(r.projection)
		expect(r.baseline.map((b) => b.netIncome)).toEqual([960_000, 960_000, 1_180_000, 1_200_000])
	})

	it('a payment of 0 leaves the debt constant and deducts nothing', () => {
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, balanceAccounts: [debt(750_000, 0)] },
			FLAT,
			YEARS
		)
		const without = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
		expect(r.projection.map((p) => p.debts)).toEqual([750_000, 750_000, 750_000])
		expect(r.projection.map((p) => p.savings)).toEqual(without.projection.map((p) => p.savings))
		expect(r.projection.map((p) => p.expenses)).toEqual(without.projection.map((p) => p.expenses))
	})

	it('a payment bigger than the debt pays only the debt in year 1, then nothing', () => {
		// 1,000.00 owed, 500.00/mo = 6,000.00 a year: Y1 pays 1,000.00 only.
		// Y1 net 11,000.00, savings 12,000.00; Y2 net 12,000.00, savings 24,000.00.
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, balanceAccounts: [debt(100_000, 50_000)] },
			FLAT,
			2
		)
		expect(r.projection.map((p) => p.netIncome)).toEqual([1_100_000, 1_200_000])
		expect(r.projection.map((p) => p.savings)).toEqual([1_200_000, 2_400_000])
		expect(r.projection.map((p) => p.debts)).toEqual([0, 0])
	})

	it('annualises a weekly payment exactly before deducting it (story 111.1)', () => {
		// 50.00/week: 5000 × 52 = 260,000 a year. Net 1,200,000 − 260,000 = 940,000.
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, balanceAccounts: [debt(1_000_000, 5_000, { frequency: 'weekly' })] },
			FLAT,
			1
		)
		expect(r.projection[0]?.netIncome).toBe(940_000)
		expect(r.projection[0]?.debts).toBe(740_000)
	})

	it('does not grow the payment with the expense growth rate (D4: a fixed instalment)', () => {
		// Expenses grow 10%: Y1 440000/mo → 5,280,000/yr; Y2 484000/mo → 5,808,000. The
		// payment stays flat.
		const r = calculateFinancialForecast(
			{ ...CURRENT_DATA, balanceAccounts: [debt(1_000_000, 20_000)] },
			{ ...FLAT, expenseGrowthRate: 0.1 },
			2
		)
		expect(r.projection.map((p) => p.expenses)).toEqual([5_520_000, 6_048_000])
		// 6,000,000 − 5,520,000 = 480,000; 6,000,000 − 6,048,000 = −48,000.
		expect(r.projection.map((p) => p.netIncome)).toEqual([480_000, -48_000])
	})

	it('counts only the unflagged debts; a corrupt flag counts as unflagged (strict === true)', () => {
		// Flagged takes nothing; unflagged takes 1,200.00; the string 'true' is not `true`, so
		// 600.00 is taken too. Net 10,200.00.
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				balanceAccounts: [
					debt(1_000_000, 20_000, { contributionRecordedAsExpense: true }),
					debt(1_000_000, 10_000),
					debt(1_000_000, 5_000, { contributionRecordedAsExpense: 'true' as never }),
				],
			},
			FLAT,
			1
		)
		expect(r.projection[0]?.netIncome).toBe(1_020_000)
		expect(r.projection[0]?.balanceAccounts).toEqual([760_000, 880_000, 940_000])
	})

	it('keeps the 100.1 invariant with an unflagged debt: rows + unassigned === savings', () => {
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				balanceAccounts: [debt(500_000, 20_000)],
				savingsAccounts: [
					{ balance: 60_000, monthlyContribution: 20_000 },
					{ balance: 40_000, monthlyContribution: 0 },
				],
			},
			FLAT,
			5
		)
		for (const p of r.projection) {
			const rowSum = (p.savingsAccounts ?? []).reduce((sum, b) => sum + b, 0)
			expect(rowSum + (p.unallocatedSavings ?? Number.NaN), `year ${p.year}`).toBe(p.savings)
		}
		// Y1: 1,200,000 − 240,000 paid − 240,000 to the savings rows = 720,000.
		// Y3 (payoff, 20,000 paid): 720,000 + 720,000 + (1,200,000 − 20,000 − 240,000).
		expect(r.projection.map((p) => p.unallocatedSavings)).toEqual([
			720_000, 1_440_000, 2_380_000, 3_340_000, 4_300_000,
		])
	})

	it('keeps the 100.1 invariant with a counted investment, a flagged debt and an unflagged debt together (T6 mix)', () => {
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				investments: 1_000_000,
				balanceAccounts: [
					{
						type: 'investment',
						annualReturn: 0.07,
						balance: 1_000_000,
						contribution: 10_000,
						frequency: 'monthly',
					},
					debt(1_000_000, 20_000, { contributionRecordedAsExpense: true }),
					debt(500_000, 20_000),
				],
				savingsAccounts: [
					{ balance: 60_000, monthlyContribution: 20_000 },
					{ balance: 40_000, monthlyContribution: 0 },
				],
			},
			FLAT,
			4
		)
		for (const p of r.projection) {
			const rowSum = (p.savingsAccounts ?? []).reduce((sum, b) => sum + b, 0)
			expect(rowSum + (p.unallocatedSavings ?? Number.NaN), `year ${p.year}`).toBe(p.savings)
		}
		// Unassigned = 1,200,000 − unflagged debt paid − 240,000 to savings − 120,000 counted:
		// Y1 600,000; Y2 600,000; Y3 820,000; Y4 840,000.
		expect(r.projection.map((p) => p.unallocatedSavings)).toEqual([
			600_000, 1_200_000, 2_020_000, 2_860_000,
		])
		expect(r.projection.map((p) => p.balanceAccounts?.slice(1))).toEqual([
			[760_000, 260_000],
			[520_000, 20_000],
			[280_000, 0],
			[40_000, 0],
		])
	})

	it('a moved payment ends where the old expense line did until payoff, then savings rise by the payment every year (AC-5)', () => {
		// (a) payment as an Expenses line with a flagged debt; (b) no expense line, unflagged debt.
		const before = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				expenses: [...CURRENT_DATA.expenses, { amount: 20_000, frequency: 'monthly' as const }],
				balanceAccounts: [debt(500_000, 20_000, { contributionRecordedAsExpense: true })],
			},
			FLAT,
			5
		)
		const after = calculateFinancialForecast(
			{ ...CURRENT_DATA, balanceAccounts: [debt(500_000, 20_000)] },
			FLAT,
			5
		)
		expect(after.projection.map((p) => p.debts)).toEqual(before.projection.map((p) => p.debts))
		for (const i of [0, 1]) {
			expect(after.projection[i]?.netIncome).toBe(before.projection[i]?.netIncome)
			expect(after.projection[i]?.expenses).toBe(before.projection[i]?.expenses)
			expect(after.projection[i]?.savings).toBe(before.projection[i]?.savings)
		}
		// Payoff year 3: only the 200.00 remainder was paid, so 2,200.00 more is kept.
		const diff = (i: number) =>
			(after.projection[i]?.savings ?? Number.NaN) - (before.projection[i]?.savings ?? Number.NaN)
		expect(diff(2)).toBe(220_000)
		// Later years keep the whole payment: net income higher by P, savings gap widening by P.
		for (const i of [3, 4]) {
			expect(
				(after.projection[i]?.netIncome ?? Number.NaN) -
					(before.projection[i]?.netIncome ?? Number.NaN)
			).toBe(240_000)
			expect(diff(i) - diff(i - 1)).toBe(240_000)
		}
	})
})

describe('calculateFinancialForecast — per-investment annual return (100.3)', () => {
	function oneRow(balance: number, annualReturn: unknown, contribution = 0) {
		return {
			...CURRENT_DATA,
			investments: balance,
			balanceAccounts: [
				{
					type: 'investment' as const,
					balance,
					contribution,
					frequency: 'monthly' as const,
					annualReturn: annualReturn as number,
				},
			],
		}
	}

	it('the default for a new investment row is 6% (D2)', () => {
		expect(DEFAULT_INVESTMENT_RETURN).toBe(0.06)
	})

	// At 0.07 every row reproduces the figures pinned above, copied, not recomputed.
	it('at 7% the 100.2 fixtures give the 100.2 figures exactly (parity)', () => {
		const PINNED_100_2 = {
			balanceAccounts: [
				[1_190_000, 367_007, 260_000],
				[1_393_300, 652_697, 20_000],
				[1_610_831, 958_386, 0],
			],
			investments: [1_557_007, 2_045_997, 2_569_217],
			savings: [1_180_000, 2_260_000, 3_340_000],
			netWorth: [2_477_007, 4_285_997, 5_909_217],
			startingNetWorth: 700_007,
			endingNetWorth: 5_909_217,
		}
		const mixed = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				investments: 1_100_007,
				balanceAccounts: [
					{
						type: 'investment',
						balance: 1_000_000,
						contribution: 10_000,
						frequency: 'monthly',
						annualReturn: 0.07,
					},
					{
						type: 'investment',
						balance: 100_007,
						contribution: 5_000,
						frequency: 'weekly',
						contributionRecordedAsExpense: true,
						annualReturn: 0.07,
					},
					{
						type: 'debt',
						balance: 500_000,
						contribution: 20_000,
						frequency: 'monthly',
						contributionRecordedAsExpense: true,
					},
				],
			},
			FLAT,
			YEARS
		)
		for (const series of [mixed.projection, mixed.baseline]) {
			expect(series.map((p) => p.balanceAccounts)).toEqual(PINNED_100_2.balanceAccounts)
			expect(series.map((p) => p.investments)).toEqual(PINNED_100_2.investments)
			expect(series.map((p) => p.savings)).toEqual(PINNED_100_2.savings)
			expect(series.map((p) => p.netWorth)).toEqual(PINNED_100_2.netWorth)
		}
		expect(mixed.summary.startingNetWorth).toBe(PINNED_100_2.startingNetWorth)
		expect(mixed.summary.endingNetWorth).toBe(PINNED_100_2.endingNetWorth)

		// Per-row rounding chain: 107007, 114497, 122511.
		const split = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				investments: 100_007,
				balanceAccounts: [
					{
						type: 'investment',
						balance: 50_003,
						contribution: 0,
						frequency: 'monthly',
						annualReturn: 0.07,
					},
					{
						type: 'investment',
						balance: 50_004,
						contribution: 0,
						frequency: 'monthly',
						annualReturn: 0.07,
					},
				],
			},
			FLAT,
			YEARS
		)
		expect(split.projection.map((p) => p.investments)).toEqual([107_007, 114_497, 122_511])
	})

	it('compounds a row at 6% on BOTH series, by hand', () => {
		// 1000000 at 6%: 1060000, 1123600, 1191016 (all exact).
		const r = calculateFinancialForecast(oneRow(1_000_000, 0.06), FLAT, YEARS)
		expect(r.projection.map((p) => p.investments)).toEqual([1_060_000, 1_123_600, 1_191_016])
		expect(r.baseline.map((b) => b.investments)).toEqual([1_060_000, 1_123_600, 1_191_016])
	})

	it('rounds every year at 6% (the 67.1 rounding probe, at the new rate)', () => {
		// 100007 at 6%: 106007, 112367, 119109.
		const r = calculateFinancialForecast(oneRow(100_007, 0.06), FLAT, YEARS)
		expect(r.projection.map((p) => p.investments)).toEqual([106_007, 112_367, 119_109])
	})

	// 100000 cents: −25% → 75000, 56250, 42187.5 → 42188. 5.5% → 105500, 111302.5 →
	// 111303, 117424.665 → 117425.
	it.each([
		[0, [100_000, 100_000, 100_000]],
		[-0.25, [75_000, 56_250, 42_188]],
		[0.055, [105_500, 111_303, 117_425]],
	])('compounds a row at %s on BOTH series, by hand', (rate, expected) => {
		const r = calculateFinancialForecast(oneRow(100_000, rate), FLAT, YEARS)
		expect(r.projection.map((p) => p.investments)).toEqual(expected)
		expect(r.baseline.map((b) => b.investments)).toEqual(expected)
	})

	it('two rows at different rates each compound at their own rate', () => {
		// A 500000 at 2%: 510000, 520200, 530604. B 300000 at 10%: 330000, 363000, 399300
		// (floats give 363000.00000000006).
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				investments: 800_000,
				balanceAccounts: [
					{
						type: 'investment',
						balance: 500_000,
						contribution: 0,
						frequency: 'monthly',
						annualReturn: 0.02,
					},
					{
						type: 'investment',
						balance: 300_000,
						contribution: 0,
						frequency: 'monthly',
						annualReturn: 0.1,
					},
				],
			},
			FLAT,
			YEARS
		)
		expect(r.projection.map((p) => p.balanceAccounts)).toEqual([
			[510_000, 330_000],
			[520_200, 363_000],
			[530_604, 399_300],
		])
		expect(r.projection.map((p) => p.investments)).toEqual([840_000, 883_200, 929_904])
	})

	it('accepts −100% (the row drops to 0, then gains only its contributions) and +100% (doubles)', () => {
		// −100%: round(100000 × 0) + 120000 = 120000; round(120000 × 0) + 120000 = 120000.
		const lost = calculateFinancialForecast(oneRow(100_000, -1, 10_000), FLAT, 2)
		expect(lost.projection.map((p) => p.investments)).toEqual([120_000, 120_000])
		// +100%: 100000 × 2 + 120000 = 320000, then 760000. Growth comes before the
		// contribution: (100000 + 120000) × 2 would be 440000.
		const doubled = calculateFinancialForecast(oneRow(100_000, 1, 10_000), FLAT, 2)
		expect(doubled.projection.map((p) => p.investments)).toEqual([320_000, 760_000])
	})

	it('refuses a rate outside −100%..100%, not a finite number, or missing (D4)', () => {
		expect(INVESTMENT_RETURN_OUT_OF_RANGE).toBe('Investment returns must be from -100% to 100%')
		const bad: unknown[] = [
			-1.0001,
			1.0001,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			undefined,
			null,
			'0.06',
		]
		for (const rate of bad) {
			expect(
				() => calculateFinancialForecast(oneRow(100_000, rate), FLAT, YEARS),
				String(rate)
			).toThrow(INVESTMENT_RETURN_OUT_OF_RANGE)
		}
		expect(() =>
			calculateFinancialForecast(
				{
					...CURRENT_DATA,
					investments: 100_000,
					balanceAccounts: [
						{ type: 'investment', balance: 100_000, contribution: 0, frequency: 'monthly' },
					],
				},
				FLAT,
				YEARS
			)
		).toThrow(INVESTMENT_RETURN_OUT_OF_RANGE)
	})

	it('ignores the rate on a debt row: NaN there does not throw, and the debt pays down as before', () => {
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				balanceAccounts: [
					{
						type: 'debt',
						balance: 500_000,
						contribution: 20_000,
						frequency: 'monthly',
						annualReturn: Number.NaN,
					},
				],
			},
			FLAT,
			YEARS
		)
		// 500000 − 240000 = 260000; − 240000 = 20000; max(0, −220000) = 0.
		expect(r.projection.map((p) => p.debts)).toEqual([260_000, 20_000, 0])
	})

	it('a flat scenario keeps baseline === projection with a row at a non-7% rate (67.1, 100.2 D5)', () => {
		const r = calculateFinancialForecast(
			{
				...CURRENT_DATA,
				investments: 100_007,
				balanceAccounts: [
					{
						type: 'investment',
						balance: 100_007,
						contribution: 10_000,
						frequency: 'monthly',
						annualReturn: 0.03,
					},
					{ type: 'debt', balance: 50_000, contribution: 1_000, frequency: 'monthly' },
				],
			},
			FLAT,
			YEARS
		)
		expect(r.baseline).toEqual(r.projection)
		// round(100007 × 1.03) = 103007, + 120000.
		expect(r.baseline[0]?.investments).toBe(223_007)
	})
})
