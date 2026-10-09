import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useCategoryStore } from '../../../stores/categoryStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { dropAnotherAccountsLocalData } from '../dropAnotherAccountsLocalData'
import { clearSyncBridge, registerSyncBridge } from '../syncBridge'

const ACCOUNT_A = 'aaaaaaaa-0000-4000-8000-000000000862'
const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000862'
const A_MAIN = 'aaaaaaaa-1111-4111-8111-111111111111'
const B_MAIN = 'bbbbbbbb-1111-4111-8111-111111111111'
const LOCAL = 'cccccccc-1111-4111-8111-111111111111'
const ISO = '2026-09-01T00:00:00.000Z'

function profile(id: string, userId: string, isDefault: boolean) {
	return { id, userId, name: id.slice(0, 4), isDefault, currency: 'NONE' }
}

function income(id: string, userId: string | number, profileId: string) {
	return {
		id,
		userId,
		profileId,
		name: id,
		amount: 1,
		frequency: 'monthly' as const,
		categoryId: null,
		sortOrder: 0,
		createdAt: ISO,
		updatedAt: ISO,
	}
}

beforeEach(() => {
	localStorage.clear()
	useIncomeStore.setState({ incomeSources: [] })
})

describe('dropAnotherAccountsLocalData — kept profiles', () => {
	it("makes the session's DEFAULT profile active when A's was, and moves kept rows onto it", () => {
		useProfileStore.setState({
			profiles: [
				profile(A_MAIN, ACCOUNT_A, true),
				profile(LOCAL, 'temp-user', false),
				profile(B_MAIN, ACCOUNT_B, true),
			],
			activeProfileId: A_MAIN,
		})
		useIncomeStore.setState({
			incomeSources: [income('theirs', ACCOUNT_A, A_MAIN), income('free', 0, A_MAIN)],
		})

		dropAnotherAccountsLocalData(ACCOUNT_B)

		expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([LOCAL, B_MAIN])
		expect(useProfileStore.getState().activeProfileId).toBe(B_MAIN)
		expect(useIncomeStore.getState().incomeSources.map((r) => [r.id, r.profileId])).toEqual([
			['free', B_MAIN],
		])
	})

	it('keeps a kept active profile active, and leaves rows on kept profiles alone', () => {
		// LOCAL is neither the default nor first, so only "keep the active one"
		// leaves it active.
		useProfileStore.setState({
			profiles: [
				profile(A_MAIN, ACCOUNT_A, true),
				profile(B_MAIN, ACCOUNT_B, true),
				profile(LOCAL, 'temp-user', false),
			],
			activeProfileId: LOCAL,
		})
		useIncomeStore.setState({
			incomeSources: [income('mine', ACCOUNT_B, LOCAL), income('free', 0, LOCAL)],
		})

		dropAnotherAccountsLocalData(ACCOUNT_B)

		expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([B_MAIN, LOCAL])
		expect(useProfileStore.getState().activeProfileId).toBe(LOCAL)
		expect(useIncomeStore.getState().incomeSources.map((r) => [r.id, r.profileId])).toEqual([
			['mine', LOCAL],
			['free', LOCAL],
		])
	})
})

describe('a row created before its first pull, MEASURED', () => {
	afterEach(() => {
		clearSyncBridge()
	})

	it('a row made during a PAID session carries a placeholder until its first pull, so it is kept and adopted like a free-tier row', () => {
		registerSyncBridge({
			userId: ACCOUNT_A,
			queueCreate: vi.fn(async () => {}),
			queueUpdate: vi.fn(async () => {}),
			queueDelete: vi.fn(async () => {}),
		})
		useProfileStore.setState({
			profiles: [profile(A_MAIN, ACCOUNT_A, true)],
			activeProfileId: A_MAIN,
		})
		useExpenseStore.setState({ expenses: [] })
		useSavingsStore.setState({ savingsGoals: [] })
		useBalanceStore.setState({ entries: [] })
		useCategoryStore.setState({ categories: [] })

		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Unsent', amount: 1, frequency: 'monthly', categoryId: null })
		useExpenseStore
			.getState()
			.addExpense({ name: 'Unsent', amount: 1, frequency: 'monthly', categoryId: null })
		useSavingsStore.getState().addSavingsGoal({
			name: 'Unsent',
			targetAmount: null,
			currentBalance: 1,
			allocationMode: 'automatic',
			monthlyAllocation: null,
		})
		useBalanceStore.getState().addBalanceEntry({
			type: 'investment',
			name: 'Unsent',
			currentBalance: 1,
			monthlyContribution: 0,
			frequency: 'monthly',
			contributionRecordedAsExpense: false,
		})
		useCategoryStore.getState().addCategory({ name: 'Unsent', kind: 'expense' })

		const owners = [
			useIncomeStore.getState().incomeSources[0]?.userId,
			useExpenseStore.getState().expenses[0]?.userId,
			(useSavingsStore.getState().savingsGoals[0] as { userId?: unknown } | undefined)?.userId,
			(useBalanceStore.getState().entries[0] as { userId?: unknown } | undefined)?.userId,
			useCategoryStore.getState().categories[0]?.userId,
		]
		expect(owners).toEqual([0, 0, undefined, undefined, 0])

		// Indistinguishable from free-tier rows, so all five are kept (a known limit).
		dropAnotherAccountsLocalData(ACCOUNT_B)

		expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
		expect(useExpenseStore.getState().expenses).toHaveLength(1)
		expect(useSavingsStore.getState().savingsGoals).toHaveLength(1)
		expect(useBalanceStore.getState().entries).toHaveLength(1)
		expect(useCategoryStore.getState().categories).toHaveLength(1)
	})
})
