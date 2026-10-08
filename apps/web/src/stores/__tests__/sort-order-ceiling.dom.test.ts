/**
 * Tested at the consequence: the queue swallows the client gate's rejection, so the list silently
 * stops syncing. These run the real gate over the payload the bridge actually queued.
 */

import { PG_INT32_MAX, syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import { useBalanceStore } from '../balanceStore'
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'
import { useSavingsStore } from '../savingsStore'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

/** Written out per store so a store that stops being covered shows in the diff. */
const STORES = [
	{
		label: 'incomeStore',
		collection: 'incomeSources',
		reset: () => useIncomeStore.setState({ incomeSources: [] }),
		add: (name: string) =>
			useIncomeStore.getState().addIncomeSource({ name, amount: 1000, frequency: 'monthly' }),
		read: () => useIncomeStore.getState().incomeSources,
		plantAtCeiling: () => {
			useIncomeStore
				.getState()
				.addIncomeSource({ name: 'pulled', amount: 1000, frequency: 'monthly' })
			useIncomeStore.setState((state) => ({
				incomeSources: state.incomeSources.map((row) => ({ ...row, sortOrder: PG_INT32_MAX })),
			}))
		},
	},
	{
		label: 'expenseStore',
		collection: 'expenses',
		reset: () => useExpenseStore.setState({ expenses: [] }),
		add: (name: string) =>
			useExpenseStore.getState().addExpense({ name, amount: 1000, frequency: 'monthly' }),
		read: () => useExpenseStore.getState().expenses,
		plantAtCeiling: () => {
			useExpenseStore.getState().addExpense({ name: 'pulled', amount: 1000, frequency: 'monthly' })
			useExpenseStore.setState((state) => ({
				expenses: state.expenses.map((row) => ({ ...row, sortOrder: PG_INT32_MAX })),
			}))
		},
	},
	{
		label: 'savingsStore',
		collection: 'savingsGoals',
		reset: () => useSavingsStore.setState({ savingsGoals: [] }),
		add: (name: string) =>
			useSavingsStore.getState().addSavingsGoal({ name, targetAmount: 5000, currentBalance: 0 }),
		read: () => useSavingsStore.getState().savingsGoals,
		plantAtCeiling: () => {
			useSavingsStore
				.getState()
				.addSavingsGoal({ name: 'pulled', targetAmount: 5000, currentBalance: 0 })
			useSavingsStore.setState((state) => ({
				savingsGoals: state.savingsGoals.map((row) => ({ ...row, sortOrder: PG_INT32_MAX })),
			}))
		},
	},
	{
		label: 'balanceStore',
		collection: 'entries',
		reset: () => useBalanceStore.setState({ entries: [] }),
		add: (name: string) =>
			useBalanceStore.getState().addBalanceEntry({
				type: 'investment',
				name,
				currentBalance: 1000,
				monthlyContribution: 0,
				frequency: 'monthly',
			}),
		read: () => useBalanceStore.getState().entries,
		plantAtCeiling: () => {
			useBalanceStore.getState().addBalanceEntry({
				type: 'investment',
				name: 'pulled',
				currentBalance: 1000,
				monthlyContribution: 0,
				frequency: 'monthly',
			})
			useBalanceStore.setState((state) => ({
				entries: state.entries.map((row) => ({ ...row, sortOrder: PG_INT32_MAX })),
			}))
		},
	},
] as const

beforeEach(() => {
	localStorage.clear()
	clearSyncBridge()
	for (const store of STORES) {
		store.reset()
	}
})

describe.each(STORES)('$label — one ceiling row must not stop the list syncing', (store) => {
	/** zod's `.max` is inclusive, so a pulled row at PG_INT32_MAX is a valid server row. */
	it('the payload the bridge queues still PASSES the real client gate', () => {
		const queued: Record<string, unknown>[] = []
		registerSyncBridge({
			userId: SESSION_USER_ID,
			queueCreate: vi.fn(async (_type, _id, data) => {
				queued.push(data)
			}),
			queueUpdate: vi.fn(async () => {}),
			queueDelete: vi.fn(async () => {}),
		})

		store.plantAtCeiling()
		queued.length = 0 // discard the planted row's own op; the NEXT add is under test

		store.add('the-add-that-breaks-today')

		expect(queued).toHaveLength(1)
		expect(() => syncOperationDataSchema.parse(queued[0])).not.toThrow()
		expect(queued[0]?.sortOrder).toBe(PG_INT32_MAX)
	})

	/** Cumulative: max + 1 over an out-of-range value breaks every later add. */
	it('EVERY later add stays inside the gate, not just the first', () => {
		const queued: Record<string, unknown>[] = []
		registerSyncBridge({
			userId: SESSION_USER_ID,
			queueCreate: vi.fn(async (_type, _id, data) => {
				queued.push(data)
			}),
			queueUpdate: vi.fn(async () => {}),
			queueDelete: vi.fn(async () => {}),
		})

		store.plantAtCeiling()
		queued.length = 0

		store.add('second')
		store.add('third')
		store.add('fourth')

		expect(queued).toHaveLength(3)
		for (const payload of queued) {
			// sortOrder is `.optional()` in the schema, so a payload that dropped it would parse cleanly.
			expect(payload.sortOrder).toBe(PG_INT32_MAX)
			expect(() => syncOperationDataSchema.parse(payload)).not.toThrow()
		}
	})

	it('queues without a swallowed rejection reaching console.error', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		registerSyncBridge({
			userId: SESSION_USER_ID,
			// The gate runs inside the queue, as the real sync service does.
			queueCreate: vi.fn(async (_type, _id, data) => {
				syncOperationDataSchema.parse(data)
			}),
			queueUpdate: vi.fn(async () => {}),
			queueDelete: vi.fn(async () => {}),
		})

		try {
			store.plantAtCeiling()
			store.add('the-add-that-breaks-today')
			// syncEntityCreate is fire-and-forget; two ticks were measured sufficient for the rejection to settle.
			await Promise.resolve()
			await Promise.resolve()

			expect(consoleError).not.toHaveBeenCalled()
		} finally {
			// In a finally so a failure does not leak a silenced console.error into later iterations.
			consoleError.mockRestore()
		}
	})

	/** createdAt is ms-resolution, so same-ms rows at the ceiling fall through to a random uuid. */
	/** Revert-insensitive: the control for the same-millisecond case below, not clamp coverage. */
	it('rows created at distinct times still read BOTTOM-wards in insertion order', () => {
		vi.useFakeTimers()
		try {
			store.plantAtCeiling()
			vi.advanceTimersByTime(1000)
			store.add('second')
			vi.advanceTimersByTime(1000)
			store.add('third')

			expect(store.read().map((r) => r.name)).toEqual(['pulled', 'second', 'third'])
		} finally {
			vi.useRealTimers()
		}
	})

	it('same-millisecond rows at the ceiling keep every row, order NOT guaranteed', () => {
		vi.useFakeTimers()
		try {
			store.plantAtCeiling()
			store.add('second')
			store.add('third')

			const rows = store.read()
			// Relative order among tied rows is not asserted: it is a uuid sort.
			expect([...rows.map((r) => r.name)].sort()).toEqual(['pulled', 'second', 'third'])
			expect(rows.every((r) => r.sortOrder === PG_INT32_MAX)).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})
})
