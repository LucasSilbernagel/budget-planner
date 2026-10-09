// @vitest-environment node
/** PGlite is one connection: the writer lock is checked via statement order, not real blocking. */

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
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import { processBatchSync } from '../sync'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER = '11111111-1111-4111-8111-111111111111'
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const Q = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PAID = { id: USER, subscriptionStatus: 'lifetime' } as const

const WRITER = {
	sql: 'select "id" from "users" where "users"."id" = $1 for no key update',
	params: [USER],
}

let pg: PGlite
let db: ReturnType<typeof drizzle>
let opCounter = 0

const statements: { sql: string; params: unknown[] }[] = []

function withTransactionMarks(target: ReturnType<typeof drizzle>) {
	return new Proxy(target, {
		get(obj, prop, receiver) {
			if (prop === 'transaction') {
				return async (...args: Parameters<typeof obj.transaction>) => {
					statements.push({ sql: 'BEGIN', params: [] })
					try {
						return await obj.transaction(...args)
					} finally {
						statements.push({ sql: 'END', params: [] })
					}
				}
			}
			return Reflect.get(obj, prop, receiver)
		},
	})
}

function createProfile(isDefault: boolean) {
	opCounter++
	return {
		id: `op-${opCounter}`,
		type: 'create',
		entityType: 'userProfile',
		entityId: Q,
		timestamp: Date.now(),
		deviceId: 'device-2',
		userId: USER,
		data: { userId: USER, name: 'Main Profile', isDefault, currency: 'NONE' },
	}
}

function push(operations: unknown[]) {
	return processBatchSync(
		{ operations, clientTimestamp: Date.now(), deviceId: 'device-2' } as never,
		PAID
	)
}

async function profiles() {
	return db
		.select({
			id: userProfiles.id,
			isDeleted: userProfiles.isDeleted,
			isDefault: userProfiles.isDefault,
		})
		.from(userProfiles)
		.where(eq(userProfiles.userId, USER))
}

async function liveDefaults() {
	return (await profiles())
		.filter((row) => row.isDefault && !row.isDeleted)
		.map((row) => row.id)
		.sort()
}

function firstStatementOfEachTransaction() {
	const firsts: { sql: string; params: unknown[] }[] = []
	statements.forEach((statement, index) => {
		if (statement.sql === 'BEGIN') {
			firsts.push(statements[index + 1] ?? { sql: '(empty transaction)', params: [] })
		}
	})
	return firsts
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
	holder.db = withTransactionMarks(logged)

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
	await db.delete(userProfiles)
	statements.length = 0
	vi.mocked(logger.info).mockClear()
})

describe('a profile create asking for a TAKEN default seat', () => {
	beforeEach(async () => {
		await db
			.insert(userProfiles)
			.values({ id: P, userId: USER, name: 'Main Profile', isDefault: true })
		statements.length = 0
	})

	it('is created as a non-default profile; the current default keeps the seat', async () => {
		const result = await push([createProfile(true)])

		const q = (await profiles()).find((row) => row.id === Q)
		expect(q, 'the create was applied').toBeDefined()
		expect(q).toMatchObject({ isDeleted: false, isDefault: false })
		expect(await liveDefaults()).toEqual([P])

		expect(result).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
		expect(result.rejections).toEqual([])

		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('default seat taken'), {
			entityType: 'userProfile',
			entityId: Q,
			userId: USER,
		})
	})

	it('reads the seat INSIDE the create transaction, after the writer lock', async () => {
		await push([createProfile(true)])

		const begin = statements.findIndex((statement) => statement.sql === 'BEGIN')
		const end = statements.findIndex((statement, index) => index > begin && statement.sql === 'END')
		const inside = statements.slice(begin + 1, end).map((statement) => statement.sql)
		expect(begin, 'a transaction opened').toBeGreaterThanOrEqual(0)
		expect(inside[0]).toBe(WRITER.sql)
		// Match the seat query's own shape: the duplicate check's bare select()
		// also lists isDefault, so a looser matcher passes without any seat read.
		const seatRead = inside.findIndex(
			(sql) =>
				sql.startsWith('select "id" from "userProfiles"') &&
				sql.includes('"userProfiles"."isDefault" = ')
		)
		const insert = inside.findIndex((sql) => sql.startsWith('insert into "userProfiles"'))
		expect(seatRead, 'the seat is read inside the transaction').toBeGreaterThan(0)
		expect(insert, 'the INSERT follows the seat read').toBeGreaterThan(seatRead)
	})

	it('CONTROL: a replay of the applied create is acknowledged and writes nothing more', async () => {
		expect(await push([createProfile(true)])).toMatchObject({ processedCount: 1, failedCount: 0 })
		statements.length = 0

		const replay = await push([createProfile(true)])

		expect(replay).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
		expect(statements.some((statement) => statement.sql.startsWith('insert into'))).toBe(false)
		expect(await liveDefaults()).toEqual([P])
	})

	it('CONTROL: a create with isDefault: false is created non-default, as before', async () => {
		expect(await push([createProfile(false)])).toMatchObject({ processedCount: 1, failedCount: 0 })
		expect(logger.info).not.toHaveBeenCalledWith(
			expect.stringContaining('default seat taken'),
			expect.anything()
		)
		expect((await profiles()).find((row) => row.id === Q)).toMatchObject({ isDefault: false })
		expect(await liveDefaults()).toEqual([P])
	})
})

describe('a profile create asking for a FREE default seat (control)', () => {
	// Each seed has an older live non-default profile so the post-batch repair
	// cannot mask a wrong seat check by promoting Q.
	const R = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
	const olderLiveNonDefault = {
		id: R,
		userId: USER,
		name: 'Older',
		isDefault: false,
		createdAt: new Date('2020-01-01'),
	}
	const repairUpdates = () =>
		statements.filter((statement) => statement.sql.startsWith('update "userProfiles"'))

	it('takes the seat when every live profile is non-default', async () => {
		await db.insert(userProfiles).values(olderLiveNonDefault)
		statements.length = 0

		expect(await push([createProfile(true)])).toMatchObject({ processedCount: 1, failedCount: 0 })
		expect(await liveDefaults()).toEqual([Q])
		expect(repairUpdates(), 'the repair promoted nothing').toEqual([])
	})

	it('takes the seat when the only default is a tombstone', async () => {
		await db
			.insert(userProfiles)
			.values([
				{ id: P, userId: USER, name: 'Gone', isDefault: true, isDeleted: true },
				olderLiveNonDefault,
			])
		statements.length = 0

		expect(await push([createProfile(true)])).toMatchObject({ processedCount: 1, failedCount: 0 })
		expect(await liveDefaults()).toEqual([Q])
		expect(repairUpdates(), 'the repair promoted nothing').toEqual([])
	})
})

describe('every profile create takes the writer lock first', () => {
	beforeEach(async () => {
		await db
			.insert(userProfiles)
			.values({ id: P, userId: USER, name: 'Main Profile', isDefault: true })
		statements.length = 0
	})

	it('[create, repair] both open with the writer lock', async () => {
		expect(await push([createProfile(false)])).toMatchObject({ processedCount: 1, failedCount: 0 })
		expect(firstStatementOfEachTransaction(), '[profile create, repair]').toEqual([WRITER, WRITER])
	})

	it('the duplicate check and the INSERT lie inside the create transaction', async () => {
		await push([createProfile(false)])

		const insert = statements.findIndex((statement) =>
			statement.sql.startsWith('insert into "userProfiles"')
		)
		const begin = statements.findIndex((statement) => statement.sql === 'BEGIN')
		const end = statements.findIndex((statement, index) => index > begin && statement.sql === 'END')
		expect(insert, 'the profile INSERT ran').toBeGreaterThanOrEqual(0)
		expect(begin, 'a transaction opened').toBeGreaterThanOrEqual(0)
		expect(insert).toBeGreaterThan(begin)
		expect(insert).toBeLessThan(end)
		const duplicateCheck = statements.findIndex(
			(statement, index) =>
				index > begin &&
				index < insert &&
				statement.sql.startsWith('select') &&
				statement.sql.includes('from "userProfiles"') &&
				statement.params.includes(Q)
		)
		expect(duplicateCheck, 'the duplicate check runs inside, before the INSERT').toBeGreaterThan(
			begin
		)
	})
})

describe('a profile create that fails INSIDE its transaction stays retryable (code review 80.2)', () => {
	const OTHER_USER = '22222222-2222-4222-8222-222222222222'

	it('a 23505 on the primary key (an id another user owns) is a kept-queued failure, not a rejection', async () => {
		// Existence checks filter by userId, so another user's row with this id
		// is invisible to them and the INSERT hits the primary key.
		await db
			.insert(users)
			.values({
				id: OTHER_USER,
				email: 'b@example.test',
				paddleId: 'ctm_b',
				subscriptionStatus: 'lifetime',
			})
			.onConflictDoNothing()
		await db
			.insert(userProfiles)
			.values({ id: Q, userId: OTHER_USER, name: 'Theirs', isDefault: true })

		const result = await push([createProfile(false)])

		expect(result).toMatchObject({ processedCount: 0, failedCount: 1, conflictCount: 0 })
		expect(result.rejections).toEqual([])
		const [theirs] = await db.select().from(userProfiles).where(eq(userProfiles.id, Q))
		expect(theirs).toMatchObject({ userId: OTHER_USER, name: 'Theirs' })
	})
})
