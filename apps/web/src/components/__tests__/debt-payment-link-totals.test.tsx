import type React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { ExpensesPage } from '../ExpensesPage'
import { HomePage } from '../HomePage'
import { FinancialSummaryReport } from '../reports/FinancialSummaryReport'
import { SavingsPage } from '../SavingsPage'

const ISO = '2026-10-06T00:00:00.000Z'

function resetStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useBalanceStore.setState({ entries: [] })
	useSavingsStore.setState({ savingsGoals: [] })
}

function seed(linked: boolean): void {
	useIncomeStore.setState({
		incomeSources: [
			{
				id: 'inc-1',
				userId: 0,
				categoryId: null,
				name: 'Salary',
				amount: 500_000,
				frequency: 'monthly',
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
	useExpenseStore.setState({
		expenses: [
			{
				id: 'exp-car',
				userId: 0,
				categoryId: null,
				name: 'Car payment',
				amount: 45_000,
				frequency: 'monthly',
				createdAt: ISO,
				updatedAt: ISO,
			},
			{
				id: 'exp-rent',
				userId: 0,
				categoryId: null,
				name: 'Rent',
				amount: 150_000,
				frequency: 'monthly',
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
	useSavingsStore.setState({
		savingsGoals: [
			{
				id: 'goal-1',
				name: 'Holiday',
				targetAmount: 500_000,
				currentBalance: 0,
				allocationMode: 'automatic',
				monthlyAllocation: null,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
	useBalanceStore.setState({
		entries: [
			{
				id: 'inv-1',
				type: 'investment',
				name: 'Pension',
				currentBalance: 2_000_000,
				monthlyContribution: 20_000,
				frequency: 'monthly',
				createdAt: ISO,
				updatedAt: ISO,
			},
			{
				id: 'debt-1',
				type: 'debt',
				name: 'Car loan',
				currentBalance: 1_200_000,
				monthlyContribution: 0,
				frequency: 'monthly',
				paymentExpenseId: linked ? 'exp-car' : null,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
}

function textOf(page: () => React.ReactElement, linked: boolean): string {
	resetStores()
	seed(linked)
	const view = renderWithProviders(page())
	const text = view.container.textContent ?? ''
	view.unmount()
	return text
}

describe('a debt payment link changes no expense figure (Story 102.1, AC-9)', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	const generatedAt = new Date('2026-10-06T12:00:00.000Z')
	// 450.00 + 1,500.00 a month = 1,950.00 = 23,400.00 a year; the /savings leftover is
	// 5,000.00 − 1,950.00 − 200.00 (Pension contribution) = 2,850.00.
	it.each([
		['Expenses', () => <ExpensesPage />, '23,400.00'],
		['Savings', () => <SavingsPage />, '2,850.00'],
		['Overview', () => <HomePage />, '23,400.00'],
		['Report', () => <FinancialSummaryReport generatedAt={generatedAt} />, '1,950.00'],
	] as const)('%s reads the same with the debt linked or not', (_page, page, figure) => {
		const unlinked = textOf(page, false)
		const linked = textOf(page, true)
		expect(unlinked).toContain(figure)
		expect(linked).toBe(unlinked)
	})

	it('the Expenses page still lists and totals the linked expense', () => {
		expect(textOf(() => <ExpensesPage />, true)).toContain('Car payment')
	})
})
