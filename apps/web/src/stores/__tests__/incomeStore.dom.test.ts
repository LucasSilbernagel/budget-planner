/**
 * Fixtures are mixed-frequency: at a single frequency the raw and normalized sums are equal.
 * Expectations are hand-computed literals, never re-derived with the implementation's helpers.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useIncomeStore } from '../incomeStore'

const base = {
	userId: 0,
	categoryId: null,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
}

/**
 * weekly round(20000 × 52/12) = 86667, monthly 150000, annually 60000 / 12 = 5000 → 241667.
 * Raw sum: 230000.
 */
const MIXED_INCOME = [
	{
		id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		name: 'Side gig',
		amount: 20000,
		frequency: 'weekly' as const,
		...base,
	},
	{
		id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		name: 'Salary',
		amount: 150000,
		frequency: 'monthly' as const,
		...base,
	},
	{
		id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
		name: 'Bonus',
		amount: 60000,
		frequency: 'annually' as const,
		...base,
	},
]

const RAW_SUM = 230000
const NORMALIZED_MONTHLY = 241667

beforeEach(() => {
	localStorage.clear()
	useIncomeStore.setState({ incomeSources: [] })
})

describe('incomeStore — getTotalIncome (story 32.1, FR58)', () => {
	it('normalizes mixed frequencies to a monthly basis instead of raw-summing', () => {
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })

		expect(useIncomeStore.getState().getTotalIncome()).toBe(NORMALIZED_MONTHLY)
	})

	it('does NOT return the raw sum (the defect this story fixes)', () => {
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })

		// If these were equal the test above could not distinguish broken from fixed.
		expect(RAW_SUM).not.toBe(NORMALIZED_MONTHLY)
		expect(useIncomeStore.getState().getTotalIncome()).not.toBe(RAW_SUM)
	})

	it('returns 0 for an empty list without NaN', () => {
		const total = useIncomeStore.getState().getTotalIncome()

		expect(total).toBe(0)
		expect(Number.isNaN(total)).toBe(false)
	})

	it('agrees with a biweekly row normalized at 26/12', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
					name: 'Stipend',
					amount: 10000,
					frequency: 'biweekly',
					...base,
				},
			],
		})

		// round(10000 × 26/12) = round(21666.66…) = 21667
		expect(useIncomeStore.getState().getTotalIncome()).toBe(21667)
	})

	it('returns a number, never an object', () => {
		// Called inside a zustand selector, so it must return a number.
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })

		expect(typeof useIncomeStore.getState().getTotalIncome()).toBe('number')
	})
})

describe('incomeStore — corrupt rows are excluded, not thrown on (story 32.1)', () => {
	/** core's validateFrequency throws outside the four values, and stored rows are user-editable. */
	it('does not throw on a corrupt persisted frequency', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					name: 'Corrupt',
					amount: 10000,
					frequency: 'daily' as never,
					...base,
				},
				{
					id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
					name: 'Salary',
					amount: 150000,
					frequency: 'monthly',
					...base,
				},
			],
		})

		expect(() => useIncomeStore.getState().getTotalIncome()).not.toThrow()
	})

	it('excludes the unreadable row from the total rather than guessing its period', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					name: 'Corrupt',
					amount: 10000,
					frequency: 'daily' as never,
					...base,
				},
				{
					id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
					name: 'Salary',
					amount: 150000,
					frequency: 'monthly',
					...base,
				},
			],
		})

		// Coercing the corrupt row to monthly would report 160000, a number the user never entered.
		expect(useIncomeStore.getState().getTotalIncome()).toBe(150000)
	})

	it('does not throw on a non-finite amount', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					name: 'Broken',
					amount: Number.NaN,
					frequency: 'monthly',
					...base,
				},
			],
		})

		expect(() => useIncomeStore.getState().getTotalIncome()).not.toThrow()
		expect(useIncomeStore.getState().getTotalIncome()).toBe(0)
	})

	it('counts unreadable rows so the page can disclose them', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					name: 'Corrupt',
					amount: 10000,
					frequency: 'daily' as never,
					...base,
				},
				{
					id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
					name: 'Salary',
					amount: 150000,
					frequency: 'monthly',
					...base,
				},
			],
		})

		expect(useIncomeStore.getState().getUnreadableIncomeCount()).toBe(1)
	})

	it('reports zero unreadable rows for clean data', () => {
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })

		expect(useIncomeStore.getState().getUnreadableIncomeCount()).toBe(0)
	})
	/**
	 * migrate only runs on a version mismatch, so a current-version blob can deliver a bad element
	 * straight into state.
	 */
	it.each([null, undefined, 42, 'nonsense'])(
		'does not throw when the persisted array contains %p',
		(bad) => {
			useIncomeStore.setState({ incomeSources: [MIXED_INCOME[1], bad as never] })

			expect(() => useIncomeStore.getState().getTotalIncome()).not.toThrow()
			expect(useIncomeStore.getState().getTotalIncome()).toBe(150000)
			expect(useIncomeStore.getState().getUnreadableIncomeCount()).toBe(1)
		}
	)
})
