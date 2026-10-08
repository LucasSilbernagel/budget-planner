import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore, useExpenseStore, useIncomeStore, useSavingsStore } from '../../stores'
import { type ClientCategory, useCategoryStore } from '../../stores/categoryStore'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

import { HomePage } from '../HomePage'

function category(overrides: Partial<ClientCategory> & { id: string }): ClientCategory {
	return {
		userId: 0,
		profileId: null,
		name: 'Groceries',
		kind: 'expense',
		isDeleted: false,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	}
}

function expenseRow(id: string, name: string, amount: number, categoryId: string | null) {
	return {
		id,
		userId: 0,
		name,
		amount,
		frequency: 'monthly' as const,
		categoryId,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

function incomeRow(id: string, name: string, amount: number, categoryId: string | null) {
	return {
		id,
		userId: 0,
		name,
		amount,
		frequency: 'monthly' as const,
		categoryId,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

function expensePie(): HTMLElement {
	const heading = screen.getByRole('heading', { name: /expenses by category/i })
	const card = heading.parentElement?.parentElement
	if (!card) {
		throw new Error('Expense pie card not found — BreakdownPie markup changed')
	}
	return card
}

function expenseLegend(): HTMLElement {
	return within(expensePie()).getByRole('list')
}

beforeEach(() => {
	vi.clearAllMocks()
	usePremiumAccess.mockReturnValue({
		status: {
			hasAccess: false,
			subscriptionStatus: 'free',
			isLoading: false,
			error: null,
			isAuthenticated: false,
		} satisfies PremiumAccessStatus,
	})
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
	useCategoryStore.setState({ categories: [] })
})

describe('AC-7: two rows sharing a category merge into one slice', () => {
	it('shows the category once with the summed figure, and neither row name', () => {
		useCategoryStore.setState({
			categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
		})
		useExpenseStore.setState({
			expenses: [
				expenseRow('x1', 'Tesco run', 5000, 'e1'),
				expenseRow('x2', 'Aldi run', 3000, 'e1'),
			],
		})

		render(<HomePage />)
		const legend = expenseLegend()

		expect(within(legend).getAllByRole('listitem')).toHaveLength(1)
		expect(within(legend).getByText('Groceries')).toBeInTheDocument()
		expect(within(legend).getByText('960.00')).toBeInTheDocument()
		expect(within(legend).queryByText('Tesco run')).not.toBeInTheDocument()
		expect(within(legend).queryByText('Aldi run')).not.toBeInTheDocument()
		expect(within(legend).queryByText('600.00')).not.toBeInTheDocument()
		expect(within(legend).queryByText('360.00')).not.toBeInTheDocument()
	})

	it('keeps two DIFFERENT categories as two slices', () => {
		useCategoryStore.setState({
			categories: [
				category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
				category({ id: 'e2', name: 'Housing', kind: 'expense' }),
			],
		})
		useExpenseStore.setState({
			expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1'), expenseRow('x2', 'Rent', 3000, 'e2')],
		})

		render(<HomePage />)
		const legend = expenseLegend()

		expect(within(legend).getAllByRole('listitem')).toHaveLength(2)
		expect(within(legend).getByText('Groceries')).toBeInTheDocument()
		expect(within(legend).getByText('Housing')).toBeInTheDocument()
		expect(within(legend).getByText('600.00')).toBeInTheDocument()
		expect(within(legend).getByText('360.00')).toBeInTheDocument()
	})

	it('an UNCATEGORIZED row still falls back to its own name (Decision 10)', () => {
		useCategoryStore.setState({
			categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
		})
		useExpenseStore.setState({
			expenses: [
				expenseRow('x1', 'Tesco run', 5000, 'e1'),
				expenseRow('x2', 'Netflix', 3000, null),
			],
		})

		render(<HomePage />)
		const legend = expenseLegend()

		expect(within(legend).getByText('Groceries')).toBeInTheDocument()
		expect(within(legend).getByText('Netflix')).toBeInTheDocument()
	})

	it('never leaks a raw categoryId uuid into the legend', () => {
		useCategoryStore.setState({
			categories: [category({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Groceries' })],
		})
		useExpenseStore.setState({
			expenses: [expenseRow('x1', 'Tesco run', 5000, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')],
		})

		render(<HomePage />)

		expect(within(expenseLegend()).getByText('Groceries')).toBeInTheDocument()
		// Recharts renders no SVG under jsdom, so this only guards the slice list.
		expect(screen.queryByText(/cccccccc-cc/)).not.toBeInTheDocument()
	})
})

describe('AC-7: a rename re-renders the pies', () => {
	it('follows a category rename with no other store change (the memo dependency)', () => {
		useCategoryStore.setState({
			categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
		})
		useExpenseStore.setState({ expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1')] })

		render(<HomePage />)
		expect(within(expenseLegend()).getByText('Groceries')).toBeInTheDocument()

		// Only the category store changes, so a missing categoryNames memo dependency keeps the old label.
		act(() => {
			useCategoryStore.getState().renameCategory('e1', 'Food')
		})

		const legend = expenseLegend()
		expect(within(legend).getByText('Food')).toBeInTheDocument()
		expect(within(legend).queryByText('Groceries')).not.toBeInTheDocument()
	})
})

describe('AC-3: a dangling categoryId degrades gracefully in the pies', () => {
	it('CAUSE 1 (pull pagination): an id not yet on this device falls back to the row name', () => {
		useCategoryStore.setState({
			categories: [category({ id: 'e-other', name: 'Housing', kind: 'expense' })],
		})
		useExpenseStore.setState({
			expenses: [expenseRow('x1', 'Tesco run', 5000, 'e-not-yet-pulled')],
		})

		render(<HomePage />)
		const legend = expenseLegend()

		expect(within(legend).getByText('Tesco run')).toBeInTheDocument()
		expect(screen.queryByText(/e-not-yet-pulled/)).not.toBeInTheDocument()
	})

	it('CAUSE 2 (deleted on another device): a removed category falls back to the row name', () => {
		useCategoryStore.setState({ categories: [] })
		useExpenseStore.setState({ expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1')] })

		render(<HomePage />)

		expect(within(expenseLegend()).getByText('Tesco run')).toBeInTheDocument()
	})

	it('CAUSE 3 (soft-deleted locally): a tombstoned category falls back to the row name', () => {
		useCategoryStore.setState({
			categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense', isDeleted: true })],
		})
		useExpenseStore.setState({ expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1')] })

		render(<HomePage />)
		const legend = expenseLegend()

		expect(within(legend).getByText('Tesco run')).toBeInTheDocument()
		expect(within(legend).queryByText('Groceries')).not.toBeInTheDocument()
	})
})

describe('income category count shifts expense category colors (code review, story UX-3)', () => {
	it('the same expense category gets a DIFFERENT legend color depending on how many distinct income categories precede it', () => {
		// generateColorMap assigns colors by array index, so the number of income
		// categories shifts every expense category's color.
		useCategoryStore.setState({
			categories: [
				category({ id: 'i1', name: 'Employment', kind: 'income' }),
				category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
			],
		})
		useIncomeStore.setState({
			incomeSources: [
				incomeRow('n1', 'Main salary', 5000, 'i1'),
				incomeRow('n2', 'Overtime', 3000, 'i1'),
			],
		})
		useExpenseStore.setState({ expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1')] })

		const { unmount } = render(<HomePage />)
		const dotColorFor = (categoryLabel: string): string | null => {
			const li = within(expenseLegend()).getByText(categoryLabel).closest('li')
			if (!li) throw new Error(`no <li> for ${categoryLabel}`)
			const dot = li.querySelector('.rounded-full') as HTMLElement | null
			return dot?.style.backgroundColor ?? null
		}
		const colorWithOneIncomeCategory = dotColorFor('Groceries')
		unmount()

		useCategoryStore.setState({
			categories: [
				category({ id: 'i1', name: 'Employment', kind: 'income' }),
				category({ id: 'i2', name: 'Freelance', kind: 'income' }),
				category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
			],
		})
		useIncomeStore.setState({
			incomeSources: [
				incomeRow('n1', 'Main salary', 5000, 'i1'),
				incomeRow('n2', 'Overtime', 3000, 'i2'),
			],
		})
		useExpenseStore.setState({ expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1')] })

		render(<HomePage />)
		const colorWithTwoIncomeCategories = dotColorFor('Groceries')

		expect(colorWithOneIncomeCategory).not.toBeNull()
		expect(colorWithTwoIncomeCategories).not.toBeNull()
		expect(colorWithTwoIncomeCategories).not.toBe(colorWithOneIncomeCategory)
	})
})
