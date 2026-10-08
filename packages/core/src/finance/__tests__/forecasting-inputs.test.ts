import { describe, expect, it } from 'vitest'
import {
  type ForecastingScenario,
  GROWTH_RATE_OUT_OF_RANGE,
  MAX_GROWTH_RATE,
  MIN_GROWTH_RATE,
  calculateFinancialForecast,
  isValidGrowthRate,
} from '../forecasting'

const GROWTH_MESSAGE = 'Growth rates must be from -100% to 100%'
const AMOUNT_MESSAGE = 'Amount must be a finite number'

const DATA = {
  income: [{ amount: 500000, frequency: 'monthly' as const }],
  expenses: [{ amount: 300000, frequency: 'monthly' as const }],
  savings: 100000,
  investments: 0,
}

const scenario = (incomeGrowthRate: unknown, expenseGrowthRate: unknown): ForecastingScenario => ({
  name: 'rates',
  incomeGrowthRate: incomeGrowthRate as number,
  expenseGrowthRate: expenseGrowthRate as number,
})

describe('isValidGrowthRate', () => {
  it('the bounds are -1 and 1 (−100% and +100%), and the message names them', () => {
    expect(MIN_GROWTH_RATE).toBe(-1)
    expect(MAX_GROWTH_RATE).toBe(1)
    expect(GROWTH_RATE_OUT_OF_RANGE).toBe(GROWTH_MESSAGE)
  })

  const valid: unknown[] = [-1, 0, 1, 0.05, -0.5]
  const invalid: [string, unknown][] = [
    ['-1.0001', -1.0001],
    ['1.0001', 1.0001],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['null', null],
    ['undefined', undefined],
    ["'0.05' (a string)", '0.05'],
  ]
  for (const v of valid) {
    it(`accepts ${String(v)}`, () => expect(isValidGrowthRate(v)).toBe(true))
  }
  for (const [label, v] of invalid) {
    it(`rejects ${label}`, () => expect(isValidGrowthRate(v)).toBe(false))
  }
})

describe('the engine refuses an out-of-range or non-numeric growth rate (AC-3)', () => {
  const bad: [string, unknown][] = [
    ['NaN (an emptied field)', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['null (a JSON-flattened NaN)', null],
    ["'0.05' (a string)", '0.05'],
    ['-1.0001 (below -100%: the sign alternates)', -1.0001],
    ['1.0001 (above +100%)', 1.0001],
  ]

  for (const [label, rate] of bad) {
    it(`income growth ${label} throws the growth message`, () => {
      expect(
        () => calculateFinancialForecast(DATA, scenario(rate, 0), 10),
        `income growth ${label} must be refused with the growth message, not an amount message`
      ).toThrow(GROWTH_MESSAGE)
    })
    it(`expense growth ${label} throws the growth message`, () => {
      expect(
        () => calculateFinancialForecast(DATA, scenario(0, rate), 10),
        `expense growth ${label} must be refused with the growth message, not an amount message`
      ).toThrow(GROWTH_MESSAGE)
    })
  }

  // `[].map(...)` never evaluates the rate, so a NaN rate with no rows needs its own check.
  it('a NaN income growth rate is refused even with NO income rows', () => {
    expect(
      () => calculateFinancialForecast({ ...DATA, income: [] }, scenario(Number.NaN, 0), 10),
      'no rows of that kind must not make a NaN rate acceptable'
    ).toThrow(GROWTH_MESSAGE)
  })
  it('a NaN expense growth rate is refused even with NO expense rows', () => {
    expect(
      () => calculateFinancialForecast({ ...DATA, expenses: [] }, scenario(0, Number.NaN), 10),
      'no rows of that kind must not make a NaN rate acceptable'
    ).toThrow(GROWTH_MESSAGE)
  })

  for (const [label, rate] of bad) {
    it(`income growth ${label} is refused with NO income rows`, () => {
      expect(() =>
        calculateFinancialForecast({ ...DATA, income: [] }, scenario(rate, 0), 10)
      ).toThrow(GROWTH_MESSAGE)
    })
    it(`expense growth ${label} is refused with NO expense rows`, () => {
      expect(() =>
        calculateFinancialForecast({ ...DATA, expenses: [] }, scenario(0, rate), 10)
      ).toThrow(GROWTH_MESSAGE)
    })
  }

  it('refuses BEFORE any row is computed (the baseline would otherwise run first)', () => {
    let touched = 0
    const income = new Proxy(DATA.income, {
      get(target, prop, receiver) {
        touched++
        return Reflect.get(target, prop, receiver)
      },
    })
    expect(() =>
      calculateFinancialForecast({ ...DATA, income }, scenario(Number.NaN, 0), 10)
    ).toThrow(GROWTH_MESSAGE)
    expect(touched, 'the income rows must not be read before the refusal').toBe(0)
  })
})

describe('the engine accepts the boundaries (AC-3)', () => {
  it('-100% stops the income from year 1, with every summary figure finite', () => {
    const r = calculateFinancialForecast(DATA, scenario(-1, 0), 10)
    expect(r.projection[0]?.income).toBe(0)
    expect(r.projection.every((row) => row.income === 0)).toBe(true)
    for (const v of Object.values(r.summary)) expect(Number.isFinite(v)).toBe(true)
  })

  it('+100% doubles every year, with every summary figure finite at 30 years', () => {
    const r = calculateFinancialForecast(DATA, scenario(1, 1), 30)
    // 5000.00/mo doubled once = 10000.00/mo, annualized = 120000.00.
    expect(r.projection[0]?.income).toBe(500000 * 2 * 12)
    for (const v of Object.values(r.summary)) expect(Number.isFinite(v)).toBe(true)
  })

  it('0 and the default scenario still project', () => {
    expect(() => calculateFinancialForecast(DATA, scenario(0, 0))).not.toThrow()
    expect(() => calculateFinancialForecast(DATA, scenario(0.05, -0.02), 5)).not.toThrow()
  })
})

describe('the engine refuses a non-finite starting balance (AC-3, 77.1 review rider)', () => {
  const bad: [string, unknown][] = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['null', null],
  ]
  for (const field of ['savings', 'investments'] as const) {
    for (const [label, value] of bad) {
      it(`${field} ${label} throws the amount message, not "too large to project"`, () => {
        expect(
          () =>
            calculateFinancialForecast({ ...DATA, [field]: value as number }, scenario(0, 0), 10),
          `a ${label} starting ${field} must be refused by validateAmount`
        ).toThrow(AMOUNT_MESSAGE)
      })
    }
  }
})
