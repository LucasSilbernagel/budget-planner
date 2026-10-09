/**
 * Unlink must clear (an omitted key keeps the old link); a dangling uuid must be accepted
 * (an FK error would stay queued until the circuit breaker stops all sync).
 */

import { readFileSync } from 'node:fs'
import { balanceTracking, expenses } from '@budget-planner/db/schema'
import { PGlite } from '@electric-sql/pglite'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import { useBalanceStore } from '../../../stores/balanceStore'
import { applyServerChangesToStores } from '../applyServerChanges'
import {
	clearSyncBridge,
	registerSyncBridge,
	type SyncBridgeHandle,
	syncEntityUpdate,
} from '../syncBridge'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '99999999-9999-4999-8999-999999999999'
const DEBT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const EXPENSE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const DANGLING_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

type JournalEntry = {
	idx: number
	tag: string
}

const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', MIGRATIONS), 'utf8')) as {
	entries: JournalEntry[]
}

function statementsFor(tag: string): string[] {
	return readFileSync(new URL(`${tag}.sql`, MIGRATIONS), 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean)
}

let pg: PGlite
let db: ReturnType<typeof drizzle>

beforeAll(async () => {
	pg = await PGlite.create()
	await pg.exec('BEGIN')
	for (const entry of journal.entries) {
		for (const statement of statementsFor(entry.tag)) {
			await pg.exec(statement)
		}
	}
	await pg.exec('COMMIT')
	db = drizzle(pg)

	await pg.exec(`
    INSERT INTO "users" ("id", "email", "paddleId")
      VALUES ('${USER_ID}', 'roundtrip@example.com', 'ctm_roundtrip_102_1');
    INSERT INTO "userProfiles" ("id", "userId", "name", "currency")
      VALUES ('${PROFILE_ID}', '${USER_ID}', 'Main Profile', 'USD');
  `)
	await db.insert(expenses).values({
		id: EXPENSE_ID,
		userId: USER_ID,
		profileId: PROFILE_ID,
		name: 'Car payment',
		amount: 45_000,
		frequency: 'monthly',
	})
	await db.insert(balanceTracking).values({
		id: DEBT_ID,
		userId: USER_ID,
		profileId: PROFILE_ID,
		type: 'debt',
		name: 'Car loan',
		currentBalance: -1_200_000,
	})
}, 120_000)

afterAll(async () => {
	await pg?.close()
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

const clientDebt = (paymentExpenseId: string | null | undefined) => ({
	id: DEBT_ID,
	userId: 0,
	type: 'debt' as const,
	name: 'Car loan',
	currentBalance: -1_200_000,
	monthlyContribution: 0,
	frequency: 'monthly' as const,
	contributionRecordedAsExpense: false,
	sortOrder: 0,
	paymentExpenseId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
})

async function pushUpdate(paymentExpenseId: string | null | undefined): Promise<void> {
	handle.queueUpdate.mockClear()
	syncEntityUpdate('balanceTracking', clientDebt(paymentExpenseId))
	const payload = handle.queueUpdate.mock.calls[0]?.[2]
	expect(payload).toBeDefined()

	const parsed = syncOperationSchema.parse({
		id: '22222222-2222-4222-8222-222222222222',
		type: 'update' as const,
		entityType: 'balanceTracking' as const,
		entityId: DEBT_ID,
		data: { ...payload, userId: USER_ID },
		timestamp: 1_700_000_000_000,
		deviceId: 'device-a',
		userId: USER_ID,
		profileId: PROFILE_ID,
	})

	const data = parsed.data as Record<string, unknown>
	const { id: _id, profileId: _p, userId: _u, ...fields } = data
	await db
		.update(balanceTracking)
		.set({ ...fields, userId: USER_ID, updatedAt: new Date() })
		.where(and(eq(balanceTracking.userId, USER_ID), eq(balanceTracking.id, DEBT_ID)))
}

async function pullRow() {
	const rows = await db.select().from(balanceTracking).where(eq(balanceTracking.id, DEBT_ID))
	return rows[0]
}

async function pullIntoStore(): Promise<Record<string, unknown> | undefined> {
	const row = await pullRow()
	useBalanceStore.setState({ entries: [] })
	applyServerChangesToStores(
		[
			{
				entityType: 'balanceTracking',
				entityId: DEBT_ID,
				data: row as unknown as Record<string, unknown>,
				updatedAt: Date.now(),
				isDeleted: false,
			},
		],
		USER_ID
	)
	return useBalanceStore.getState().entries[0] as unknown as Record<string, unknown>
}

describe('paymentExpenseId: device A writes, the database answers', () => {
	it('the column exists on a freshly migrated database and starts NULL', async () => {
		expect((await pullRow())?.paymentExpenseId).toBeNull()
	})

	it('LINK: the id pushed from device A is what device B pulls into its store', async () => {
		await pushUpdate(EXPENSE_ID)
		expect((await pullRow())?.paymentExpenseId).toBe(EXPENSE_ID)
		expect((await pullIntoStore())?.['paymentExpenseId']).toBe(EXPENSE_ID)
	})

	it('⚠️⚠️ UNLINK: an explicit null actually CLEARS the link for device B', async () => {
		await pushUpdate(EXPENSE_ID)
		expect((await pullRow())?.paymentExpenseId).toBe(EXPENSE_ID)

		await pushUpdate(null)
		expect((await pullRow())?.paymentExpenseId).toBeNull()
		expect((await pullIntoStore())?.['paymentExpenseId']).toBeNull()
	})

	it('⚠️ an UNSTAMPED row (pre-102.1, no key at all) clears rather than keeping a stale link', async () => {
		await pushUpdate(EXPENSE_ID)
		await pushUpdate(undefined)
		expect((await pullRow())?.paymentExpenseId).toBeNull()
	})

	it('⚠️⚠️ DANGLING: a link to an expense the database does not hold is ACCEPTED (no 23503)', async () => {
		await expect(pushUpdate(DANGLING_ID)).resolves.toBeUndefined()
		expect((await pullRow())?.paymentExpenseId).toBe(DANGLING_ID)
	})

	it('deleting the linked expense leaves the debt row intact (no cascade)', async () => {
		await pushUpdate(EXPENSE_ID)
		await db.delete(expenses).where(eq(expenses.id, EXPENSE_ID))
		const row = await pullRow()
		expect(row?.paymentExpenseId).toBe(EXPENSE_ID)
		expect(row?.name).toBe('Car loan')
	})

	it('the link does not disturb the rest of the row', async () => {
		await pushUpdate(DANGLING_ID)
		const row = await pullRow()
		expect(row?.type).toBe('debt')
		expect(row?.currentBalance).toBe(-1_200_000)
		expect(row?.monthlyContribution).toBe(0)
		expect(row?.profileId).toBe(PROFILE_ID)
	})
})
