/**
 * Automatic Leftover-Allocation Solver Tests (Story 26.2)
 *
 * Mathematical validation tests for the savings leftover-allocation solver.
 * Zero tolerance for errors - NFR3 requirement.
 *
 * Pool formula:
 *   distributablePool = max(0, netPeriodIncome
 *                              − Σ(normalized investment contributions)
 *                              − Σ(manual savings allocations))
 * Even split: each automatic account receives distributablePool / N with
 * deterministic cent-rounding whose sum equals the pool exactly.
 */

import { describe, expect, it } from 'vitest'
import {
  type AllocationAccount,
  calculateDistributablePool,
  solveAutomaticAllocations,
} from '../savingsAllocation.js'

// Convenience builders keep the intent of each case obvious.
const manual = (id: string, monthlyAllocation: number | null): AllocationAccount => ({
  id,
  allocationMode: 'manual',
  monthlyAllocation,
})
const automatic = (id: string): AllocationAccount => ({ id, allocationMode: 'automatic' })

describe('calculateDistributablePool', () => {
  it('returns net period income when there are no contributions or manual allocations', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [{ amount: 200000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [automatic('a')],
    })
    // net = 500000 - 200000 = 300000
    expect(pool).toBe(300000)
  })

  it('subtracts normalized investment/retirement contributions', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [{ amount: 200000, frequency: 'monthly' }],
      investmentContributions: [{ amount: 50000, frequency: 'monthly' }],
      savingsAccounts: [automatic('a')],
    })
    // 300000 - 50000 = 250000
    expect(pool).toBe(250000)
  })

  it('subtracts manual savings allocations but NOT automatic accounts', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [{ amount: 200000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [manual('m', 70000), automatic('a')],
    })
    // 300000 - 70000 (manual only) = 230000
    expect(pool).toBe(230000)
  })

  it('subtracts both contributions and manual allocations together', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [{ amount: 200000, frequency: 'monthly' }],
      investmentContributions: [{ amount: 50000, frequency: 'monthly' }],
      savingsAccounts: [manual('m', 70000), automatic('a')],
    })
    // 300000 - 50000 - 70000 = 180000
    expect(pool).toBe(180000)
  })

  it('normalizes investment contributions by frequency before subtracting', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [
        { amount: 12000, frequency: 'annually' }, // round(12000/12) = 1000
        { amount: 1000, frequency: 'weekly' }, // round(1000 * 52/12) = 4333
        { amount: 1000, frequency: 'biweekly' }, // round(1000 * 26/12) = 2167
      ],
      savingsAccounts: [automatic('a')],
    })
    // 500000 - (1000 + 4333 + 2167) = 500000 - 7500 = 492500
    expect(pool).toBe(492500)
  })

  it('floors the pool at zero when manual allocations exceed available funds', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 100000, frequency: 'monthly' }],
      expenses: [{ amount: 50000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [manual('m', 80000)],
    })
    // net 50000 - 80000 = -30000 → floored to 0
    expect(pool).toBe(0)
  })

  it('treats a null/absent manual amount as zero', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [{ amount: 200000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [manual('m', null), { id: 'm2', allocationMode: 'manual' }],
    })
    // both manual amounts count as 0 → 300000
    expect(pool).toBe(300000)
  })

  it('clamps a defensive negative manual amount to zero', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [{ amount: 200000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [manual('m', -5000)],
    })
    // -5000 clamped to 0 → 300000
    expect(pool).toBe(300000)
  })

  it('returns 0 for fully empty inputs', () => {
    const pool = calculateDistributablePool({
      incomeSources: [],
      expenses: [],
      investmentContributions: [],
      savingsAccounts: [],
    })
    expect(pool).toBe(0)
  })

  it('clamps a stray negative contribution to zero (cannot inflate the pool)', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 300000, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [{ amount: -50000, frequency: 'monthly' }],
      savingsAccounts: [automatic('a')],
    })
    // a negative contribution must NOT add to the pool → clamped to 0 → 300000
    expect(pool).toBe(300000)
  })

  it('treats a NaN manual amount as zero instead of poisoning the pool', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [{ amount: 200000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [manual('m', Number.NaN)],
    })
    expect(Number.isNaN(pool)).toBe(false)
    expect(pool).toBe(300000)
  })
})

describe('solveAutomaticAllocations', () => {
  it('splits an evenly-divisible pool equally, summing to the pool', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 600000, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [],
      savingsAccounts: [automatic('a'), automatic('b'), automatic('c')],
    })
    expect(result.distributablePool).toBe(600000)
    expect(result.automaticAccountCount).toBe(3)
    expect(result.allocations).toEqual({ a: 200000, b: 200000, c: 200000 })
    const sum = Object.values(result.allocations).reduce((s, v) => s + v, 0)
    expect(sum).toBe(result.distributablePool)
  })

  it('distributes leftover cents deterministically for a non-divisible pool', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 100, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [],
      savingsAccounts: [automatic('a'), automatic('b'), automatic('c')],
    })
    // pool 100, base 33, remainder 1 → first account gets the extra cent
    expect(result.distributablePool).toBe(100)
    expect(result.allocations).toEqual({ a: 34, b: 33, c: 33 })
    const sum = Object.values(result.allocations).reduce((s, v) => s + v, 0)
    expect(sum).toBe(100)
  })

  it('assigns the extra cents by input order (determinism)', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 100, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [],
      // reversed order vs previous test → the extra cent follows the order
      savingsAccounts: [automatic('c'), automatic('b'), automatic('a')],
    })
    expect(result.allocations).toEqual({ c: 34, b: 33, a: 33 })
  })

  it('spreads two leftover cents across the first two accounts', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 101, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [],
      savingsAccounts: [automatic('a'), automatic('b'), automatic('c')],
    })
    // pool 101, base 33, remainder 2 → a and b get the extra cent each
    expect(result.allocations).toEqual({ a: 34, b: 34, c: 33 })
    const sum = Object.values(result.allocations).reduce((s, v) => s + v, 0)
    expect(sum).toBe(101)
  })

  it('gives the whole pool to a single automatic account', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 250000, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [],
      savingsAccounts: [automatic('a')],
    })
    expect(result.automaticAccountCount).toBe(1)
    expect(result.allocations).toEqual({ a: 250000 })
  })

  it('distributes nothing when there are zero automatic accounts (all manual)', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [{ amount: 200000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [manual('m1', 100000), manual('m2', 50000)],
    })
    // pool = 300000 - 150000 = 150000, but no automatic accounts to receive it
    expect(result.distributablePool).toBe(150000)
    expect(result.automaticAccountCount).toBe(0)
    expect(result.allocations).toEqual({})
  })

  it('handles a mix of manual and automatic accounts', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 500000, frequency: 'monthly' }],
      expenses: [{ amount: 200000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [manual('m', 60000), automatic('a'), automatic('b')],
    })
    // net 300000 - manual 60000 = pool 240000, split across 2 automatic
    expect(result.distributablePool).toBe(240000)
    expect(result.automaticAccountCount).toBe(2)
    expect(result.allocations).toEqual({ a: 120000, b: 120000 })
    // the manual account is not part of the automatic distribution
    expect(result.allocations.m).toBeUndefined()
  })

  it('gives every automatic account 0 when the pool is exactly zero', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 50000, frequency: 'monthly' }],
      expenses: [{ amount: 50000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [automatic('a'), automatic('b')],
    })
    expect(result.distributablePool).toBe(0)
    expect(result.allocations).toEqual({ a: 0, b: 0 })
  })

  it('gives automatic accounts 0 for an over-committed plan (never negative)', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 100000, frequency: 'monthly' }],
      expenses: [{ amount: 50000, frequency: 'monthly' }],
      investmentContributions: [],
      savingsAccounts: [manual('m', 80000), automatic('a'), automatic('b')],
    })
    // net 50000 - 80000 = -30000 → pool floored 0; automatic accounts get 0
    expect(result.distributablePool).toBe(0)
    expect(result.allocations).toEqual({ a: 0, b: 0 })
    for (const value of Object.values(result.allocations)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(Number.isNaN(value)).toBe(false)
    }
  })

  it('treats an account with no allocationMode as automatic (default)', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 600000, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [],
      // no allocationMode field → resolveAllocationMode defaults to 'automatic'
      savingsAccounts: [{ id: 'a' }, { id: 'b' }],
    })
    expect(result.automaticAccountCount).toBe(2)
    expect(result.allocations).toEqual({ a: 300000, b: 300000 })
  })

  it('produces no NaN or negative values with fully empty inputs', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [],
      expenses: [],
      investmentContributions: [],
      savingsAccounts: [],
    })
    expect(result.distributablePool).toBe(0)
    expect(result.automaticAccountCount).toBe(0)
    expect(result.allocations).toEqual({})
  })

  it('spreads leftover cents when the pool is smaller than the account count (base share 0)', () => {
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 2, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [],
      savingsAccounts: [
        automatic('a'),
        automatic('b'),
        automatic('c'),
        automatic('d'),
        automatic('e'),
      ],
    })
    // pool 2, base 0, remainder 2 → first two accounts get 1 cent each
    expect(result.allocations).toEqual({ a: 1, b: 1, c: 0, d: 0, e: 0 })
    const sum = Object.values(result.allocations).reduce((s, v) => s + v, 0)
    expect(sum).toBe(2)
  })

  it('treats an unrecognized allocationMode as automatic (no account or money is dropped)', () => {
    // A corrupt/typo'd mode from untyped persisted JSON must not evaporate:
    // it is neither counted as a manual reservation nor excluded from the split.
    const corrupt = { id: 'x', allocationMode: 'auto', monthlyAllocation: 999 } as AllocationAccount
    const result = solveAutomaticAllocations({
      incomeSources: [{ amount: 600000, frequency: 'monthly' }],
      expenses: [],
      investmentContributions: [],
      savingsAccounts: [corrupt, automatic('b')],
    })
    // 999 is NOT subtracted as manual; both accounts share the full pool
    expect(result.distributablePool).toBe(600000)
    expect(result.automaticAccountCount).toBe(2)
    expect(result.allocations).toEqual({ x: 300000, b: 300000 })
  })
})

/**
 * Story 45.1 (FR72) — the distributable pool never deducts the same money twice.
 *
 * Mathematical validation, zero tolerance (NFR3). Every expectation below is
 * HAND-COMPUTED. A test that calls the function under test to build its own
 * expectation passes even when the operator is wrong.
 *
 * ⚠️ THE REGRESSION FENCE IS THE UNFLAGGED ARM, NOT THE FLAGGED ONE. A suite that
 * only ever exercises `recordedAsExpense: true` proves nothing about the user who
 * legitimately has an expense line AND a contribution for DIFFERENT money — and
 * that user's pool must not move by a cent (epic AC-3). Cases 2 and 3 were written
 * before the implementation existed, for exactly that reason.
 */
describe('calculateDistributablePool — recordedAsExpense (Story 45.1, FR72)', () => {
  // One shared scenario, varied ONLY by the flag, so any difference in the
  // expected numbers is attributable to the flag and nothing else.
  //   income  $3,000/mo = 300000c
  //   expense   $500/mo =  50000c  ("TFSA contribution", the same money)
  //   TFSA contribution  =  50000c
  const scenario = (recordedAsExpense?: boolean) => ({
    incomeSources: [{ amount: 300_000, frequency: 'monthly' as const }],
    expenses: [{ amount: 50_000, frequency: 'monthly' as const }],
    investmentContributions: [
      recordedAsExpense === undefined
        ? { amount: 50_000, frequency: 'monthly' as const }
        : { amount: 50_000, frequency: 'monthly' as const, recordedAsExpense },
    ],
    savingsAccounts: [automatic('a')],
  })

  // --- Case 2: unflagged. TODAY'S NUMBER. This must not move. -----------------
  it('case 2 — unflagged: deducts twice, exactly as it does today (300000-50000-50000)', () => {
    // net = 300000 − 50000 = 250000; contributions = 50000; pool = 200000.
    // ⚠️ This "wrong-looking" figure is CORRECT for the different-money user and
    // is the number epic AC-3 forbids this story from changing.
    expect(calculateDistributablePool(scenario(false))).toBe(200_000)
  })

  // --- Case 3: field absent ≡ false -------------------------------------------
  it('case 3 — flag absent is identical to false', () => {
    expect(calculateDistributablePool(scenario(undefined))).toBe(200_000)
    expect(calculateDistributablePool(scenario(undefined))).toBe(
      calculateDistributablePool(scenario(false))
    )
  })

  // --- Case 1: flagged. The fix. ----------------------------------------------
  it('case 1 — flagged: the same money is deducted ONCE (the FR72 reproduction)', () => {
    // net = 300000 − 50000 = 250000; the flagged contribution is NOT subtracted
    // again, so pool = 250000. Before this story the same fixture returned 200000.
    expect(calculateDistributablePool(scenario(true))).toBe(250_000)
  })

  // --- Case 4: distinct money, both unflagged ---------------------------------
  it('case 4 — distinct money: both are deducted and the pool is unchanged', () => {
    // A user with a $500 RRSP expense and a SEPARATE $500 TFSA contribution.
    // Same amounts, different money — indistinguishable from case 2 in the data,
    // which is exactly why the distinguisher has to be user-supplied.
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 300_000, frequency: 'monthly' }],
      expenses: [{ amount: 50_000, frequency: 'monthly' }],
      investmentContributions: [{ amount: 50_000, frequency: 'monthly' }],
      savingsAccounts: [automatic('a')],
    })
    expect(pool).toBe(200_000)
  })

  // --- Case 5: manual-only accounts -------------------------------------------
  it('case 5 — manual-only accounts: manual sums subtracted, allocations empty', () => {
    const input = {
      incomeSources: [{ amount: 300_000, frequency: 'monthly' as const }],
      expenses: [{ amount: 50_000, frequency: 'monthly' as const }],
      investmentContributions: [
        { amount: 50_000, frequency: 'monthly' as const, recordedAsExpense: true },
      ],
      savingsAccounts: [manual('m1', 30_000), manual('m2', 20_000)],
    }
    // net 250000; flagged contribution skipped; manual 30000+20000 = 50000
    expect(calculateDistributablePool(input)).toBe(200_000)
    const solved = solveAutomaticAllocations(input)
    expect(solved.automaticAccountCount).toBe(0)
    expect(solved.allocations).toEqual({})
  })

  // --- Case 6: automatic-only, even split with exact cents ---------------------
  it('case 6 — automatic-only: even split with exact cents', () => {
    const input = {
      incomeSources: [{ amount: 300_001, frequency: 'monthly' as const }],
      expenses: [{ amount: 50_000, frequency: 'monthly' as const }],
      investmentContributions: [
        { amount: 50_000, frequency: 'monthly' as const, recordedAsExpense: true },
      ],
      savingsAccounts: [automatic('a'), automatic('b')],
    }
    // net 250001; flagged skipped; pool 250001 → 125001 / 125000
    const solved = solveAutomaticAllocations(input)
    expect(solved.distributablePool).toBe(250_001)
    expect(solved.allocations).toEqual({ a: 125_001, b: 125_000 })
  })

  // --- Case 7: zero automatic accounts ----------------------------------------
  it('case 7 — zero automatic accounts: pool still reported, allocations empty', () => {
    const solved = solveAutomaticAllocations({
      incomeSources: [{ amount: 300_000, frequency: 'monthly' }],
      expenses: [{ amount: 50_000, frequency: 'monthly' }],
      investmentContributions: [{ amount: 50_000, frequency: 'monthly', recordedAsExpense: true }],
      savingsAccounts: [],
    })
    expect(solved.distributablePool).toBe(250_000)
    expect(solved.automaticAccountCount).toBe(0)
    expect(solved.allocations).toEqual({})
  })

  // --- Case 8: pool would go negative -----------------------------------------
  it('case 8 — a flagged row cannot turn a negative pool positive; it clamps at 0', () => {
    // Expenses exceed income outright. Skipping the flagged contribution reduces
    // how negative the raw figure is, but the clamp still floors it at zero.
    const input = {
      incomeSources: [{ amount: 100_000, frequency: 'monthly' as const }],
      expenses: [{ amount: 400_000, frequency: 'monthly' as const }],
      investmentContributions: [
        { amount: 50_000, frequency: 'monthly' as const, recordedAsExpense: true },
      ],
      savingsAccounts: [automatic('a')],
    }
    // raw = 100000 − 400000 = −300000; flagged skipped; still −300000 → clamped 0
    expect(calculateDistributablePool(input)).toBe(0)
    const solved = solveAutomaticAllocations(input)
    expect(solved.allocations).toEqual({ a: 0 })
  })

  // --- Case 9: THE PRECISION TRAP ---------------------------------------------
  it('case 9 — a flagged row at a weekly cadence excludes its ROUNDED monthly value', () => {
    // ⚠️ `normalizeToMonthly` rounds PER ITEM with Math.round, and totals sum
    // already-rounded values. Excluding a row must remove exactly the rounded
    // value that row contributed — not an unrounded recomputation.
    //   11538c/wk × 52/12 = 49998.0  → Math.round = 49998
    //   11537c/wk × 52/12 = 49993.66 → Math.round = 49994
    const weekly = { amount: 11_538, frequency: 'weekly' as const }
    const other = { amount: 11_537, frequency: 'weekly' as const }

    const base = {
      incomeSources: [{ amount: 300_000, frequency: 'monthly' as const }],
      expenses: [],
      savingsAccounts: [automatic('a')],
    }

    const bothCounted = calculateDistributablePool({
      ...base,
      investmentContributions: [weekly, other],
    })
    // 300000 − 49998 − 49994 = 200008
    expect(bothCounted).toBe(200_008)

    const firstFlagged = calculateDistributablePool({
      ...base,
      investmentContributions: [{ ...weekly, recordedAsExpense: true }, other],
    })
    // 300000 − 49994 = 250006
    expect(firstFlagged).toBe(250_006)

    // The difference is EXACTLY the rounded contribution of the flagged row.
    expect(firstFlagged - bothCounted).toBe(49_998)
  })

  // --- Case 10: mixed flagged and unflagged ------------------------------------
  it('case 10 — with one flagged and one unflagged row, only the flagged one is skipped', () => {
    const pool = calculateDistributablePool({
      incomeSources: [{ amount: 300_000, frequency: 'monthly' }],
      expenses: [{ amount: 50_000, frequency: 'monthly' }],
      investmentContributions: [
        { amount: 50_000, frequency: 'monthly', recordedAsExpense: true },
        { amount: 30_000, frequency: 'monthly', recordedAsExpense: false },
      ],
      savingsAccounts: [automatic('a')],
    })
    // net 250000; skip 50000; deduct 30000 → 220000
    expect(pool).toBe(220_000)
  })

  // --- The skip must be strictly `=== true`, never truthy ----------------------
  it('treats a non-boolean truthy value as NOT flagged (the skip is strictly === true)', () => {
    // A persisted `"false"` string or a `1` from a hand-edited store must never
    // silently disable a real deduction. Only a genuine `true` skips.
    const withStringFalse = calculateDistributablePool({
      incomeSources: [{ amount: 300_000, frequency: 'monthly' }],
      expenses: [{ amount: 50_000, frequency: 'monthly' }],
      investmentContributions: [
        {
          amount: 50_000,
          frequency: 'monthly',
          recordedAsExpense: 'false' as unknown as boolean,
        },
      ],
      savingsAccounts: [automatic('a')],
    })
    expect(withStringFalse).toBe(200_000)
  })
})

/**
 * Story 45.1 — AC-5: the solver's invariants survive the pool change.
 * ⚠️ Assert Σ allocations against the POOL, never against a hard-coded total: a
 * constant passes when the pool and the split are wrong together.
 */
describe('solveAutomaticAllocations — invariants hold across the 45.1 matrix', () => {
  const cases: Array<{ name: string; input: Parameters<typeof solveAutomaticAllocations>[0] }> = [
    {
      name: 'flagged, single automatic account',
      input: {
        incomeSources: [{ amount: 300_000, frequency: 'monthly' }],
        expenses: [{ amount: 50_000, frequency: 'monthly' }],
        investmentContributions: [
          { amount: 50_000, frequency: 'monthly', recordedAsExpense: true },
        ],
        savingsAccounts: [automatic('a')],
      },
    },
    {
      // ⚠️ 250_001 % 3 === 2, so TWO accounts take an extra cent. The first
      // draft of this case used 300_002 → a pool of 250_002, which divides by 3
      // EXACTLY — the fixture was named "indivisible" and was not, so the
      // largest-remainder path these invariants exist to protect was never
      // executed and mutation arms M5/M6 left them GREEN. Measured, not assumed.
      name: 'flagged, three automatic accounts with an indivisible pool',
      input: {
        incomeSources: [{ amount: 300_001, frequency: 'monthly' }],
        expenses: [{ amount: 50_000, frequency: 'monthly' }],
        investmentContributions: [
          { amount: 50_000, frequency: 'monthly', recordedAsExpense: true },
        ],
        savingsAccounts: [automatic('a'), automatic('b'), automatic('c')],
      },
    },
    {
      // 500_001 − 50_000 = 450_001; weekly 30_000 → 130_000; manual 25_000 ⇒
      // pool 295_001 over 2 automatic accounts, i.e. an odd pool with a leftover
      // cent. Same correction as above: 500_000 gave an exactly-even 147_500.
      name: 'mixed flagged/unflagged with manual and automatic accounts',
      input: {
        incomeSources: [{ amount: 500_001, frequency: 'monthly' }],
        expenses: [{ amount: 50_000, frequency: 'monthly' }],
        investmentContributions: [
          { amount: 50_000, frequency: 'monthly', recordedAsExpense: true },
          { amount: 30_000, frequency: 'weekly' },
        ],
        savingsAccounts: [manual('m', 25_000), automatic('a'), automatic('b')],
      },
    },
    {
      name: 'clamped-to-zero pool',
      input: {
        incomeSources: [{ amount: 100_000, frequency: 'monthly' }],
        expenses: [{ amount: 400_000, frequency: 'monthly' }],
        investmentContributions: [
          { amount: 50_000, frequency: 'monthly', recordedAsExpense: true },
        ],
        savingsAccounts: [automatic('a'), automatic('b')],
      },
    },
  ]

  for (const { name, input } of cases) {
    it(`preserves the total exactly — ${name}`, () => {
      const { distributablePool, allocations, automaticAccountCount } =
        solveAutomaticAllocations(input)
      const total = Object.values(allocations).reduce((sum, cents) => sum + cents, 0)
      expect(total).toBe(distributablePool)
      expect(Object.keys(allocations)).toHaveLength(automaticAccountCount)
    })

    it(`splits within one cent and creates no cent — ${name}`, () => {
      const { distributablePool, allocations, automaticAccountCount } =
        solveAutomaticAllocations(input)
      if (automaticAccountCount === 0) {
        expect(allocations).toEqual({})
        return
      }
      const shares = Object.values(allocations)
      const base = Math.floor(distributablePool / automaticAccountCount)
      for (const share of shares) {
        expect(share === base || share === base + 1).toBe(true)
      }
      // exactly `pool mod N` accounts receive the extra cent
      expect(shares.filter((s) => s === base + 1)).toHaveLength(
        distributablePool % automaticAccountCount
      )
    })
  }
})
