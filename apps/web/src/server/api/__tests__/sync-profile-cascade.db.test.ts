// @vitest-environment node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import {
	balanceTracking,
	categories,
	expenses,
	forecastingProfiles,
	incomeSources,
	savingsGoals,
	userProfiles,
	users,
} from '@budget-planner/db/schema'
import { and, eq } from 'drizzle-orm'
import { getSyncChanges, processBatchSync } from '../sync'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER = '22222222-2222-4222-8222-222222222222'
const P_KEEP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const P_DOOM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PAID = { id: USER, subscriptionStatus: 'lifetime' } as const

const R = {
	incomeKeep: '10000000-0000-4000-8000-000000000001',
	incomeDoom: '10000000-0000-4000-8000-000000000002',
	expenseDoom: '20000000-0000-4000-8000-000000000002',
	categoryDoom: '30000000-0000-4000-8000-000000000002',
	savingsDoom: '40000000-0000-4000-8000-000000000002',
	balanceDoom: '50000000-0000-4000-8000-000000000002',
}

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
		// Even a DELETE needs `data: { userId }`; one invalid op fails the whole batch.
		data: { userId: USER },
		...overrides,
	}
}

function pushDelete(profileId: string) {
	return processBatchSync(
		{
			operations: [op({ type: 'delete', entityType: 'userProfile', entityId: profileId })],
			clientTimestamp: Date.now(),
			deviceId: 'device-1',
		} as never,
		PAID
	)
}

async function liveIds(table: typeof incomeSources | typeof expenses | typeof categories) {
	const rows = await db
		.select({ id: table.id, profileId: table.profileId })
		.from(table)
		.where(and(eq(table.userId, USER), eq(table.isDeleted, false)))
	return rows.map((r) => r.id)
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
		email: 'cascade@example.test',
		paddleId: 'ctm_cascade',
		subscriptionStatus: 'lifetime',
	})
}, 60_000)

afterAll(async () => {
	await pg?.close()
})

// Both profiles get rows so every assertion has a control. Children first: these are hard deletes.
beforeEach(async () => {
	await db.delete(forecastingProfiles).where(eq(forecastingProfiles.userId, USER))
	await db.delete(incomeSources).where(eq(incomeSources.userId, USER))
	await db.delete(expenses).where(eq(expenses.userId, USER))
	await db.delete(categories).where(eq(categories.userId, USER))
	await db.delete(savingsGoals).where(eq(savingsGoals.userId, USER))
	await db.delete(balanceTracking).where(eq(balanceTracking.userId, USER))
	await db.delete(userProfiles).where(eq(userProfiles.userId, USER))

	await db.insert(userProfiles).values([
		{ id: P_KEEP, userId: USER, name: 'Main Profile', isDefault: true },
		{ id: P_DOOM, userId: USER, name: 'Business', isDefault: false },
	])
	await db.insert(incomeSources).values([
		{
			id: R.incomeKeep,
			userId: USER,
			profileId: P_KEEP,
			name: 'Salary',
			amount: 500_000,
			frequency: 'monthly',
		},
		{
			id: R.incomeDoom,
			userId: USER,
			profileId: P_DOOM,
			name: 'Consulting',
			amount: 200_000,
			frequency: 'monthly',
		},
	])
	await db
		.insert(categories)
		.values([
			{ id: R.categoryDoom, userId: USER, profileId: P_DOOM, name: 'Software', kind: 'expense' },
		])
	await db.insert(expenses).values([
		// Categorised so a hard delete of categories would fail on the FK.
		{
			id: R.expenseDoom,
			userId: USER,
			profileId: P_DOOM,
			name: 'Office',
			amount: 90_000,
			frequency: 'monthly',
			categoryId: R.categoryDoom,
		},
	])
	await db.insert(savingsGoals).values([
		{
			id: R.savingsDoom,
			userId: USER,
			profileId: P_DOOM,
			name: 'Tax pot',
			currentBalance: 10_000,
		},
	])
	await db.insert(balanceTracking).values([
		{
			id: R.balanceDoom,
			userId: USER,
			profileId: P_DOOM,
			type: 'investment',
			name: 'ISA',
			currentBalance: 1_000,
		},
	])
	await db.insert(forecastingProfiles).values([
		{ userId: USER, profileId: P_DOOM, name: 'Doomed scenario', scenarioData: '{}' },
		{ userId: USER, profileId: P_KEEP, name: 'Surviving scenario', scenarioData: '{}' },
	])
})

describe('the server cascade', () => {
	it('tombstones the deleted profile and all five syncable child tables', async () => {
		const result = await pushDelete(P_DOOM)
		expect(result.success).toBe(true)

		for (const table of [incomeSources, expenses, categories, savingsGoals, balanceTracking]) {
			const rows = await db
				.select({ id: table.id, isDeleted: table.isDeleted })
				.from(table)
				.where(and(eq(table.userId, USER), eq(table.profileId, P_DOOM)))
			expect(rows.length).toBeGreaterThan(0)
			expect(rows.every((r) => r.isDeleted)).toBe(true)
		}

		const [profile] = await db
			.select({ isDeleted: userProfiles.isDeleted })
			.from(userProfiles)
			.where(eq(userProfiles.id, P_DOOM))
		expect(profile?.isDeleted).toBe(true)
	})

	it('HARD-deletes the deleted profile’s saved forecasts, keeping the survivor’s', async () => {
		await pushDelete(P_DOOM)

		const rows = await db
			.select({ profileId: forecastingProfiles.profileId })
			.from(forecastingProfiles)
			.where(eq(forecastingProfiles.userId, USER))
		expect(rows.map((r) => r.profileId)).toEqual([P_KEEP])
	})

	it('cascades the DEFAULT profile and leaves exactly one live default behind', async () => {
		await db.update(userProfiles).set({ isDefault: false }).where(eq(userProfiles.id, P_KEEP))
		await db.update(userProfiles).set({ isDefault: true }).where(eq(userProfiles.id, P_DOOM))

		const result = await pushDelete(P_DOOM)
		expect(result.success).toBe(true)

		const live = await db
			.select({ id: userProfiles.id, isDefault: userProfiles.isDefault })
			.from(userProfiles)
			.where(and(eq(userProfiles.userId, USER), eq(userProfiles.isDeleted, false)))
		expect(live.map((p) => p.id)).toEqual([P_KEEP])
		expect(live.filter((p) => p.isDefault)).toHaveLength(1)

		const rows = await db
			.select({ isDeleted: incomeSources.isDeleted })
			.from(incomeSources)
			.where(eq(incomeSources.profileId, P_DOOM))
		expect(rows.every((r) => r.isDeleted)).toBe(true)
	})

	it('leaves the SURVIVING profile’s rows completely untouched', async () => {
		await pushDelete(P_DOOM)

		expect(await liveIds(incomeSources)).toEqual([R.incomeKeep])
		const [keeper] = await db
			.select({ isDeleted: userProfiles.isDeleted, isDefault: userProfiles.isDefault })
			.from(userProfiles)
			.where(eq(userProfiles.id, P_KEEP))
		expect(keeper).toEqual({ isDeleted: false, isDefault: true })
	})

	// Ordering, not the envelope: a cascade before the last-profile check would destroy data, then decline.
	it('destroys NOTHING when the delete is declined as unsatisfiable', async () => {
		// Children first: these are hard deletes against live FKs.
		await db.delete(forecastingProfiles).where(eq(forecastingProfiles.profileId, P_KEEP))
		await db.delete(incomeSources).where(eq(incomeSources.profileId, P_KEEP))
		await db.delete(userProfiles).where(eq(userProfiles.id, P_KEEP))

		const result = await pushDelete(P_DOOM)

		expect(result.success).toBe(true)
		const rows = await db
			.select({ isDeleted: incomeSources.isDeleted })
			.from(incomeSources)
			.where(eq(incomeSources.profileId, P_DOOM))
		expect(rows.every((r) => !r.isDeleted)).toBe(true)
		const [profile] = await db
			.select({ isDeleted: userProfiles.isDeleted })
			.from(userProfiles)
			.where(eq(userProfiles.id, P_DOOM))
		expect(profile?.isDeleted).toBe(false)
	})
})

describe('the last-profile refusal on the live push path', () => {
	// Both halves together: acknowledgement alone would pass against code that deleted the last profile.
	it('ACKNOWLEDGES an unsatisfiable last-profile delete while keeping the profile live', async () => {
		await db.delete(forecastingProfiles).where(eq(forecastingProfiles.profileId, P_KEEP))
		await db.delete(incomeSources).where(eq(incomeSources.profileId, P_KEEP))
		await db.delete(userProfiles).where(eq(userProfiles.id, P_KEEP))

		const result = await pushDelete(P_DOOM)

		expect(result.success).toBe(true)
		expect(result.failedOperationIds).toHaveLength(0)

		const [profile] = await db
			.select({ isDeleted: userProfiles.isDeleted })
			.from(userProfiles)
			.where(eq(userProfiles.id, P_DOOM))
		expect(profile?.isDeleted).toBe(false)
	})

	it('still delivers the kept-alive profile to a pulling client', async () => {
		await db.delete(forecastingProfiles).where(eq(forecastingProfiles.profileId, P_KEEP))
		await db.delete(incomeSources).where(eq(incomeSources.profileId, P_KEEP))
		await db.delete(userProfiles).where(eq(userProfiles.id, P_KEEP))

		await pushDelete(P_DOOM)
		const changes = await getSyncChanges(USER, null, 100, P_DOOM)

		const profileChange = changes.find(
			(c) => c.entityType === 'userProfile' && c.entityId === P_DOOM
		)
		expect(profileChange).toBeDefined()
		expect(profileChange?.isDeleted).toBe(false)
		expect(changes.some((c) => c.entityId === R.incomeDoom)).toBe(true)
	})

	it('allows the SAME delete while a second profile is live', async () => {
		const result = await pushDelete(P_DOOM)
		expect(result.success).toBe(true)
	})

	it('does NOT refuse an ordinary child delete for a single-profile user', async () => {
		await db.delete(forecastingProfiles).where(eq(forecastingProfiles.profileId, P_KEEP))
		await db.delete(incomeSources).where(eq(incomeSources.profileId, P_KEEP))
		await db.delete(userProfiles).where(eq(userProfiles.id, P_KEEP))

		const result = await processBatchSync(
			{
				operations: [
					op({
						type: 'delete',
						entityType: 'incomeSource',
						entityId: R.incomeDoom,
						profileId: P_DOOM,
					}),
				],
				clientTimestamp: Date.now(),
				deviceId: 'device-1',
			} as never,
			PAID
		)

		expect(result.success).toBe(true)
	})
})

describe('what a SECOND device pulls afterwards', () => {
	// Child tables are filtered by the client's active profile, so another device gets only the
	// profile tombstone; the client cascades locally.
	it('delivers the profile tombstone but NOT the child tombstones', async () => {
		await pushDelete(P_DOOM)

		const changes = await getSyncChanges(USER, null, 100, P_KEEP)

		const profileChange = changes.find(
			(c) => c.entityType === 'userProfile' && c.entityId === P_DOOM
		)
		expect(profileChange?.isDeleted).toBe(true)
		expect(changes.some((c) => c.entityId === R.incomeDoom)).toBe(false)
		expect(changes.some((c) => c.entityId === R.expenseDoom)).toBe(false)
	})

	it('still delivers the surviving profile’s own rows', async () => {
		await pushDelete(P_DOOM)

		const changes = await getSyncChanges(USER, null, 100, P_KEEP)
		expect(changes.some((c) => c.entityId === R.incomeKeep)).toBe(true)
	})
})
