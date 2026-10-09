import type { ServerChange } from '@budget-planner/core/sync/types'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/api/client', () => ({
	fetchServerChangesWithMeta: vi.fn(),
	sendSyncOperation: vi.fn(),
}))

import { IncomePage } from '@/components/IncomePage'
import { fetchServerChangesWithMeta, sendSyncOperation } from '@/features/api/client'
import { resetSyncStore } from '@/hooks/useSync'
import { resetSessionStatusStore } from '@/lib/sync/sessionStatusStore'
import { clearSyncBridge } from '@/lib/sync/syncBridge'
import { useBalanceStore } from '@/stores/balanceStore'
import { useCategoryStore } from '@/stores/categoryStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useIncomeStore } from '@/stores/incomeStore'
import { useProfileStore } from '@/stores/profileStore'
import { useSavingsStore } from '@/stores/savingsStore'
import { ActiveSync } from '../ActiveSync'

const ACCOUNT_A = 'aaaaaaaa-0000-4000-8000-000000000862'
const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000862'
const A_MAIN = 'aaaaaaaa-1111-4111-8111-111111111111'
const A_SIDE = 'aaaaaaaa-2222-4222-8222-222222222222'
const B_MAIN = 'bbbbbbbb-1111-4111-8111-111111111111'
const A_INCOME = 'aaaaaaaa-3333-4333-8333-333333333333'
const A_EXPENSE = 'aaaaaaaa-4444-4444-8444-444444444444'
const A_SAVINGS = 'aaaaaaaa-5555-4555-8555-555555555555'
const A_BALANCE = 'aaaaaaaa-6666-4666-8666-666666666666'
const A_CATEGORY = 'aaaaaaaa-7777-4777-8777-777777777777'
const FREE_INCOME = 'cccccccc-3333-4333-8333-333333333333'
const A_IDS = [A_MAIN, A_SIDE, A_INCOME, A_EXPENSE, A_SAVINGS, A_BALANCE, A_CATEGORY]
const A_QUEUE_KEY = `bp-sync-queue-${ACCOUNT_A}`
const A_QUEUE = JSON.stringify([{ id: 'op-a', entityType: 'expense', entityId: A_EXPENSE }])
const ISO = '2026-09-01T00:00:00.000Z'

const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const B_MAIN_CHANGE: ServerChange = {
	entityType: 'userProfile',
	entityId: B_MAIN,
	data: { id: B_MAIN, userId: ACCOUNT_B, name: 'Main Profile', isDefault: true, currency: 'NONE' },
	updatedAt: 1000,
	isDeleted: false,
}

function income(id: string, userId: string | number, name: string) {
	return {
		id,
		userId,
		profileId: A_SIDE,
		name,
		amount: 100_000,
		frequency: 'monthly' as const,
		categoryId: null,
		sortOrder: id === FREE_INCOME ? 1 : 0,
		createdAt: ISO,
		updatedAt: ISO,
	}
}

function aRow(id: string, extra: Record<string, unknown>) {
	return { id, userId: ACCOUNT_A, profileId: A_SIDE, createdAt: ISO, updatedAt: ISO, ...extra }
}

function sent(): string[] {
	return send.mock.calls.map(([op]) => {
		const { type, entityType, entityId, profileId } = op as Record<string, string>
		return `${type} ${entityType} ${entityId} ${profileId}`
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	resetSyncStore()
	resetSessionStatusStore()
	clearSyncBridge()
	localStorage.clear()
	localStorage.setItem('sync:hasCompletedInitialPull', '1')
	localStorage.setItem(A_QUEUE_KEY, A_QUEUE)

	useProfileStore.setState({
		profiles: [
			{ id: A_MAIN, userId: ACCOUNT_A, name: 'Their main', isDefault: true, currency: 'NONE' },
			{ id: A_SIDE, userId: ACCOUNT_A, name: 'Their side', isDefault: false, currency: 'NONE' },
		],
		activeProfileId: A_SIDE,
	})
	useIncomeStore.setState({
		incomeSources: [
			income(A_INCOME, ACCOUNT_A, 'Their salary'),
			income(FREE_INCOME, 0, 'My salary'),
		],
	})
	useExpenseStore.setState({
		expenses: [aRow(A_EXPENSE, { name: 'Their rent', amount: 1, frequency: 'monthly' }) as never],
	})
	useSavingsStore.setState({
		savingsGoals: [aRow(A_SAVINGS, { name: 'Their goal', targetAmount: 1 }) as never],
	})
	useBalanceStore.setState({
		entries: [aRow(A_BALANCE, { type: 'investment', name: 'Their brokerage' }) as never],
	})
	useCategoryStore.setState({
		categories: [aRow(A_CATEGORY, { name: 'Theirs', kind: 'expense', isDeleted: false }) as never],
	})

	fetchMeta.mockResolvedValue({ changes: [B_MAIN_CHANGE], profileIds: [B_MAIN] })
	send.mockResolvedValue({ success: true })
})

afterEach(() => {
	cleanup()
	clearSyncBridge()
})

describe("B's sync on a browser holding A's data", () => {
	it("removes A's profiles and rows, uploads none of them, and shows none of them", async () => {
		render(
			<>
				<ActiveSync userId={ACCOUNT_B} />
				<IncomePage />
			</>
		)

		await waitFor(() => expect(sent()).toContain(`create incomeSource ${FREE_INCOME} ${B_MAIN}`), {
			timeout: 6000,
		})

		expect(sent().filter((op) => A_IDS.some((id) => op.includes(id)))).toEqual([])
		expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([B_MAIN])
		expect(useProfileStore.getState().activeProfileId).toBe(B_MAIN)
		expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toEqual([FREE_INCOME])
		expect(useExpenseStore.getState().expenses).toEqual([])
		expect(useSavingsStore.getState().savingsGoals).toEqual([])
		expect(useBalanceStore.getState().entries).toEqual([])
		expect(useCategoryStore.getState().categories).toEqual([])
		expect(localStorage.getItem(A_QUEUE_KEY)).toBe(A_QUEUE)

		expect(screen.getByText('My salary')).toBeInTheDocument()
		expect(screen.queryByText('Their salary')).not.toBeInTheDocument()
	}, 10_000)
})
