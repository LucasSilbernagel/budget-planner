import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { type OverviewDuration, useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { HomePage } from '../HomePage'

const TS = '2026-08-15T00:00:00.000Z'

function mockFreeTier(): void {
	const status: PremiumAccessStatus = {
		hasAccess: false,
		subscriptionStatus: 'free',
		isLoading: false,
		error: null,
		isAuthenticated: false,
	}
	usePremiumAccess.mockReturnValue({ status })
}

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useBalanceStore.setState({ entries: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useOverviewDurationStore.setState({ duration: 'annually' })
}

function seedSharedFixture(): void {
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
				id: 'asset-1',
				type: 'asset',
				name: 'Condo',
				currentBalance: 40_000_000,
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

function netWorthTextFrom(surface: 'overview' | 'balance'): string {
	const testId = surface === 'overview' ? 'overview-net-worth' : 'stat-net-worth'

	if (surface === 'overview') {
		render(<HomePage />)
	} else {
		renderWithProviders(<BalancePage />)
	}

	const text = screen.getByTestId(testId).textContent ?? ''
	// Unmount between surfaces: wiping innerHTML leaves the root subscribed to the shared stores.
	cleanup()
	return text.trim()
}

describe('net worth agrees across every surface that shows it (story 32.2)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockFreeTier()
		clearStores()
	})

	afterEach(clearStores)

	it('AC-5: the Overview and the Balance page show the SAME figure for one seed', () => {
		seedSharedFixture()

		const overview = netWorthTextFrom('overview')
		const balance = netWorthTextFrom('balance')

		expect(overview).toBe(balance)
		expect(overview).toContain('273,000.00')
	})

	it('AC-6: both agree for a savings-only user, where they used to show zero', () => {
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
			],
		})

		const overview = netWorthTextFrom('overview')
		const balance = netWorthTextFrom('balance')

		expect(overview).toContain('2,500.00')
		expect(balance).toBe(overview)
	})

	it('32.3: both surfaces hold the same net worth at every duration, with flows on screen', () => {
		seedSharedFixture()
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-salary',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 200_000,
					frequency: 'biweekly',
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
		useExpenseStore.setState({
			expenses: [
				{
					id: 'exp-groceries',
					userId: 0,
					categoryId: null,
					name: 'Groceries',
					amount: 20_000,
					frequency: 'weekly',
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})

		const durations: readonly OverviewDuration[] = ['weekly', 'biweekly', 'monthly', 'annually']
		for (const duration of durations) {
			useOverviewDurationStore.setState({ duration })

			const overview = netWorthTextFrom('overview')
			const balance = netWorthTextFrom('balance')

			expect(balance).toBe(overview)
			expect(overview).toContain('273,000.00')
		}
	})
})
