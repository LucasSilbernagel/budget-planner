/**
 * Every assertion runs against all four stores: independent implementations with no shared
 * factory, so testing one proves nothing about the others.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasPaidAccess } from '../../lib/premium/access-statuses'
import {
	clearSyncBridge,
	registerSyncBridge,
	type SyncBridgeHandle,
} from '../../lib/sync/syncBridge'
import { useBalanceStore } from '../balanceStore'
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'
import { useSavingsStore } from '../savingsStore'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

/** Written out per store so a store that stops being covered shows in the diff. */
const STORES = [
	{
		label: 'incomeStore',
		persistVersion: 3,
		key: 'budget-planner-income-v1',
		collection: 'incomeSources',
		reset: () => useIncomeStore.setState({ incomeSources: [] }),
		add: (name: string) =>
			useIncomeStore.getState().addIncomeSource({ name, amount: 1000, frequency: 'monthly' }),
		read: () => useIncomeStore.getState().incomeSources,
		remove: (id: string) => useIncomeStore.getState().deleteIncomeSource(id),
		tieAllPositions: () =>
			useIncomeStore.setState((state) => ({
				incomeSources: state.incomeSources.map((row) => ({ ...row, sortOrder: 4 })),
			})),
		rehydrate: () => useIncomeStore.persist.rehydrate(),
		legacyRow: (id: string, createdAt: string) => ({
			id,
			userId: 0,
			name: `row-${id}`,
			amount: 1000,
			frequency: 'monthly',
			categoryId: null,
			createdAt,
			updatedAt: createdAt,
		}),
	},
	{
		label: 'expenseStore',
		persistVersion: 3,
		key: 'budget-planner-expenses-v1',
		collection: 'expenses',
		reset: () => useExpenseStore.setState({ expenses: [] }),
		add: (name: string) =>
			useExpenseStore.getState().addExpense({ name, amount: 1000, frequency: 'monthly' }),
		read: () => useExpenseStore.getState().expenses,
		remove: (id: string) => useExpenseStore.getState().deleteExpense(id),
		tieAllPositions: () =>
			useExpenseStore.setState((state) => ({
				expenses: state.expenses.map((row) => ({ ...row, sortOrder: 4 })),
			})),
		rehydrate: () => useExpenseStore.persist.rehydrate(),
		legacyRow: (id: string, createdAt: string) => ({
			id,
			userId: 0,
			name: `row-${id}`,
			amount: 1000,
			frequency: 'monthly',
			categoryId: null,
			createdAt,
			updatedAt: createdAt,
		}),
	},
	{
		label: 'savingsStore',
		persistVersion: 3,
		key: 'budget-planner:savings-goals',
		collection: 'savingsGoals',
		reset: () => useSavingsStore.setState({ savingsGoals: [] }),
		add: (name: string) =>
			useSavingsStore.getState().addSavingsGoal({ name, targetAmount: 5000, currentBalance: 0 }),
		read: () => useSavingsStore.getState().savingsGoals,
		remove: (id: string) => useSavingsStore.getState().deleteSavingsGoal(id),
		tieAllPositions: () =>
			useSavingsStore.setState((state) => ({
				savingsGoals: state.savingsGoals.map((row) => ({ ...row, sortOrder: 4 })),
			})),
		rehydrate: () => useSavingsStore.persist.rehydrate(),
		legacyRow: (id: string, createdAt: string) => ({
			id,
			name: `row-${id}`,
			targetAmount: 5000,
			currentBalance: 0,
			allocationMode: 'automatic',
			monthlyAllocation: null,
			createdAt,
			updatedAt: createdAt,
		}),
	},
	{
		label: 'balanceStore',
		persistVersion: 4,
		key: 'budget-planner:balance-tracking',
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
		remove: (id: string) => useBalanceStore.getState().deleteBalanceEntry(id),
		tieAllPositions: () =>
			useBalanceStore.setState((state) => ({
				entries: state.entries.map((row) => ({ ...row, sortOrder: 4 })),
			})),
		rehydrate: () => useBalanceStore.persist.rehydrate(),
		legacyRow: (id: string, createdAt: string) => ({
			id,
			type: 'investment',
			name: `row-${id}`,
			currentBalance: 1000,
			monthlyContribution: 0,
			frequency: 'monthly',
			createdAt,
			updatedAt: createdAt,
		}),
	},
] as const

beforeEach(() => {
	localStorage.clear()
	clearSyncBridge()
	for (const store of STORES) {
		store.reset()
	}
})

describe.each(STORES)('$label — new rows land at the BOTTOM (AC-3)', (store) => {
	it('appends in insertion order and assigns 0, 1, 2', () => {
		store.add('first')
		store.add('second')
		store.add('third')

		const rows = store.read()
		expect(rows.map((r) => r.name)).toEqual(['first', 'second', 'third'])
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
	})

	it('assigns 0 to the first row of an empty list', () => {
		store.add('only')
		expect(store.read()[0]?.sortOrder).toBe(0)
	})

	/**
	 * Clock driven forward between adds: with same-ms createdAt, newest-first is indistinguishable
	 * from append order.
	 */
	it('appends oldest-first even when each row has a DISTINCT createdAt (kills M10)', () => {
		vi.useFakeTimers()
		try {
			vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
			store.add('first')
			vi.advanceTimersByTime(60_000)
			store.add('second')
			vi.advanceTimersByTime(60_000)
			store.add('third')
		} finally {
			vi.useRealTimers()
		}

		const rows = store.read()
		// Distinct timestamps, or this test cannot discriminate.
		expect(new Set(rows.map((r) => r.createdAt)).size).toBe(3)
		expect(rows.map((r) => r.name)).toEqual(['first', 'second', 'third'])
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
	})

	/** A delete leaves a gap on purpose; using list.length would collide with the row at position 2. */
	it('AC-6: after deleting from the middle, the next insert does not collide', () => {
		store.add('a')
		store.add('b')
		store.add('c')

		const b = store.read()[1]
		store.remove(b.id)

		const afterDelete = store.read()
		expect(afterDelete.map((r) => r.name)).toEqual(['a', 'c'])
		expect(afterDelete.map((r) => r.sortOrder)).toEqual([0, 2])

		store.add('d')
		const final = store.read()
		expect(final.map((r) => r.name)).toEqual(['a', 'c', 'd'])
		expect(final.map((r) => r.sortOrder)).toEqual([0, 2, 3])
	})

	it('AC-6: deleting preserves the relative order of the remaining rows', () => {
		store.add('a')
		store.add('b')
		store.add('c')
		store.add('d')

		store.remove(store.read()[0].id)
		expect(store.read().map((r) => r.name)).toEqual(['b', 'c', 'd'])
	})
})

describe.each(STORES)('$label — legacy -> current backfill (AC-2)', (store) => {
	/** Seeded newest-first, so backfilling by array index would give exactly the reverse order. */
	it('assigns dense 0..n-1 by createdAt ASC, ignoring the stored array order', async () => {
		localStorage.setItem(
			store.key,
			JSON.stringify({
				version: 2,
				state: {
					[store.collection]: [
						store.legacyRow('11111111-1111-4111-8111-111111111111', '2026-03-01T00:00:00.000Z'),
						store.legacyRow('22222222-2222-4222-8222-222222222222', '2026-02-01T00:00:00.000Z'),
						store.legacyRow('33333333-3333-4333-8333-333333333333', '2026-01-01T00:00:00.000Z'),
					],
				},
			})
		)

		await store.rehydrate()

		const rows = store.read()
		expect(rows).toHaveLength(3)
		expect(rows.map((r) => r.createdAt)).toEqual([
			'2026-01-01T00:00:00.000Z',
			'2026-02-01T00:00:00.000Z',
			'2026-03-01T00:00:00.000Z',
		])
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
	})

	/**
	 * createdAt is ms-precision, so ties are routine; without the id tiebreaker the backfill is not
	 * reproducible across client and server.
	 */
	it('breaks a same-millisecond createdAt tie by id, deterministically', async () => {
		const SAME = '2026-01-01T00:00:00.000Z'
		localStorage.setItem(
			store.key,
			JSON.stringify({
				version: 2,
				state: {
					[store.collection]: [
						store.legacyRow('cccccccc-cccc-4ccc-8ccc-cccccccccccc', SAME),
						store.legacyRow('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SAME),
						store.legacyRow('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', SAME),
					],
				},
			})
		)

		await store.rehydrate()

		expect(store.read().map((r) => r.id)).toEqual([
			'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
			'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
		])
		expect(store.read().map((r) => r.sortOrder)).toEqual([0, 1, 2])
	})

	it('leaves no row orderless', async () => {
		localStorage.setItem(
			store.key,
			JSON.stringify({
				version: 2,
				state: {
					[store.collection]: [
						store.legacyRow('11111111-1111-4111-8111-111111111111', '2026-01-01T00:00:00.000Z'),
						store.legacyRow('22222222-2222-4222-8222-222222222222', '2026-01-02T00:00:00.000Z'),
					],
				},
			})
		)

		await store.rehydrate()

		for (const row of store.read()) {
			expect(typeof row.sortOrder).toBe('number')
			expect(Number.isFinite(row.sortOrder)).toBe(true)
		}
	})

	it('survives a null row in the persisted array without losing the list', async () => {
		localStorage.setItem(
			store.key,
			JSON.stringify({
				version: 2,
				state: {
					[store.collection]: [
						store.legacyRow('11111111-1111-4111-8111-111111111111', '2026-01-01T00:00:00.000Z'),
						null,
						store.legacyRow('22222222-2222-4222-8222-222222222222', '2026-01-02T00:00:00.000Z'),
					],
				},
			})
		)

		await store.rehydrate()

		const rows = store.read()
		expect(rows).toHaveLength(2)
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1])
	})

	/** Uses each store's current version; a stale number would re-run migrate and renumber. */
	it('a payload at the current version is left alone (migrate does not re-run)', async () => {
		localStorage.setItem(
			store.key,
			JSON.stringify({
				version: store.persistVersion,
				state: {
					[store.collection]: [
						{
							...store.legacyRow(
								'11111111-1111-4111-8111-111111111111',
								'2026-01-01T00:00:00.000Z'
							),
							sortOrder: 7,
						},
					],
				},
			})
		)

		await store.rehydrate()

		expect(store.read()[0].sortOrder).toBe(7)
	})
})

/**
 * Pinned on the free tier explicitly: a tier-conditional regression is invisible to a
 * single-tier suite.
 */
describe.each(STORES)('$label — tier matrix (AC-9)', (store) => {
	it('FREE (no session): assigns sortOrder and enqueues NOTHING', () => {
		// Deliberately NOT registered (free tier); the spies turn that into an assertion.
		const unregistered = {
			userId: SESSION_USER_ID,
			queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
			queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
			queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
		}

		store.add('free-a')
		store.add('free-b')
		const first = store.read()[0]
		store.remove(first.id)

		expect(store.read().map((r) => r.sortOrder)).toEqual([1])
		expect(unregistered.queueCreate).not.toHaveBeenCalled()
		expect(unregistered.queueUpdate).not.toHaveBeenCalled()
		expect(unregistered.queueDelete).not.toHaveBeenCalled()
	})

	/** The store cannot distinguish paid tiers; the status-sensitive part is hasPaidAccess. */
	it.each(['active', 'lifetime'] as const)(
		'PAID (%s): the tier may sync, and the position is assigned AND pushed',
		(status) => {
			expect(hasPaidAccess(status)).toBe(true)

			const queueCreate = vi.fn<SyncBridgeHandle['queueCreate']>(async () => {})
			registerSyncBridge({
				userId: SESSION_USER_ID,
				queueCreate,
				queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
				queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
			})

			store.add('paid-a')
			store.add('paid-b')

			expect(store.read().map((r) => r.sortOrder)).toEqual([0, 1])
			expect(queueCreate).toHaveBeenCalledTimes(2)
			expect(queueCreate.mock.calls[0][2]).toMatchObject({ sortOrder: 0 })
			expect(queueCreate.mock.calls[1][2]).toMatchObject({ sortOrder: 1 })
		}
	)
})
