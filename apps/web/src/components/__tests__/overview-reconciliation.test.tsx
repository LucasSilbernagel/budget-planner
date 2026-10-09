import { cleanup, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

import { buildFinancialSummary } from '../../lib/report/build-financial-summary'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { type OverviewDuration, useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { ExpensesPage } from '../ExpensesPage'
import { HomePage } from '../HomePage'
import { IncomePage } from '../IncomePage'

const TS = '2026-08-15T00:00:00.000Z'

// Core rounds each row to monthly cents as it converts, then sums; displays divide
// the monthly total by the period multiplier (weekly 52/12, biweekly 26/12).
const INCOME_FIXTURE = [
	{ id: 'inc-salary', name: 'Salary', amount: 200_000, frequency: 'biweekly' as const },
	{ id: 'inc-freelance', name: 'Freelance', amount: 60_000, frequency: 'monthly' as const },
	{ id: 'inc-dividend', name: 'Dividend', amount: 120_000, frequency: 'annually' as const },
]

const EXPENSE_FIXTURE = [
	{ id: 'exp-rent', name: 'Rent', amount: 150_000, frequency: 'monthly' as const },
	{ id: 'exp-groceries', name: 'Groceries', amount: 20_000, frequency: 'weekly' as const },
	{ id: 'exp-insurance', name: 'Insurance', amount: 90_000, frequency: 'annually' as const },
]

const EXPECTED = {
	weekly: { income: '1,161.54', expenses: '563.46' },
	biweekly: { income: '2,323.08', expenses: '1,126.92' },
	monthly: { income: '5,033.33', expenses: '2,441.67' },
	annually: { income: '60,399.96', expenses: '29,300.04' },
} satisfies Record<OverviewDuration, { income: string; expenses: string }>

const EXPECTED_NET_WORTH = '273,000.00'

const DURATIONS = [
	'weekly',
	'biweekly',
	'monthly',
	'annually',
] satisfies readonly OverviewDuration[]

function exactMoney(testId: string): string {
	return (screen.getByTestId(testId).textContent ?? '').trim()
}

function formatCents(cents: number): string {
	return (cents / 100).toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})
}

function mockFreeTier(): void {
	const status = {
		hasAccess: false,
		subscriptionStatus: 'free',
		isLoading: false,
		error: null,
		isAuthenticated: false,
	} satisfies PremiumAccessStatus
	usePremiumAccess.mockReturnValue({ status })
}

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useBalanceStore.setState({ entries: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useOverviewDurationStore.setState({ duration: 'annually' })
}

function seedFixture(): void {
	useIncomeStore.setState({
		incomeSources: INCOME_FIXTURE.map((row) => ({
			...row,
			userId: 0,
			categoryId: null,
			createdAt: TS,
			updatedAt: TS,
		})),
	})
	useExpenseStore.setState({
		expenses: EXPENSE_FIXTURE.map((row) => ({
			...row,
			userId: 0,
			categoryId: null,
			createdAt: TS,
			updatedAt: TS,
		})),
	})
	useBalanceStore.setState({
		entries: [
			{
				id: 'inv-1',
				type: 'investment',
				name: 'ISA',
				currentBalance: 800_000,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'inv-2',
				type: 'investment',
				name: 'Pension',
				currentBalance: 1_200_000,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'debt-1',
				type: 'debt',
				name: 'Mortgage',
				currentBalance: 15_000_000,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'asset-1',
				type: 'asset',
				name: 'Condo',
				currentBalance: 40_000_000,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: TS,
				updatedAt: TS,
			},
		],
	})
	useSavingsStore.setState({
		savingsGoals: [
			{
				id: 'sav-1',
				name: 'Emergency fund',
				targetAmount: 1_000_000,
				currentBalance: 250_000,
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'sav-2',
				name: 'Rainy day',
				targetAmount: null,
				currentBalance: 50_000,
				createdAt: TS,
				updatedAt: TS,
			},
		],
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	mockFreeTier()
	clearStores()
})

afterEach(() => {
	cleanup()
	clearStores()
})

describe('the Overview reconciles against a hand-computed example', () => {
	for (const duration of DURATIONS) {
		it(`shows the hand-computed income, expenses and net worth at ${duration}`, () => {
			seedFixture()
			useOverviewDurationStore.setState({ duration })
			render(<HomePage />)

			expect(exactMoney('overview-total-income')).toBe(EXPECTED[duration].income)
			expect(exactMoney('overview-total-expenses')).toBe(EXPECTED[duration].expenses)
			expect(exactMoney('overview-net-worth')).toBe(EXPECTED_NET_WORTH)
		})
	}

	it('does NOT show the raw entered sums, only the normalized totals', () => {
		seedFixture()
		useOverviewDurationStore.setState({ duration: 'monthly' })
		render(<HomePage />)

		expect(exactMoney('overview-total-income')).toBe('5,033.33')
		expect(exactMoney('overview-total-expenses')).toBe('2,441.67')
		expect(exactMoney('overview-total-income')).not.toBe('3,800.00')
		expect(exactMoney('overview-total-expenses')).not.toBe('2,600.00')
	})

	it('lands 4c below the spreadsheet on income and 4c above it on expenses', () => {
		seedFixture()
		useOverviewDurationStore.setState({ duration: 'annually' })
		render(<HomePage />)

		expect(screen.getByTestId('overview-total-income')).toHaveTextContent('60,399.96')
		expect(screen.getByTestId('overview-total-income')).not.toHaveTextContent('60,400.00')
		expect(screen.getByTestId('overview-total-expenses')).toHaveTextContent('29,300.04')
		expect(screen.getByTestId('overview-total-expenses')).not.toHaveTextContent('29,300.00')
	})
})

describe('every surface showing this money agrees, for one seed', () => {
	function textFrom(surface: 'overview' | 'income' | 'expenses', testId: string): string {
		if (surface === 'overview') {
			render(<HomePage />)
		} else if (surface === 'income') {
			renderWithProviders(<IncomePage />)
		} else {
			renderWithProviders(<ExpensesPage />)
		}
		const text = screen.getByTestId(testId).textContent ?? ''
		// Unmount between surfaces: wiping innerHTML leaves the root subscribed to the shared stores.
		cleanup()
		return text.trim()
	}

	for (const duration of DURATIONS) {
		it(`the Overview and the Income page show the same total at ${duration}`, () => {
			seedFixture()
			useOverviewDurationStore.setState({ duration })

			const overview = textFrom('overview', 'overview-total-income')
			const page = textFrom('income', 'period-total-amount')

			expect(overview).toBe(page)
			expect(overview).toContain(EXPECTED[duration].income)
		})

		it(`the Overview and the Expenses page show the same total at ${duration}`, () => {
			seedFixture()
			useOverviewDurationStore.setState({ duration })

			const overview = textFrom('overview', 'overview-total-expenses')
			const page = textFrom('expenses', 'period-total-amount')

			expect(overview).toBe(page)
			expect(overview).toContain(EXPECTED[duration].expenses)
		})
	}

	it('the printed report agrees with the Overview at the monthly basis', () => {
		seedFixture()
		useOverviewDurationStore.setState({ duration: 'monthly' })

		const report = buildFinancialSummary({
			income: INCOME_FIXTURE,
			expenses: EXPENSE_FIXTURE,
			balances: [],
			savings: [],
			generatedAt: new Date(TS),
		})

		const overviewIncome = textFrom('overview', 'overview-total-income')
		const overviewExpenses = textFrom('overview', 'overview-total-expenses')

		expect(overviewIncome).toContain(formatCents(report.budget.monthlyIncomeCents))
		expect(overviewExpenses).toContain(formatCents(report.budget.monthlyExpensesCents))
		expect(report.budget.monthlyIncomeCents).toBe(503_333)
		expect(report.budget.monthlyExpensesCents).toBe(244_167)
	})

	// Pies scale each entry then sum; cards scale the summed monthly total once, so at
	// biweekly they differ by a cent.
	const PIE_TOTAL_TESTID = 'breakdown-pie-total-expense'

	it('the expenses pie sums per entry and lands 1c ABOVE the card at biweekly', () => {
		seedFixture()
		useOverviewDurationStore.setState({ duration: 'biweekly' })
		render(<HomePage />)

		expect(screen.getByTestId(PIE_TOTAL_TESTID)).toHaveTextContent('1,126.93')
		expect(screen.getByTestId('overview-total-expenses')).toHaveTextContent('1,126.92')
		expect(screen.getByTestId('breakdown-pies-rounding-note')).toBeInTheDocument()
	})

	it('the pies carry correct per-entry figures at weekly', () => {
		seedFixture()
		useOverviewDurationStore.setState({ duration: 'weekly' })
		render(<HomePage />)

		expect(screen.getByTestId(PIE_TOTAL_TESTID)).toHaveTextContent('563.46')
		const section = screen.getByTestId('breakdown-pie-expense')
		expect(within(section).getByText('346.15')).toBeInTheDocument()
		expect(within(section).getByText('200.00')).toBeInTheDocument()
		expect(within(section).getByText('17.31')).toBeInTheDocument()
	})

	it('net period income follows from the two totals', () => {
		const report = buildFinancialSummary({
			income: INCOME_FIXTURE,
			expenses: EXPENSE_FIXTURE,
			balances: [],
			savings: [],
			generatedAt: new Date(TS),
		})

		expect(report.budget.monthlyIncomeCents - report.budget.monthlyExpensesCents).toBe(259_166)
		expect((report.budget.monthlyIncomeCents - report.budget.monthlyExpensesCents) * 12).toBe(
			3_109_992
		)
	})
})
