/**
 * Story 104.1 (FR172): half cents round the same way at every rate.
 *
 * The engine used bare `Math.round` on float products, so an exact half cent that
 * float error left just below .5 rounded DOWN: `100 * 1.015` is
 * `101.49999999999999`, which gave 101 where the decimal answer is 102. RD1
 * (100.3 review) measured it over b in 0..1,999,999: 8,415 cases at 1.5%, 3,650 at
 * 4.5%, 1,154 at 5.5%, 0 at 6% and 7%. Story 104.1 T1 reproduced those exact
 * counts before any engine change (record in the story file).
 *
 * Every oracle here is INTEGER arithmetic: `b * (den + num) / den`, rounded half
 * toward +Infinity (Math.round's own rule, D4). A float oracle would prove nothing.
 * In the small sweep every product is below 2^53, so plain Number integer maths is
 * exact; the large-magnitude ranges use BigInt.
 */

import { describe, expect, it } from 'vitest'
import { type ForecastingScenario, calculateFinancialForecast, roundCents } from '../forecasting'

/** Round `num / den` half toward +Infinity, exactly. Integers below 2^53 only. */
function exactRound(num: number, den: number): number {
  const q = Math.floor(num / den)
  const rem = num - q * den
  return rem * 2 >= den ? q + 1 : q
}

/** The same rule over BigInt, for magnitudes where a product passes 2^53. */
function exactRoundBig(num: bigint, den: bigint): number {
  const q = num / den
  const r = num % den
  const floor = r < 0n ? q - 1n : q
  const rem = r < 0n ? r + den : r
  return Number(rem * 2n >= den ? floor + 1n : floor)
}

/** A rate as an exact fraction plus the float the engine actually sees. */
interface Rate {
  label: string
  /** The growth as `num / den`, e.g. 15/1000 for 1.5%. */
  num: number
  den: number
  /** The engine's input: `1 + annualReturn`, built the same way (`forecasting.ts`). */
  multiplier: number
}
const rate = (label: string, num: number, den: number): Rate => ({
  label,
  num,
  den,
  multiplier: 1 + num / den,
})

const SWEEP_RATES = [
  rate('1.5%', 15, 1000),
  rate('4.5%', 45, 1000),
  rate('5.5%', 55, 1000),
  rate('6%', 6, 100),
  rate('7%', 7, 100),
]

const SWEEP_SIZE = 2_000_000

describe('roundCents — the RD1 sweep (AC-3)', () => {
  it.each(SWEEP_RATES)(
    'matches the integer oracle for every b in 0..1,999,999 at $label',
    ({ num, den, multiplier }) => {
      let mismatches = 0
      let firstMismatch: number | null = null
      for (let b = 0; b < SWEEP_SIZE; b++) {
        if (roundCents(b * multiplier) !== exactRound(b * (den + num), den)) {
          mismatches++
          firstMismatch ??= b
        }
      }
      expect({ mismatches, firstMismatch }).toEqual({ mismatches: 0, firstMismatch: null })
    },
    60_000
  )

  it.each(SWEEP_RATES.filter((r) => r.label === '6%' || r.label === '7%'))(
    'is identical to bare Math.round at $label (the default figures do not move)',
    ({ multiplier }) => {
      let differences = 0
      for (let b = 0; b < SWEEP_SIZE; b++) {
        const x = b * multiplier
        if (roundCents(x) !== Math.round(x)) differences++
      }
      expect(differences).toBe(0)
    },
    60_000
  )
})

describe('roundCents — large magnitudes never do worse than bare Math.round (AC-4)', () => {
  // At these magnitudes the float product itself cannot carry the exact fraction
  // (ulp of 1e13 is ~0.002 cents), so 0 mismatches is out of reach for ANY rule.
  // The bar is no regression. MEASURED at create-story and again in dev:
  // `Math.round(+x.toPrecision(15))` gave 9,930 mismatches on the 1e13 range,
  // bare Math.round 170. A relative snap window with no cap was also worse
  // (1 ulp: 560); the cap in `roundCents` is what keeps this at bare's count.
  const ranges: { label: string; start: bigint }[] = [
    { label: '1e13 cents', start: 10_000_000_000_000n },
    {
      label: 'the validator bound (MAX_SAFE_INTEGER / 100)',
      start: BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 100)) - 200_000n,
    },
  ]
  const COUNT = 200_000

  it.each(ranges)(
    'at 5.555% over 200,000 balances from $label',
    ({ start }) => {
      const num = 5555n
      const den = 100_000n
      const multiplier = 1 + 0.05555
      let helper = 0
      let bare = 0
      for (let i = 0; i < COUNT; i++) {
        const b = start + BigInt(i)
        const x = Number(b) * multiplier
        const exact = exactRoundBig(b * (den + num), den)
        if (roundCents(x) !== exact) helper++
        if (Math.round(x) !== exact) bare++
      }
      expect(helper).toBeLessThanOrEqual(bare)
    },
    60_000
  )
})

describe('roundCents — edge values', () => {
  it('keeps Math.round for a negative exact half (D4: half toward +Infinity)', () => {
    expect(roundCents(-2.5)).toBe(-2)
    expect(roundCents(-0.5)).toBe(Math.round(-0.5))
    expect(roundCents(-101.5)).toBe(-101)
  })

  it('rounds a negative value near an exact half as that half, toward +Infinity (D4)', () => {
    // -100 * 1.015 is -101.49999999999999; exactly it is -101.5, which rounds to
    // -101. Bare Math.round gets this one right too (characterization, not a fix):
    // for a negative product the float error leans the safe way here.
    expect(-100 * 1.015).not.toBe(-101.5)
    expect(roundCents(-100 * 1.015)).toBe(-101)
  })

  it('leaves non-finite input to Math.round', () => {
    expect(roundCents(Number.NaN)).toBeNaN()
    expect(roundCents(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
    expect(roundCents(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY)
  })

  it('does not move a fraction that is genuinely below a half', () => {
    expect(roundCents(101.4999)).toBe(101)
    expect(roundCents(2.49)).toBe(2)
  })
})

/** No income or expenses, so only the rows and the growth sites move. */
const QUIET_DATA = {
  income: [] as { amount: number; frequency: 'monthly' }[],
  expenses: [] as { amount: number; frequency: 'monthly' }[],
  savings: 0,
  investments: 0,
}
const FLAT: ForecastingScenario = { name: 'flat', incomeGrowthRate: 0, expenseGrowthRate: 0 }

describe('the engine sites round through roundCents (AC-1, AC-2)', () => {
  it('an investment row of 100 at 1.5% closes year 1 at 102, not 101 (stepBalanceRows)', () => {
    const r = calculateFinancialForecast(
      {
        ...QUIET_DATA,
        investments: 100,
        balanceAccounts: [
          {
            type: 'investment',
            annualReturn: 0.015,
            balance: 100,
            contribution: 0,
            frequency: 'monthly',
          },
        ],
      },
      FLAT,
      1
    )
    expect(r.projection[0]?.investments).toBe(102)
    expect(r.baseline?.[0]?.investments).toBe(102)
  })

  it('an investment row of 1900 at 5.5% closes year 1 at 2005, not 2004', () => {
    const r = calculateFinancialForecast(
      {
        ...QUIET_DATA,
        investments: 1900,
        balanceAccounts: [
          {
            type: 'investment',
            annualReturn: 0.055,
            balance: 1900,
            contribution: 0,
            frequency: 'monthly',
          },
        ],
      },
      FLAT,
      1
    )
    expect(r.projection[0]?.investments).toBe(2005)
  })

  it('income growth: 100/mo at 1.5% is 102/mo in year 1 (1,224 a year), not 101', () => {
    const r = calculateFinancialForecast(
      { ...QUIET_DATA, income: [{ amount: 100, frequency: 'monthly' }] },
      { ...FLAT, incomeGrowthRate: 0.015 },
      1
    )
    expect(r.projection[0]?.income).toBe(102 * 12)
  })

  it('expense growth: 100/mo at 1.5% is 102/mo in year 1 (1,224 a year), not 101', () => {
    const r = calculateFinancialForecast(
      { ...QUIET_DATA, expenses: [{ amount: 100, frequency: 'monthly' }] },
      { ...FLAT, expenseGrowthRate: 0.015 },
      1
    )
    expect(r.projection[0]?.expenses).toBe(102 * 12)
  })

  // Found by search in dev (exact integer oracle over amount × year): the float
  // pow leaves these just below an exact half, so bare Math.round was a cent low.
  it.each([
    { amount: 20_000, growth: 0.015, year: 2, float: 20_604.499999999993, exact: 20_605 },
    { amount: 4_000, growth: 0.15, year: 3, float: 6_083.499999999999, exact: 6_084 },
  ])(
    'a later growth year lands on the exact half too: $amount/mo at $growth in year $year is $exact/mo',
    ({ amount, growth, year, float, exact }) => {
      expect(amount * (1 + growth) ** year).toBe(float)
      const r = calculateFinancialForecast(
        { ...QUIET_DATA, income: [{ amount, frequency: 'monthly' }] },
        { ...FLAT, incomeGrowthRate: growth },
        year
      )
      expect(r.projection[year - 1]?.income).toBe(exact * 12)
    }
  )
})
