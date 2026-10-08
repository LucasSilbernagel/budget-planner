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
import { HomePage } from '../HomePage'
import { IncomePage } from '../IncomePage'

const TS = '2026-09-15T00:00:00.000Z'
const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'

function mockTier(): void {
	const status: PremiumAccessStatus = {
		hasAccess: true,
		subscriptionStatus: 'active',
		isLoading: false,
		error: null,
		isAuthenticated: true,
	}
	usePremiumAccess.mockReturnValue({ status })
}

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
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

describe('Overview after a profile switch (AC-2)', () => {
	it('shows ONLY profile A figures before the switch (positive control)', () => {
		render(<HomePage />)
		expect(exactMoney('overview-total-income')).toBe('1,000.00')
		expect(exactMoney('overview-net-worth')).toBe('150.00')
	})

	it('drops every profile A figure after switching to B', () => {
		render(<HomePage />)

		act(() => {
			useProfileStore.getState().switchProfile(B)
		})

		expect(exactMoney('overview-total-income')).toBe('2,000.00')
		expect(exactMoney('overview-net-worth')).toBe('370.00')
	})
})

describe('Income page after a profile switch (AC-2)', () => {
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
