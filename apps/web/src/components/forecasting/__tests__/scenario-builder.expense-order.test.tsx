import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { rowsFromStores, ScenarioBuilder } from '../scenario-builder'

vi.mock('../../../stores/currencyStore', () => ({
	useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
	useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
	useCurrencyMode: () => 'none',
	useCurrencyCode: () => 'NONE',
}))

const NOW = '2026-10-07T00:00:00.000Z'

const rows = [
	{ name: 'Phone', amount: 5_000, frequency: 'monthly' as const },
	{ name: 'Insurance', amount: 240_000, frequency: 'annually' as const },
	{ name: 'Rent', amount: 150_000, frequency: 'monthly' as const },
	{ name: 'Internet', amount: 5_000, frequency: 'monthly' as const },
]
const expected = ['Rent', 'Insurance', 'Phone', 'Internet']

describe('expense row order', () => {
	it('seeds a fresh scenario from the stores highest monthly equivalent first', () => {
		const seeded = rowsFromStores({
			income: [],
			expenses: rows.map((row, index) => ({
				...row,
				id: `exp-${index}`,
				profileId: 'p',
				userId: 0,
				categoryId: null,
				createdAt: NOW,
				updatedAt: NOW,
			})),
			savingsGoals: [],
			balanceEntries: [],
			contributionItems: [],
		})

		expect(seeded.expenseItems.map((item) => item.name)).toEqual(expected)
		expect(seeded.unfilteredExpenseItems.map((item) => item.name)).toEqual(expected)
		expect(new Set(seeded.expenseItems.map((item) => item.id)).size).toBe(rows.length)
	})

	it('loads a saved forecast highest monthly equivalent first', () => {
		const saved = {
			id: 'saved-1',
			name: 'Plan',
			scenario: {
				name: 'Plan',
				incomeGrowthRate: 0,
				expenseGrowthRate: 0,
				newIncome: [],
				newExpenses: rows,
				oneTimeEvents: [],
			},
			result: {
				scenario: { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
				baseline: [],
				projection: [],
				summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
			},
			createdAt: NOW,
			updatedAt: NOW,
		} satisfies SavedForecast
		render(<ScenarioBuilder onSave={vi.fn()} initialForecast={saved} />)

		const section = screen.getByRole('heading', { name: 'Expense Categories' }).parentElement
			?.parentElement as HTMLElement
		const names = within(section)
			.getAllByLabelText(/^name$/i)
			.map((input) => (input as HTMLInputElement).value)
		expect(names).toEqual(expected)
	})
})
