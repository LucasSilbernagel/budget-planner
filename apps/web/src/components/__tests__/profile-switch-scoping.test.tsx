import { act, cleanup, render } from '@testing-library/react'
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
import { useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { HomePage } from '../HomePage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'

const TS = '2026-09-15T00:00:00.000Z'
const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'

function mockTier(): void {
	const status = {
		hasAccess: true,
		subscriptionStatus: 'active',
		isLoading: false,
		error: null,
		isAuthenticated: true,
	} satisfies PremiumAccessStatus
	usePremiumAccess.mockReturnValue({ status })
}

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
}

function balanceRow(
	id: string,
	profileId: string | undefined,
	type: 'asset' | 'debt',
	name: string,
	currentBalance: number
) {
	return {
		id,
		...(profileId === undefined ? {} : { profileId }),
		type,
		name,
		currentBalance,
		monthlyContribution: 0,
		frequency: 'monthly' as const,
		createdAt: TS,
		updatedAt: TS,
	}
}

function seed(): void {
	useProfileStore.setState({
		profiles: [
			{ id: A, userId: 'u-1', name: 'Personal', isDefault: true, currency: 'NONE' },
			{ id: B, userId: 'u-1', name: 'Business', isDefault: false, currency: 'NONE' },
		],
		activeProfileId: A,
		error: null,
	})
	useOverviewDurationStore.setState({ duration: 'monthly' })
	useIncomeStore.setState({
		incomeSources: [
			{
				id: 'inc-a',
				profileId: A,
				userId: 0,
				name: 'Personal salary',
				amount: 100_000,
				frequency: 'monthly',
				categoryId: null,
				sortOrder: 0,
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'inc-b',
				profileId: B,
				userId: 0,
				name: 'Business revenue',
				amount: 200_000,
				frequency: 'monthly',
				categoryId: null,
				sortOrder: 1,
				createdAt: TS,
				updatedAt: TS,
			},
		],
	})
	useExpenseStore.setState({
		expenses: [
			{
				id: 'exp-a',
				profileId: A,
				userId: 0,
				name: 'Personal rent',
				amount: 10_000,
				frequency: 'monthly',
				categoryId: null,
				sortOrder: 0,
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'exp-b',
				profileId: B,
				userId: 0,
				name: 'Business rent',
				amount: 20_000,
				frequency: 'monthly',
				categoryId: null,
				sortOrder: 1,
				createdAt: TS,
				updatedAt: TS,
			},
		],
	})
	useSavingsStore.setState({
		savingsGoals: [
			{
				id: 'sav-a',
				profileId: A,
				name: 'Personal fund',
				targetAmount: null,
				currentBalance: 10_000,
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'sav-b',
				profileId: B,
				name: 'Business fund',
				targetAmount: null,
				currentBalance: 30_000,
				createdAt: TS,
				updatedAt: TS,
			},
		],
	})
	useBalanceStore.setState({
		entries: [
			{
				id: 'inv-a',
				profileId: A,
				type: 'investment',
				name: 'Personal ISA',
				currentBalance: 5_000,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'inv-b',
				profileId: B,
				type: 'investment',
				name: 'Business ISA',
				currentBalance: 7_000,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: TS,
				updatedAt: TS,
			},
			balanceRow('asset-a', A, 'asset', 'Personal car', 300),
			balanceRow('asset-b', B, 'asset', 'Business van', 400),
			balanceRow('debt-a', A, 'debt', 'Personal loan', 50),
			balanceRow('debt-b', B, 'debt', 'Business loan', 60),
		],
	})
}

function exactMoney(testId: string): string {
	return (screen.getByTestId(testId).textContent ?? '').trim()
}

beforeEach(() => {
	vi.clearAllMocks()
	mockTier()
	clearStores()
	seed()
})

afterEach(() => {
	cleanup()
	act(() => {
		clearStores()
	})
})

describe('Overview after a profile switch', () => {
	it('shows ONLY profile A figures before the switch (positive control)', () => {
		render(<HomePage />)
		expect(exactMoney('overview-total-income')).toBe('1,000.00')
		expect(exactMoney('overview-total-expenses')).toBe('100.00')
		expect(exactMoney('overview-net-worth')).toBe('152.50')
	})

	it('drops every profile A figure after switching to B', () => {
		render(<HomePage />)

		act(() => {
			useProfileStore.getState().switchProfile(B)
		})

		expect(exactMoney('overview-total-income')).toBe('2,000.00')
		expect(exactMoney('overview-total-expenses')).toBe('200.00')
		// 70 + 300 + 4 − 0.60; A and B together would be 525.90.
		expect(exactMoney('overview-net-worth')).toBe('373.40')
	})
})

describe('Income page after a profile switch', () => {
	it('finds profile A row by name before the switch, and it is ABSENT after', () => {
		renderWithProviders(<IncomePage />)

		expect(screen.getAllByText('Personal salary').length).toBeGreaterThan(0)
		expect(screen.queryAllByText('Business revenue')).toHaveLength(0)

		act(() => {
			useProfileStore.getState().switchProfile(B)
		})

		expect(screen.queryAllByText('Personal salary')).toHaveLength(0)
		expect(screen.getAllByText('Business revenue').length).toBeGreaterThan(0)
	})
})

describe('every row page after a profile switch', () => {
	it.each([
		{ name: 'Income', Page: IncomePage, a: ['Personal salary'], b: ['Business revenue'] },
		{ name: 'Expenses', Page: ExpensesPage, a: ['Personal rent'], b: ['Business rent'] },
		{ name: 'Savings', Page: SavingsPage, a: ['Personal fund'], b: ['Business fund'] },
		{
			name: 'Balance',
			Page: BalancePage,
			a: ['Personal ISA', 'Personal car', 'Personal loan'],
			b: ['Business ISA', 'Business van', 'Business loan'],
		},
	])('$name shows no profile A row after switching to B', ({ Page, a, b }) => {
		renderWithProviders(<Page />)
		for (const name of a) expect(screen.getAllByText(name).length, name).toBeGreaterThan(0)

		act(() => {
			useProfileStore.getState().switchProfile(B)
		})

		for (const name of a) expect(screen.queryAllByText(name), name).toHaveLength(0)
		for (const name of b) expect(screen.getAllByText(name).length, name).toBeGreaterThan(0)
	})

	it('the Balance totals hold only profile B money after the switch', () => {
		renderWithProviders(<BalancePage />)

		act(() => {
			useProfileStore.getState().switchProfile(B)
		})

		expect(exactMoney('stat-total-investments')).toBe('70.00')
		expect(exactMoney('stat-total-savings')).toBe('300.00')
		expect(exactMoney('stat-total-assets')).toBe('4.00')
		expect(exactMoney('stat-total-debts')).toBe('0.60')
		expect(exactMoney('stat-net-worth')).toBe('373.40')
	})

	it('the Savings total holds only profile B money after the switch', () => {
		renderWithProviders(<SavingsPage />)

		act(() => {
			useProfileStore.getState().switchProfile(B)
		})

		expect(exactMoney('savings-total')).toBe('300.00')
	})
})

describe('a row added under one profile', () => {
	it('is shown under that profile and hidden after switching away', () => {
		act(() => {
			useProfileStore.getState().switchProfile(B)
			useIncomeStore
				.getState()
				.addIncomeSource({ name: 'Consulting', amount: 1, frequency: 'monthly' })
		})
		renderWithProviders(<IncomePage />)
		expect(screen.getAllByText('Consulting').length).toBeGreaterThan(0)

		act(() => {
			useProfileStore.getState().switchProfile(A)
		})

		expect(screen.queryAllByText('Consulting')).toHaveLength(0)
	})
})

describe('a single default profile with legacy rows lacking profileId', () => {
	it('counts every legacy row, and a new row joins them', () => {
		clearStores()
		useProfileStore.setState({
			profiles: [{ id: A, userId: '', name: 'Main Profile', isDefault: true, currency: 'NONE' }],
			activeProfileId: A,
		})
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'legacy-inc',
					userId: 0,
					name: 'Legacy',
					amount: 300,
					frequency: 'monthly',
					categoryId: null,
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
		useSavingsStore.setState({
			savingsGoals: [
				{
					id: 'legacy-sav',
					name: 'Legacy',
					targetAmount: null,
					currentBalance: 50,
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
		useBalanceStore.setState({
			entries: [balanceRow('legacy-debt', undefined, 'debt', 'Legacy loan', 20)],
		})
		render(<HomePage />)

		expect(exactMoney('overview-total-income')).toBe('3.00')
		expect(exactMoney('overview-net-worth')).toBe('0.30')

		act(() => {
			useIncomeStore.getState().addIncomeSource({ name: 'New', amount: 1, frequency: 'monthly' })
		})

		expect(exactMoney('overview-total-income')).toBe('3.01')
	})
})
