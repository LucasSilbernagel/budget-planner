/**
 * Normalizes downward while the income fixture normalizes upward, so a direction error cannot
 * pass both suites.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useExpenseStore } from '../expenseStore'

const base = {
	userId: 0,
	categoryId: null,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
}

/**
 * weekly round(5000 × 52/12) = 21667, monthly 90000, annually 120000 / 12 = 10000 → 121667.
 * Raw sum: 215000.
 */
const MIXED_EXPENSES = [
	{
		id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		name: 'Groceries',
		amount: 5000,
		frequency: 'weekly' as const,
		...base,
	},
	{
		id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		name: 'Rent',
		amount: 90000,
		frequency: 'monthly' as const,
		...base,
	},
	{
		id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
		name: 'Insurance',
		amount: 120000,
		frequency: 'annually' as const,
		...base,
	},
]

const RAW_SUM = 215000
const NORMALIZED_MONTHLY = 121667

beforeEach(() => {
	localStorage.clear()
	useExpenseStore.setState({ expenses: [] })
})

describe('expenseStore — getTotalExpenses', () => {
	it('normalizes mixed frequencies to a monthly basis instead of raw-summing', () => {
		useExpenseStore.setState({ expenses: MIXED_EXPENSES })

		expect(useExpenseStore.getState().getTotalExpenses()).toBe(NORMALIZED_MONTHLY)
	})

	it('does NOT return the raw sum (the defect this story fixes)', () => {
		useExpenseStore.setState({ expenses: MIXED_EXPENSES })

		expect(RAW_SUM).not.toBe(NORMALIZED_MONTHLY)
		expect(useExpenseStore.getState().getTotalExpenses()).not.toBe(RAW_SUM)
	})

	it('normalizes downward when annual rows dominate, not merely "differently"', () => {
		useExpenseStore.setState({ expenses: MIXED_EXPENSES })

		// Pins the direction: a reciprocal-multiplier bug would still differ from the raw sum.
		expect(useExpenseStore.getState().getTotalExpenses()).toBeLessThan(RAW_SUM)
	})

	it('returns 0 for an empty list without NaN', () => {
		const total = useExpenseStore.getState().getTotalExpenses()

		expect(total).toBe(0)
		expect(Number.isNaN(total)).toBe(false)
	})

	it('agrees with a biweekly row normalized at 26/12', () => {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
					name: 'Childcare',
					amount: 10000,
					frequency: 'biweekly',
					...base,
				},
			],
		})

		expect(useExpenseStore.getState().getTotalExpenses()).toBe(21667)
	})

	it('returns a number, never an object', () => {
		useExpenseStore.setState({ expenses: MIXED_EXPENSES })

		expect(typeof useExpenseStore.getState().getTotalExpenses()).toBe('number')
	})
})

describe('expenseStore — corrupt rows are excluded, not thrown on', () => {
	it('does not throw on a corrupt persisted frequency', () => {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					name: 'Corrupt',
					amount: 10000,
					frequency: 'daily' as never,
					...base,
				},
				{
					id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
					name: 'Rent',
					amount: 90000,
					frequency: 'monthly',
					...base,
				},
			],
		})

		expect(() => useExpenseStore.getState().getTotalExpenses()).not.toThrow()
	})

	it('excludes the unreadable row from the total rather than guessing its period', () => {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					name: 'Corrupt',
					amount: 10000,
					frequency: 'daily' as never,
					...base,
				},
				{
					id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
					name: 'Rent',
					amount: 90000,
					frequency: 'monthly',
					...base,
				},
			],
		})

		expect(useExpenseStore.getState().getTotalExpenses()).toBe(90000)
	})

	it('counts unreadable rows so the page can disclose them', () => {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
					name: 'Corrupt',
					amount: 10000,
					frequency: 'daily' as never,
					...base,
				},
				{
					id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
					name: 'Rent',
					amount: 90000,
					frequency: 'monthly',
					...base,
				},
			],
		})

		expect(useExpenseStore.getState().getUnreadableExpenseCount()).toBe(1)
	})

	it('reports zero unreadable rows for clean data', () => {
		useExpenseStore.setState({ expenses: MIXED_EXPENSES })

		expect(useExpenseStore.getState().getUnreadableExpenseCount()).toBe(0)
	})
	/**
	 * migrate only runs on a version mismatch, so a current-version blob can deliver a bad element
	 * straight into state.
	 */
	it.each([null, undefined, 42, 'nonsense'])(
		'does not throw when the persisted array contains %p',
		(bad) => {
			useExpenseStore.setState({ expenses: [MIXED_EXPENSES[1], bad as never] })

			expect(() => useExpenseStore.getState().getTotalExpenses()).not.toThrow()
			expect(useExpenseStore.getState().getTotalExpenses()).toBe(90000)
			expect(useExpenseStore.getState().getUnreadableExpenseCount()).toBe(1)
		}
	)
})
