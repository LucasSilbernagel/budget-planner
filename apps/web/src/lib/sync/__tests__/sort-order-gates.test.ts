/**
 * The server per-entity schemas run inside a superRefine that discards its parse result,
 * so they validate rather than strip.
 */

import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import {
	clearSyncBridge,
	registerSyncBridge,
	type SyncBridgeHandle,
	syncEntityCreate,
	syncEntityUpdate,
} from '../syncBridge'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeHandle() {
	return {
		userId: SESSION_USER_ID,
		queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
		queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
		queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
	}
}

let handle: ReturnType<typeof makeHandle>

beforeEach(() => {
	handle = makeHandle()
	registerSyncBridge(handle)
})

afterEach(() => {
	clearSyncBridge()
	vi.restoreAllMocks()
})

/** `toServerPayload` returns `Record<string, unknown>`, so a forgotten key is not a type error. */
describe('Gate 2 — the push payload carries sortOrder on every branch', () => {
	const CASES = [
		{
			entityType: 'incomeSource' as const,
			entity: {
				id: ROW_ID,
				userId: 0,
				name: 'Salary',
				amount: 1000,
				frequency: 'monthly',
				sortOrder: 3,
			},
		},
		{
			entityType: 'expense' as const,
			entity: {
				id: ROW_ID,
				userId: 0,
				name: 'Rent',
				amount: 1000,
				frequency: 'monthly',
				sortOrder: 4,
			},
		},
		{
			entityType: 'savingsGoal' as const,
			entity: { id: ROW_ID, name: 'Fund', targetAmount: 5000, currentBalance: 0, sortOrder: 5 },
		},
		{
			entityType: 'balanceTracking' as const,
			entity: {
				id: ROW_ID,
				type: 'investment',
				name: 'Brokerage',
				currentBalance: 1000,
				monthlyContribution: 0,
				frequency: 'monthly',
				sortOrder: 6,
			},
		},
	]

	it.each(CASES)('create forwards sortOrder for $entityType', ({ entityType, entity }) => {
		syncEntityCreate(entityType, entity)
		expect(handle.queueCreate).toHaveBeenCalledTimes(1)
		expect(handle.queueCreate.mock.calls[0][2]).toMatchObject({ sortOrder: entity.sortOrder })
	})

	/** `updateEntity` does a partial `.set()`, so an omitted `sortOrder` silently keeps the old value. */
	it.each(CASES)(
		'update forwards sortOrder for $entityType, including 0',
		({ entityType, entity }) => {
			// A named row, not an inline literal, so the bridge's narrow view does not trip the excess-property check.
			const reordered = { ...entity, sortOrder: 0 }
			syncEntityUpdate(entityType, reordered)
			expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
			const payload = handle.queueUpdate.mock.calls[0][2]
			expect(Object.hasOwn(payload, 'sortOrder')).toBe(true)
			expect(payload.sortOrder).toBe(0)
		}
	)
})

/** This gate strips undeclared keys, so a missing declaration silently drops `sortOrder`. */
describe('Gate 3 — the client zod gate does not strip sortOrder', () => {
	it('preserves sortOrder through a parse', () => {
		const parsed = syncOperationDataSchema.parse({
			name: 'Salary',
			amount: 1000,
			frequency: 'monthly',
			sortOrder: 7,
			userId: SESSION_USER_ID,
		})
		expect(parsed.sortOrder).toBe(7)
	})

	it('preserves an explicit 0 rather than dropping it', () => {
		const parsed = syncOperationDataSchema.parse({ name: 'Salary', sortOrder: 0 })
		expect(Object.hasOwn(parsed, 'sortOrder')).toBe(true)
		expect(parsed.sortOrder).toBe(0)
	})

	it('DOES strip a genuinely undeclared key (so the check above is meaningful)', () => {
		const parsed = syncOperationDataSchema.parse({
			name: 'Salary',
			notARealField: 'dropped',
		} as Record<string, unknown>)
		expect(Object.hasOwn(parsed, 'notARealField')).toBe(false)
	})

	it.each([-1, 1.5, 2_147_483_648])('rejects an out-of-range sortOrder (%s)', (bad) => {
		expect(() => syncOperationDataSchema.parse({ name: 'Salary', sortOrder: bad })).toThrow()
	})
})

describe('Gate 4 — the server gates validate sortOrder for all four entities', () => {
	const op = (entityType: string, data: Record<string, unknown>) => ({
		id: 'op-1',
		type: 'create',
		entityType,
		entityId: ROW_ID,
		timestamp: 1_700_000_000_000,
		deviceId: 'device-1',
		userId: SESSION_USER_ID,
		data: { ...data, userId: SESSION_USER_ID },
	})

	const ENTITIES = [
		{ entityType: 'incomeSource', base: { name: 'Salary', amount: 1000, frequency: 'monthly' } },
		{ entityType: 'expense', base: { name: 'Rent', amount: 1000, frequency: 'monthly' } },
		{ entityType: 'savingsGoal', base: { name: 'Fund', targetAmount: 5000, currentBalance: 0 } },
		{
			entityType: 'balanceTracking',
			base: {
				type: 'investment',
				name: 'Brokerage',
				currentBalance: 1000,
				monthlyContribution: 0,
				frequency: 'monthly',
			},
		},
	]

	it.each(ENTITIES)(
		'$entityType accepts a valid sortOrder and keeps it in data',
		({ entityType, base }) => {
			const parsed = syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 5 }))
			expect((parsed.data as Record<string, unknown>).sortOrder).toBe(5)
		}
	)

	it.each(ENTITIES)('$entityType accepts an explicit 0', ({ entityType, base }) => {
		expect(() => syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 0 }))).not.toThrow()
	})

	it.each(ENTITIES)('$entityType REJECTS a negative sortOrder', ({ entityType, base }) => {
		expect(() => syncOperationSchema.parse(op(entityType, { ...base, sortOrder: -1 }))).toThrow()
	})

	it.each(ENTITIES)('$entityType REJECTS a fractional sortOrder', ({ entityType, base }) => {
		expect(() => syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 1.5 }))).toThrow()
	})

	it.each(ENTITIES)(
		'$entityType REJECTS a sortOrder past the int32 column ceiling',
		({ entityType, base }) => {
			expect(() =>
				syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 2_147_483_648 }))
			).toThrow()
		}
	)

	it.each(ENTITIES)('$entityType REJECTS a non-numeric sortOrder', ({ entityType, base }) => {
		expect(() => syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 'top' }))).toThrow()
	})

	/** Optional because older rows and the unordered entity types must still validate. */
	it.each(ENTITIES)(
		'$entityType still accepts an operation with no sortOrder',
		({ entityType, base }) => {
			expect(() => syncOperationSchema.parse(op(entityType, base))).not.toThrow()
		}
	)
})
