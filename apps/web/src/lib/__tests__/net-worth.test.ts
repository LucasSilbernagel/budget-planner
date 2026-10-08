import { describe, expect, it } from 'vitest'
import { netWorthFromTotals } from '../net-worth'

/** Expectations are hand-computed; deriving them via `netWorthFromTotals` would mirror an operator bug. */

const FIXTURE = {
	investmentsCents: 2_000_000,
	savingsCents: 300_000,
	assetsCents: 0,
	debtsCents: 15_000_000,
}

/** Every component is non-zero and distinct so a swapped or dropped term is visible. */
const ASSET_FIXTURE = {
	investmentsCents: 5_000_000,
	savingsCents: 300_000,
	assetsCents: 40_000_000,
	debtsCents: 30_000_000,
}

describe('netWorthFromTotals', () => {
	it('adds investments and savings, subtracts debts (the shared story fixture)', () => {
		// 2,000,000 + 300,000 − 15,000,000
		expect(netWorthFromTotals(FIXTURE)).toBe(-12_700_000)
	})

	it('does not silently drop savings (the pre-32.2 definition)', () => {
		expect(netWorthFromTotals(FIXTURE)).not.toBe(-13_000_000)
	})

	it('returns the savings total for a savings-only user', () => {
		const savingsOnly = {
			investmentsCents: 0,
			savingsCents: 300_000,
			assetsCents: 0,
			debtsCents: 0,
		}
		expect(netWorthFromTotals(savingsOnly)).toBe(300_000)
	})

	it('returns the negated debt total for a debt-only user', () => {
		const debtOnly = {
			investmentsCents: 0,
			savingsCents: 0,
			assetsCents: 0,
			debtsCents: 15_000_000,
		}
		expect(netWorthFromTotals(debtOnly)).toBe(-15_000_000)
	})

	it('isolates savings when investments and debts cancel exactly', () => {
		expect(
			netWorthFromTotals({
				investmentsCents: 2_000_000,
				savingsCents: 300_000,
				assetsCents: 0,
				debtsCents: 2_000_000,
			})
		).toBe(300_000)
	})

	it('returns zero when every total is zero', () => {
		expect(
			netWorthFromTotals({
				investmentsCents: 0,
				savingsCents: 0,
				assetsCents: 0,
				debtsCents: 0,
			})
		).toBe(0)
	})

	it('returns the asset total for an asset-only user', () => {
		expect(
			netWorthFromTotals({
				investmentsCents: 0,
				savingsCents: 0,
				assetsCents: 40_000_000,
				debtsCents: 0,
			})
		).toBe(40_000_000)
	})

	it('is POSITIVE for a condo worth more than the mortgage against it (FR70)', () => {
		expect(
			netWorthFromTotals({
				investmentsCents: 0,
				savingsCents: 0,
				assetsCents: 40_000_000,
				debtsCents: 30_000_000,
			})
		).toBe(10_000_000)
	})

	it('adds assets alongside investments and savings, and subtracts debts', () => {
		// 5,000,000 + 300,000 + 40,000,000 − 30,000,000
		expect(netWorthFromTotals(ASSET_FIXTURE)).toBe(15_300_000)
	})

	it('does not drop the asset term', () => {
		// The value this fixture would produce if `assetsCents` were ignored.
		expect(netWorthFromTotals(ASSET_FIXTURE)).not.toBe(-24_700_000)
	})

	it('adds assets rather than subtracting them', () => {
		// The value a sign slip on the asset term would produce.
		expect(netWorthFromTotals(ASSET_FIXTURE)).not.toBe(-64_700_000)
	})

	it('isolates assets when investments, savings and debts cancel exactly', () => {
		expect(
			netWorthFromTotals({
				investmentsCents: 1_000_000,
				savingsCents: 0,
				assetsCents: 40_000_000,
				debtsCents: 1_000_000,
			})
		).toBe(40_000_000)
	})
})
