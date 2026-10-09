// @vitest-environment node
/**
 * Whole chain: each layer can be green while the op stays queued until the circuit breaker stops sync.
 * The bad op is seeded directly because the client queue gate would refuse it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@budget-planner/db', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		get db() {
			return holder.db
		},
	}
})

vi.mock('@/server/rate-limit/db-window', () => ({
	checkDbRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99 })),
}))

vi.mock('@/lib/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const USER = '33333333-3333-4333-8333-333333333333'

vi.mock('@/server/api/auth/paddle', () => ({
	getCurrentUserSession: vi.fn(async () => ({
		success: true,
		data: { userId: USER, subscriptionStatus: 'lifetime', isAuthenticated: true },
	})),
}))

import type { SyncOperation } from '@budget-planner/core/sync'
import { createSynchronizationService } from '@budget-planner/core/sync'
import { categories, incomeSources, savingsGoals, userProfiles, users } from '@budget-planner/db'
import { eq } from 'drizzle-orm'
import { JSDOM } from 'jsdom'
import { logger } from '@/lib/logger'
import { POST as batchPOST } from '@/routes/api/sync/batch'
import { processBatchSync } from '@/server/api/sync'
import { sendSyncOperation } from '../../../features/api/client'

const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const PROFILE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const GOAL = '40000000-0000-4000-8000-0000000000a1'
const QUEUE_KEY = `bp-sync-queue-${USER}`

let pg: PGlite
let db: ReturnType<typeof drizzle>
let dom: JSDOM
let service: ReturnType<typeof createSynchronizationService> | undefined
const served: { status: number; body: string }[] = []

/** content-length is set here: undici's Request omits it, so the route's size guard would never be reached. */
async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = new URL(String(input), 'https://app.test')
	if (url.pathname !== '/api/sync/batch') throw new Error(`unrouted fetch ${url}`)
	const headers = new Headers(init?.headers)
	if (typeof init?.body === 'string') {
		headers.set('content-length', String(new TextEncoder().encode(init.body).byteLength))
	}
	const response = await batchPOST({ request: new Request(url, { ...init, headers }) })
	const body = await response.clone().text()
	served.push({ status: response.status, body })
	return response
}

function queuedOp(overrides: Partial<SyncOperation>): SyncOperation {
	return {
		id: `op-${Math.random().toString(36).slice(2)}`,
		type: 'update',
		entityType: 'savingsGoal',
		entityId: GOAL,
		data: { userId: USER, name: 'Emergency fund', currentBalance: -1 },
		timestamp: Date.now(),
		deviceId: 'device-1',
		userId: USER,
		profileId: PROFILE,
		...overrides,
	} as SyncOperation
}

function seedQueue(ops: SyncOperation[]) {
	localStorage.setItem(QUEUE_KEY, JSON.stringify(ops))
}

function persistedQueueIds(): string[] {
	const raw = localStorage.getItem(QUEUE_KEY)
	return raw ? (JSON.parse(raw) as SyncOperation[]).map((op) => op.id) : []
}

async function startService() {
	service = createSynchronizationService(USER, {
		autoSync: false,
		processOperation: sendSyncOperation,
		profileId: PROFILE,
	})
	await service.initialize()
	return service
}

beforeAll(async () => {
	pg = new PGlite()
	const journal = JSON.parse(readFileSync(resolve(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
		entries: { idx: number; tag: string }[]
	}
	for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
		const sql = readFileSync(resolve(MIGRATIONS, `${entry.tag}.sql`), 'utf8')
		for (const statement of sql.split('--> statement-breakpoint')) {
			if (statement.trim()) {
				await pg.exec(statement)
			}
		}
	}
	db = drizzle(pg)
	holder.db = db
	await db.insert(users).values({
		id: USER,
		email: 'chain@example.test',
		paddleId: 'ctm_chain',
		subscriptionStatus: 'lifetime',
	})
	await db.insert(userProfiles).values({ id: PROFILE, userId: USER, name: 'Main', isDefault: true })

	dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
	vi.stubGlobal('localStorage', dom.window.localStorage)
	// Node's `navigator` lacks `onLine`, so the service would send nothing.
	vi.stubGlobal('navigator', dom.window.navigator)
	vi.stubGlobal('fetch', routeFetch)
}, 60_000)

afterAll(async () => {
	vi.unstubAllGlobals()
	await pg?.close()
})

beforeEach(async () => {
	localStorage.clear()
	served.length = 0
	await db.delete(incomeSources).where(eq(incomeSources.userId, USER))
	await db.delete(categories).where(eq(categories.userId, USER))
	await db.delete(savingsGoals).where(eq(savingsGoals.userId, USER))
	await db.insert(savingsGoals).values({
		id: GOAL,
		userId: USER,
		profileId: PROFILE,
		name: 'Emergency fund',
		currentBalance: 1000,
	} as never)
})

afterEach(() => {
	service?.destroy()
	service = undefined
})

describe('a never-acceptable op leaves the queue', () => {
	it('drops an update the database refuses with a CHECK violation (23514)', async () => {
		const bad = queuedOp({})
		seedQueue([bad])
		const sync = await startService()

		await sync.forceSync()

		expect(served.map((r) => r.status)).toEqual([200])
		const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, GOAL))
		expect(row?.currentBalance).toBe(1000)

		expect(persistedQueueIds()).not.toContain(bad.id)
		expect(sync.getState().pendingOperations.map((op) => op.id)).not.toContain(bad.id)
		expect(sync.getState().rejectedOperations.map((op) => op.id)).toContain(bad.id)
	})

	it('does not put the driver message, table or constraint name on the wire', async () => {
		seedQueue([queuedOp({})])
		const sync = await startService()
		await sync.forceSync()

		expect(served).toHaveLength(1)
		const wire = served[0]?.body ?? ''
		expect(wire).not.toMatch(/savingsGoals_currentBalance_non_negative/)
		expect(wire).not.toMatch(/violates check constraint/)
		expect(wire).not.toMatch(/"savingsGoals"/)
	})

	it('CONTROL — keeps an op whose failure depends on ordering (23503, category not synced yet)', async () => {
		const income = queuedOp({
			type: 'create',
			entityType: 'incomeSource',
			entityId: '10000000-0000-4000-8000-0000000000a2',
			data: {
				userId: USER,
				name: 'Salary',
				amount: 500000,
				frequency: 'monthly',
				// A category whose own create has not reached the server yet.
				categoryId: '30000000-0000-4000-8000-0000000000a3',
			},
		})
		seedQueue([income])
		const sync = await startService()

		await sync.forceSync()

		expect(served.map((r) => r.status)).toEqual([200])
		expect(JSON.parse(served[0]?.body ?? '{}')).toMatchObject({ failedCount: 1 })
		// Can succeed once the category lands, so it must stay.
		expect(persistedQueueIds()).toContain(income.id)
		expect(sync.getState().rejectedOperations.map((op) => op.id)).not.toContain(income.id)
	})

	it('CONTROL — keeps an op whose failure is transient (40001), exactly as before 75.1 (plus an empty `rejections`)', async () => {
		// Can succeed on replay, so it stays queued, and not as retryable: retryable ops leave the persisted queue.
		const update = vi.spyOn(db, 'update').mockImplementationOnce(() => {
			throw Object.assign(new Error('could not serialize access'), { code: '40001' })
		})
		const op = queuedOp({ data: { userId: USER, name: 'Emergency fund', currentBalance: 5 } })
		seedQueue([op])
		const sync = await startService()

		let updateCalls = 0
		try {
			await sync.forceSync()
			// Read BEFORE `mockRestore`, which also clears the recorded calls.
			updateCalls = update.mock.calls.length
		} finally {
			update.mockRestore()
		}

		expect(updateCalls).toBe(1)
		expect(served.map((r) => r.status)).toEqual([200])
		const envelope = JSON.parse(served[0]?.body ?? '{}')
		expect(envelope).toMatchObject({ failedCount: 1, rejections: [] })
		expect(persistedQueueIds()).toContain(op.id)
		expect(sync.getState().rejectedOperations.map((o) => o.id)).not.toContain(op.id)
		expect(sync.getState().failedOperations.map((o) => o.id)).not.toContain(op.id)
	})

	it('KEEPS an op whose conflict CHECK fails transiently (40001) — a failure, not a conflict', async () => {
		// A failed existence check must be a kept, escalated failure, not an update-delete conflict.
		let fired = 0
		const select = vi.spyOn(db, 'select').mockImplementationOnce(() => {
			fired++
			throw Object.assign(new Error('could not serialize access'), { code: '40001' })
		})
		const op = queuedOp({ data: { userId: USER, name: 'Emergency fund', currentBalance: 5 } })
		seedQueue([op])
		const sync = await startService()
		vi.mocked(logger.error).mockClear()

		try {
			await sync.forceSync()
		} finally {
			select.mockRestore()
		}
		expect(vi.mocked(logger.error).mock.calls.map((call) => call[0])).toContain(
			'[Conflict Check Error]'
		)

		expect(fired).toBe(1)
		expect(served.map((r) => r.status)).toEqual([200])
		expect(JSON.parse(served[0]?.body ?? '{}')).toMatchObject({
			failedCount: 1,
			conflictCount: 0,
			conflicts: [],
			rejections: [],
			status: 'FAILED',
		})
		const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, GOAL))
		expect(row?.currentBalance).toBe(1000)
		expect(persistedQueueIds()).toContain(op.id)
		expect(sync.getState().conflictOperations.map((o) => o.id)).not.toContain(op.id)
		expect(sync.getState().rejectedOperations.map((o) => o.id)).not.toContain(op.id)
	})

	it('drops an op whose payload fails the server schema (request-level, HTTP 400)', async () => {
		const bad = queuedOp({
			type: 'create',
			entityType: 'incomeSource',
			entityId: '10000000-0000-4000-8000-0000000000a4',
			// Non-integer cents: the server schema is `z.number().int()`.
			data: { userId: USER, name: 'Salary', amount: 1.5, frequency: 'monthly' },
		})
		seedQueue([bad])
		const sync = await startService()

		await sync.forceSync()

		expect(served[0]?.status).toBe(400)
		expect(persistedQueueIds()).not.toContain(bad.id)
		expect(sync.getState().rejectedOperations.map((op) => op.id)).toContain(bad.id)
	})

	it('drops an op whose request is over the size limit (HTTP 413 + `too-large`)', async () => {
		// Exceeding 512 KiB needs an undeclared key: per-entity schemas bound declared strings but don't strip extras.
		const huge = queuedOp({
			data: {
				userId: USER,
				name: 'Emergency fund',
				currentBalance: 5,
				notes: 'x'.repeat(1_100_000),
			},
		})
		seedQueue([huge])
		const sync = await startService()
		const handedOn: string[][] = []
		sync.onOperationsRejected((ops) => handedOn.push(ops.map((op) => op.id)))

		await sync.forceSync()

		expect(served.map((r) => r.status)).toEqual([413])
		expect(JSON.parse(served[0]?.body ?? '{}')).toMatchObject({ refusal: 'too-large' })
		const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, GOAL))
		expect(row?.currentBalance).toBe(1000)
		expect(persistedQueueIds()).not.toContain(huge.id)
		expect(sync.getState().rejectedOperations.map((op) => op.id)).toContain(huge.id)
		expect(handedOn).toEqual([[huge.id]])
	})

	it("KEEPS an op whose userId is not the session user (HTTP 401) — it may be another account's edit", async () => {
		// The cookie is shared across tabs while useSync reads userId once, so a tab can push A's queue
		// under B's cookie. 401 keeps it queued.
		const other = '44444444-4444-4444-8444-444444444444'
		const foreign = queuedOp({
			userId: other,
			data: { userId: other, name: 'x', currentBalance: 5 },
		})
		seedQueue([foreign])
		const sync = await startService()

		await sync.forceSync()

		expect(served[0]?.status).toBe(401)
		expect(persistedQueueIds()).toContain(foreign.id)
		expect(sync.getState().rejectedOperations.map((op) => op.id)).not.toContain(foreign.id)
	})

	it("drops a refused CREATE together with the row's queued follow-up", async () => {
		// Without sweeping the queue the update gets update-delete for a never-created row: a permanent conflict.
		const goal = '40000000-0000-4000-8000-0000000000b1'
		const create = queuedOp({
			type: 'create',
			entityId: goal,
			data: { userId: USER, name: 'New goal', currentBalance: -1 },
		})
		const followUp = queuedOp({
			id: 'op-follow-up',
			entityId: goal,
			data: { userId: USER, name: 'New goal', currentBalance: 10 },
			timestamp: create.timestamp + 1,
		})
		seedQueue([create, followUp])
		const sync = await startService()

		await sync.forceSync()

		expect(served.length).toBeGreaterThanOrEqual(1)
		expect(persistedQueueIds()).toEqual([])
		expect(
			sync
				.getState()
				.rejectedOperations.map((op) => op.id)
				.sort()
		).toEqual([create.id, followUp.id].sort())
		expect(sync.getState().conflictOperations.map((op) => op.id)).not.toContain(followUp.id)
	})
})

describe('processBatchSync classification', () => {
	function push(op: SyncOperation) {
		return processBatchSync(
			{ operations: [op], clientTimestamp: Date.now(), deviceId: 'device-1' },
			{ id: USER, subscriptionStatus: 'lifetime' }
		)
	}

	it('reports a 23514 as a rejection with reason `constraint`, and still counts it failed', async () => {
		const op = queuedOp({})
		const result = await push(op)
		expect(result).toMatchObject({
			failedCount: 1,
			failedOperationIds: [op.id],
			rejections: [{ operationId: op.id, reason: 'constraint' }],
		})
	})

	it('does NOT reject a 23505 — a unique violation can clear once its paired op lands', async () => {
		// The live unique index is on lower(name), so `groceries` collides with `Groceries`;
		// the same create can succeed later.
		const first = '30000000-0000-4000-8000-0000000000c1'
		const second = '30000000-0000-4000-8000-0000000000c2'
		const categoryCreate = (entityId: string, name: string) =>
			queuedOp({
				type: 'create',
				entityType: 'category',
				entityId,
				data: { userId: USER, name, kind: 'expense' },
			})
		expect(await push(categoryCreate(first, 'Groceries'))).toMatchObject({
			processedCount: 1,
			failedCount: 0,
		})

		const op = categoryCreate(second, 'groceries')
		const result = await push(op)
		expect(result).toMatchObject({ failedCount: 1, failedOperationIds: [op.id], rejections: [] })

		// Positive control: the same op under another name is accepted, so the index is what refused it.
		const accepted = await push({ ...op, id: `${op.id}-b`, data: { ...op.data, name: 'Rent' } })
		expect(accepted).toMatchObject({ processedCount: 1, failedCount: 0 })
	})

	it('refuses a non-uuid entityId at the REQUEST level (it used to become a permanent conflict)', async () => {
		const op = queuedOp({ entityId: 'not-a-uuid' })
		const result = await push(op)
		expect(result).toMatchObject({ refusal: 'invalid-request', conflictCount: 0 })
		expect(result.error).toMatch(/"entityId"/)
		expect(result.error).toMatch(/Invalid uuid/)
	})

	it('does NOT reject "Profile not found" — the profile may still be syncing (the ops of a deleted profile are dropped by the pull)', async () => {
		// A CREATE, so `checkConflict` passes and `applyOperation` reaches the profile
		// check (an UPDATE would be reported as an update-delete conflict first).
		const op = queuedOp({
			type: 'create',
			entityType: 'incomeSource',
			entityId: '10000000-0000-4000-8000-0000000000a5',
			profileId: '99999999-9999-4999-8999-999999999999',
			data: { userId: USER, name: 'Salary', amount: 500000, frequency: 'monthly' },
		})
		const result = await push(op)
		expect(result).toMatchObject({ failedCount: 1, failedOperationIds: [op.id], rejections: [] })
	})
})
