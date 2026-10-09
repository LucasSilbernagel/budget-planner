/**
 * Every store the util touches must be mocked: an unmocked store runs for real and nothing asserts
 * it was purged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	incomeSetState: vi.fn(),
	incomeClear: vi.fn(),
	expenseSetState: vi.fn(),
	expenseClear: vi.fn(),
	savingsSetState: vi.fn(),
	savingsClear: vi.fn(),
	profileReset: vi.fn(),
	profileClear: vi.fn(),
	balanceReset: vi.fn(),
	balanceClear: vi.fn(),
	categoryReset: vi.fn(),
	categoryClear: vi.fn(),
	retirementPlanReset: vi.fn(),
	retirementPlanClear: vi.fn(),
	queueClear: vi.fn().mockResolvedValue(undefined),
	createSyncQueue: vi.fn(),
}))

vi.mock('@/stores/retirementPlannerStore', () => ({
	RETIREMENT_PLANNER_PARKED_KEY_PREFIX: 'budget-planner-retirement-planner-v1:',
	useRetirementPlannerStore: {
		getState: () => ({ resetPlan: h.retirementPlanReset }),
		persist: { clearStorage: h.retirementPlanClear },
	},
}))

vi.mock('@/stores/incomeStore', () => ({
	useIncomeStore: { setState: h.incomeSetState, persist: { clearStorage: h.incomeClear } },
}))
vi.mock('@/stores/expenseStore', () => ({
	useExpenseStore: { setState: h.expenseSetState, persist: { clearStorage: h.expenseClear } },
}))
vi.mock('@/stores/savingsStore', () => ({
	useSavingsStore: { setState: h.savingsSetState, persist: { clearStorage: h.savingsClear } },
}))
vi.mock('@/stores/profileStore', () => ({
	useProfileStore: {
		getState: () => ({ reset: h.profileReset }),
		persist: { clearStorage: h.profileClear },
	},
}))
vi.mock('@/stores/balanceStore', () => ({
	useBalanceStore: {
		getState: () => ({ reset: h.balanceReset }),
		persist: { clearStorage: h.balanceClear },
	},
}))
vi.mock('@/stores/categoryStore', () => ({
	useCategoryStore: {
		getState: () => ({ reset: h.categoryReset }),
		persist: { clearStorage: h.categoryClear },
	},
}))
vi.mock('@budget-planner/core/sync', () => ({ createSyncQueue: h.createSyncQueue }))

import { registerSyncPurgeHandle } from '@/lib/sync/purgeHandle'
import {
	addRefusalNotices,
	dismissRefusalNotice,
	getRefusalNotices,
	type RefusalNotice,
	reconcileNotSyncedNotices,
	resetRefusalNotices,
} from '@/lib/sync/refusalNoticeStore'
import { purgeLocalFinancialData } from './purge-local-financial-data'

beforeEach(() => {
	vi.clearAllMocks()
	h.queueClear.mockResolvedValue(undefined)
	h.createSyncQueue.mockReturnValue({ clear: h.queueClear })
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
let unregister: (() => void) | null = null
afterEach(() => {
	unregister?.()
	unregister = null
	vi.restoreAllMocks()
})

describe('purgeLocalFinancialData', () => {
	it('resets + clears all seven financial stores and the user-scoped sync queue', async () => {
		await purgeLocalFinancialData('user-9')

		expect(h.incomeSetState).toHaveBeenCalledWith({ incomeSources: [] })
		expect(h.incomeClear).toHaveBeenCalledTimes(1)
		expect(h.expenseSetState).toHaveBeenCalledWith({ expenses: [] })
		expect(h.expenseClear).toHaveBeenCalledTimes(1)
		expect(h.savingsSetState).toHaveBeenCalledWith({ savingsGoals: [] })
		expect(h.savingsClear).toHaveBeenCalledTimes(1)
		expect(h.profileReset).toHaveBeenCalledTimes(1)
		expect(h.profileClear).toHaveBeenCalledTimes(1)
		expect(h.categoryReset).toHaveBeenCalledTimes(1)
		expect(h.categoryClear).toHaveBeenCalledTimes(1)
		expect(h.balanceReset).toHaveBeenCalledTimes(1)
		expect(h.balanceClear).toHaveBeenCalledTimes(1)
		expect(h.retirementPlanReset).toHaveBeenCalledTimes(1)
		expect(h.retirementPlanClear).toHaveBeenCalledTimes(1)

		expect(h.createSyncQueue).toHaveBeenCalledWith('user-9')
		expect(h.queueClear).toHaveBeenCalledTimes(1)
	})

	it('is best-effort: a throwing store does not abort the rest or the queue clear, and never rejects', async () => {
		h.incomeClear.mockImplementationOnce(() => {
			throw new Error('localStorage disabled (private mode)')
		})

		await expect(purgeLocalFinancialData('user-9')).resolves.toBeUndefined()

		expect(h.balanceReset).toHaveBeenCalledTimes(1)
		expect(h.balanceClear).toHaveBeenCalledTimes(1)
		expect(h.queueClear).toHaveBeenCalledTimes(1)
	})

	it('never rejects even if the sync-queue clear itself fails', async () => {
		h.queueClear.mockRejectedValueOnce(new Error('storage error'))
		await expect(purgeLocalFinancialData('user-9')).resolves.toBeUndefined()
	})

	it('with no userId resets all five stores but does NOT touch the sync queue', async () => {
		await purgeLocalFinancialData()

		expect(h.incomeSetState).toHaveBeenCalledWith({ incomeSources: [] })
		expect(h.incomeClear).toHaveBeenCalledTimes(1)
		expect(h.expenseSetState).toHaveBeenCalledWith({ expenses: [] })
		expect(h.expenseClear).toHaveBeenCalledTimes(1)
		expect(h.savingsSetState).toHaveBeenCalledWith({ savingsGoals: [] })
		expect(h.savingsClear).toHaveBeenCalledTimes(1)
		expect(h.profileReset).toHaveBeenCalledTimes(1)
		expect(h.profileClear).toHaveBeenCalledTimes(1)
		expect(h.balanceReset).toHaveBeenCalledTimes(1)
		expect(h.balanceClear).toHaveBeenCalledTimes(1)

		expect(h.createSyncQueue).not.toHaveBeenCalled()
		expect(h.queueClear).not.toHaveBeenCalled()
	})

	describe('with a live sync service registered', () => {
		it('clears the queue THROUGH the live service for that user, not a fresh queue', async () => {
			const clearQueue = vi.fn().mockResolvedValue(undefined)
			unregister = registerSyncPurgeHandle({ userId: 'user-9', clearQueue })

			await purgeLocalFinancialData('user-9')

			expect(clearQueue).toHaveBeenCalledTimes(1)
			expect(h.createSyncQueue).not.toHaveBeenCalled()
		})

		it("falls back to a fresh queue when the live service is ANOTHER user's", async () => {
			const clearQueue = vi.fn().mockResolvedValue(undefined)
			unregister = registerSyncPurgeHandle({ userId: 'someone-else', clearQueue })

			await purgeLocalFinancialData('user-9')

			expect(clearQueue).not.toHaveBeenCalled()
			expect(h.createSyncQueue).toHaveBeenCalledWith('user-9')
			expect(h.queueClear).toHaveBeenCalledTimes(1)
		})

		it('falls back to a fresh queue, and never rejects, when the live clear fails (a torn-down service)', async () => {
			const clearQueue = vi.fn().mockRejectedValue(new Error('Sync service destroyed'))
			unregister = registerSyncPurgeHandle({ userId: 'user-9', clearQueue })

			await expect(purgeLocalFinancialData('user-9')).resolves.toBeUndefined()

			expect(clearQueue).toHaveBeenCalledTimes(1)
			expect(h.createSyncQueue).toHaveBeenCalledWith('user-9')
			expect(h.queueClear).toHaveBeenCalledTimes(1)
		})

		it('with no userId never touches the live service', async () => {
			const clearQueue = vi.fn().mockResolvedValue(undefined)
			unregister = registerSyncPurgeHandle({ userId: 'user-9', clearQueue })

			await purgeLocalFinancialData()

			expect(clearQueue).not.toHaveBeenCalled()
			expect(h.createSyncQueue).not.toHaveBeenCalled()
		})

		it('an old registration cannot unregister a newer one', async () => {
			const old = vi.fn().mockResolvedValue(undefined)
			const next = vi.fn().mockResolvedValue(undefined)
			const unregisterOld = registerSyncPurgeHandle({ userId: 'user-9', clearQueue: old })
			unregister = registerSyncPurgeHandle({ userId: 'user-9', clearQueue: next })
			unregisterOld()

			await purgeLocalFinancialData('user-9')

			expect(next).toHaveBeenCalledTimes(1)
			expect(old).not.toHaveBeenCalled()
		})
	})

	it('removes the retirement plans parked for other accounts, and nothing else', async () => {
		const items = new Map<string, string>([
			['budget-planner-retirement-planner-v1:aaaa', '{}'],
			['budget-planner-retirement-planner-v1:bbbb', '{}'],
			['budget-planner-currency-v1', 'kept'],
		])
		vi.stubGlobal('localStorage', {
			get length() {
				return items.size
			},
			key: (index: number) => [...items.keys()][index] ?? null,
			getItem: (key: string) => items.get(key) ?? null,
			removeItem: (key: string) => {
				items.delete(key)
			},
		})
		try {
			await purgeLocalFinancialData('')
		} finally {
			vi.unstubAllGlobals()
		}
		expect([...items.keys()]).toEqual(['budget-planner-currency-v1'])
	})

	it('with an empty-string userId also skips the sync queue', async () => {
		await purgeLocalFinancialData('')
		expect(h.incomeClear).toHaveBeenCalledTimes(1)
		expect(h.createSyncQueue).not.toHaveBeenCalled()
	})

	// The real notice store: mocking it would let a missing reset pass.
	describe('refusal notices', () => {
		const refused: RefusalNotice = {
			key: 'incomeSource:gone',
			entityType: 'incomeSource',
			name: 'Salary',
			kind: 'income',
			fallback: 'An income entry',
			outcome: 'removed',
		}
		const notSynced: RefusalNotice = {
			key: 'expense:stuck',
			entityType: 'expense',
			name: 'Rent',
			kind: 'expense',
			fallback: 'An expense',
			outcome: 'not-synced',
			change: 'update',
		}
		afterEach(() => {
			resetRefusalNotices()
		})

		it.each([
			['a userId', 'user-9'],
			['no userId', undefined],
		])('forgets every notice and every dismissal (with %s)', async (_label, userId) => {
			reconcileNotSyncedNotices([notSynced])
			dismissRefusalNotice(notSynced.key)
			addRefusalNotices([refused])
			expect(getRefusalNotices().map((n) => n.key)).toEqual([refused.key])

			await purgeLocalFinancialData(userId)

			expect(getRefusalNotices()).toEqual([])
			reconcileNotSyncedNotices([notSynced])
			expect(getRefusalNotices().map((n) => n.key)).toEqual([notSynced.key])
		})
	})
})
