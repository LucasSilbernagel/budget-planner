// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@budget-planner/db', async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		'../../../../../../packages/db/src/schema'
	)
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

const USER = '76767676-7676-4767-8767-767676767676'

vi.mock('@/server/api/auth/paddle', () => ({
	getCurrentUserSession: vi.fn(async () => ({
		success: true,
		data: { userId: USER, subscriptionStatus: 'lifetime', isAuthenticated: true },
	})),
}))

import type { SyncOperation } from '@budget-planner/core/sync'
import { incomeSources, userProfiles, users } from '@budget-planner/db'
import { and, eq } from 'drizzle-orm'
import type { drizzle as Drizzle } from 'drizzle-orm/pglite'
import { JSDOM } from 'jsdom'
import { POST as batchPOST } from '@/routes/api/sync/batch'
import { GET as changesGET } from '@/routes/api/sync/changes'

type RTL = typeof import('@testing-library/react')
let rtl: RTL
let resetSyncStore: typeof import('@/hooks/useSync').resetSyncStore
let useProfileStore: typeof import('@/stores/profileStore').useProfileStore
let isSyncActive: typeof import('@/lib/sync/syncBridge').isSyncActive
let ActiveSync: typeof import('../ActiveSync').ActiveSync

const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const QUEUE_KEY = `bp-sync-queue-${USER}`
const MAIN = '7a000000-0000-4000-8000-000000000001'
const P = '7a000000-0000-4000-8000-000000000002'
const Y = '7a000000-0000-4000-8000-000000000003'
const R1 = '7b000000-0000-4000-8000-000000000001'
const C1 = '7b000000-0000-4000-8000-000000000002'
const Z = '7a000000-0000-4000-8000-000000000004'
const OLD_ISO = '2026-09-01T00:00:00.000Z'
const OLD = new Date(OLD_ISO)

let pg: PGlite
let db: ReturnType<typeof Drizzle>
const served: string[] = []
const batchAnswers: string[] = []
let openBatch: () => void = () => {}
let batchGate: Promise<void> = Promise.resolve()
// A request records its answer only if it started in the current test, so a late
// push from an unmounted engine cannot leak into the next test.
let generation = 0

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = new URL(String(input), 'https://app.test')
	const request = new Request(url, init)
	const startedIn = generation
	if (url.pathname === '/api/sync/batch') {
		await batchGate
		const response = await batchPOST({ request })
		if (startedIn === generation) {
			batchAnswers.push(await response.clone().text())
			served.push(`POST ${url.pathname} ${response.status}`)
		}
		return response
	}
	if (url.pathname === '/api/sync/changes') {
		const response = await changesGET({ request })
		if (startedIn === generation) {
			served.push(`GET ${url.pathname} ${response.status}`)
		}
		return response
	}
	throw new Error(`unrouted fetch ${url}`)
}

async function deviceAPushes(operation: Partial<SyncOperation>): Promise<void> {
	const response = await batchPOST({
		request: new Request('https://app.test/api/sync/batch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				operations: [
					{
						id: crypto.randomUUID(),
						timestamp: Date.now(),
						deviceId: 'device-a',
						userId: USER,
						...operation,
					},
				],
				clientTimestamp: Date.now(),
				deviceId: 'device-a',
			}),
		}),
	})
	expect(JSON.parse(await response.text())).toMatchObject({ processedCount: 1 })
}

function queuedOp(overrides: Partial<SyncOperation>): SyncOperation {
	return {
		id: crypto.randomUUID(),
		type: 'update',
		entityType: 'incomeSource',
		entityId: R1,
		data: { userId: USER, name: 'Salary', amount: 1000, frequency: 'monthly' },
		timestamp: Date.now(),
		deviceId: 'device-b',
		userId: USER,
		...overrides,
	} as SyncOperation
}

function persistedQueue(): SyncOperation[] {
	const raw = localStorage.getItem(QUEUE_KEY)
	return raw ? (JSON.parse(raw) as SyncOperation[]) : []
}

function queueSummary(): string[] {
	return persistedQueue().map((o) => `${o.type}:${o.entityType}:${o.entityId}`)
}

function localProfile(id: string, name: string, isDefault: boolean, createdAt = OLD_ISO) {
	return {
		id,
		userId: USER,
		name,
		isDefault,
		currency: 'NONE',
		createdAt,
		updatedAt: OLD_ISO,
	}
}

function localDefaults(): string[] {
	return useProfileStore
		.getState()
		.profiles.filter((p) => p.isDefault)
		.map((p) => p.name)
}

async function serverDefaults(): Promise<string[]> {
	const rows = await db
		.select({ name: userProfiles.name })
		.from(userProfiles)
		.where(
			and(
				eq(userProfiles.userId, USER),
				eq(userProfiles.isDefault, true),
				eq(userProfiles.isDeleted, false)
			)
		)
	return rows.map((r) => r.name)
}

const pulls = () => served.filter((s) => s.startsWith('GET /api/sync/changes')).length

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
		email: 'remote-delete@example.test',
		paddleId: 'ctm_remote_delete',
		subscriptionStatus: 'lifetime',
	})
	vi.stubGlobal('fetch', routeFetch)

	const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
	// `localStorage` and `navigator` must come from the JSDOM window.
	for (const key of [
		'window',
		'document',
		'HTMLElement',
		'Node',
		'navigator',
		'MutationObserver',
		'localStorage',
	]) {
		vi.stubGlobal(
			key,
			key === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]
		)
	}
	const { createJSONStorage } = await import('zustand/middleware')
	const persisted = await Promise.all([
		import('@/stores/incomeStore').then((m) => m.useIncomeStore),
		import('@/stores/expenseStore').then((m) => m.useExpenseStore),
		import('@/stores/savingsStore').then((m) => m.useSavingsStore),
		import('@/stores/balanceStore').then((m) => m.useBalanceStore),
		import('@/stores/categoryStore').then((m) => m.useCategoryStore),
		import('@/stores/currencyStore').then((m) => m.useCurrencyStore),
		import('@/stores/profileStore').then((m) => m.useProfileStore),
	])
	for (const store of persisted) {
		const api = (store as { persist?: { setOptions: (o: Record<string, unknown>) => void } })
			.persist
		api?.setOptions({ storage: createJSONStorage(() => dom.window.localStorage) })
	}

	rtl = await import('@testing-library/react')
	;({ resetSyncStore } = await import('@/hooks/useSync'))
	;({ useProfileStore } = await import('@/stores/profileStore'))
	;({ isSyncActive } = await import('@/lib/sync/syncBridge'))
	;({ ActiveSync } = await import('../ActiveSync'))
}, 60_000)

afterAll(async () => {
	vi.unstubAllGlobals()
	await pg?.close()
})

beforeEach(async () => {
	generation++
	served.length = 0
	batchAnswers.length = 0
	batchGate = new Promise<void>((r) => {
		openBatch = r
	})
	localStorage.clear()
	await db.delete(incomeSources).where(eq(incomeSources.userId, USER))
	await db.delete(userProfiles).where(eq(userProfiles.userId, USER))
})

afterEach(() => {
	// The gate is not opened here: a held push stays held and cannot touch the next test's state.
	rtl.cleanup()
	resetSyncStore()
})

describe('a profile deleted on another device', () => {
	it('its queued child ops leave this device’s queue in the pull that brings the tombstone', async () => {
		await db.insert(userProfiles).values([
			{ id: MAIN, userId: USER, name: 'Main', isDefault: true, updatedAt: OLD },
			{ id: P, userId: USER, name: 'Side', isDefault: false, updatedAt: OLD },
		])
		await db.insert(incomeSources).values({
			id: R1,
			userId: USER,
			profileId: P,
			name: 'Salary',
			amount: 1000,
			frequency: 'monthly',
			updatedAt: OLD,
		} as never)
		useProfileStore.setState({
			profiles: [localProfile(MAIN, 'Main', true), localProfile(P, 'Side', false)],
			activeProfileId: MAIN,
		})
		const childCreate = queuedOp({
			type: 'create',
			entityId: C1,
			data: { userId: USER, name: 'Bonus', amount: 500, frequency: 'monthly' },
			profileId: P,
		})
		const childUpdate = queuedOp({ profileId: P, baseVersion: OLD.getTime() })
		localStorage.setItem(QUEUE_KEY, JSON.stringify([childCreate, childUpdate]))
		await deviceAPushes({
			type: 'delete',
			entityType: 'userProfile',
			entityId: P,
			data: { userId: USER },
		})

		rtl.render(<ActiveSync userId={USER} />)

		await rtl.waitFor(
			() => expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([MAIN]),
			{ timeout: 15_000 }
		)
		expect(pulls()).toBeGreaterThan(0)
		expect(queueSummary()).toEqual([])

		// That push was already in flight when the pull dropped the ops, so it still sends
		// them once; what matters is that no later push carries them.
		openBatch()
		await rtl.waitFor(() => expect(batchAnswers.length).toBeGreaterThan(0), { timeout: 15_000 })
		await rtl.act(async () => {
			await new Promise((r) => setTimeout(r, 0))
		})
		expect(queueSummary()).toEqual([])
		expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0)
	}, 60_000)

	it('a deletion that LOST last-writer-wins does not move the default, and leaves one local default', async () => {
		await db.insert(userProfiles).values([
			{ id: MAIN, userId: USER, name: 'Main', isDefault: true, updatedAt: OLD },
			{ id: Y, userId: USER, name: 'Travel', isDefault: false, updatedAt: OLD },
		])
		useProfileStore.setState({
			profiles: [localProfile(MAIN, 'Main', true), localProfile(Y, 'Travel', false)],
			activeProfileId: MAIN,
		})

		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(() => expect(isSyncActive()).toBe(true), { timeout: 15_000 })
		await rtl.waitFor(() => expect(pulls()).toBeGreaterThan(0), { timeout: 15_000 })
		await new Promise((r) => setTimeout(r, 300))

		await db
			.update(userProfiles)
			.set({ name: 'Main (renamed on A)', updatedAt: new Date() })
			.where(eq(userProfiles.id, MAIN))

		const pullsBefore = pulls()
		await rtl.act(async () => {
			useProfileStore.getState().removeProfile(MAIN)
		})
		await rtl.waitFor(
			() =>
				expect(
					useProfileStore
						.getState()
						.profiles.map((p) => p.name)
						.sort()
				).toEqual(['Main (renamed on A)', 'Travel']),
			{ timeout: 15_000 }
		)
		expect(pulls()).toBeGreaterThan(pullsBefore)

		await rtl.waitFor(() => expect(queueSummary()).toEqual([]), { timeout: 15_000 })
		await rtl.waitFor(() => expect(localDefaults()).toEqual(['Main (renamed on A)']), {
			timeout: 15_000,
		})

		openBatch()
		await new Promise((r) => setTimeout(r, 2500))
		expect(batchAnswers).toEqual([])
		expect(await serverDefaults()).toEqual(['Main (renamed on A)'])
	}, 60_000)

	it('the route accepts an op carrying dependsOn and ignores the field (Task 3.1)', async () => {
		await db.insert(userProfiles).values([
			{ id: MAIN, userId: USER, name: 'Main', isDefault: true, updatedAt: OLD },
			{ id: Y, userId: USER, name: 'Travel', isDefault: false, updatedAt: OLD },
		])

		await deviceAPushes({
			type: 'update',
			entityType: 'userProfile',
			entityId: Y,
			data: { userId: USER, name: 'Travel', isDefault: true, currency: 'NONE' },
			dependsOn: { entityType: 'userProfile', entityId: MAIN, type: 'delete' },
		})

		expect(await serverDefaults()).toEqual(['Travel'])
	})

	it("convergence: deleting the ACTIVE default promotes the repair's own pick, so the returning tombstone changes nothing", async () => {
		// Archive is the oldest, with local createdAt matching the server's, so a
		// first-in-store-order pick (Travel) fails below.
		await db.insert(userProfiles).values([
			{
				id: Z,
				userId: USER,
				name: 'Archive',
				isDefault: false,
				createdAt: new Date('2026-01-01'),
				updatedAt: OLD,
			},
			{
				id: P,
				userId: USER,
				name: 'Home',
				isDefault: true,
				createdAt: new Date('2026-02-01'),
				updatedAt: OLD,
			},
			{
				id: Y,
				userId: USER,
				name: 'Travel',
				isDefault: false,
				createdAt: new Date('2026-03-01'),
				updatedAt: OLD,
			},
		])
		useProfileStore.setState({
			profiles: [
				localProfile(P, 'Home', true, '2026-02-01T00:00:00.000Z'),
				localProfile(Y, 'Travel', false, '2026-03-01T00:00:00.000Z'),
				localProfile(Z, 'Archive', false, '2026-01-01T00:00:00.000Z'),
			],
			activeProfileId: P,
		})

		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(() => expect(isSyncActive()).toBe(true), { timeout: 15_000 })
		await rtl.waitFor(() => expect(pulls()).toBeGreaterThan(0), { timeout: 15_000 })
		await new Promise((r) => setTimeout(r, 300))

		await rtl.act(async () => {
			useProfileStore.getState().removeProfile(P)
		})
		expect(useProfileStore.getState().activeProfileId).toBe(Z)
		await rtl.waitFor(() => expect(persistedQueue()).toHaveLength(2), { timeout: 15_000 })
		const promotion = persistedQueue().find((o) => o.entityId === Z) as SyncOperation
		// The promotion carries the deleted profile's stamp: the queue ran before the
		// active-profile switch reached the sync config.
		expect(promotion.profileId).toBe(P)

		await deviceAPushes({
			type: 'delete',
			entityType: 'userProfile',
			entityId: P,
			data: { userId: USER },
		})
		rtl.cleanup()
		resetSyncStore()
		const pullsBefore = pulls()
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(() => expect(pulls()).toBeGreaterThan(pullsBefore), { timeout: 15_000 })
		await new Promise((r) => setTimeout(r, 300))

		expect(queueSummary()).toEqual([])
		expect(localDefaults()).toEqual(['Archive'])

		openBatch()
		await new Promise((r) => setTimeout(r, 2500))
		expect(await serverDefaults()).toEqual(['Archive'])
		expect(batchAnswers.join(' ')).not.toMatch(/update-delete/)
	}, 60_000)

	it('trap control: a promotion stamped with the deleted profile survives the tombstone and wins the seat', async () => {
		// Trap control: A promoted Travel before deleting P, so no server repair runs; B's
		// queued promotion of Archive must survive the pull and win the seat.
		await db.insert(userProfiles).values([
			{
				id: Z,
				userId: USER,
				name: 'Archive',
				isDefault: false,
				createdAt: new Date('2026-01-01'),
				updatedAt: OLD,
			},
			{
				id: P,
				userId: USER,
				name: 'Home',
				isDefault: true,
				createdAt: new Date('2026-02-01'),
				updatedAt: OLD,
			},
			{
				id: Y,
				userId: USER,
				name: 'Travel',
				isDefault: false,
				createdAt: new Date('2026-03-01'),
				updatedAt: OLD,
			},
		])
		useProfileStore.setState({
			profiles: [
				localProfile(P, 'Home', true, '2026-02-01T00:00:00.000Z'),
				localProfile(Y, 'Travel', false, '2026-03-01T00:00:00.000Z'),
				localProfile(Z, 'Archive', false, '2026-01-01T00:00:00.000Z'),
			],
			activeProfileId: P,
		})

		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(() => expect(isSyncActive()).toBe(true), { timeout: 15_000 })
		await rtl.waitFor(() => expect(pulls()).toBeGreaterThan(0), { timeout: 15_000 })
		await new Promise((r) => setTimeout(r, 300))

		await rtl.act(async () => {
			useProfileStore.getState().removeProfile(P)
		})
		expect(useProfileStore.getState().activeProfileId).toBe(Z)
		await rtl.waitFor(() => expect(persistedQueue()).toHaveLength(2), { timeout: 15_000 })
		const promotion = persistedQueue().find((o) => o.entityId === Z)
		expect(promotion?.profileId).toBe(P)
		expect(promotion?.dependsOn).toMatchObject({ type: 'delete', entityId: P })

		await deviceAPushes({
			type: 'update',
			entityType: 'userProfile',
			entityId: Y,
			data: { userId: USER, name: 'Travel', isDefault: true, currency: 'NONE' },
		})
		await deviceAPushes({
			type: 'delete',
			entityType: 'userProfile',
			entityId: P,
			data: { userId: USER },
		})
		expect(await serverDefaults()).toEqual(['Travel'])

		rtl.cleanup()
		resetSyncStore()
		const pullsBefore = pulls()
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(() => expect(pulls()).toBeGreaterThan(pullsBefore), { timeout: 15_000 })
		await rtl.waitFor(
			() => expect(useProfileStore.getState().profiles.map((p) => p.id)).not.toContain(P),
			{ timeout: 15_000 }
		)
		await new Promise((r) => setTimeout(r, 300))

		expect(queueSummary()).toEqual([`update:userProfile:${Z}`])

		openBatch()
		await rtl.waitFor(async () => expect(await serverDefaults()).toEqual(['Archive']), {
			timeout: 15_000,
		})
		expect(batchAnswers.join(' ')).not.toMatch(/update-delete/)
	}, 60_000)
})
