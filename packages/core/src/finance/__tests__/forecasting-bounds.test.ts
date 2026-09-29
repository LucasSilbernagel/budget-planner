/**
 * `calculateFinancialForecast` — input bounds (story 77.1, FR124).
 *
 * ⚠️⚠️ WHY THE `years` CASES RUN IN A CHILD PROCESS, NOT IN THIS ONE.
 *
 * The engine is synchronous. Before this story a `years` of `Infinity` (or
 * `Number.MAX_VALUE`, or just `1e9`) spun its baseline loop for ever — story
 * 67.1's reviewer had to kill the probe. A vitest `testTimeout` is a timer on the
 * SAME event loop as the test, so it can never fire while that loop spins: an
 * in-process call does not fail, it wedges the whole run. The bound therefore
 * has to live in ANOTHER process, which `spawnSync`'s `timeout` kills with
 * SIGTERM (a busy JS loop cannot block a signal).
 *
 * The child cannot import the TypeScript source directly: CI runs Node 20, which
 * has no type stripping, `tsx` is not installed, and `dist/` is gitignored and
 * NOT built by the CI unit job. So `beforeAll` transpiles the engine's own
 * module chain with this package's `typescript` devDependency into CommonJS in a
 * temp directory (no `package.json` there, so `.js` is CommonJS and
 * extensionless `require('./netIncome')` resolves).
 *
 * ⚠️ If `forecasting.ts` ever imports a module outside `ENGINE_MODULES`, the
 * child's `require` fails with "Cannot find module": the child exits non-zero
 * and writes to stderr, so the `status` and `stderr` assertions below fail
 * rather than pass. The positive-anchor test (`years = 3` → RETURNED) catches it
 * too.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FORECAST_OUT_OF_RANGE,
  type ForecastingScenario,
  MAX_FORECAST_YEARS,
  MIN_FORECAST_YEARS,
  calculateFinancialForecast,
  isValidForecastYears,
} from '../forecasting'

const FINANCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Every module `forecasting.ts` reaches, transitively. */
const ENGINE_MODULES = ['forecasting', 'netIncome', 'normalization'] as const
/** Generous for a 30-iteration loop; a non-terminating one never finishes. */
const CHILD_TIMEOUT_MS = 5000
const RANGE_MESSAGE = 'Projection period must be a whole number of years from 1 to 30'

let engineDir = ''

beforeAll(() => {
  engineDir = mkdtempSync(join(tmpdir(), 'forecast-engine-'))
  for (const name of ENGINE_MODULES) {
    const source = readFileSync(join(FINANCE_DIR, `${name}.ts`), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    })
    writeFileSync(join(engineDir, `${name}.js`), outputText)
  }
})

afterAll(() => {
  if (engineDir) rmSync(engineDir, { recursive: true, force: true })
})

/**
 * Runs the engine in a child with `years` given as a JS EXPRESSION (so
 * `Infinity` survives — JSON cannot carry it) and reports how it ended.
 */
function runEngineInChild(yearsExpression: string) {
  const script = `
    const { calculateFinancialForecast } = require(${JSON.stringify(
      join(engineDir, 'forecasting.js')
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

      // ⚠️ The MECHANISM assertion comes first, so a RED run names it: on an
      // unguarded engine the child is killed by the timeout, and this line is
      // what the failure prints.
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
    // Without this, every case above could pass for a reason unrelated to the
    // guard — e.g. the child failing to load the transpiled engine at all.
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
const FLAT: ForecastingScenario = { name: 'bounds', incomeGrowthRate: 0, expenseGrowthRate: 0 }

describe('years the engine refuses (in-process)', () => {
  // ⚠️ These are safe to run IN-PROCESS only because none of them loops for ever
  // on an unguarded engine: 0, -1, 2.5 and NaN run at most two iterations, '10'
  // compares as a number for ten, and 31 terminates. `Infinity`, `MAX_VALUE` and
  // `1e9` belong ONLY in the child-process harness above.
  const refused: [string, unknown][] = [
    ["0 (an emptied field: Number('') is 0)", 0],
    ['-1', -1],
    ['2.5 (a fraction)', 2.5],
    ['31 (one past the maximum)', 31],
    ['NaN', Number.NaN],
    ["the string '10'", '10'],
  ]
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
  const cases: [unknown, boolean][] = [
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
  ]
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
    // Before 77.1 the reduce ended in `|| 0`, so NaN + 700000 = NaN became 0 and
    // the valid 7,000.00 event vanished from year 1 with no error at all
    // (measured: year-1 netIncome equal to the no-event baseline).
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
      // Differential, like the one-time-event tests in forecasting.test.ts: the
      // event's whole contribution is exactly the rounded amount.
      expect(r.projection[0].savings - baseline.projection[0].savings).toBe(cents)
      expect(Number.isInteger(r.projection[0].savings)).toBe(true)
      expect(Number.isInteger(r.summary.endingNetWorth)).toBe(true)
    })
  }
})

describe('a projection whose balance overflows is refused, never returned as Infinity/NaN', () => {
  // Found by 77.1's code review (P2): each event amount is finite, so the
  // per-event `validateAmount` passes, but their SUM is not.
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
    // One event per year, so no single year's sum overflows; only the running
    // balance can see it: year 1 lands at ~1.7e308, year 2 pushes it past
    // MAX_VALUE. (Unguarded, a later negative pair then made it NaN.)
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
