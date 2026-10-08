// 26 / 12 isn't exact in float, so a half cent can round down (27¢ biweekly → 58).
// Oracles are exact integer arithmetic, half toward +Infinity.

import { describe, expect, it } from 'vitest'
import { type Frequency, normalizeToMonthly } from '../normalization'

const PERIODS: Record<Frequency, number> = { weekly: 52, biweekly: 26, monthly: 12, annually: 1 }
const FREQUENCIES = Object.keys(PERIODS) as Frequency[]

function exactRound(num: number, den: number): number {
  const q = Math.floor(num / den)
  const rem = num - q * den
  return rem * 2 >= den ? q + 1 : q
}

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
  // Money caps at MAX_SAFE_INTEGER / 100, so amount × 52 must stay below 2^53 there.
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
