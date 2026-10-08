// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))
const session = vi.hoisted(() => ({ userId: '11111111-1111-4111-8111-111111111111' }))

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

const USER = '11111111-1111-4111-8111-111111111111'

vi.mock('@/server/api/auth/paddle', () => ({
	getCurrentUserSession: vi.fn(async () => ({
		success: true,
		data: { userId: session.userId, subscriptionStatus: 'lifetime', isAuthenticated: true },
	})),
}))

import { users } from '@budget-planner/db'
import { JSDOM } from 'jsdom'
import type { ReactElement } from 'react'
import { POST as batchPOST } from '@/routes/api/sync/batch'
import { GET as changesGET } from '@/routes/api/sync/changes'

type RTL = typeof import('@testing-library/react')
let rtl: RTL
let resetSyncStore: typeof import('@/hooks/useSync').resetSyncStore
let useIncomeStore: typeof import('@/stores/incomeStore').useIncomeStore
let useProfileStore: typeof import('@/stores/profileStore').useProfileStore
let ActiveSync: typeof import('../ActiveSync').ActiveSync
let useProfileManager: typeof import('@/hooks/useActiveProfile').useProfileManager
let planStore: typeof import('@/stores/retirementPlannerStore')
let boundary: typeof import('@/lib/sync/accountBoundary')
let planPush: typeof import('@/lib/sync/retirementPlanPush')
let persistedStores: { persist?: { rehydrate: () => Promise<void> | void } }[] = []

// vitest runs with cwd = apps/web.
const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const requests: string[] = []
const pushedOps: string[] = []
const batchFailures: string[] = []
const dbErrors: string[] = []
// When true, /api/sync/batch answers every op with a permanent server failure.
let serverRejectsPushes = false

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = new URL(String(input), 'https://app.test')
	const request = new Request(url, init)
	requests.push(`${request.method} ${url.pathname}${url.search}`)
	if (url.pathname === '/api/sync/batch') {
		if (serverRejectsPushes) {
			return new Response(
				JSON.stringify({ success: false, processedCount: 0, failedCount: 1, conflictCount: 0 }),
				{ status: 200 }
			)
		}
		const { operations } = (await request.clone().json()) as {
			operations: { type: string; entityType: string; entityId: string; profileId?: string }[]
		}
		for (const op of operations) {
			pushedOps.push(`${op.type} ${op.entityType} ${op.entityId}`)
		}
		const response = await batchPOST({ request })
		const body = (await response.clone().json()) as {
			failedCount?: number
			rejections?: unknown[]
		}
		if (!response.ok || (body.failedCount ?? 0) > 0) {
			const outcome = !response.ok
				? `HTTP ${response.status}`
				: body.rejections?.length
					? 'refused'
					: 'failed with no rejection (kept queued)'
			for (const op of operations) {
				batchFailures.push(
					`${op.type} ${op.entityType} ${op.entityId} (profile ${op.profileId}): ${outcome}`
				)
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
	const recording = <Q extends (...args: never[]) => Promise<unknown>>(query: Q): Q =>
		(async (...args: Parameters<Q>) => {
			try {
				return await query(...args)
			} catch (error) {
				const { code, message } = error as { code?: string; message?: string }
				dbErrors.push(`${code} ${message}`)
				throw error
			}
		}) as Q
	pg.query = recording(pg.query.bind(pg))
	const transaction = pg.transaction.bind(pg)
	pg.transaction = ((callback: Parameters<typeof pg.transaction>[0]) =>
		transaction((tx) => {
			tx.query = recording(tx.query.bind(tx))
			return callback(tx)
		})) as typeof pg.transaction
	const db = drizzle(pg)
	holder.db = db
	await db.insert(users).values({
		id: USER,
		email: 'a@example.test',
		paddleId: 'ctm_a',
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
	// Persisted stores bind storage at first import, before the JSDOM localStorage
	// exists here. Rebind whichever have a persist API.
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
	persistedStores = persisted as typeof persistedStores
	for (const store of persisted) {
		const api = (store as { persist?: { setOptions: (o: Record<string, unknown>) => void } })
			.persist
		api?.setOptions({
			storage: createJSONStorage(() => dom.window.localStorage),
		})
	}

	rtl = await import('@testing-library/react')
	;({ resetSyncStore } = await import('@/hooks/useSync'))
	;({ useIncomeStore } = await import('@/stores/incomeStore'))
	;({ useProfileStore } = await import('@/stores/profileStore'))
	;({ ActiveSync } = await import('../ActiveSync'))
	;({ useProfileManager } = await import('@/hooks/useActiveProfile'))
	planStore = await import('@/stores/retirementPlannerStore')
	boundary = await import('@/lib/sync/accountBoundary')
	planPush = await import('@/lib/sync/retirementPlanPush')
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
	useIncomeStore.setState({ incomeSources: [] })
	planStore.useRetirementPlannerStore.setState({
		plan: { ...planStore.RETIREMENT_PLAN_DEFAULTS },
		ownerUserId: '',
		serverUpdatedAt: null,
		localPlanDiverged: false,
	})
	boundary.resetAccountBoundaryForTests()
	planPush.resetRetirementPlanPushForTests()
}

describe('cross-device sync (real engine, real routes, real PostgreSQL)', () => {
	it('data entered on device A appears on device B', async () => {
		freshDevice()
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 500_000, frequency: 'monthly' })
		const localId = useIncomeStore.getState().incomeSources[0]?.id
		rtl.render(<ActiveSync userId={USER} />)

		await rtl.waitFor(
			async () => {
				const rows = await pg.query<{ id: string }>('select id from "incomeSources"')
				expect(rows.rows.map((r) => r.id)).toEqual([localId])
			},
			{ timeout: 15_000 }
		)

		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Bonus', amount: 100_000, frequency: 'annually' })
		await rtl.waitFor(
			async () => {
				const rows = await pg.query('select id from "incomeSources"')
				expect(rows.rows).toHaveLength(2)
			},
			{ timeout: 15_000 }
		)

		freshDevice()
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(
			() => {
				const names = useIncomeStore
					.getState()
					.incomeSources.map((s) => s.name)
					.sort()
				expect(names).toEqual(['Bonus', 'Salary'])
			},
			{ timeout: 15_000 }
		)
	}, 60_000)

	it('a device whose uploads were rejected before the server fix uploads its data after a reload, with no new edits', async () => {
		await pg.exec('delete from "incomeSources"')
		freshDevice()
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Rent income', amount: 90_000, frequency: 'monthly' })
		serverRejectsPushes = true
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(() => expect(requests.some((r) => r.startsWith('POST'))).toBe(true), {
			timeout: 15_000,
		})
		await new Promise((r) => setTimeout(r, 500))

		serverRejectsPushes = false
		requests.length = 0
		reload()
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(
			async () => {
				const rows = await pg.query('select id from "incomeSources"')
				expect(rows.rows).toHaveLength(1)
			},
			{ timeout: 15_000 }
		)
	}, 60_000)

	it('local rows are uploaded even when the device carries the pre-fix "already seeded" marker and no queued ops', async () => {
		await pg.exec('delete from "incomeSources"')
		freshDevice()
		const serverProfile = await pg.query<{ id: string }>(
			`select id from "userProfiles" where "userId" = '${USER}' limit 1`
		)
		const profileId = serverProfile.rows[0]?.id as string
		useProfileStore.setState({
			profiles: [
				{ id: profileId, userId: USER, name: 'Main Profile', isDefault: true, currency: 'NONE' },
			],
			activeProfileId: profileId,
		})
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Pension', amount: 70_000, frequency: 'monthly' })
		localStorage.setItem(`budget-planner:sync-seeded:${USER}`, '1')

		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(
			async () => {
				const rows = await pg.query('select id from "incomeSources"')
				expect(rows.rows).toHaveLength(1)
			},
			{ timeout: 15_000 }
		)
	}, 60_000)

	it('a profile created while sync was off is uploaded, so the data queued under it reaches the server and another device can switch to it', async () => {
		await pg.exec('delete from "incomeSources"')
		freshDevice()
		const localOnlyProfile = crypto.randomUUID()
		useProfileStore.setState({
			profiles: [
				{
					id: localOnlyProfile,
					userId: USER,
					name: 'Household',
					isDefault: false,
					currency: 'NONE',
				},
			],
			activeProfileId: localOnlyProfile,
		})
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Freelance', amount: 250_000, frequency: 'monthly' })

		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(
			async () => {
				const rows = await pg.query<{ profileId: string }>(
					'select "profileId" from "incomeSources"'
				)
				expect(rows.rows.map((r) => r.profileId)).toEqual([localOnlyProfile])
			},
			{ timeout: 20_000 }
		)
		const profiles = await pg.query<{ id: string }>(
			`select id from "userProfiles" where "userId" = '${USER}' and "isDeleted" = false`
		)
		expect(profiles.rows.map((r) => r.id)).toContain(localOnlyProfile)

		freshDevice()
		rtl.render(<ActiveSync userId={USER} />)
		await rtl.waitFor(
			() => {
				expect(useProfileStore.getState().profiles.map((p) => p.id)).toContain(localOnlyProfile)
			},
			{ timeout: 15_000 }
		)
		useProfileStore.getState().switchProfile(localOnlyProfile)
		await rtl.waitFor(
			() => {
				expect(useIncomeStore.getState().incomeSources.map((s) => s.name)).toContain('Freelance')
			},
			{ timeout: 15_000 }
		)
	}, 90_000)
})

const ACCOUNT_A = '86386386-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCOUNT_B = '86386386-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACCOUNT_C = '86386386-cccc-4ccc-8ccc-cccccccccccc'

function queued(userId: string): string[] {
	const ops = JSON.parse(localStorage.getItem(`bp-sync-queue-${userId}`) ?? '[]') as {
		type: string
		entityType: string
		entityId: string
	}[]
	return ops.map((op) => `${op.type} ${op.entityType} ${op.entityId}`)
}

function signOut(): void {
	rtl.cleanup()
	resetSyncStore()
}

function incomeNamed(name: string): { id: string } {
	const row = useIncomeStore.getState().incomeSources.find((r) => r.name === name)
	if (!row) {
		throw new Error(`no local income row named ${name}`)
	}
	return row
}

async function sleep(ms: number): Promise<void> {
	await new Promise((r) => setTimeout(r, ms))
}

async function serverDefaultProfile(userId: string): Promise<string | undefined> {
	const rows = await pg.query<{ id: string }>(
		'select id from "userProfiles" where "userId" = $1 and "isDefault" = true and "isDeleted" = false',
		[userId]
	)
	return rows.rows[0]?.id
}

describe('two accounts on one browser (story 86.3, real engine, real routes, real PostgreSQL)', () => {
	beforeAll(async () => {
		const db = holder.db as ReturnType<typeof drizzle>
		await db.insert(users).values([
			{
				id: ACCOUNT_A,
				email: 'a863@example.test',
				paddleId: 'ctm_a863',
				subscriptionStatus: 'lifetime',
			},
			{
				id: ACCOUNT_B,
				email: 'b863@example.test',
				paddleId: 'ctm_b863',
				subscriptionStatus: 'lifetime',
			},
			{
				id: ACCOUNT_C,
				email: 'c863@example.test',
				paddleId: 'ctm_c863',
				subscriptionStatus: 'lifetime',
			},
		])
	})

	afterEach(() => {
		session.userId = USER
	})

	it('AC 2: what A pushed and never pulled back is A’s, so B neither lands on it nor re-uploads it', async () => {
		freshDevice()
		session.userId = ACCOUNT_A
		rtl.render(<ActiveSync userId={ACCOUNT_A} />)
		await rtl.waitFor(
			() => {
				const { profiles, activeProfileId } = useProfileStore.getState()
				expect(profiles.find((p) => p.id === activeProfileId)?.userId).toBe(ACCOUNT_A)
			},
			{ timeout: 15_000 }
		)
		const aDefault = await serverDefaultProfile(ACCOUNT_A)
		expect(aDefault).toBeDefined()
		await sleep(500)
		const pullsBeforeEdits = requests.filter((r) => r.startsWith('GET')).length

		const manager = rtl.renderHook(() => useProfileManager())
		const side = manager.result.current.createProfile({
			name: 'Side',
			isDefault: false,
			currency: 'NONE',
			userId: 'temp-user',
		})
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'A salary', amount: 300_000, frequency: 'monthly' })
		const aIncome = incomeNamed('A salary')
		await rtl.waitFor(
			async () => {
				const profile = await pg.query<{ userId: string }>(
					'select "userId" from "userProfiles" where id = $1',
					[side.id]
				)
				expect(profile.rows).toEqual([{ userId: ACCOUNT_A }])
				const income = await pg.query<{ userId: string }>(
					'select "userId" from "incomeSources" where id = $1',
					[aIncome.id]
				)
				expect(income.rows).toEqual([{ userId: ACCOUNT_A }])
				expect(queued(ACCOUNT_A)).toEqual([])
				expect(useProfileStore.getState().profiles.find((p) => p.id === side.id)?.userId).toBe(
					ACCOUNT_A
				)
				expect(
					useIncomeStore.getState().incomeSources.find((r) => r.id === aIncome.id)?.userId
				).toBe(ACCOUNT_A)
			},
			{ timeout: 15_000 }
		)
		expect(requests.filter((r) => r.startsWith('GET')).length).toBe(pullsBeforeEdits)
		signOut()

		session.userId = ACCOUNT_B
		batchFailures.length = 0
		dbErrors.length = 0
		rtl.render(<ActiveSync userId={ACCOUNT_B} />)
		await rtl.waitFor(
			() => expect(useProfileStore.getState().profiles.map((p) => p.userId)).toContain(ACCOUNT_B),
			{ timeout: 15_000 }
		)
		const bDefault = await serverDefaultProfile(ACCOUNT_B)
		expect(bDefault).toBeDefined()
		// Long enough for the debounced (2 s) profile upload push and the seed to round trip.
		await sleep(3500)

		const { profiles, activeProfileId } = useProfileStore.getState()
		expect.soft(profiles.map((p) => p.id)).not.toContain(side.id)
		expect.soft(activeProfileId).toBe(bDefault)
		expect.soft(useIncomeStore.getState().incomeSources.map((r) => r.id)).not.toContain(aIncome.id)
		expect.soft(queued(ACCOUNT_B)).toEqual([])
		expect.soft(batchFailures).toEqual([])
		expect.soft(dbErrors).toEqual([])

		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'B salary', amount: 200_000, frequency: 'monthly' })
		const bIncome = incomeNamed('B salary')
		const landed = async () =>
			(
				await pg.query<{ userId: string; profileId: string }>(
					'select "userId", "profileId" from "incomeSources" where id = $1',
					[bIncome.id]
				)
			).rows
		await rtl
			.waitFor(async () => expect(await landed()).toHaveLength(1), { timeout: 6000 })
			.catch(() => undefined)
		expect.soft(await landed()).toEqual([{ userId: ACCOUNT_B, profileId: bDefault }])
		const aRows = await pg.query<{ userId: string }>(
			'select "userId" from "userProfiles" where id = $1 union all select "userId" from "incomeSources" where id = $2',
			[side.id, aIncome.id]
		)
		expect(aRows.rows).toEqual([{ userId: ACCOUNT_A }, { userId: ACCOUNT_A }])
	}, 60_000)

	it('AC 5: what A never pushed is still adopted by the next account, and marked as theirs once it lands', async () => {
		freshDevice()
		const manager = rtl.renderHook(() => useProfileManager())
		const local = manager.result.current.createProfile({
			name: 'Local',
			isDefault: false,
			currency: 'NONE',
			userId: 'temp-user',
		})
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Free salary', amount: 100_000, frequency: 'monthly' })
		const freeIncome = incomeNamed('Free salary')
		manager.unmount()

		session.userId = ACCOUNT_C
		rtl.render(<ActiveSync userId={ACCOUNT_C} />)
		await rtl.waitFor(
			async () => {
				const profile = await pg.query<{ userId: string }>(
					'select "userId" from "userProfiles" where id = $1',
					[local.id]
				)
				expect(profile.rows).toEqual([{ userId: ACCOUNT_C }])
				const income = await pg.query<{ userId: string }>(
					'select "userId" from "incomeSources" where id = $1',
					[freeIncome.id]
				)
				expect(income.rows).toEqual([{ userId: ACCOUNT_C }])
				expect(queued(ACCOUNT_C)).toEqual([])
			},
			{ timeout: 20_000 }
		)
		await rtl.waitFor(() => {
			expect(useProfileStore.getState().profiles.find((p) => p.id === local.id)?.userId).toBe(
				ACCOUNT_C
			)
			expect(
				useIncomeStore.getState().incomeSources.find((r) => r.id === freeIncome.id)?.userId
			).toBe(ACCOUNT_C)
		})
	}, 60_000)
})

const PLAN_ACCOUNTS = {
	aToB: '99399399-1111-4111-8111-111111111111',
	parkedOther: '99399399-2222-4222-8222-222222222222',
	currencies: '99399399-3333-4333-8333-333333333333',
	currenciesSeed: '99399399-3333-4333-8333-33333333333a',
	clearLocal: '99399399-4444-4444-8444-444444444444',
	unclaimed: '99399399-5555-4555-8555-555555555555',
	reconciled: '99399399-6666-4666-8666-666666666666',
	returningOwner: '99399399-7777-4777-8777-777777777777',
	freePeriod: '99399399-8888-4888-8888-888888888888',
	firstDevice: '99399399-9999-4999-8999-999999999999',
} as const

type Plan = import('@/stores/retirementPlannerStore').RetirementPlan

const AUTHORED: Plan = {
	currentAgeInput: '42',
	lifeExpectancyInput: '88',
	desiredIncomeInput: '55,000.00',
	desiredIncomeTouched: true,
	desiredIncomeLocale: 'en-US',
	adoptedMonthlyCents: null,
	incomeBasis: 'monthly',
	annualReturnInput: '7.5',
	postRetirementReturnInput: '3.25',
	postRetirementTouched: true,
	model: 'perpetual',
}

const plan = () => planStore.useRetirementPlannerStore.getState()

async function serverPlan(userId: string): Promise<Plan | undefined> {
	const rows = await pg.query<{ plan: Plan }>('select plan from "retirementPlans" where id = $1', [
		userId,
	])
	return rows.rows[0]?.plan
}

async function putServerPlan(userId: string, value: Plan): Promise<void> {
	await pg.query(
		`insert into "retirementPlans" (id, "userId", plan, "updatedAt") values ($1, $1, $2, now())
     on conflict (id) do update set plan = excluded.plan, "updatedAt" = now()`,
		[userId, JSON.stringify(value)]
	)
}

function planOpsFor(userId: string): string[] {
	return pushedOps.filter((op) => op.endsWith(` retirementPlan ${userId}`))
}

function signIn(userId: string, extra?: ReactElement): void {
	session.userId = userId
	boundary.applyAccountBoundary(userId)
	rtl.render(
		<>
			<ActiveSync userId={userId} />
			{extra}
		</>
	)
}

async function waitForInitialPull(userId: string): Promise<void> {
	await rtl.waitFor(
		() => {
			const { profiles, activeProfileId } = useProfileStore.getState()
			expect(profiles.find((p) => p.id === activeProfileId)?.userId).toBe(userId)
		},
		{ timeout: 15_000 }
	)
	await sleep(3000)
}

function snapshotDevice(): Record<string, string> {
	const snapshot: Record<string, string> = {}
	for (let i = 0; i < localStorage.length; i += 1) {
		const key = localStorage.key(i) as string
		snapshot[key] = localStorage.getItem(key) as string
	}
	return snapshot
}

async function loadDevice(snapshot: Record<string, string>): Promise<void> {
	rtl.cleanup()
	resetSyncStore()
	localStorage.clear()
	for (const [key, value] of Object.entries(snapshot)) {
		localStorage.setItem(key, value)
	}
	planPush.resetRetirementPlanPushForTests()
	boundary.resetAccountBoundaryForTests()
	for (const store of persistedStores) {
		await store.persist?.rehydrate()
	}
}

describe('the retirement plan follows the account (story 99.3, real engine, real routes, real PostgreSQL)', () => {
	beforeAll(async () => {
		const db = holder.db as ReturnType<typeof drizzle>
		await db.insert(users).values(
			Object.values(PLAN_ACCOUNTS).map((id, index) => ({
				id,
				email: `p${index}@example.test`,
				paddleId: `ctm_p${index}`,
				subscriptionStatus: 'lifetime' as const,
			}))
		)
	})

	afterEach(() => {
		session.userId = USER
		rtl.cleanup()
	})

	it('AC-1: device A edits every field; a fresh device B shows the identical plan after its first sync', async () => {
		const id = PLAN_ACCOUNTS.aToB
		freshDevice()
		signIn(id)
		await waitForInitialPull(id)
		expect(planOpsFor(id)).toEqual([`create retirementPlan ${id}`])

		const s = plan()
		s.setCurrentAgeInput(AUTHORED.currentAgeInput)
		s.setLifeExpectancyInput(AUTHORED.lifeExpectancyInput)
		s.setDesiredIncomeInput(AUTHORED.desiredIncomeInput)
		s.markDesiredIncomeAuthored(AUTHORED.desiredIncomeLocale)
		s.setIncomeBasis(AUTHORED.incomeBasis)
		s.setAnnualReturnInput(AUTHORED.annualReturnInput)
		s.setPostRetirementReturn(AUTHORED.postRetirementReturnInput)
		s.setModel(AUTHORED.model)
		s.setAdoptedMonthlyCents(240_000)
		const authored = { ...AUTHORED, adoptedMonthlyCents: 240_000 }
		expect(plan().plan).toEqual(authored)
		await rtl.waitFor(async () => expect(await serverPlan(id)).toEqual(authored), {
			timeout: 15_000,
		})
		expect(planOpsFor(id)).toEqual([`create retirementPlan ${id}`, `update retirementPlan ${id}`])

		freshDevice()
		signIn(id)
		await rtl.waitFor(() => expect(plan().plan).toEqual(authored), { timeout: 15_000 })
		await waitForInitialPull(id)
		expect(planOpsFor(id)).toHaveLength(2)
		expect(plan().ownerUserId).toBe(id)
	}, 90_000)

	it('AC-7: a device with an UNCLAIMED local plan signs in to an account that has one: the server plan wins', async () => {
		const id = PLAN_ACCOUNTS.unclaimed
		await putServerPlan(id, AUTHORED)
		freshDevice()
		planStore.useRetirementPlannerStore.setState({
			plan: { ...planStore.RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '29', model: 'perpetual' },
		})
		signIn(id)
		expect(plan().ownerUserId).toBe(id)
		await rtl.waitFor(() => expect(plan().plan).toEqual(AUTHORED), { timeout: 15_000 })
		await waitForInitialPull(id)
		expect(planOpsFor(id)).toEqual([])
		expect(await serverPlan(id)).toEqual(AUTHORED)
	}, 60_000)

	it('AC-7: on a browser that synced BEFORE 99.3 (profile already reconciled at mount), the reconcile still waits for the initial pull, so the server plan wins', async () => {
		const id = PLAN_ACCOUNTS.reconciled
		freshDevice()
		signIn(id)
		await waitForInitialPull(id)
		const profileId = (await serverDefaultProfile(id)) as string
		await putServerPlan(id, AUTHORED)
		const opsBefore = planOpsFor(id).length

		freshDevice()
		// The profile gate is open from the first render here, so only the explicit wait
		// for the initial pull keeps the reconcile after it.
		useProfileStore.setState({
			profiles: [
				{ id: profileId, userId: id, name: 'Main Profile', isDefault: true, currency: 'NONE' },
			],
			activeProfileId: profileId,
		})
		planStore.useRetirementPlannerStore.setState({
			plan: { ...planStore.RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '33', model: 'perpetual' },
			ownerUserId: id,
		})
		signIn(id)
		await rtl.waitFor(() => expect(plan().plan).toEqual(AUTHORED), { timeout: 15_000 })
		await waitForInitialPull(id)
		expect(plan().plan).toEqual(AUTHORED)
		expect(planOpsFor(id)).toHaveLength(opsBefore)
	}, 60_000)

	it('AC-7: the first device of an account with NO server plan uploads its local plan once', async () => {
		const id = PLAN_ACCOUNTS.firstDevice
		freshDevice()
		planStore.useRetirementPlannerStore.setState({ plan: { ...AUTHORED } })
		signIn(id)
		await rtl.waitFor(async () => expect(await serverPlan(id)).toEqual(AUTHORED), {
			timeout: 15_000,
		})
		await waitForInitialPull(id)
		expect(planOpsFor(id)).toEqual([`create retirementPlan ${id}`])
		expect(plan().plan).toEqual(AUTHORED)
	}, 60_000)

	it('review decision: plan edits made while FREE are kept and pushed when the owner is paid again', async () => {
		const id = PLAN_ACCOUNTS.freePeriod
		freshDevice()
		planStore.useRetirementPlannerStore.setState({ plan: { ...AUTHORED } })
		signIn(id)
		await rtl.waitFor(async () => expect(await serverPlan(id)).toEqual(AUTHORED), {
			timeout: 15_000,
		})
		await waitForInitialPull(id)

		rtl.cleanup()
		resetSyncStore()
		plan().setCurrentAgeInput('57')
		expect(plan().localPlanDiverged).toBe(true)

		await loadDevice(snapshotDevice())
		signIn(id)
		await rtl.waitFor(async () => expect((await serverPlan(id))?.currentAgeInput).toBe('57'), {
			timeout: 15_000,
		})
		await waitForInitialPull(id)
		expect(plan().plan.currentAgeInput).toBe('57')
		expect(plan().localPlanDiverged).toBe(false)
		expect(planOpsFor(id)).toEqual([`create retirementPlan ${id}`, `update retirementPlan ${id}`])
	}, 90_000)

	it.each([
		['an AUTHORED income (the locale re-expression effect)', 'authored'],
		['a never-authored income seeded from the income rows (the seed effect)', 'seeded'],
	] as const)(
		'AC-3: two devices with DIFFERENT currencies on /retirement, %s, settle to ZERO plan ops over 3 pull cycles each, with the same desired-income magnitude',
		async (_, kind) => {
			const id = kind === 'authored' ? PLAN_ACCOUNTS.currencies : PLAN_ACCOUNTS.currenciesSeed
			const { RetirementAccumulationPlanner } = await import(
				'@/components/RetirementAccumulationPlanner'
			)
			const { useCurrencyStore } = await import('@/stores/currencyStore')
			const { parseCurrencyToCents } = await import('@/lib/retirement-parsers')
			const planner = <RetirementAccumulationPlanner />
			const start: Plan =
				kind === 'authored'
					? { ...AUTHORED }
					: {
							...AUTHORED,
							desiredIncomeInput: '',
							desiredIncomeTouched: false,
							desiredIncomeLocale: '',
						}

			freshDevice()
			useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
			if (kind === 'seeded') {
				useIncomeStore
					.getState()
					.addIncomeSource({ name: 'Salary', amount: 600_000, frequency: 'monthly' })
			}
			planStore.useRetirementPlannerStore.setState({ plan: start })
			signIn(id, planner)
			await rtl.waitFor(async () => expect(await serverPlan(id)).toBeDefined(), {
				timeout: 15_000,
			})
			await waitForInitialPull(id)
			planPush.flushPendingPlanPush()
			let deviceA = snapshotDevice()

			freshDevice()
			useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
			signIn(id, planner)
			await rtl.waitFor(() => expect(plan().plan.currentAgeInput).toBe(AUTHORED.currentAgeInput), {
				timeout: 15_000,
			})
			if (kind === 'seeded') {
				await rtl.waitFor(() => expect(useIncomeStore.getState().incomeSources).toHaveLength(1), {
					timeout: 15_000,
				})
			}
			await waitForInitialPull(id)
			planPush.flushPendingPlanPush()
			let deviceB = snapshotDevice()

			const settled = planOpsFor(id).length
			expect(settled).toBe(1)
			const magnitudes: number[] = []
			for (let cycle = 1; cycle <= 3; cycle += 1) {
				for (const device of ['A', 'B'] as const) {
					await loadDevice(device === 'A' ? deviceA : deviceB)
					signIn(id, planner)
					await waitForInitialPull(id)
					planPush.flushPendingPlanPush()
					expect(planOpsFor(id), `cycle ${cycle}, device ${device}`).toHaveLength(settled)
					expect(queued(id).filter((op) => op.includes('retirementPlan'))).toEqual([])
					const { desiredIncomeInput, desiredIncomeLocale, desiredIncomeTouched } = plan().plan
					expect(desiredIncomeTouched).toBe(kind === 'authored')
					magnitudes.push(parseCurrencyToCents(desiredIncomeInput, desiredIncomeLocale))
					if (device === 'A') {
						deviceA = snapshotDevice()
					} else {
						deviceB = snapshotDevice()
						expect(desiredIncomeLocale).not.toBe('en-US')
					}
				}
			}
			expect(new Set(magnitudes).size).toBe(1)
			expect(magnitudes[0]).toBeGreaterThan(0)
			if (kind === 'authored') {
				expect(magnitudes[0]).toBe(5_500_000)
			}
		},
		180_000
	)

	it('AC-9: Clear local data resets the local plan and pushes nothing; the server copy comes back in the same session and on the next load', async () => {
		const id = PLAN_ACCOUNTS.clearLocal
		const { purgeLocalFinancialData } = await import('@/lib/account/purge-local-financial-data')
		freshDevice()
		planStore.useRetirementPlannerStore.setState({ plan: { ...AUTHORED } })
		signIn(id)
		await rtl.waitFor(async () => expect(await serverPlan(id)).toEqual(AUTHORED), {
			timeout: 15_000,
		})
		await waitForInitialPull(id)

		await purgeLocalFinancialData(id)
		await rtl.waitFor(() => expect(plan().plan).toEqual(AUTHORED), { timeout: 15_000 })
		planPush.flushPendingPlanPush()
		await sleep(2500)
		expect(planOpsFor(id)).toEqual([`create retirementPlan ${id}`])
		expect(await serverPlan(id)).toEqual(AUTHORED)

		await purgeLocalFinancialData(id)
		await loadDevice(snapshotDevice())
		expect(plan().plan).toEqual(planStore.RETIREMENT_PLAN_DEFAULTS)
		signIn(id)
		await rtl.waitFor(() => expect(plan().plan).toEqual(AUTHORED), { timeout: 15_000 })
		await waitForInitialPull(id)
		expect(planOpsFor(id)).toEqual([`create retirementPlan ${id}`])
	}, 90_000)

	it('AC-8: a returning owner whose PARKED plan is stale ends on the server copy after the initial pull', async () => {
		const id = PLAN_ACCOUNTS.returningOwner
		const other = PLAN_ACCOUNTS.parkedOther
		await putServerPlan(id, AUTHORED)
		freshDevice()
		localStorage.setItem(
			`${planStore.RETIREMENT_PLANNER_PARKED_KEY_PREFIX}${id}`,
			JSON.stringify({ ...planStore.RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '30' })
		)
		planStore.useRetirementPlannerStore.setState({
			plan: { ...AUTHORED, currentAgeInput: '61' },
			ownerUserId: other,
		})
		signIn(id)
		expect(plan().plan.currentAgeInput).toBe('30')
		expect(
			localStorage.getItem(`${planStore.RETIREMENT_PLANNER_PARKED_KEY_PREFIX}${other}`)
		).toContain('"61"')
		await rtl.waitFor(() => expect(plan().plan).toEqual(AUTHORED), { timeout: 15_000 })
		await waitForInitialPull(id)
		expect(planOpsFor(id)).toEqual([])
		expect(planOpsFor(other)).toEqual([])
	}, 60_000)
})
