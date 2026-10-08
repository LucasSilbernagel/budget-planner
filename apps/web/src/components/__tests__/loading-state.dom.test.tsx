// The pending arm uses renderToString: render() flushes effects and resolves the
// mount gate, while the server render reads each store's initial state.
import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { __resetStoresHydratedForTests } from '../../hooks/useStoresHydrated'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

import type { ReactNode } from 'react'
import { useBalanceStore, useExpenseStore, useIncomeStore, useSavingsStore } from '../../stores'
import { useCurrencyStore } from '../../stores/currencyStore'
import { FENCED_EMPTY_COPY, type GatedPath } from '../../test/fenced-copy'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { HomePage } from '../HomePage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'

function resolvedFreeTier(): void {
	usePremiumAccess.mockReturnValue({
		status: {
			hasAccess: false,
			isLoading: false,
			error: null,
			subscriptionStatus: null,
		} satisfies Partial<PremiumAccessStatus> as PremiumAccessStatus,
		checkAccess: vi.fn(),
		refresh: vi.fn(),
	})
}

function seedSavings(): void {
	useSavingsStore.setState({
		savingsGoals: [
			{
				id: '11111111-1111-4111-8111-111111111111',
				name: 'Emergency fund',
				targetAmount: 1_000_000,
				currentBalance: 300_000,
				allocationMode: 'manual',
				monthlyAllocation: 20_000,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		],
	})
}

function clearStores(): void {
	useSavingsStore.setState({ savingsGoals: [] })
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useBalanceStore.setState({ entries: [] })
}

describe('Overview loading state (story 38.2)', () => {
	beforeEach(() => {
		// Reset the module-level "already hydrated" flag that render() sets, or a later
		// renderToString() starts resolved.
		__resetStoresHydratedForTests()
		resolvedFreeTier()
		clearStores()
	})

	it('PENDING: the server render shows a skeleton, not a figure and not the onboarding copy', () => {
		seedSavings()

		const html = renderToString(<HomePage />)

		expect(html).toContain('overview-net-worth-skeleton')
		expect(html).toContain('overview-total-income-skeleton')
		expect(html).toContain('overview-total-expenses-skeleton')
		expect(html).not.toContain('$0.00')
		expect(html).not.toContain('set up your budget')
	})

	it('RESOLVED WITH DATA: the real figure, no skeleton', () => {
		seedSavings()

		render(<HomePage />)

		expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('3,000.00')
		expect(screen.queryByTestId('overview-net-worth-skeleton')).not.toBeInTheDocument()
	})

	it('RESOLVED EMPTY: the genuine empty state, no skeleton — this is the arm that catches "skeleton forever"', () => {
		render(<HomePage />)

		expect(screen.getByText(/set up your budget/i)).toBeInTheDocument()
		expect(screen.queryByTestId('overview-net-worth-skeleton')).not.toBeInTheDocument()
		expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('0.00')
	})
})

describe('the announced region (AC-8)', () => {
	beforeEach(() => {
		// Reset the module-level "already hydrated" flag that render() sets, or a later
		// renderToString() starts resolved.
		__resetStoresHydratedForTests()
		resolvedFreeTier()
		clearStores()
	})

	it('PENDING: exactly ONE live region for the whole page, not one per skeleton', () => {
		const html = renderToString(<HomePage />)

		expect(html.split('data-testid="page-loading-status"').length - 1).toBe(1)
		// Text content, not aria-label on an empty element: a live region announces content changes.
		const region = new DOMParser()
			.parseFromString(html, 'text/html')
			.querySelector('[data-testid="page-loading-status"]')
		expect(region?.getAttribute('role')).toBe('status')
		expect(region?.textContent).toBe('Loading your figures')
	})

	it('RESOLVED: the live region is gone', () => {
		render(<HomePage />)

		expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
	})

	it('every skeleton stays out of the accessibility tree', () => {
		const html = renderToString(<HomePage />)
		const doc = new DOMParser().parseFromString(html, 'text/html')

		for (const testid of [
			'overview-total-income-skeleton',
			'overview-total-expenses-skeleton',
			'overview-net-worth-skeleton',
			'overview-sections-skeleton',
		]) {
			const element = doc.querySelector(`[data-testid="${testid}"]`)
			expect(element, `${testid} is not in the server render`).not.toBeNull()
			expect(
				element?.closest('[aria-hidden="true"]'),
				`${testid} is not hidden from assistive technology (itself or an ancestor)`
			).not.toBeNull()
		}
	})
})

describe('Income page loading state (a second surface, AC-5)', () => {
	beforeEach(() => {
		// Reset the module-level "already hydrated" flag that render() sets, or a later
		// renderToString() starts resolved.
		__resetStoresHydratedForTests()
		resolvedFreeTier()
		clearStores()
	})

	it('PENDING: a skeleton for the figure and for the list, and no "No income sources yet"', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: '33333333-3333-4333-8333-333333333333',
					userId: 0,
					name: 'Salary',
					amount: 500_000,
					frequency: 'monthly',
					categoryId: null,
					sortOrder: 0,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})

		const html = renderToString(<IncomePage />)

		expect(html).toContain('period-total-amount-skeleton')
		expect(html).toContain('income-list-skeleton')
		expect(html).not.toContain('No income sources yet')
		expect(html).not.toContain('$0.00')
	})

	it('RESOLVED WITH DATA: the real figure and the real row, no skeleton', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: '33333333-3333-4333-8333-333333333333',
					userId: 0,
					name: 'Salary',
					amount: 500_000,
					frequency: 'monthly',
					categoryId: null,
					sortOrder: 0,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})

		render(<IncomePage />)

		expect(screen.getByTestId('period-total-amount')).toHaveTextContent('60,000.00')
		expect(screen.queryByTestId('period-total-amount-skeleton')).not.toBeInTheDocument()
		expect(screen.queryByTestId('income-list-skeleton')).not.toBeInTheDocument()
		expect(screen.queryByText('No income sources yet')).not.toBeInTheDocument()
	})

	it('RESOLVED EMPTY: the real empty state, no skeleton', () => {
		render(<IncomePage />)

		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
		expect(screen.queryByTestId('income-list-skeleton')).not.toBeInTheDocument()
		expect(screen.queryByTestId('period-total-amount-skeleton')).not.toBeInTheDocument()
	})
})

describe('the remaining gated pages, pending → resolved (AC-5)', () => {
	beforeEach(() => {
		__resetStoresHydratedForTests()
		resolvedFreeTier()
		clearStores()
	})

	const PAGES = [
		{
			name: 'Expenses',
			Page: ExpensesPage,
			skeletons: ['period-total-amount-skeleton', 'expenses-list-skeleton'],
			emptyCopy: 'No expenses recorded yet',
		},
		{
			name: 'Savings',
			Page: SavingsPage,
			skeletons: [
				'savings-total-skeleton',
				'savings-leftover-summary-skeleton',
				'savings-list-skeleton',
			],
			emptyCopy: 'No savings goals recorded yet',
		},
		{
			name: 'Balance',
			Page: BalancePage,
			skeletons: [
				'stat-total-investments-skeleton',
				'stat-total-savings-skeleton',
				'stat-total-assets-skeleton',
				'stat-total-debts-skeleton',
				'stat-net-worth-skeleton',
				'balance-entries-skeleton',
			],
			emptyCopy: 'No balance entries recorded yet',
		},
	] as const

	for (const { name, Page, skeletons, emptyCopy } of PAGES) {
		it(`${name}: PENDING renders every skeleton and none of the empty copy`, () => {
			const html = renderToString(<Page />)

			for (const testid of skeletons) {
				expect(html, `${name} is missing ${testid}`).toContain(testid)
			}
			expect(html, `${name} still serves "${emptyCopy}" while pending`).not.toContain(emptyCopy)
			expect(html.split('data-testid="page-loading-status"').length - 1).toBe(1)
		})

		it(`${name}: RESOLVED EMPTY renders the real empty state and no skeleton`, () => {
			render(<Page />)

			expect(screen.getByText(emptyCopy)).toBeInTheDocument()
			for (const testid of skeletons) {
				expect(
					screen.queryByTestId(testid),
					`${name} still shows ${testid}`
				).not.toBeInTheDocument()
			}
			expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
		})
	}
})

const GATED_PAGES = [
	{ path: '/', Page: HomePage, marker: 'overview-net-worth' },
	{ path: '/income', Page: IncomePage, marker: 'period-total-amount' },
	{ path: '/expenses', Page: ExpensesPage, marker: 'period-total-amount' },
	{ path: '/savings', Page: SavingsPage, marker: 'savings-leftover-summary' },
	{ path: '/balance', Page: BalancePage, marker: 'stat-net-worth' },
] as const satisfies readonly { path: GatedPath; Page: () => ReactNode; marker: string }[]

describe('positive controls: every fenced phrase is the resolved empty copy', () => {
	beforeEach(() => {
		__resetStoresHydratedForTests()
		resolvedFreeTier()
		clearStores()
		useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
	})

	for (const { path, Page } of GATED_PAGES) {
		it(`${path} really renders every phrase its fence claims to exclude`, () => {
			const { container } = render(<Page />)
			expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()

			const text = container.textContent ?? ''
			for (const phrase of FENCED_EMPTY_COPY[path]) {
				expect(
					text.includes(phrase),
					`${path} never renders "${phrase}": the matching fence is guarding nothing`
				).toBe(true)
			}
		})
	}
})

describe('every gated page resolves with data', () => {
	beforeEach(() => {
		__resetStoresHydratedForTests()
		resolvedFreeTier()
		clearStores()
		seedSavings()
		useIncomeStore.setState({
			incomeSources: [
				{
					id: '22222222-2222-4222-8222-222222222222',
					userId: 0,
					name: 'Salary',
					amount: 500_000,
					frequency: 'monthly',
					categoryId: null,
					sortOrder: 0,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
		useExpenseStore.setState({
			expenses: [
				{
					id: '33333333-3333-4333-8333-333333333333',
					userId: 0,
					name: 'Rent',
					amount: 150_000,
					frequency: 'monthly',
					categoryId: null,
					sortOrder: 0,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
		useBalanceStore.setState({
			entries: [
				{
					id: '44444444-4444-4444-8444-444444444444',
					type: 'investment',
					name: 'ISA',
					currentBalance: 800_000,
					monthlyContribution: 10_000,
					frequency: 'monthly',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
				{
					id: '55555555-5555-4555-8555-555555555555',
					type: 'debt',
					name: 'Mortgage',
					currentBalance: 15_000_000,
					monthlyContribution: 50_000,
					frequency: 'monthly',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
				{
					id: '66666666-6666-4666-8666-666666666666',
					type: 'asset',
					name: 'Car',
					currentBalance: 1_200_000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
		useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
	})

	for (const { path, Page, marker } of GATED_PAGES) {
		it(`${path} clears every skeleton and its status region`, () => {
			const { container } = render(<Page />)

			expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
			const leftovers = [...container.querySelectorAll('[data-testid$="-skeleton"]')].map((el) =>
				el.getAttribute('data-testid')
			)
			expect(leftovers, `${path} still shows skeletons`).toEqual([])
			expect(screen.getByTestId(marker)).toBeInTheDocument()

			const text = container.textContent ?? ''
			for (const phrase of FENCED_EMPTY_COPY[path]) {
				expect(
					text.includes(phrase),
					`${path} resolved to its EMPTY copy ("${phrase}"): the seed misses a store this page reads`
				).toBe(false)
			}
		})
	}
})
