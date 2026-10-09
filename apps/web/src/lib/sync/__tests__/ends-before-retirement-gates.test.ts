/**
 * A new persisted synced field is a six-gate change, and z.object strips undeclared keys,
 * so a missed gate is not a type error.
 */

import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import {
	clearSyncBridge,
	registerSyncBridge,
	type SyncBridgeHandle,
	syncEntityCreate,
	syncEntityUpdate,
} from '../syncBridge'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const baseRow = {
	name: 'Mortgage',
	amount: 180_000,
	frequency: 'monthly' as const,
	userId: USER_ID,
}

const op = (data: Record<string, unknown>) => ({
	id: '22222222-2222-4222-8222-222222222222',
	type: 'create' as const,
	entityType: 'expense' as const,
	entityId: ROW_ID,
	data,
	timestamp: 1_700_000_000_000,
	deviceId: 'device-1',
	userId: USER_ID,
})

function makeHandle() {
	return {
		userId: USER_ID,
		queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
		queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
		queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
	}
}

let handle: ReturnType<typeof makeHandle>

beforeEach(() => {
	clearSyncBridge()
	handle = makeHandle()
	registerSyncBridge(handle)
})

const expenseRow = (extra: Record<string, unknown> = {}) => ({
	id: ROW_ID,
	userId: 0,
	name: 'Mortgage',
	amount: 180_000,
	frequency: 'monthly' as const,
	categoryId: null,
	sortOrder: 0,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	...extra,
})

describe('Gate 3 — core’s runtime queue gate does not strip the flag', () => {
	it('preserves endsBeforeRetirement: true rather than stripping it', () => {
		const parsed = syncOperationDataSchema.parse({ ...baseRow, endsBeforeRetirement: true })
		expect(parsed.endsBeforeRetirement).toBe(true)
	})

	it('preserves endsBeforeRetirement: false rather than stripping it', () => {
		// `false` matters most: a dropped key looks right for `true` (column default) but can't untick.
		const parsed = syncOperationDataSchema.parse({ ...baseRow, endsBeforeRetirement: false })
		expect(parsed).toHaveProperty('endsBeforeRetirement')
		expect(parsed.endsBeforeRetirement).toBe(false)
	})

	it('leaves the key absent when the payload omits it (partial update)', () => {
		const parsed = syncOperationDataSchema.parse(baseRow)
		expect(parsed.endsBeforeRetirement).toBeUndefined()
	})

	it('REJECTS a non-boolean, while the same fixture is otherwise accepted', () => {
		// Acceptance partner on the same fixture, so the rejection can't pass vacuously.
		expect(() =>
			syncOperationDataSchema.parse({ ...baseRow, endsBeforeRetirement: 'yes' })
		).toThrow()
		expect(() =>
			syncOperationDataSchema.parse({ ...baseRow, endsBeforeRetirement: true })
		).not.toThrow()
	})
})

describe('Gate 4 — the server ingest schema validates the flag and keeps it in data', () => {
	it('passes endsBeforeRetirement: true through UNSTRIPPED', () => {
		const parsed = syncOperationSchema.parse(op({ ...baseRow, endsBeforeRetirement: true }))
		expect((parsed.data as Record<string, unknown>)['endsBeforeRetirement']).toBe(true)
	})

	it('passes an explicit false through unchanged', () => {
		const parsed = syncOperationSchema.parse(op({ ...baseRow, endsBeforeRetirement: false }))
		expect(parsed.data as Record<string, unknown>).toHaveProperty('endsBeforeRetirement')
		expect((parsed.data as Record<string, unknown>)['endsBeforeRetirement']).toBe(false)
	})

	it('⚠️ does NOT default an omitted flag — the superRefine DISCARDS its parse result', () => {
		// superRefine discards the parsed value, so the server default never reaches data.
		const parsed = syncOperationSchema.parse(op(baseRow))
		expect((parsed.data as Record<string, unknown>)['endsBeforeRetirement']).toBeUndefined()
	})

	it('REJECTS a non-boolean, while the same fixture is otherwise accepted', () => {
		expect(() => syncOperationSchema.parse(op({ ...baseRow, endsBeforeRetirement: 1 }))).toThrow()
		expect(() =>
			syncOperationSchema.parse(op({ ...baseRow, endsBeforeRetirement: false }))
		).not.toThrow()
	})
})

/** `=== true`, not `?? false`: a persisted "false" string would fail the queue gate and stop the row syncing. */
describe('Gate 5 — the push payload carries the flag, in both directions', () => {
	it('update forwards a ticked flag', () => {
		syncEntityUpdate('expense', expenseRow({ endsBeforeRetirement: true }))
		expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
		const payload = handle.queueUpdate.mock.calls[0][2]
		expect(payload['endsBeforeRetirement']).toBe(true)
		expect(payload['name']).toBe('Mortgage')
		expect(payload['amount']).toBe(180_000)
		expect(payload['frequency']).toBe('monthly')
	})

	it('create forwards a ticked flag', () => {
		syncEntityCreate('expense', expenseRow({ endsBeforeRetirement: true }))
		expect(handle.queueCreate).toHaveBeenCalledTimes(1)
		expect(handle.queueCreate.mock.calls[0][2]).toMatchObject({ endsBeforeRetirement: true })
	})

	it('⚠️ UNTICKING sends an explicit false — the untick actually clears the server value', () => {
		syncEntityUpdate('expense', expenseRow({ endsBeforeRetirement: false }))
		const payload = handle.queueUpdate.mock.calls[0][2]
		expect(Object.hasOwn(payload, 'endsBeforeRetirement')).toBe(true)
		expect(payload['endsBeforeRetirement']).toBe(false)
	})

	it.each([
		['undefined', undefined],
		['absent', 'OMIT' as const],
	])(
		'⚠️ an UNSTAMPED row (%s) still puts an explicit false on the wire, not an undefined',
		(_label, value) => {
			const row = value === 'OMIT' ? expenseRow() : expenseRow({ endsBeforeRetirement: undefined })
			syncEntityUpdate('expense', row)
			const payload = handle.queueUpdate.mock.calls[0][2]
			// `JSON.stringify` drops an undefined-valued key, so present-but-undefined equals absent.
			expect(payload['endsBeforeRetirement']).toBe(false)
			expect(JSON.parse(JSON.stringify(payload))).toHaveProperty('endsBeforeRetirement', false)
		}
	)

	it.each([
		['a truthy "false" string', 'false'],
		['a "true" string', 'true'],
		['the number 1', 1],
		['an empty string', ''],
	])(
		'⚠️⚠️ coerces %s to a real boolean rather than forwarding it (code review 65.2)',
		(_label, junk) => {
			// localStorage junk forwarded uncoerced makes the queue gate reject the whole op.
			syncEntityUpdate('expense', expenseRow({ endsBeforeRetirement: junk }))
			const payload = handle.queueUpdate.mock.calls[0][2]
			expect(payload['endsBeforeRetirement']).toBe(false)
			expect(() => syncOperationDataSchema.parse({ ...payload, userId: USER_ID })).not.toThrow()
		}
	)

	it('⚠️ does NOT put the flag on an incomeSource payload — income has no such column', () => {
		// Drizzle silently drops a non-column key, so a shared arm wouldn't throw; split for a future .strict().
		syncEntityUpdate('incomeSource', expenseRow({ endsBeforeRetirement: true }))
		const payload = handle.queueUpdate.mock.calls[0][2]
		expect(Object.hasOwn(payload, 'endsBeforeRetirement')).toBe(false)
		expect(payload['name']).toBe('Mortgage')
		expect(payload['amount']).toBe(180_000)
		expect(payload['frequency']).toBe('monthly')
		expect(payload['sortOrder']).toBe(0)
	})
})

/** Required iff the column is NOT NULL: a default would make the key optional on the pull gate. */
describe('Gate 2 — core’s per-entity expense mirror declares the flag', () => {
	it('REFUSES a row that omits the flag (the pull gate wants a complete row)', async () => {
		const { expenseSchema } = await import('@budget-planner/core/sync/types')
		expect(expenseSchema.safeParse(baseRow).success).toBe(false)
	})

	it('accepts an explicit false', async () => {
		const { expenseSchema } = await import('@budget-planner/core/sync/types')
		expect(
			expenseSchema.parse({ ...baseRow, endsBeforeRetirement: false }).endsBeforeRetirement
		).toBe(false)
	})

	it('preserves an explicit true', async () => {
		const { expenseSchema } = await import('@budget-planner/core/sync/types')
		expect(
			expenseSchema.parse({ ...baseRow, endsBeforeRetirement: true }).endsBeforeRetirement
		).toBe(true)
	})
})

/** Chains payload → server schema → updateEntity destructuring → drizzle SQL. Not the database round trip. */
describe('Gate 1 — the flag survives payload -> server schema -> generated SQL', () => {
	it('reaches the UPDATE statement as a real column', async () => {
		const { drizzle } = await import('drizzle-orm/node-postgres')
		const { eq, and } = await import('drizzle-orm')
		const { expenses } = await import('@budget-planner/db/schema')
		const db = drizzle({} as never)

		syncEntityUpdate('expense', expenseRow({ endsBeforeRetirement: true }))
		const payload = handle.queueUpdate.mock.calls[0][2]

		// updateEntity's destructuring: drop id/profileId/userId, re-stamp userId and updatedAt.
		const parsed = syncOperationSchema.parse(op({ ...payload, userId: USER_ID }))
		const data = parsed.data as Record<string, unknown>
		const { id: _id, profileId: _p, userId: _u, ...fields } = data
		const updateData = { ...fields, userId: USER_ID, updatedAt: new Date() }

		const sql = db
			.update(expenses)
			.set(updateData)
			.where(and(eq(expenses.userId, USER_ID), eq(expenses.id, ROW_ID)))
			.toSQL().sql

		expect(sql).toContain('"endsBeforeRetirement"')
		// Drizzle silently drops non-column keys, so asserting a sibling column proves the statement was built.
		expect(sql).toContain('"name"')
	})

	it('reaches the INSERT statement as a real column', async () => {
		const { drizzle } = await import('drizzle-orm/node-postgres')
		const { expenses } = await import('@budget-planner/db/schema')
		const db = drizzle({} as never)

		syncEntityCreate('expense', expenseRow({ endsBeforeRetirement: true }))
		const payload = handle.queueCreate.mock.calls[0][2]
		const parsed = syncOperationSchema.parse(op({ ...payload, userId: USER_ID }))

		const sql = db
			.insert(expenses)
			// @ts-expect-error - dynamic insert, as at the production call site
			.values({
				...(parsed.data as Record<string, unknown>),
				id: ROW_ID,
				userId: USER_ID,
				profileId: USER_ID,
				updatedAt: new Date(),
			})
			.toSQL().sql

		expect(sql).toContain('"endsBeforeRetirement"')
		expect(sql).toContain('"name"')
	})
})
