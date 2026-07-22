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
