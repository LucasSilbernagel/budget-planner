import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../balanceStore'
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'
import { useProfileStore } from '../profileStore'
import { useSavingsStore } from '../savingsStore'

const TS = '2026-09-15T00:00:00.000Z'
const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'

function seedProfiles(active: string = A): void {
	useProfileStore.setState({
		profiles: [
			{ id: A, userId: 'u-1', name: 'Personal', isDefault: true, currency: 'NONE' },
			{ id: B, userId: 'u-1', name: 'Business', isDefault: false, currency: 'NONE' },
		],
		activeProfileId: active,
		error: null,
	})
}

function balance(
	id: string,
	profileId: string | undefined,
	type: 'investment' | 'debt' | 'asset',
	currentBalance: number
) {
	return {
		id,
		...(profileId === undefined ? {} : { profileId }),
		type,
		name: id,
		currentBalance,
		monthlyContribution: 0,
		frequency: 'monthly' as const,
		createdAt: TS,
		updatedAt: TS,
	}
}

function seedTwoProfiles(): void {
	useIncomeStore.setState({
		incomeSources: [
			{
				id: 'inc-a',
				profileId: A,
				userId: 0,
				name: 'Salary A',
				amount: 100_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'inc-b',
				profileId: B,
				userId: 0,
				name: 'Salary B',
				amount: 200_000,
				frequency: 'monthly',
				categoryId: null,
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
				name: 'Rent A',
				amount: 10_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'exp-b',
				profileId: B,
				userId: 0,
				name: 'Rent B',
				amount: 20_000,
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
				id: 'sav-a',
				profileId: A,
				name: 'Fund A',
				targetAmount: null,
				currentBalance: 1_000,
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'sav-b',
				profileId: B,
				name: 'Fund B',
				targetAmount: null,
				currentBalance: 2_000,
				createdAt: TS,
				updatedAt: TS,
			},
		],
	})
	useBalanceStore.setState({
		entries: [
			balance('inv-a', A, 'investment', 700),
			balance('inv-b', B, 'investment', 800),
			balance('asset-a', A, 'asset', 30),
			balance('asset-b', B, 'asset', 40),
			balance('debt-a', A, 'debt', 5),
			balance('debt-b', B, 'debt', 6),
		],
	})
}

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
}

beforeEach(() => {
	clearStores()
	seedProfiles()
})

afterEach(() => {
	clearStores()
})

describe('create paths stamp the active profile', () => {
	it('stamps a row added under B with B', () => {
		seedProfiles(B)
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'New income', amount: 1, frequency: 'monthly' })
		useExpenseStore.getState().addExpense({ name: 'New expense', amount: 1, frequency: 'monthly' })
		useSavingsStore
			.getState()
			.addSavingsGoal({ name: 'New fund', targetAmount: null, currentBalance: 1 })
		useBalanceStore.getState().addBalanceEntry({
			type: 'investment',
			name: 'New investment',
			currentBalance: 1,
			monthlyContribution: 0,
			frequency: 'monthly',
		})

		expect(useIncomeStore.getState().incomeSources[0]?.profileId).toBe(B)
		expect(useExpenseStore.getState().expenses[0]?.profileId).toBe(B)
		expect(useSavingsStore.getState().savingsGoals[0]?.profileId).toBe(B)
		expect(useBalanceStore.getState().entries[0]?.profileId).toBe(B)
	})

	it('an update neither strips nor changes the stamp', () => {
		seedTwoProfiles()
		useIncomeStore.getState().updateIncomeSource('inc-b', { name: 'Renamed', amount: 5 })
		useExpenseStore.getState().updateExpense('exp-b', { name: 'Renamed' })
		useSavingsStore.getState().updateSavingsGoal('sav-b', { name: 'Renamed' })
		useBalanceStore.getState().updateBalanceEntry('inv-b', { name: 'Renamed' })

		const find = <T extends { id: string }>(rows: T[], id: string) => rows.find((r) => r.id === id)
		expect(find(useIncomeStore.getState().incomeSources, 'inc-b')?.profileId).toBe(B)
		expect(find(useExpenseStore.getState().expenses, 'exp-b')?.profileId).toBe(B)
		expect(find(useSavingsStore.getState().savingsGoals, 'sav-b')?.profileId).toBe(B)
		expect(find(useBalanceStore.getState().entries, 'inv-b')?.profileId).toBe(B)
	})
})
