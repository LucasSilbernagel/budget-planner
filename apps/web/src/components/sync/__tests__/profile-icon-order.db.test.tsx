// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

// The real package entry refuses to load under jsdom (it has a `window`), so
// mock it from the schema module alone.
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

const USER = '98198198-1111-4111-8111-111111111111'

vi.mock('@/server/api/auth/paddle', () => ({
	getCurrentUserSession: vi.fn(async () => ({
		success: true,
		data: { userId: USER, subscriptionStatus: 'lifetime', isAuthenticated: true },
	})),
}))

import { users } from '@budget-planner/db'
import { JSDOM } from 'jsdom'
import { POST as batchPOST } from '@/routes/api/sync/batch'
import { GET as changesGET } from '@/routes/api/sync/changes'

type RTL = typeof import('@testing-library/react')
let rtl: RTL
let resetSyncStore: typeof import('@/hooks/useSync').resetSyncStore
let useProfileStore: typeof import('@/stores/profileStore').useProfileStore
let useProfiles: typeof import('@/stores/profileStore').useProfiles
let ActiveSync: typeof import('../ActiveSync').ActiveSync
let useProfileManager: typeof import('@/hooks/useActiveProfile').useProfileManager
let resolveProfileIcon: typeof import('@/lib/profile-appearance').resolveProfileIcon

// vitest runs with cwd = apps/web.
const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const batchFailures: string[] = []

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = new URL(String(input), 'https://app.test')
	const request = new Request(url, init)
	if (url.pathname === '/api/sync/batch') {
		const { operations } = (await request.clone().json()) as {
			operations: { type: string; entityType: string; entityId: string }[]
		}
		const response = await batchPOST({ request })
		const body = (await response.clone().json()) as { failedCount?: number }
		if (!response.ok || (body.failedCount ?? 0) > 0) {
			for (const op of operations) {
				batchFailures.push(`${op.type} ${op.entityType} ${op.entityId}: HTTP ${response.status}`)
			}
		}
		return response
	}
	if (url.pathname === '/api/sync/changes') {
		return changesGET({ request })
	}
	throw new Error(`unrouted fetch ${url}`)
}

let pg: PGlite

beforeAll(async () => {
	// PGlite cannot boot under jsdom, so this file runs in the node environment and
	// a DOM is installed only after the database is up.
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
	const db = drizzle(pg)
	holder.db = db
	await db.insert(users).values({
		id: USER,
		email: 'p981@example.test',
		paddleId: 'ctm_p981',
		subscriptionStatus: 'lifetime',
	})
	vi.stubGlobal('fetch', routeFetch)

	const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
	// `localStorage` must come from the JSDOM window; the node environment has none.
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
	// Rebind every persisted store to the JSDOM storage.
	const { createJSONStorage } = await import('zustand/middleware')
	const persisted = await Promise.all([
		import('@/stores/incomeStore').then((m) => m.useIncomeStore),
		import('@/stores/expenseStore').then((m) => m.useExpenseStore),
		import('@/stores/savingsStore').then((m) => m.useSavingsStore),
		import('@/stores/balanceStore').then((m) => m.useBalanceStore),
		import('@/stores/categoryStore').then((m) => m.useCategoryStore),
		import('@/stores/currencyStore').then((m) => m.useCurrencyStore),
		import('@/stores/profileStore').then((m) => m.useProfileStore),
		import('@/stores/overviewDurationStore').then((m) => m.useOverviewDurationStore),
		import('@/stores/plannerVisibilityStore').then((m) => m.usePlannerVisibilityStore),
		import('@/stores/tableSortStore').then((m) => m.useTableSortStore),
		import('@/stores/retirementPlannerStore').then((m) => m.useRetirementPlannerStore),
	])
	for (const store of persisted) {
		const api = (store as { persist?: { setOptions: (o: Record<string, unknown>) => void } })
			.persist
		api?.setOptions({
			storage: createJSONStorage(() => dom.window.localStorage),
		})
	}

	rtl = await import('@testing-library/react')
	;({ resetSyncStore } = await import('@/hooks/useSync'))
	;({ useProfileStore, useProfiles } = await import('@/stores/profileStore'))
	;({ ActiveSync } = await import('../ActiveSync'))
	;({ useProfileManager } = await import('@/hooks/useActiveProfile'))
	;({ resolveProfileIcon } = await import('@/lib/profile-appearance'))
}, 60_000)

afterAll(async () => {
	vi.unstubAllGlobals()
	await pg?.close()
})

function reload(): void {
	rtl.cleanup()
	resetSyncStore()
}

function freshDevice(): void {
	rtl.cleanup()
	resetSyncStore()
	localStorage.clear()
	const placeholder = crypto.randomUUID()
	useProfileStore.setState({
		profiles: [
			{ id: placeholder, userId: '', name: 'Main Profile', isDefault: true, currency: 'NONE' },
		],
		activeProfileId: placeholder,
	})
}

async function sleep(ms: number): Promise<void> {
	await new Promise((r) => setTimeout(r, ms))
}

type IconRow = { id: string; name: string; icon: string | null }

async function serverRows(): Promise<IconRow[]> {
	const result = await pg.query<IconRow>(
		'select id, name, icon from "userProfiles" where "userId" = $1 and "isDeleted" = false order by "createdAt", id',
		[USER]
	)
	return result.rows
}

function readNames(): string[] {
	const { result, unmount } = rtl.renderHook(() => useProfiles())
	const names = result.current.map((p) => p.name)
	unmount()
	return names
}

describe('profile icon + order round trip (story 98.1, real engine, real routes, real PostgreSQL)', () => {
	it('icons chosen on create (and changed later) reach the server and another device, which reads oldest → newest', async () => {
		freshDevice()
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(
			() => {
				const { profiles, activeProfileId } = useProfileStore.getState()
				expect(profiles.find((p) => p.id === activeProfileId)?.userId).toBe(USER)
			},
			{ timeout: 15_000 }
		)
		await sleep(500)

		const manager = rtl.renderHook(() => useProfileManager())
		const work = manager.result.current.createProfile({
			name: 'Work',
			icon: '💼',
			isDefault: false,
			currency: 'NONE',
			userId: 'temp-user',
		})
		await rtl.waitFor(
			async () => expect((await serverRows()).map((r) => r.name)).toContain('Work'),
			{ timeout: 15_000 }
		)
		const travel = manager.result.current.createProfile({
			name: 'Travel',
			icon: '🏠',
			isDefault: false,
			currency: 'NONE',
			userId: 'temp-user',
		})
		await rtl.waitFor(
			async () => expect((await serverRows()).map((r) => r.name)).toContain('Travel'),
			{ timeout: 15_000 }
		)

		const rows = await serverRows()
		const defaultRow = rows[0] as IconRow
		expect(rows.map((r) => [r.name, r.icon])).toEqual([
			[defaultRow.name, null],
			['Work', '💼'],
			['Travel', '🏠'],
		])
		expect(rows.map((r) => r.id)).toEqual([defaultRow.id, work.id, travel.id])
		expect(batchFailures).toEqual([])

		freshDevice()
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(
			() => expect(useProfileStore.getState().profiles.map((p) => p.id)).toContain(travel.id),
			{ timeout: 15_000 }
		)
		const onB = (id: string) => useProfileStore.getState().profiles.find((p) => p.id === id)
		expect(onB(work.id)?.icon).toBe('💼')
		expect(onB(travel.id)?.icon).toBe('🏠')
		expect(onB(defaultRow.id)?.icon ?? null).toBeNull()
		expect(resolveProfileIcon(onB(defaultRow.id) as NonNullable<ReturnType<typeof onB>>)).toBe('🏠')
		expect(readNames()).toEqual([defaultRow.name, 'Work', 'Travel'])

		await sleep(500)
		const bStorage = Object.entries({ ...localStorage }) as [string, string][]
		const { profiles: bProfiles, activeProfileId: bActive } = useProfileStore.getState()

		freshDevice()
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(
			() => expect(useProfileStore.getState().profiles.map((p) => p.id)).toContain(travel.id),
			{ timeout: 15_000 }
		)
		await sleep(500)
		const managerA = rtl.renderHook(() => useProfileManager())
		managerA.result.current.modifyProfile(defaultRow.id, { name: 'Household' })
		managerA.result.current.modifyProfile(work.id, { icon: '📈' })
		await rtl.waitFor(
			async () => {
				const after = await serverRows()
				expect(after.map((r) => [r.name, r.icon])).toEqual([
					['Household', null],
					['Work', '📈'],
					['Travel', '🏠'],
				])
			},
			{ timeout: 15_000 }
		)
		expect(batchFailures).toEqual([])

		reload()
		localStorage.clear()
		for (const [key, value] of bStorage) {
			localStorage.setItem(key, value)
		}
		useProfileStore.setState({ profiles: bProfiles, activeProfileId: bActive })
		expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([
			defaultRow.id,
			work.id,
			travel.id,
		])
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(
			() => {
				expect(onB(defaultRow.id)?.name).toBe('Household')
				expect(onB(work.id)?.icon).toBe('📈')
			},
			{ timeout: 15_000 }
		)
		expect(useProfileStore.getState().profiles[0]?.id).not.toBe(defaultRow.id)
		expect(readNames()).toEqual(['Household', 'Work', 'Travel'])
	}, 90_000)
})
