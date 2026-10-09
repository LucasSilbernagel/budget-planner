// @vitest-environment node
/**
 * PGlite is one connection: seams interleave handlers outside transactions, but lock
 * blocking can't be shown, so the lock is guarded by the statement-order test.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@budget-planner/db/client', async (importOriginal) => {
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

const USER = '11111111-1111-4111-8111-111111111111'

import { forecastingProfiles, userProfiles, users } from '@budget-planner/db/schema'
import { eq } from 'drizzle-orm'
import { processBatchSync } from '../../api/sync'
import { createForecastingProfile } from '../forecastingProfiles'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const Q = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PAID = { id: USER, subscriptionStatus: 'lifetime' } as const
const REFUSAL = 'Invalid profile ID or profile does not belong to current user'

let pg: PGlite
let db: ReturnType<typeof drizzle>
let opCounter = 0

/** Run before a top-level `db.transaction` or `db.insert().values()`; `tx.*` calls never reach them. */
const seams = {
	beforeTransaction: null as null | (() => Promise<void>),
	beforeInsert: null as null | (() => Promise<void>),
}

const statements: { sql: string; params: unknown[] }[] = []

/** Keeps the builder's methods: the create chains `.returning()`, which a bare thenable lacks. */
function awaitingSeam<T extends object>(query: T): T {
	return new Proxy(query, {
		get(target, key, receiver) {
			if (key === 'then') {
				const hook = seams.beforeInsert
				const then = Reflect.get(target, 'then', target) as (
					ok: unknown,
					ko: unknown
				) => Promise<unknown>
				if (!hook) return then.bind(target)
				return (ok: never, ko: never) => hook().then(() => then.call(target, ok, ko), ko)
			}
			if (key === 'returning') {
				return (...args: unknown[]) =>
					awaitingSeam(
						(Reflect.get(target, key, receiver) as (...a: unknown[]) => object).apply(target, args)
					)
			}
			return Reflect.get(target, key, receiver)
		},
	})
}

function withSeams(target: ReturnType<typeof drizzle>) {
	return new Proxy(target, {
		get(obj, prop, receiver) {
			if (prop === 'transaction') {
				return async (...args: Parameters<typeof obj.transaction>) => {
					const hook = seams.beforeTransaction
					if (hook) await hook()
					statements.push({ sql: 'BEGIN', params: [] })
					try {
						return await obj.transaction(...args)
					} finally {
						statements.push({ sql: 'END', params: [] })
					}
				}
			}
			if (prop === 'insert') {
				return (table: Parameters<typeof obj.insert>[0]) => {
					const builder = obj.insert(table)
					return new Proxy(builder, {
						get(b, key, r) {
							if (key !== 'values') return Reflect.get(b, key, r)
							return (values: never) => awaitingSeam(b.values(values))
						},
					})
				}
			}
			return Reflect.get(obj, prop, receiver)
		},
	})
}

function push(operations: unknown[]) {
	return processBatchSync(
		{ operations, clientTimestamp: Date.now(), deviceId: 'device-2' } as never,
		PAID
	)
}

const deleteProfile = (id: string) => {
	opCounter++
	return {
		id: `op-${opCounter}`,
		type: 'delete',
		entityType: 'userProfile',
		entityId: id,
		timestamp: Date.now(),
		deviceId: 'device-2',
		userId: USER,
		data: { userId: USER },
	}
}

function save(overrides: Record<string, unknown> = {}) {
	return createForecastingProfile(USER, {
		name: 'Plan A',
		scenarioData: { scenario: {}, result: {}, inputs: {} },
		profileId: P,
		...overrides,
	})
}

async function forecastsUnder(profileId: string) {
	return db
		.select({
			id: forecastingProfiles.id,
			name: forecastingProfiles.name,
			isDefault: forecastingProfiles.isDefault,
		})
		.from(forecastingProfiles)
		.where(eq(forecastingProfiles.profileId, profileId))
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
	const logged = drizzle(pg, {
		logger: {
			logQuery: (query: string, params: unknown[]) => {
				statements.push({ sql: query, params })
			},
		},
	})
	holder.db = withSeams(logged)

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
	await db.delete(forecastingProfiles)
	await db.delete(userProfiles)
	// Two live profiles, so the cascade of P is not refused as the last profile.
	await db.insert(userProfiles).values([
		{ id: P, userId: USER, name: 'Main', isDefault: true, createdAt: new Date('2020-01-01') },
		{ id: Q, userId: USER, name: 'Q', isDefault: false, createdAt: new Date('2020-02-01') },
	])
	statements.length = 0
})

afterEach(() => {
	seams.beforeTransaction = null
	seams.beforeInsert = null
})

describe('a forecast save interleaves with the cascade of its profile', () => {
	it('a cascade that commits at the save\u2019s first write step leaves no forecast under the tombstone', async () => {
		// Fire the cascade at the save's first top-level write (transaction open or INSERT);
		// `firedAt` makes a refactor that moves the write off both seams fail here.
		const fired: string[] = []
		let cascade: Awaited<ReturnType<typeof push>> | undefined
		const runCascade = (seam: string) => async () => {
			fired.push(seam)
			seams.beforeInsert = null
			seams.beforeTransaction = null
			// No `expect` in here: a throw would become the save's failure result.
			cascade = await push([deleteProfile(P)])
		}
		seams.beforeInsert = runCascade('insert')
		seams.beforeTransaction = runCascade('transaction')

		const result = await save()

		expect(fired).toEqual(['transaction'])
		expect(cascade).toMatchObject({ processedCount: 1, failedCount: 0 })
		const [profile] = await db
			.select({ isDeleted: userProfiles.isDeleted })
			.from(userProfiles)
			.where(eq(userProfiles.id, P))
		expect(profile?.isDeleted).toBe(true)

		expect(await forecastsUnder(P), 'forecast under tombstoned profile').toEqual([])

		expect(result).toEqual({ success: false, error: REFUSAL, reason: 'not-found' })
	})

	it('a save that lands BEFORE the cascade is removed by it', async () => {
		expect(await save()).toMatchObject({ success: true })
		expect(await push([deleteProfile(P)])).toMatchObject({ processedCount: 1, failedCount: 0 })
		expect(await forecastsUnder(P)).toEqual([])
	})
})

describe('a save under a live profile behaves as before (positive controls)', () => {
	it('creates the forecast and names its profile', async () => {
		const result = await save()
		expect(result).toMatchObject({
			success: true,
			data: { name: 'Plan A', profileId: P, profileName: 'Main' },
		})
		expect(await forecastsUnder(P)).toHaveLength(1)
	})

	it('a default save demotes the profile’s previous default forecast', async () => {
		expect(await save({ name: 'Old', isDefault: true })).toMatchObject({ success: true })
		expect(await save({ name: 'New', isDefault: true })).toMatchObject({ success: true })
		const rows = await forecastsUnder(P)
		expect(rows.filter((row) => row.isDefault).map((row) => row.name)).toEqual(['New'])
	})

	it('a duplicate name still gets the friendly message, and writes nothing', async () => {
		expect(await save()).toMatchObject({ success: true })
		const duplicate = await save()
		expect(duplicate).toEqual({
			success: false,
			error: 'A forecast with this name already exists for this profile.',
			reason: 'conflict',
		})
		expect(await forecastsUnder(P)).toHaveLength(1)
	})

	it('a profile tombstoned before the save is refused without a write', async () => {
		await db.update(userProfiles).set({ isDeleted: true }).where(eq(userProfiles.id, P))
		expect(await save()).toEqual({ success: false, error: REFUSAL, reason: 'not-found' })
		expect(await forecastsUnder(P)).toEqual([])
	})
})

describe('a refused save writes nothing (the transaction is atomic)', () => {
	it('a duplicate default save rolls its demotion back', async () => {
		expect(await save({ isDefault: true })).toMatchObject({ success: true })
		// Same name: the INSERT fails AFTER the demotion ran in the same transaction.
		expect(await save({ isDefault: true })).toEqual({
			success: false,
			error: 'A forecast with this name already exists for this profile.',
			reason: 'conflict',
		})
		const rows = await forecastsUnder(P)
		expect(
			rows.map((row) => row.isDefault),
			'default flags after the refused save'
		).toEqual([true])
	})
})

describe('a malformed scenario is refused before anything is written (Task 2, code review)', () => {
	it('keeps its own message, writes nothing, and leaves the old default in place', async () => {
		expect(await save({ name: 'Old', isDefault: true })).toMatchObject({ success: true })
		statements.length = 0

		const result = await save({ name: 'New', isDefault: true, scenarioData: 42 })

		expect(result).toEqual({
			success: false,
			error: 'scenarioData must be a JSON object or a valid JSON string',
			reason: 'invalid-input',
		})
		expect(statements, 'no statement for a malformed scenario').toEqual([])
		const rows = await forecastsUnder(P)
		expect(rows.map((row) => [row.name, row.isDefault])).toEqual([['Old', true]])
	})

	it('is reported before the profile check (the precedence Task 2 specified)', async () => {
		await db.update(userProfiles).set({ isDeleted: true }).where(eq(userProfiles.id, P))
		expect(await save({ scenarioData: 'not json' })).toEqual({
			success: false,
			error: 'scenarioData must be valid JSON',
			reason: 'invalid-input',
		})
	})
})

/** The only automated protection of the per-user lock: the race test passes without it. */
describe('the forecast save locks the user first', () => {
	const LOCK = { sql: 'select "id" from "users" where "users"."id" = $1 for share', params: [USER] }

	it('the first statement of its transaction is the reader lock on the users row', async () => {
		expect(await save()).toMatchObject({ success: true })
		const firsts: { sql: string; params: unknown[] }[] = []
		statements.forEach((statement, index) => {
			if (statement.sql === 'BEGIN') {
				firsts.push(statements[index + 1] ?? { sql: '(empty transaction)', params: [] })
			}
		})
		expect(firsts, '[forecast save]').toEqual([LOCK])
	})

	it('every statement of a default save runs inside that one transaction, after the lock', async () => {
		// Pin the whole log, not just the first statement, so moving the check or the
		// INSERT back to autocommit fails.
		expect(await save({ isDefault: true })).toMatchObject({ success: true })
		const sqls = statements.map((statement) => statement.sql)

		expect(sqls[0], 'nothing before the transaction').toBe('BEGIN')
		expect(sqls.at(-1), 'nothing after the transaction').toBe('END')
		expect(
			sqls.filter((sql) => sql === 'BEGIN'),
			'one transaction'
		).toHaveLength(1)
		expect(statements[1]).toEqual(LOCK)
		const inside = sqls.slice(2, -1)
		expect(
			inside.findIndex((sql) => sql.startsWith('select "id" from "userProfiles"')),
			'check'
		).toBe(0)
		expect(
			inside.some((sql) => sql.startsWith('update "forecastingProfiles"')),
			'demotion'
		).toBe(true)
		expect(
			inside.some((sql) => sql.startsWith('insert into "forecastingProfiles"')),
			'insert'
		).toBe(true)
	})
})
