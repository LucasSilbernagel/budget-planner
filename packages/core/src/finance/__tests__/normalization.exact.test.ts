/**
 * Story 105.1 (FR173): recurring amounts convert to monthly exactly.
 *
 * `normalizeToMonthly` used `Math.round(amount * (26 / 12))`. `26 / 12` is not
 * exact in float, so an exact half cent could land just below .5 and round DOWN
 * (27¢ biweekly → 58.49999999999999 → 58; exactly 58.5 → 59). The 104.1 review
 * MEASURED 120,989 such misses in 0..1,999,999 for biweekly, and 0 for weekly,
 * monthly and annually.
 *
 * Every oracle here is INTEGER arithmetic: `amount × periodsPerYear / 12`,
 * rounded half toward +Infinity (`Math.round`'s own rule). A float oracle would
 * prove nothing. The small sweeps stay below 2^53, so plain Number integer maths
 * is exact; the validator-bound cases use BigInt.
 */

import { describe, expect, it } from 'vitest'
import { type Frequency, normalizeToMonthly } from '../normalization'

const PERIODS: Record<Frequency, number> = { weekly: 52, biweekly: 26, monthly: 12, annually: 1 }
const FREQUENCIES = Object.keys(PERIODS) as Frequency[]

/** Round `num / den` half toward +Infinity, exactly. Integers below 2^53, den > 0. */
function exactRound(num: number, den: number): number {
  const q = Math.floor(num / den)
  const rem = num - q * den
  return rem * 2 >= den ? q + 1 : q
}

/** The same rule over BigInt, for numerators past 2^53. */
function exactRoundBig(num: bigint, den: bigint): number {
  const q = num / den
  const r = num % den
  const floor = r < 0n ? q - 1n : q
  const rem = r < 0n ? r + den : r
  return Number(rem * 2n >= den ? floor + 1n : floor)
}

const SWEEP_SIZE = 2_000_000
const NEGATIVE_SWEEP_SIZE = 200_000

describe('normalizeToMonthly — exact against an integer oracle (AC-3)', () => {
  it.each(FREQUENCIES)(
    'matches the oracle for every amount in 0..1,999,999 at %s',
    (frequency) => {
      const periods = PERIODS[frequency]
      let mismatches = 0
      let firstMismatch: number | null = null
      for (let amount = 0; amount < SWEEP_SIZE; amount++) {
        if (normalizeToMonthly(amount, frequency) !== exactRound(amount * periods, 12)) {
          mismatches++
          firstMismatch ??= amount
        }
      }
      expect({ mismatches, firstMismatch }).toEqual({ mismatches: 0, firstMismatch: null })
    },
    60_000
  )

  it.each(FREQUENCIES)(
    'matches the oracle for every amount in -200,000..-1 at %s',
    (frequency) => {
      const periods = PERIODS[frequency]
      let mismatches = 0
      for (let amount = -NEGATIVE_SWEEP_SIZE; amount < 0; amount++) {
        if (normalizeToMonthly(amount, frequency) !== exactRound(amount * periods, 12)) {
          mismatches++
        }
      }
      expect(mismatches).toBe(0)
    },
    60_000
  )
})

describe('normalizeToMonthly — exact at the validator bound (AC-4)', () => {
  // `validateBalanceTracking` and friends cap money at MAX_SAFE_INTEGER / 100.
  // The numerator `amount × 52` must stay below 2^53 there, or the integer
  // product itself would lose precision.
  const BOUND = Math.floor(Number.MAX_SAFE_INTEGER / 100)

  it('keeps the largest numerator below 2^53', () => {
    expect(BOUND * 52).toBeLessThan(Number.MAX_SAFE_INTEGER)
  })

  it.each(FREQUENCIES)(
    'matches a BigInt oracle for 1,000 amounts up to ±the bound at %s',
    (frequency) => {
      const periods = BigInt(PERIODS[frequency])
      let mismatches = 0
      for (let i = 0; i < 1_000; i++) {
        for (const amount of [BOUND - i, -(BOUND - i)]) {
          const exact = exactRoundBig(BigInt(amount) * periods, 12n)
          if (normalizeToMonthly(amount, frequency) !== exact) mismatches++
        }
      }
      expect(mismatches).toBe(0)
    }
  )
})
