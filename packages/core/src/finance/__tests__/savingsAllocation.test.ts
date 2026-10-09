import { describe, expect, it } from 'vitest'
import {
	type AllocationAccount,
	calculateDistributablePool,
	solveAutomaticAllocations,
} from '../savingsAllocation.js'

// Deliberately not annotated `AllocationAccount`, so the literal escapes
// excess-property checks and can carry `targetAmount: null`.
const manual = (id: string, monthlyAllocation: number | null): AllocationAccount => ({
	id,
	allocationMode: 'manual',
	monthlyAllocation,
})
const automatic = (id: string): AllocationAccount => ({
	id,
	allocationMode: 'automatic',
})
const account = (id: string) => ({
	id,
	targetAmount: null,
	allocationMode: 'automatic' as const,
})
const manualAccount = (id: string, monthlyAllocation: number | null) => ({
	id,
	targetAmount: null,
	allocationMode: 'manual' as const,
	monthlyAllocation,
})

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
		const corrupt = {
			id: 'x',
			allocationMode: 'auto',
			monthlyAllocation: 999,
			// `unknown` first: 'auto' is not an `AllocationMode`, which is the point.
		} as unknown as AllocationAccount
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

describe('target-less entries are allocated like goals', () => {
	const income = [{ amount: 600_000, frequency: 'monthly' as const }]

	it('an automatic target-less entry RECEIVES an even share', () => {
		// pool 600_000, no deductions; 2 automatic rows ⇒ 600_000 / 2 = 300_000 each.
		const result = solveAutomaticAllocations({
			incomeSources: income,
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [automatic('goal'), account('acct')],
		})
		expect(result.allocations).toEqual({ goal: 300_000, acct: 300_000 })
		expect(result.automaticAccountCount).toBe(2)
	})

	it('adding a target-less entry halves a goal’s share', () => {
		// Pool 50_000c: without the account the goal takes it all; with it, 25_000c each.
		const withoutAccount = solveAutomaticAllocations({
			incomeSources: [{ amount: 50_000, frequency: 'monthly' }],
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [automatic('goal')],
		})
		const withAccount = solveAutomaticAllocations({
			incomeSources: [{ amount: 50_000, frequency: 'monthly' }],
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [automatic('goal'), account('acct')],
		})
		expect(withoutAccount.allocations.goal).toBe(50_000)
		expect(withAccount.allocations).toEqual({ goal: 25_000, acct: 25_000 })
	})

	it('a MANUAL target-less entry consumes the manual deduction', () => {
		// 600_000 − 250_000 (the account's fixed amount) = 350_000.
		const pool = calculateDistributablePool({
			incomeSources: income,
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [automatic('goal'), manualAccount('acct', 250_000)],
		})
		expect(pool).toBe(350_000)
	})

	it('a manual GOAL still consumes the deduction — the negative control', () => {
		// 600_000 − 250_000 = 350_000.
		const pool = calculateDistributablePool({
			incomeSources: income,
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [automatic('goal'), manual('fixed', 250_000)],
		})
		expect(pool).toBe(350_000)
	})

	it('a row with NO `targetAmount` key at all is allocated normally', () => {
		// Guards against reintroducing a target check: an absent key must not mean "account".
		// 600_000 / 2 = 300_000 each.
		const noTargetKey = { id: 'acct', allocationMode: 'automatic' as const }
		const result = solveAutomaticAllocations({
			incomeSources: income,
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [automatic('goal'), noTargetKey],
		})
		expect(result.allocations).toEqual({ goal: 300_000, acct: 300_000 })
	})

	it('an all-target-less page SPLITS the pool among its automatic entries', () => {
		// 600_000 − 100_000 (c, manual) = 500_000 over a, b ⇒ 250_000 each.
		const result = solveAutomaticAllocations({
			incomeSources: income,
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [account('a'), account('b'), manualAccount('c', 100_000)],
		})
		expect(result.distributablePool).toBe(500_000)
		expect(result.automaticAccountCount).toBe(2)
		expect(result.allocations).toEqual({ a: 250_000, b: 250_000 })
	})

	it('leftover cents are shared across goals AND target-less entries, creating none', () => {
		// pool 100c over 3 automatic rows: floor(100 / 3) = 33, remainder 1, handed
		// to the FIRST row in input order ⇒ 34 / 33 / 33, summing to exactly 100.
		const result = solveAutomaticAllocations({
			incomeSources: [{ amount: 100, frequency: 'monthly' }],
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [automatic('goal'), account('acct-1'), account('acct-2')],
		})
		expect(result.allocations).toEqual({ goal: 34, 'acct-1': 33, 'acct-2': 33 })
		const sum = Object.values(result.allocations).reduce((s, v) => s + v, 0)
		expect(sum).toBe(100)
		expect(sum).toBe(result.distributablePool)
	})

	it('target-less entries that are ALL manual: pool reported, no recipients, no division', () => {
		// 600_000 − 100_000 − 50_000 = 450_000; zero automatic rows ⇒ empty
		// `allocations` and a count of 0.
		const result = solveAutomaticAllocations({
			incomeSources: income,
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [manualAccount('a', 100_000), manualAccount('b', 50_000)],
		})
		expect(result.distributablePool).toBe(450_000)
		expect(result.automaticAccountCount).toBe(0)
		expect(result.allocations).toEqual({})
	})

	it('a zero target is allocated like any other row', () => {
		// 0, null and a real target must allocate identically; sole automatic row ⇒ 600_000.
		const zeroTarget = { id: 'z', targetAmount: 0, allocationMode: 'automatic' as const }
		const result = solveAutomaticAllocations({
			incomeSources: income,
			expenses: [],
			investmentContributions: [],
			savingsAccounts: [zeroTarget],
		})
		expect(result.allocations).toEqual({ z: 600_000 })
	})
})

// The unflagged arm is the regression fence: a user with an expense and a contribution
// for different money must see the pool unchanged.
describe('calculateDistributablePool — recordedAsExpense', () => {
	// income 300000c, expense 50000c ("TFSA contribution"), contribution 50000c; only the
	// flag varies.
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

	it('case 2 — unflagged: deducts twice, exactly as it does today (300000-50000-50000)', () => {
		// net 250000 − contribution 50000 = 200000: correct for the different-money user.
		expect(calculateDistributablePool(scenario(false))).toBe(200_000)
	})

	it('case 3 — flag absent is identical to false', () => {
		expect(calculateDistributablePool(scenario(undefined))).toBe(200_000)
		expect(calculateDistributablePool(scenario(undefined))).toBe(
			calculateDistributablePool(scenario(false))
		)
	})

	it('case 1 — flagged: the same money is deducted ONCE (the double-deduction reproduction)', () => {
		// net 250000; the flagged contribution is not subtracted again.
		expect(calculateDistributablePool(scenario(true))).toBe(250_000)
	})

	it('case 4 — distinct money: both are deducted and the pool is unchanged', () => {
		// Same amounts, different money: indistinguishable from case 2, so the flag must be
		// user-supplied.
		const pool = calculateDistributablePool({
			incomeSources: [{ amount: 300_000, frequency: 'monthly' }],
			expenses: [{ amount: 50_000, frequency: 'monthly' }],
			investmentContributions: [{ amount: 50_000, frequency: 'monthly' }],
			savingsAccounts: [automatic('a')],
		})
		expect(pool).toBe(200_000)
	})

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

	it('case 8 — a flagged row cannot turn a negative pool positive; it clamps at 0', () => {
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

	it('case 9 — a flagged row at a weekly cadence excludes its ROUNDED monthly value', () => {
		// normalizeToMonthly rounds per item: 11538c/wk → 49998, 11537c/wk → 49993.67 → 49994.
		// Excluding a row must remove exactly its rounded value.
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

		expect(firstFlagged - bothCounted).toBe(49_998)
	})

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

	it('treats a non-boolean truthy value as NOT flagged (the skip is strictly === true)', () => {
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

// Payroll-deducted users have no expense row (income is already take-home); these
// cases cover that shape.
describe('calculateDistributablePool — the two populations', () => {
	it('shape B — payroll-deducted: take-home income, no expense row, flagged → nothing subtracted', () => {
		// The $500 never reached take-home income, so it must not be subtracted.
		// net 250000; flagged skipped; pool 250000.
		expect(
			calculateDistributablePool({
				incomeSources: [{ amount: 250_000, frequency: 'monthly' }],
				expenses: [],
				investmentContributions: [
					{ amount: 50_000, frequency: 'monthly', recordedAsExpense: true },
				],
				savingsAccounts: [automatic('a')],
			})
		).toBe(250_000)
	})

	it('shape B — the same rows UNFLAGGED are the defect the wording exists to fix', () => {
		// Flag off: 250000 − 50000 = 200000, understating by the contribution.
		expect(
			calculateDistributablePool({
				incomeSources: [{ amount: 250_000, frequency: 'monthly' }],
				expenses: [],
				investmentContributions: [{ amount: 50_000, frequency: 'monthly' }],
				savingsAccounts: [automatic('a')],
			})
		).toBe(200_000)
	})

	it('shape C — payroll-deducted AND also listed on Expenses: ticking is not enough', () => {
		// net 250000 − 50000 = 200000; the truthful pool is 250000 because the expense line
		// subtracts money never in take-home.
		const ticked = calculateDistributablePool({
			incomeSources: [{ amount: 250_000, frequency: 'monthly' }],
			expenses: [{ amount: 50_000, frequency: 'monthly' }],
			investmentContributions: [{ amount: 50_000, frequency: 'monthly', recordedAsExpense: true }],
			savingsAccounts: [automatic('a')],
		})
		expect(ticked).toBe(200_000)

		const untickedSameRows = calculateDistributablePool({
			incomeSources: [{ amount: 250_000, frequency: 'monthly' }],
			expenses: [{ amount: 50_000, frequency: 'monthly' }],
			investmentContributions: [{ amount: 50_000, frequency: 'monthly' }],
			savingsAccounts: [automatic('a')],
		})
		expect(untickedSameRows).toBe(150_000)

		// Ticking recovers half the 100000 error; removing the expense line recovers all.
		const expenseLineRemoved = calculateDistributablePool({
			incomeSources: [{ amount: 250_000, frequency: 'monthly' }],
			expenses: [],
			investmentContributions: [{ amount: 50_000, frequency: 'monthly', recordedAsExpense: true }],
			savingsAccounts: [automatic('a')],
		})
		expect(expenseLineRemoved).toBe(250_000)
	})

	it('shape D — gross income entered: ticking OVERSTATES the pool, so the copy must exclude this user', () => {
		// A known wrong answer: gross income entered and ticked means the $500 is subtracted
		// nowhere. Leaving it unticked is correct for them.
		const base = {
			incomeSources: [{ amount: 300_000, frequency: 'monthly' as const }],
			expenses: [],
			savingsAccounts: [automatic('a')],
		}
		const unticked = calculateDistributablePool({
			...base,
			investmentContributions: [{ amount: 50_000, frequency: 'monthly' }],
		})
		const ticked = calculateDistributablePool({
			...base,
			investmentContributions: [{ amount: 50_000, frequency: 'monthly', recordedAsExpense: true }],
		})
		expect(unticked).toBe(250_000)
		expect(ticked).toBe(300_000)
	})

	it('excludes the flagged row at its ROUNDED value even when that rounding is inexact', () => {
		// Flags the inexact row (11537c/wk → 49993.67 → 49994) to separate skip-then-round
		// (250002) from an unrounded recompute (250001.67).
		const pool = calculateDistributablePool({
			incomeSources: [{ amount: 300_000, frequency: 'monthly' }],
			expenses: [],
			investmentContributions: [
				{ amount: 11_537, frequency: 'weekly', recordedAsExpense: true },
				{ amount: 11_538, frequency: 'weekly' },
			],
			savingsAccounts: [automatic('a')],
		})
		// Integrality first; reversed, it's implied by the toBe and can never fail alone.
		expect(Number.isInteger(pool)).toBe(true)
		expect(pool).toBe(250_002)
	})
})

// Assert Σ allocations against the pool, never a constant: a constant passes when pool
// and split are wrong together.
describe('solveAutomaticAllocations — invariants hold across the 45.1 matrix', () => {
	const cases = [
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
			// 250_001 % 3 === 2, so two accounts take an extra cent.
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
			// 500_001 − 50_000 = 450_001; weekly 30_000 → 130_000; manual 25_000 ⇒ odd pool
			// 295_001 over 2 accounts.
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
	] satisfies Array<{ name: string; input: Parameters<typeof solveAutomaticAllocations>[0] }>

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
