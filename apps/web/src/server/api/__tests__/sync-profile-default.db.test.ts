// @vitest-environment node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { userProfiles, users } from '@budget-planner/db'
import { and, eq } from 'drizzle-orm'
import { processBatchSync } from '../sync'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER = '11111111-1111-4111-8111-111111111111'
const P_DEFAULT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PAID = { id: USER, subscriptionStatus: 'lifetime' } as const

let pg: PGlite
let db: ReturnType<typeof drizzle>
let opCounter = 0

function op(overrides: Record<string, unknown>) {
	opCounter++
	return {
		id: `op-${opCounter}`,
		timestamp: Date.now(),
		deviceId: 'device-1',
		userId: USER,
		// Even a DELETE needs data.userId, and one invalid op fails the whole batch
		// (processedCount 0, cause only in `error`).
		data: { userId: USER },
		...overrides,
	}
}

function profilePayload(name: string, isDefault: boolean) {
	return { name, isDefault, currency: 'NONE', userId: USER }
}

function push(operations: unknown[]) {
	return processBatchSync(
		{ operations, clientTimestamp: Date.now(), deviceId: 'device-1' } as never,
		PAID
	)
}

async function liveProfiles() {
	return db
		.select()
		.from(userProfiles)
		.where(and(eq(userProfiles.userId, USER), eq(userProfiles.isDeleted, false)))
}

beforeAll(async () => {
	pg = new PGlite()
	const journal = JSON.parse(
		readFileSync(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS)), 'utf8')
	) as { entries: { idx: number; tag: string }[] }
	for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
		const sql = readFileSync(fileURLToPath(new URL(`${entry.tag}.sql`, MIGRATIONS)), 'utf8')
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
		email: 'a@example.test',
		paddleId: 'ctm_a',
		subscriptionStatus: 'lifetime',
	})
}, 60_000)

afterAll(async () => {
	await pg?.close()
})

beforeEach(async () => {
	await db.delete(userProfiles).where(eq(userProfiles.userId, USER))
	await db.insert(userProfiles).values([
		{ id: P_DEFAULT, userId: USER, name: 'Main Profile', isDefault: true },
		{ id: P_OTHER, userId: USER, name: 'Business', isDefault: false },
	])
})

describe('the delete + promote pair the store queues (story 63.2)', () => {
	it('applies both and leaves exactly one live default', async () => {
		const result = await push([
			op({ type: 'delete', entityType: 'userProfile', entityId: P_DEFAULT }),
			op({
				type: 'update',
				entityType: 'userProfile',
				entityId: P_OTHER,
				data: profilePayload('Business', true),
			}),
		])

		expect(result.success).toBe(true)
		const live = await liveProfiles()
		expect(live.map((p) => p.id)).toEqual([P_OTHER])
		expect(live.filter((p) => p.isDefault)).toHaveLength(1)
	})

	it('applies the promotion even if it arrives before the tombstone — no op fails', async () => {
		const result = await push([
			op({
				type: 'update',
				entityType: 'userProfile',
				entityId: P_OTHER,
				data: profilePayload('Business', true),
			}),
			op({ type: 'delete', entityType: 'userProfile', entityId: P_DEFAULT }),
		])

		expect(result.success).toBe(true)
		expect(result.failedOperationIds).toEqual([])
		// Not discriminating with two profiles: P_OTHER is also the repair's pick.
		const live = await liveProfiles()
		expect(live.map((p) => p.id)).toEqual([P_OTHER])
		expect(live.filter((p) => p.isDefault).map((p) => p.id)).toEqual([P_OTHER])
	})
})

describe('a stale device cannot demote the only live default (code review HIGH)', () => {
	/**
	 * syncBridge sends isDefault on every update, so a rename from a device that
	 * never pulled would otherwise clear the server-promoted default.
	 */
	it('keeps the flag when a stale rename re-sends isDefault:false', async () => {
		await push([
			op({ type: 'delete', entityType: 'userProfile', entityId: P_DEFAULT }),
			op({
				type: 'update',
				entityType: 'userProfile',
				entityId: P_OTHER,
				data: profilePayload('Business', true),
			}),
		])

		const stale = await push([
			op({
				type: 'update',
				entityType: 'userProfile',
				entityId: P_OTHER,
				data: profilePayload('Consulting', false),
			}),
		])

		expect(stale.success).toBe(true)
		const live = await liveProfiles()
		expect(live.map((p) => p.name)).toEqual(['Consulting'])
		expect(live.filter((p) => p.isDefault).map((p) => p.id)).toEqual([P_OTHER])
	})

	/** Positive control: a demotion is still honoured when another live profile is default. */
	it('still honours a demotion when another live profile is already default', async () => {
		const result = await push([
			op({
				type: 'update',
				entityType: 'userProfile',
				entityId: P_DEFAULT,
				data: profilePayload('Main Profile', false),
			}),
			op({
				type: 'update',
				entityType: 'userProfile',
				entityId: P_OTHER,
				data: profilePayload('Business', true),
			}),
		])

		expect(result.success).toBe(true)
		const live = await liveProfiles()
		expect(live.filter((p) => p.isDefault).map((p) => p.id)).toEqual([P_OTHER])
	})
})
