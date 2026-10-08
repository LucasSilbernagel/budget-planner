// normalizeToAnnual is round(amount × periods), not round(amount × periods / 12) × 12,
// which is off by up to 6 cents a year. Oracles are integer arithmetic.

import { describe, expect, it } from 'vitest'
import {
  type Frequency,
  ROUNDING_DRIFT_CENTS_PER_ENTRY_YEAR,
  calculateTotalAnnualNormalized,
  normalizeToAnnual,
  normalizeToMonthly,
  roundingDriftToleranceCents,
} from '../normalization'

const PERIODS: Record<Frequency, number> = { weekly: 52, biweekly: 26, monthly: 12, annually: 1 }
const FREQUENCIES = Object.keys(PERIODS) as Frequency[]

describe('normalizeToAnnual (story 111.1)', () => {
  it.each(FREQUENCIES)('is amount × periods for every amount 0..1,999,999 (%s)', (frequency) => {
    let misses = 0
    let first: number | undefined
    for (let amount = 0; amount < 2_000_000; amount++) {
      if (normalizeToAnnual(amount, frequency) !== amount * PERIODS[frequency]) {
        misses++
        first ??= amount
      }
    }
    expect({ misses, first }).toEqual({ misses: 0, first: undefined })
  })

  it('differs from the old monthly round trip where the story says it does', () => {
    const roundTrip = (a: number, f: Frequency) => normalizeToMonthly(a, f) * 12
    expect([normalizeToAnnual(1000, 'annually'), roundTrip(1000, 'annually')]).toEqual([1000, 996])
    expect([normalizeToAnnual(100_000, 'weekly'), roundTrip(100_000, 'weekly')]).toEqual([
      5_200_000, 5_199_996,
    ])
    expect([normalizeToAnnual(1_200_018, 'annually'), roundTrip(1_200_018, 'annually')]).toEqual([
      1_200_018, 1_200_024,
    ])
    expect([normalizeToAnnual(5000, 'weekly'), roundTrip(5000, 'weekly')]).toEqual([
      260_000, 260_004,
    ])
  })

  it('rounds a fractional amount once, after multiplying', () => {
    // 0.5 × 52 = 26 exactly (round once); rounding first would give 1 × 52 = 52.
    expect(normalizeToAnnual(0.5, 'weekly')).toBe(26)
    // 10.01 × 1 = 10.01 → 10.
    expect(normalizeToAnnual(10.01, 'annually')).toBe(10)
  })

  it('uses the same validation, and the same messages, as normalizeToMonthly', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '100', undefined]) {
      expect(() => normalizeToAnnual(bad, 'monthly')).toThrow('Amount must be a finite number')
      expect(() => normalizeToMonthly(bad, 'monthly')).toThrow('Amount must be a finite number')
    }
    for (const bad of ['daily', 'Monthly', undefined, 12]) {
      expect(() => normalizeToAnnual(100, bad)).toThrow('Invalid frequency')
    }
  })
})

describe('calculateTotalAnnualNormalized (story 111.1)', () => {
  it('sums each item annualised exactly (the annual twin of calculateTotalMonthlyNormalized)', () => {
    // The docs' worked example: 2000×26 + 600×12 + 1200 = 60,400.00.
    expect(
      calculateTotalAnnualNormalized([
        { amount: 200_000, frequency: 'biweekly' },
        { amount: 60_000, frequency: 'monthly' },
        { amount: 120_000, frequency: 'annually' },
      ])
    ).toBe(6_040_000)
    expect(calculateTotalAnnualNormalized([])).toBe(0)
  })

  it('validates like calculateTotalMonthlyNormalized', () => {
    expect(() => calculateTotalAnnualNormalized('nope')).toThrow('Items must be an array')
    expect(() => calculateTotalAnnualNormalized([{ amount: 1, frequency: 'daily' }])).toThrow(
      'Invalid frequency'
    )
    expect(() =>
      calculateTotalAnnualNormalized([{ amount: Number.NaN, frequency: 'weekly' }])
    ).toThrow('Amount must be a finite number')
  })
})

describe('roundingDriftToleranceCents (story 111.1 review, D1)', () => {
  it('is 6 cents per non-monthly entry per year, for each frequency mix', () => {
    expect(ROUNDING_DRIFT_CENTS_PER_ENTRY_YEAR).toBe(6)
    expect(roundingDriftToleranceCents([], 10)).toBe(0)
    expect(roundingDriftToleranceCents(['monthly', 'monthly'], 10)).toBe(0)
    expect(roundingDriftToleranceCents(['weekly'], 1)).toBe(6)
    expect(roundingDriftToleranceCents(['biweekly'], 1)).toBe(6)
    expect(roundingDriftToleranceCents(['annually'], 1)).toBe(6)
    expect(roundingDriftToleranceCents(['weekly'], 10)).toBe(60)
    expect(roundingDriftToleranceCents(['monthly', 'weekly', 'biweekly', 'annually'], 10)).toBe(180)
    expect(roundingDriftToleranceCents(['weekly', 'weekly', 'monthly'], 30)).toBe(360)
  })

  it('counts an unknown frequency as non-monthly, and gives 0 for no usable years', () => {
    expect(roundingDriftToleranceCents(['fortnightly', undefined], 1)).toBe(12)
    expect(roundingDriftToleranceCents(['weekly'], 0)).toBe(0)
    expect(roundingDriftToleranceCents(['weekly'], -3)).toBe(0)
    expect(roundingDriftToleranceCents(['weekly'], Number.NaN)).toBe(0)
    expect(roundingDriftToleranceCents(['weekly'], Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('bounds the real drift: no amount 0..199,999 drifts more than the tolerance in a year', () => {
    for (const frequency of FREQUENCIES.filter((f) => f !== 'monthly')) {
      const p = PERIODS[frequency]
      let worst = 0
      for (let a = 0; a < 200_000; a++) {
        worst = Math.max(worst, Math.abs(Math.round((a * p) / 12) * 12 - a * p))
      }
      expect(worst, frequency).toBeLessThanOrEqual(roundingDriftToleranceCents([frequency], 1))
    }
  })
})
