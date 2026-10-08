import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

vi.mock('../../../stores/currencyStore', () => ({
	useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
	useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
	useCurrencyMode: () => 'none',
	useCurrencyCode: () => 'NONE',
}))

const gate = vi.hoisted(() => ({ pending: true }))
vi.mock('../../../hooks/useIsInitialSyncPending', () => ({
	useIsInitialSyncPending: () => gate.pending,
}))

const NOW = '2026-09-22T00:00:00.000Z'
const PROFILE_A = 'profile-a'

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
}

function fillStores(): void {
	useIncomeStore.setState({
		incomeSources: [
			{
				id: 'inc-1',
				profileId: PROFILE_A,
				userId: 0,
				name: 'Consulting',
				amount: 720_000,
				frequency: 'monthly' as const,
				categoryId: null,
				createdAt: NOW,
				updatedAt: NOW,
			},
		],
	})
	useExpenseStore.setState({
		expenses: [
			{
				id: 'exp-1',
				profileId: PROFILE_A,
				userId: 0,
				name: 'Rent',
				amount: 150_000,
				frequency: 'monthly' as const,
				categoryId: null,
				createdAt: NOW,
				updatedAt: NOW,
			},
		],
	})
	useSavingsStore.setState({
		savingsGoals: [
			{
				id: 'goal-1',
				profileId: PROFILE_A,
				name: 'Emergency fund',
				targetAmount: 1_000_000,
				currentBalance: 345_600,
				allocationMode: 'manual' as const,
				monthlyAllocation: null,
				sortOrder: 0,
				createdAt: NOW,
				updatedAt: NOW,
			},
		],
	})
	useBalanceStore.setState({
		entries: [
			{
				id: 'entry-1',
				profileId: PROFILE_A,
				type: 'investment' as const,
				name: 'Index fund',
				currentBalance: 987_600,
				monthlyContribution: 0,
				frequency: 'monthly' as const,
				sortOrder: 0,
				createdAt: NOW,
				updatedAt: NOW,
			},
		],
	})
}

beforeEach(() => {
	gate.pending = true
	clearStores()
	fillStores()
	useProfileStore.setState({ activeProfileId: PROFILE_A })
})

afterEach(() => {
	clearStores()
	vi.clearAllMocks()
})

const onSave = vi.fn()

// A fresh element: React bails out of re-rendering an identical element reference.
function landSeed(rerender: (ui: React.ReactElement) => void): void {
	gate.pending = false
	rerender(<ScenarioBuilder onSave={onSave} />)
}

describe('edits made while the seed is still pending survive it', () => {
	it('positive control: with nothing edited, the seed fills every field and row', () => {
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)
		expect(screen.queryByDisplayValue('Consulting')).toBeNull()

		landSeed(rerender)

		expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
		expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
		expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue('3,456.00')
		expect(screen.getByLabelText('Balance for Index fund')).toHaveValue('9,876.00')
	})

	it('keeps a savings row the user added and is typing in, and does not add the store rows on top (D8)', () => {
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }))
		const field = screen.getByLabelText('Balance for New Account') as HTMLInputElement
		field.focus()
		fireEvent.change(field, { target: { value: '1234' } })

		landSeed(rerender)

		expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
		expect(screen.getByLabelText('Balance for Index fund')).toHaveValue('9,876.00')
		expect(screen.getByLabelText('Balance for New Account')).toBe(field)
		expect(document.activeElement).toBe(field)
		expect(field).toHaveValue('1234')
		expect(screen.queryByDisplayValue('Emergency fund')).toBeNull()
		const savings = screen.getByRole('region', { name: 'Savings Accounts' })
		expect(within(savings).getAllByRole('button', { name: /^Remove / })).toHaveLength(1)
	})

	it('keeps an investment/debt row the user added and is typing in, and does not add the store rows on top (D8)', () => {
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
		const field = screen.getByLabelText('Balance for New Investment') as HTMLInputElement
		field.focus()
		fireEvent.change(field, { target: { value: '50' } })

		landSeed(rerender)

		expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue('3,456.00')
		expect(screen.getByLabelText('Balance for New Investment')).toBe(field)
		expect(document.activeElement).toBe(field)
		expect(field).toHaveValue('50')
		expect(screen.queryByDisplayValue('Index fund')).toBeNull()
		const balances = screen.getByRole('region', { name: 'Investments & Debts' })
		expect(within(balances).getAllByRole('button', { name: /^Remove / })).toHaveLength(1)
	})

	it('keeps an annual return typed on a row added before the seed (story 100.3)', () => {
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
		const field = screen.getByLabelText('Annual return for New Investment') as HTMLInputElement
		expect(field).toHaveValue('6.00%')
		field.focus()
		fireEvent.change(field, { target: { value: '3.5' } })

		landSeed(rerender)

		expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue('3,456.00')
		expect(screen.getByLabelText('Annual return for New Investment')).toBe(field)
		expect(document.activeElement).toBe(field)
		expect(field).toHaveValue('3.5')
		expect(screen.queryByLabelText('Annual return for Index fund')).toBeNull()
	})

	it('keeps income rows the user added and edited instead of replacing them', () => {
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(screen.getByRole('button', { name: '+ Add Income' }))
		fireEvent.change(screen.getByDisplayValue('New Income'), { target: { value: 'Salary' } })

		landSeed(rerender)

		expect(screen.getByDisplayValue('Salary')).toBeInTheDocument()
		expect(screen.queryByDisplayValue('Consulting')).toBeNull()
		expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
	})

	it('keeps the expense rows the user added and deleted instead of re-seeding them', () => {
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(screen.getByRole('button', { name: '+ Add Expense' }))
		fireEvent.click(screen.getByRole('button', { name: '+ Add Expense' }))
		expect(screen.getAllByDisplayValue('New Expense')).toHaveLength(2)
		fireEvent.click(screen.getAllByRole('button', { name: /delete|remove/i })[0])
		expect(screen.getAllByDisplayValue('New Expense')).toHaveLength(1)

		landSeed(rerender)

		expect(screen.queryByDisplayValue('Rent')).toBeNull()
		expect(screen.getAllByDisplayValue('New Expense')).toHaveLength(1)
		expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
	})
})

describe('the linked expense moves only with the debt row that carries it (story 102.2)', () => {
	function addLinkedDebt(): void {
		useExpenseStore.setState({
			expenses: [
				...useExpenseStore.getState().expenses,
				{
					id: 'exp-loan',
					profileId: PROFILE_A,
					userId: 0,
					name: 'Loan payment',
					amount: 20_000,
					frequency: 'monthly' as const,
					categoryId: null,
					createdAt: NOW,
					updatedAt: NOW,
				},
			],
		})
		useBalanceStore.setState({
			entries: [
				...useBalanceStore.getState().entries,
				{
					id: 'entry-loan',
					profileId: PROFILE_A,
					type: 'debt' as const,
					name: 'Loan',
					currentBalance: 300_000,
					monthlyContribution: 0,
					frequency: 'monthly' as const,
					paymentExpenseId: 'exp-loan',
					sortOrder: 1,
					createdAt: NOW,
					updatedAt: NOW,
				},
			] as never,
		})
	}

	it('positive control: untouched, the expense leaves the Expenses rows and the debt carries it', () => {
		addLinkedDebt()
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)
		landSeed(rerender)
		expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
		expect(screen.queryByDisplayValue('Loan payment')).toBeNull()
		expect(screen.getByLabelText('Contribution for Loan')).toHaveValue('200.00')
		expect(screen.getByText('from Expenses: Loan payment')).toBeInTheDocument()
	})

	it('removes nothing when the balance rows were touched first: no debt row carries the payment, so it must stay an expense', () => {
		addLinkedDebt()
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)
		fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
		landSeed(rerender)
		expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
		expect(screen.getByDisplayValue('Loan payment')).toBeInTheDocument()
		expect(screen.queryByLabelText('Contribution for Loan')).toBeNull()
	})

	it('keeps Expenses rows touched first, and still seeds the debt with its payment, label and no flag', () => {
		addLinkedDebt()
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)
		fireEvent.click(screen.getByRole('button', { name: '+ Add Expense' }))
		landSeed(rerender)
		expect(screen.getAllByDisplayValue('New Expense')).toHaveLength(1)
		expect(screen.queryByDisplayValue('Rent')).toBeNull()
		expect(screen.getByLabelText('Contribution for Loan')).toHaveValue('200.00')
		expect(screen.getByText('from Expenses: Loan payment')).toBeInTheDocument()
		expect(screen.queryByLabelText('Payment already in Expenses, for Loan')).toBeNull()
	})
})
