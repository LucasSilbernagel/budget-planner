// The years cases run in a child: a sync infinite loop would block vitest's timeout.
// The child gets transpiled CJS since CI's Node has no TS stripping and dist isn't built.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
	calculateFinancialForecast,
	FORECAST_OUT_OF_RANGE,
	type ForecastingScenario,
	isValidForecastYears,
	MAX_FORECAST_YEARS,
	MIN_FORECAST_YEARS,
} from '../forecasting'

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// Transitive imports of forecasting.ts; a missing one makes the child fail to load.
const ENGINE_MODULES = [
	'finance/forecasting',
	'finance/money-limits',
	'finance/netIncome',
	'finance/normalization',
	'services/balanceTracking',
	'utils/balanceCalculations',
	'utils/uuid',
] as const
const CHILD_TIMEOUT_MS = 5000
const RANGE_MESSAGE = 'Projection period must be a whole number of years from 1 to 30'

let engineDir = ''

beforeAll(() => {
	engineDir = mkdtempSync(join(tmpdir(), 'forecast-engine-'))
	for (const name of ENGINE_MODULES) {
		const source = readFileSync(join(SRC_DIR, `${name}.ts`), 'utf8')
		const { outputText } = ts.transpileModule(source, {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
		})
		const target = join(engineDir, `${name}.js`)
		mkdirSync(dirname(target), { recursive: true })
		writeFileSync(target, outputText)
	}
})

afterAll(() => {
	if (engineDir) rmSync(engineDir, { recursive: true, force: true })
})

// `years` is passed as a JS expression because JSON cannot carry Infinity.
function runEngineInChild(yearsExpression: string) {
	const script = `
    const { calculateFinancialForecast } = require(${JSON.stringify(
			join(engineDir, 'finance', 'forecasting.js')
		)})
    try {
      calculateFinancialForecast(
        { income: [{ amount: 500000, frequency: 'monthly' }], expenses: [], savings: 0, investments: 0 },
        { name: 'bounds', incomeGrowthRate: 0, expenseGrowthRate: 0 },
        ${yearsExpression}
      )
      process.stdout.write('RETURNED')
    } catch (error) {
      process.stdout.write('THREW: ' + error.message)
    }
  `
	return spawnSync(process.execPath, ['-e', script], {
		timeout: CHILD_TIMEOUT_MS,
		encoding: 'utf8',
	})
}

describe('years that never terminate on an unguarded engine (bounded harness)', () => {
	for (const expression of ['Infinity', 'Number.MAX_VALUE', '1e9']) {
		it(`refuses years = ${expression} instead of looping`, () => {
			const result = runEngineInChild(expression)

			expect(
				result.error?.message ?? result.signal ?? 'terminated',
				`engine did not terminate within ${CHILD_TIMEOUT_MS} ms: the years guard is missing`
			).toBe('terminated')
			expect(result.stderr, 'child stderr').toBe('')
			expect(result.status, 'child exit status').toBe(0)
			expect(result.stdout).toBe(`THREW: ${RANGE_MESSAGE}`)
		})
	}
})

describe('the bounded harness itself (positive anchor)', () => {
	it('lets a valid years run to completion in the child', () => {
		// Without this, the cases above could pass because the child failed to load.
		const result = runEngineInChild('3')
		expect(result.error?.message ?? result.signal ?? 'terminated').toBe('terminated')
		expect(result.stderr, 'child stderr').toBe('')
		expect(result.status, 'child exit status').toBe(0)
		expect(result.stdout).toBe('RETURNED')
	})
})

const DATA = {
	income: [{ amount: 500_000, frequency: 'monthly' as const }],
	expenses: [],
	savings: 0,
	investments: 0,
}
const FLAT = {
	name: 'bounds',
	incomeGrowthRate: 0,
	expenseGrowthRate: 0,
} satisfies ForecastingScenario

describe('years the engine refuses (in-process)', () => {
	// Safe in-process only because none of these loops forever on an unguarded engine.
	const refused = [
		["0 (an emptied field: Number('') is 0)", 0],
		['-1', -1],
		['2.5 (a fraction)', 2.5],
		['31 (one past the maximum)', 31],
		['NaN', Number.NaN],
		["the string '10'", '10'],
	] satisfies [string, unknown][]
	for (const [label, years] of refused) {
		it(`refuses ${label}`, () => {
			expect(() => calculateFinancialForecast(DATA, FLAT, years as number)).toThrow(RANGE_MESSAGE)
		})
	}
})

describe('years the engine accepts', () => {
	for (const years of [MIN_FORECAST_YEARS, MAX_FORECAST_YEARS]) {
		it(`projects exactly ${years} year(s) with a finite summary`, () => {
			const r = calculateFinancialForecast(DATA, FLAT, years)
			expect(r.projection).toHaveLength(years)
			expect(r.baseline).toHaveLength(years)
			for (const [key, value] of Object.entries(r.summary)) {
				expect(Number.isFinite(value), `summary.${key} = ${value}`).toBe(true)
			}
			// 500000/mo = 6000000/yr, so the average annual growth is exactly one year's flow.
			expect(r.summary.averageAnnualGrowth).toBe(6_000_000)
		})
	}

	it('keeps the default of 10 years valid', () => {
		expect(calculateFinancialForecast(DATA, FLAT).projection).toHaveLength(10)
	})
})

describe('isValidForecastYears', () => {
	const cases = [
		[1, true],
		[30, true],
		[1.0, true],
		[15, true],
		[0, false],
		[-0, false],
		[31, false],
		[2.5, false],
		[Number.NaN, false],
		[Number.POSITIVE_INFINITY, false],
		[Number.MAX_VALUE, false],
		['10', false],
		[null, false],
		[undefined, false],
	] satisfies [unknown, boolean][]
	for (const [value, expected] of cases) {
		it(`${String(value)} -> ${expected}`, () => {
			expect(isValidForecastYears(value)).toBe(expected)
		})
	}
})

describe('one-time event amounts are validated like every other money term', () => {
	const withEvents = (events: Array<{ year: number; amount: unknown }>) =>
		calculateFinancialForecast(
			DATA,
			{ ...FLAT, oneTimeEvents: events as ForecastingScenario['oneTimeEvents'] },
			2
		)

	for (const [label, amount] of [
		['Infinity', Number.POSITIVE_INFINITY],
		['-Infinity', Number.NEGATIVE_INFINITY],
		['NaN', Number.NaN],
		['null (what JSON makes of a saved Infinity/NaN)', null],
	] as const) {
		it(`refuses an event amount of ${label}`, () => {
			expect(
				() => withEvents([{ year: 1, amount }]),
				`event amount ${label} must be REFUSED by validateAmount, not summed into the year`
			).toThrow('Amount must be a finite number')
		})
	}

	it('does not let a NaN event silently erase a VALID event in the same year', () => {
		expect(
			() =>
				withEvents([
					{ year: 1, amount: 700_000 },
					{ year: 1, amount: Number.NaN },
				]),
			'a NaN event must be refused, not absorbed by `|| 0` along with the valid event beside it'
		).toThrow('Amount must be a finite number')
	})

	for (const [amount, cents] of [
		[0.5, 1],
		[2.4, 2],
		[-2.6, -3],
	] as const) {
		it(`rounds an event amount of ${amount} to ${cents} whole cent(s)`, () => {
			const baseline = withEvents([])
			const r = withEvents([{ year: 1, amount }])
			expect(r.projection[0].savings - baseline.projection[0].savings).toBe(cents)
			expect(Number.isInteger(r.projection[0].savings)).toBe(true)
			expect(Number.isInteger(r.summary.endingNetWorth)).toBe(true)
		})
	}
})

describe('a projection whose balance overflows is refused, never returned as Infinity/NaN', () => {
	// Each event amount is finite, but their sum is not.
	const HUGE = 1.7e308

	it('two finite events whose sum overflows to Infinity', () => {
		expect(
			() =>
				calculateFinancialForecast(
					DATA,
					{
						...FLAT,
						oneTimeEvents: [
							{ year: 1, amount: HUGE },
							{ year: 1, amount: HUGE },
						],
					},
					2
				),
			'an overflowing year sum must be refused, not returned as an Infinity summary'
		).toThrow(FORECAST_OUT_OF_RANGE)
	})

	it('a running balance that overflows across years, though every YEAR sums finite', () => {
		// One event per year, so only the running balance overflows.
		expect(
			() =>
				calculateFinancialForecast(
					DATA,
					{
						...FLAT,
						oneTimeEvents: [
							{ year: 1, amount: HUGE },
							{ year: 2, amount: HUGE },
						],
					},
					3
				),
			'an overflowing running balance must be refused, not returned as Infinity/NaN'
		).toThrow(FORECAST_OUT_OF_RANGE)
	})

	it('a large but representable balance is still projected (control)', () => {
		const r = calculateFinancialForecast(
			DATA,
			{ ...FLAT, oneTimeEvents: [{ year: 1, amount: 1e300 }] },
			2
		)
		for (const value of Object.values(r.summary)) expect(Number.isFinite(value)).toBe(true)
	})
})
