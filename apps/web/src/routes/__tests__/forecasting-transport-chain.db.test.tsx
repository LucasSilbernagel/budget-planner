// @vitest-environment node
// Queries go through the render result, not `screen`: RTL binds `screen` to the document
// that existed when it was first imported, i.e. none.

import type { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type React from 'react'
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

vi.mock('@/lib/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/server/api/auth/paddle', () => ({ getCurrentUserSession: vi.fn() }))

import { forecastingProfiles, userProfiles, users } from '@budget-planner/db'
import { JSDOM } from 'jsdom'
import { FORECAST_SAVE_VERSION } from '@/lib/forecasting/forecast-version'
import { GET as meGET } from '@/routes/api/auth/me'
import {
	DELETE as forecastsDELETE,
	GET as forecastsGET,
	POST as forecastsPOST,
	PUT as forecastsPUT,
} from '@/routes/api/forecasts'
import { GET as profilesGET } from '@/routes/api/profiles'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { migratedPglite } from '../../test/pglite-migrated'

const USER = '11111111-1111-4111-8111-111111111111'
const PROFILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let pg: PGlite
let db: ReturnType<typeof drizzle>
let rtl: typeof import('@testing-library/react')
let renderWithRouter: typeof import('@/test/utils').renderWithRouter
let ForecastingPage: () => React.ReactElement

const sessionMock = getCurrentUserSession as unknown as ReturnType<typeof vi.fn>

const served: string[] = []

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = new URL(String(input), 'https://app.test')
	const method = (init?.method ?? 'GET').toUpperCase()
	const headers = new Headers(init?.headers)
	if (typeof init?.body === 'string') {
		// undici sets no content-length on a constructed Request.
		headers.set('content-length', String(new TextEncoder().encode(init.body).byteLength))
	}
	const request = new Request(url, { ...init, method, headers })
	const handler =
		url.pathname === '/api/auth/me' && method === 'GET'
			? meGET
			: url.pathname === '/api/profiles' && method === 'GET'
				? profilesGET
				: url.pathname === '/api/forecasts' && method === 'GET'
					? forecastsGET
					: url.pathname === '/api/forecasts' && method === 'POST'
						? forecastsPOST
						: url.pathname === '/api/forecasts' && method === 'DELETE'
							? forecastsDELETE
							: url.pathname === '/api/forecasts' && method === 'PUT'
								? forecastsPUT
								: null
	if (!handler) throw new Error(`unrouted fetch ${method} ${url}`)
	const response = await handler({ request })
	served.push(`${method} ${url.pathname}${url.search} → ${response.status}`)
	return response
}

function signedIn(subscriptionStatus: string) {
	sessionMock.mockResolvedValue({
		success: true,
		data: {
			userId: USER,
			email: 'chain@example.test',
			paddleId: 'ctm_chain',
			subscriptionStatus,
			currency: 'NONE',
			billingInterval: null,
			isAuthenticated: true,
		},
	})
}

async function storedForecasts() {
	return db
		.select({
			userId: forecastingProfiles.userId,
			profileId: forecastingProfiles.profileId,
			name: forecastingProfiles.name,
			scenarioData: forecastingProfiles.scenarioData,
		})
		.from(forecastingProfiles)
}

async function storedRows() {
	return db
		.select({
			id: forecastingProfiles.id,
			profileId: forecastingProfiles.profileId,
			name: forecastingProfiles.name,
			scenarioData: forecastingProfiles.scenarioData,
			createdAt: forecastingProfiles.createdAt,
			updatedAt: forecastingProfiles.updatedAt,
		})
		.from(forecastingProfiles)
		.orderBy(forecastingProfiles.id)
}

type View = ReturnType<typeof import('@/test/utils').renderWithRouter>

async function pressSave(view: View) {
	const save = await view.findByRole('button', { name: 'Save Forecast' }, { timeout: 5000 })
	await rtl.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false), {
		timeout: 5000,
	})
	rtl.fireEvent.click(save)
}

// react-dom loaded before `window` was stubbed, so it reads text input values on keyup via the
// old-IE polyfill (focusin + attachEvent); a bare fireEvent.change is ignored.
function typeInto(field: HTMLElement, value: string) {
	const node = field as HTMLElement & { attachEvent?: () => void; detachEvent?: () => void }
	node.attachEvent ??= () => {}
	node.detachEvent ??= () => {}
	rtl.fireEvent.focusIn(node)
	rtl.fireEvent.change(node, { target: { value } })
	rtl.fireEvent.keyUp(node)
	rtl.fireEvent.focusOut(node)
}

async function setIncomeGrowth(view: View, percent: string) {
	const field = await view.findByLabelText('Income Growth Rate')
	typeInto(field, percent)
	await new Promise((resolve) => setTimeout(resolve, 800))
}

const DUPLICATE = 'A forecast with this name already exists for this profile.'
const GONE =
	'This forecast was deleted, so it was not saved. Save again to keep it as a new forecast.'
const OPENING = [
	'GET /api/auth/me → 200',
	'GET /api/profiles → 200',
	`GET /api/forecasts?profileId=${PROFILE} → 200`,
]
const LIST = `GET /api/forecasts?profileId=${PROFILE} → 200`

async function saveThenLoad() {
	const view = renderWithRouter(<ForecastingPage />)
	await pressSave(view)
	await view.findByTestId('save-success', {}, { timeout: 5000 })
	const [first] = await storedRows()
	if (!first) throw new Error('the first save stored no row')
	rtl.fireEvent.click(
		await view.findByRole('button', { name: 'Edit My Financial Forecast' }, { timeout: 5000 })
	)
	return { view, first }
}

function setName(view: View, name: string) {
	const field = view.getByLabelText('Scenario Name') as HTMLInputElement
	typeInto(field, name)
	expect(field.value).toBe(name)
}

const savedScenario = (row: { scenarioData: string } | undefined) =>
	JSON.parse(String(row?.scenarioData)) as {
		scenario: { name: string; incomeGrowthRate: number }
		result: { summary: { endingNetWorth: number } }
	}

beforeAll(async () => {
	pg = await migratedPglite()
	db = drizzle(pg)
	holder.db = db
	await db.insert(users).values({
		id: USER,
		email: 'chain@example.test',
		paddleId: 'ctm_chain',
		subscriptionStatus: 'active',
	})
	vi.stubGlobal('fetch', routeFetch)

	const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
	for (const key of [
		'window',
		'document',
		'HTMLElement',
		'HTMLInputElement',
		'Node',
		'navigator',
		'MutationObserver',
		'localStorage',
		'KeyboardEvent',
		'MouseEvent',
		'Event',
		'CustomEvent',
		'Element',
		'SVGElement',
		'HTMLButtonElement',
		'location',
		'history',
		'getComputedStyle',
		'requestAnimationFrame',
		'cancelAnimationFrame',
	]) {
		vi.stubGlobal(
			key,
			key === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]
		)
	}
	// TanStack Router reads `self` (the window) when it builds its history.
	vi.stubGlobal('self', dom.window)
	const { createJSONStorage } = await import('zustand/middleware')
	const persisted = await Promise.all([
		import('@/stores/incomeStore').then((m) => m.useIncomeStore),
		import('@/stores/expenseStore').then((m) => m.useExpenseStore),
		import('@/stores/savingsStore').then((m) => m.useSavingsStore),
		import('@/stores/balanceStore').then((m) => m.useBalanceStore),
		import('@/stores/categoryStore').then((m) => m.useCategoryStore),
		import('@/stores/currencyStore').then((m) => m.useCurrencyStore),
		import('@/stores/profileStore').then((m) => m.useProfileStore),
		// vitest.setup.ts writes these before every test; unbound, their persist write hits undefined.setItem.
		import('@/stores/tableSortStore').then((m) => m.useTableSortStore),
		import('@/stores/retirementPlannerStore').then((m) => m.useRetirementPlannerStore),
	])
	for (const store of persisted) {
		const api = (store as { persist?: { setOptions: (o: Record<string, unknown>) => void } })
			.persist
		api?.setOptions({ storage: createJSONStorage(() => dom.window.localStorage) })
	}
	const { useIncomeStore } = await import('@/stores/incomeStore')
	const { useProfileStore } = await import('@/stores/profileStore')
	useProfileStore.setState({ activeProfileId: PROFILE })
	useIncomeStore.setState({
		incomeSources: [
			{
				id: 'inc-1',
				profileId: PROFILE,
				userId: 0,
				name: 'Salary',
				amount: 500_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: '2026-09-29T00:00:00.000Z',
				updatedAt: '2026-09-29T00:00:00.000Z',
			},
		] as never,
	})

	rtl = await import('@testing-library/react')
	;({ renderWithRouter } = await import('@/test/utils'))
	const { Route } = await import('../forecasting')
	ForecastingPage = Route.options.component as () => React.ReactElement
}, 60_000)

afterAll(async () => {
	// Drain React's queued Scheduler work while `window` still exists: a late passive flush reads
	// window.event. The Scheduler re-queues itself, so drain several immediate + timer turns.
	for (let turn = 0; turn < 5; turn++) {
		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
	vi.unstubAllGlobals()
	await pg?.close()
})

beforeEach(async () => {
	served.length = 0
	signedIn('active')
	await db.delete(forecastingProfiles)
	await db.delete(userProfiles)
	await db.insert(userProfiles).values({ id: PROFILE, userId: USER, name: 'Main', isDefault: true })
})

afterEach(() => {
	rtl.cleanup()
})

describe('the forecasting page against the real routes', () => {
	it('saves a forecast into the database, lists it, and deletes it', async () => {
		const view = renderWithRouter(<ForecastingPage />)

		const save = await view.findByRole('button', { name: 'Save Forecast' }, { timeout: 5000 })
		await rtl.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false), {
			timeout: 5000,
		})
		rtl.fireEvent.click(save)

		expect(await view.findByTestId('save-success', {}, { timeout: 5000 })).toBeTruthy()

		const [row, ...rest] = await storedForecasts()
		expect(rest).toEqual([])
		expect(row).toMatchObject({ userId: USER, profileId: PROFILE, name: 'My Financial Forecast' })
		const saved = JSON.parse(String(row?.scenarioData)) as Record<string, unknown>
		expect(Object.keys(saved).sort()).toEqual(['inputs', 'result', 'scenario'])

		const deleteButton = await view.findByRole('button', {
			name: 'Delete My Financial Forecast',
		})
		rtl.fireEvent.click(deleteButton)
		rtl.fireEvent.click(
			rtl.within(await view.findByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		)
		await rtl.waitFor(() =>
			expect(view.queryByRole('button', { name: 'Delete My Financial Forecast' })).toBeNull()
		)
		expect(await storedForecasts()).toEqual([])

		expect(served).toEqual([
			'GET /api/auth/me → 200',
			'GET /api/profiles → 200',
			`GET /api/forecasts?profileId=${PROFILE} → 200`,
			'POST /api/forecasts → 200',
			`GET /api/forecasts?profileId=${PROFILE} → 200`,
			expect.stringMatching(/^DELETE \/api\/forecasts\?id=\d+ → 200$/),
			`GET /api/forecasts?profileId=${PROFILE} → 200`,
		])
	})

	it('an account with no profile gets the "create a profile" notice from a real empty list', async () => {
		await db.delete(userProfiles)
		const view = renderWithRouter(<ForecastingPage />)

		const notice = await view.findByTestId('save-blocked-notice', {}, { timeout: 5000 })
		expect(notice.textContent).toContain(
			'Saving a forecast needs a financial profile, and this account does not have one yet.'
		)
	})

	it('an unresolvable session fails CLOSED at the access check, and asks for no data', async () => {
		sessionMock.mockResolvedValue({ success: false, error: 'db down' })
		const view = renderWithRouter(<ForecastingPage />)

		expect(
			await view.findByRole('heading', { name: /go premium/i }, { timeout: 5000 })
		).toBeTruthy()
		expect(served).toEqual(['GET /api/auth/me → 503'])
	})

	it('a free account gets the upgrade prompt from the real access check', async () => {
		signedIn('free')
		const view = renderWithRouter(<ForecastingPage />)

		expect(
			await view.findByRole('heading', { name: /go premium/i }, { timeout: 5000 })
		).toBeTruthy()
		expect(served).toEqual(['GET /api/auth/me → 200'])
	})
})

describe('editing a saved forecast saves over it', () => {
	it('Load → change → Save updates the SAME row with a PUT, not a POST that 409s', async () => {
		const view = renderWithRouter(<ForecastingPage />)
		await pressSave(view)
		expect(await view.findByTestId('save-success', {}, { timeout: 5000 })).toBeTruthy()
		const [first, ...others] = await storedRows()
		expect(others).toEqual([])
		const listRowBefore = (
			await view.findByRole('button', { name: 'Edit My Financial Forecast' })
		).closest('tr')?.textContent

		rtl.fireEvent.click(view.getByRole('button', { name: 'Edit My Financial Forecast' }))
		await setIncomeGrowth(view, '5')
		await pressSave(view)

		await rtl.waitFor(() => expect(served.length).toBeGreaterThanOrEqual(6), { timeout: 5000 })
		expect(served[5]).toBe(`PUT /api/forecasts?id=${first?.id} → 200`)
		const success = await view.findByTestId('save-success', {}, { timeout: 5000 })
		expect(success.textContent).toBe('Saved "My Financial Forecast" to My Forecasts.')
		expect(view.queryByTestId('save-outcome')).toBeNull()

		const [row, ...rest] = await storedRows()
		expect(rest, 'still exactly one row').toEqual([])
		expect(row?.id).toBe(first?.id)
		expect(row?.profileId).toBe(PROFILE)
		expect(row?.createdAt.getTime()).toBe(first?.createdAt.getTime())
		expect(Number(row?.updatedAt.getTime())).toBeGreaterThan(Number(first?.updatedAt.getTime()))
		const before = savedScenario(first)
		const after = savedScenario(row)
		expect(before.scenario.incomeGrowthRate).toBe(0)
		expect(after.scenario.incomeGrowthRate).toBeCloseTo(0.05, 12)
		expect(after.result.summary.endingNetWorth).not.toBe(before.result.summary.endingNetWorth)

		const loads = await view.findAllByRole('button', { name: 'Edit My Financial Forecast' })
		expect(loads).toHaveLength(1)
		await rtl.waitFor(() => expect(loads[0]?.closest('tr')?.textContent).not.toBe(listRowBefore))

		expect(served).toEqual([
			'GET /api/auth/me → 200',
			'GET /api/profiles → 200',
			`GET /api/forecasts?profileId=${PROFILE} → 200`,
			'POST /api/forecasts → 200',
			`GET /api/forecasts?profileId=${PROFILE} → 200`,
			`PUT /api/forecasts?id=${first?.id} → 200`,
			`GET /api/forecasts?profileId=${PROFILE} → 200`,
		])
	}, 20_000)

	it('re-saving a forecast this builder just CREATED updates it too', async () => {
		const view = renderWithRouter(<ForecastingPage />)
		await pressSave(view)
		await view.findByTestId('save-success', {}, { timeout: 5000 })
		const [first] = await storedRows()

		rtl.fireEvent.click(view.getByRole('tab', { name: /Scenario Builder/ }))
		await setIncomeGrowth(view, '3')
		await pressSave(view)
		expect(await view.findByTestId('save-success', {}, { timeout: 5000 })).toBeTruthy()

		const [row, ...rest] = await storedRows()
		expect(rest).toEqual([])
		expect(row?.id).toBe(first?.id)
		expect(savedScenario(row).scenario.incomeGrowthRate).toBeCloseTo(0.03, 12)
		expect(served).toEqual([
			...OPENING,
			'POST /api/forecasts → 200',
			LIST,
			`PUT /api/forecasts?id=${first?.id} → 200`,
			LIST,
		])
	}, 20_000)

	it('a NEW forecast under a taken name still gets the 409 text beside Save, and writes nothing (AC-4a)', async () => {
		await db.insert(forecastingProfiles).values({
			userId: USER,
			profileId: PROFILE,
			name: 'My Financial Forecast',
			scenarioData: '{}',
		})
		const [seeded] = await storedRows()
		const view = renderWithRouter(<ForecastingPage />)
		await pressSave(view)

		const outcome = await view.findByTestId('save-outcome', {}, { timeout: 5000 })
		expect(outcome.textContent).toBe(DUPLICATE)
		expect(view.queryByTestId('save-success')).toBeNull()
		expect(await storedRows()).toEqual([seeded])
		expect(served).toEqual([...OPENING, 'POST /api/forecasts → 409'])
	}, 20_000)

	it('a loaded forecast saved under a NEW name is a new forecast; the original is kept', async () => {
		const { view, first } = await saveThenLoad()
		setName(view, 'Plan B')
		await setIncomeGrowth(view, '4')
		await pressSave(view)
		const success = await view.findByTestId('save-success', {}, { timeout: 5000 })
		expect(success.textContent).toBe('Saved "Plan B" to My Forecasts.')

		const stored = await storedRows()
		expect(stored.map((r) => [r.id, r.name])).toEqual([
			[first.id, 'My Financial Forecast'],
			[expect.any(Number), 'Plan B'],
		])
		expect(stored[0]?.scenarioData).toBe(first.scenarioData)
		expect(served).toEqual([
			...OPENING,
			'POST /api/forecasts → 200',
			LIST,
			'POST /api/forecasts → 200',
			LIST,
		])
	}, 20_000)

	it('a trailing space on the loaded name is still the same forecast: PUT, one row (M4)', async () => {
		const { view, first } = await saveThenLoad()
		setName(view, 'My Financial Forecast ')
		await setIncomeGrowth(view, '2')
		await pressSave(view)
		expect(await view.findByTestId('save-success', {}, { timeout: 5000 })).toBeTruthy()

		const [row, ...rest] = await storedRows()
		expect(rest).toEqual([])
		expect(row?.id).toBe(first.id)
		expect(row?.name).toBe('My Financial Forecast')
		expect(served).toEqual([
			...OPENING,
			'POST /api/forecasts → 200',
			LIST,
			`PUT /api/forecasts?id=${first.id} → 200`,
			LIST,
		])
	}, 20_000)

	it('deleting the loaded forecast in My Forecasts drops it as the target: the next Save creates', async () => {
		const { view, first } = await saveThenLoad()
		rtl.fireEvent.click(view.getByRole('tab', { name: /My Forecasts/ }))
		rtl.fireEvent.click(await view.findByRole('button', { name: 'Delete My Financial Forecast' }))
		rtl.fireEvent.click(
			rtl.within(await view.findByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		)
		await rtl.waitFor(() =>
			expect(view.queryByRole('button', { name: 'Delete My Financial Forecast' })).toBeNull()
		)
		expect(await storedRows()).toEqual([])

		rtl.fireEvent.click(view.getByRole('tab', { name: /Scenario Builder/ }))
		await pressSave(view)
		expect(await view.findByTestId('save-success', {}, { timeout: 5000 })).toBeTruthy()

		const [row, ...rest] = await storedRows()
		expect(rest).toEqual([])
		expect(row?.id).not.toBe(first.id)
		expect(served).toEqual([
			...OPENING,
			'POST /api/forecasts → 200',
			LIST,
			`DELETE /api/forecasts?id=${first.id} → 200`,
			LIST,
			'POST /api/forecasts → 200',
			LIST,
		])
	}, 20_000)

	it('a BULK delete that includes the loaded forecast drops it as the target too', async () => {
		const { view, first } = await saveThenLoad()
		rtl.fireEvent.click(view.getByRole('tab', { name: /My Forecasts/ }))
		rtl.fireEvent.click(await view.findByRole('checkbox', { name: 'Select all' }))
		rtl.fireEvent.click(view.getByRole('button', { name: 'Delete Selected' }))
		rtl.fireEvent.click(
			rtl.within(await view.findByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		)
		await rtl.waitFor(() =>
			expect(view.queryByRole('button', { name: 'Delete My Financial Forecast' })).toBeNull()
		)
		expect(await storedRows()).toEqual([])

		rtl.fireEvent.click(view.getByRole('tab', { name: /Scenario Builder/ }))
		await pressSave(view)
		expect(await view.findByTestId('save-success', {}, { timeout: 5000 })).toBeTruthy()

		const [row, ...rest] = await storedRows()
		expect(rest).toEqual([])
		expect(row?.id).not.toBe(first.id)
		expect(served).toEqual([
			...OPENING,
			'POST /api/forecasts → 200',
			LIST,
			`DELETE /api/forecasts?id=${first.id} → 200`,
			LIST,
			'POST /api/forecasts → 200',
			LIST,
		])
	}, 20_000)

	it('a PUT that answers 404 (deleted on another device) says so, and the next Save creates it', async () => {
		const { view, first } = await saveThenLoad()
		await db.delete(forecastingProfiles)
		await pressSave(view)

		const outcome = await view.findByTestId('save-outcome', {}, { timeout: 5000 })
		expect(outcome.textContent).toBe(GONE)
		expect(await storedRows()).toEqual([])
		rtl.fireEvent.click(view.getByRole('tab', { name: /My Forecasts/ }))
		// Positive control: `name` is a full-string match, so a renamed button would also be absent.
		expect(
			await view.findByRole('heading', { name: 'No Saved Forecasts' }, { timeout: 5000 })
		).toBeTruthy()
		await rtl.waitFor(() =>
			expect(view.queryByRole('button', { name: 'Edit My Financial Forecast' })).toBeNull()
		)
		rtl.fireEvent.click(view.getByRole('tab', { name: /Scenario Builder/ }))

		await pressSave(view)
		expect(await view.findByTestId('save-success', {}, { timeout: 5000 })).toBeTruthy()
		const [row, ...rest] = await storedRows()
		expect(rest).toEqual([])
		expect(row?.name).toBe('My Financial Forecast')
		expect(served).toEqual([
			...OPENING,
			'POST /api/forecasts → 200',
			LIST,
			`PUT /api/forecasts?id=${first.id} → 404`,
			LIST,
			'POST /api/forecasts → 200',
			LIST,
		])
	}, 20_000)
})

describe('savings rows round-trip through the real routes', () => {
	const ISO = '2026-10-05T00:00:00.000Z'

	async function seedSavingsRows() {
		const { useSavingsStore } = await import('@/stores/savingsStore')
		useSavingsStore.setState({
			savingsGoals: [
				{
					id: 'g-1',
					profileId: PROFILE,
					name: 'Emergency fund',
					targetAmount: null,
					currentBalance: 100_000,
					allocationMode: 'manual',
					monthlyAllocation: 20_000,
					sortOrder: 0,
					createdAt: ISO,
					updatedAt: ISO,
				},
				{
					id: 'g-2',
					profileId: PROFILE,
					name: 'House fund',
					targetAmount: 5_000_000,
					currentBalance: 250_001,
					allocationMode: 'manual',
					monthlyAllocation: 5,
					sortOrder: 1,
					createdAt: ISO,
					updatedAt: ISO,
				},
			] as never,
		})
		return useSavingsStore
	}

	afterEach(async () => {
		const { useSavingsStore } = await import('@/stores/savingsStore')
		useSavingsStore.setState({ savingsGoals: [] })
	})

	it('POST and PUT store the current version (FORECAST_SAVE_VERSION: 6) with the rows and their sum, and Load brings the rows back', async () => {
		await seedSavingsRows()
		const view = renderWithRouter(<ForecastingPage />)
		await pressSave(view)
		await view.findByTestId('save-success', {}, { timeout: 5000 })

		const versioned = () =>
			db
				.select({
					version: forecastingProfiles.version,
					scenarioData: forecastingProfiles.scenarioData,
				})
				.from(forecastingProfiles)
		const [created, ...more] = await versioned()
		expect(more).toEqual([])
		expect(created?.version).toBe(FORECAST_SAVE_VERSION)
		const inputs = (
			JSON.parse(String(created?.scenarioData)) as { inputs: Record<string, unknown> }
		).inputs
		expect(inputs.savingsAccounts).toEqual([
			{ name: 'Emergency fund', balance: 100_000, monthlyContribution: 20_000 },
			{ name: 'House fund', balance: 250_001, monthlyContribution: 5 },
		])
		// Kept for an older cached client that reads only the total.
		expect(inputs.savings).toBe(350_001)

		rtl.fireEvent.click(
			await view.findByRole('button', { name: 'Edit My Financial Forecast' }, { timeout: 5000 })
		)
		const value = (label: string) => (view.getByLabelText(label) as HTMLInputElement).value
		await rtl.waitFor(() => expect(value('Balance for Emergency fund')).toBe('1,000.00'))
		expect(
			view.getAllByLabelText(/^Account Name, row \d+$/).map((el) => (el as HTMLInputElement).value)
		).toEqual(['Emergency fund', 'House fund'])
		expect(value('Monthly Contribution for Emergency fund')).toBe('200.00')
		expect(value('Balance for House fund')).toBe('2,500.01')
		expect(value('Monthly Contribution for House fund')).toBe('0.05')

		await setIncomeGrowth(view, '1')
		await pressSave(view)
		await rtl.waitFor(() => expect(served.some((line) => line.startsWith('PUT '))).toBe(true), {
			timeout: 5000,
		})
		const [updated] = await versioned()
		expect(updated?.version).toBe(FORECAST_SAVE_VERSION)
		expect(
			(JSON.parse(String(updated?.scenarioData)) as { inputs: { savingsAccounts: unknown[] } })
				.inputs.savingsAccounts
		).toHaveLength(2)
	}, 20_000)
})

describe('investment/debt rows round-trip through the real routes', () => {
	const ISO = '2026-10-05T00:00:00.000Z'

	afterEach(async () => {
		const { useBalanceStore } = await import('@/stores/balanceStore')
		const { useExpenseStore } = await import('@/stores/expenseStore')
		useBalanceStore.setState({ entries: [] })
		useExpenseStore.setState({ expenses: [] })
	})

	it('POST stores the current version with the rows, their rates, the debt flag and label, and the investment sum; Load brings every field back; PUT keeps a changed rate and flag', async () => {
		const { useBalanceStore } = await import('@/stores/balanceStore')
		const { useExpenseStore } = await import('@/stores/expenseStore')
		useExpenseStore.setState({
			expenses: [
				{
					id: 'exp-car',
					profileId: PROFILE,
					userId: 0,
					name: 'Car payment',
					amount: 30_000,
					frequency: 'monthly',
					categoryId: null,
					createdAt: ISO,
					updatedAt: ISO,
				},
			],
		})
		useBalanceStore.setState({
			entries: [
				{
					id: 'b-1',
					profileId: PROFILE,
					type: 'investment',
					name: 'Pension',
					currentBalance: 1_000_001,
					monthlyContribution: 25_000,
					frequency: 'biweekly',
					contributionRecordedAsExpense: true,
					sortOrder: 0,
					createdAt: ISO,
					updatedAt: ISO,
				},
				{
					id: 'b-2',
					profileId: PROFILE,
					type: 'debt',
					name: 'Car loan',
					currentBalance: -500_000,
					monthlyContribution: 0,
					frequency: 'monthly',
					paymentExpenseId: 'exp-car',
					sortOrder: 1,
					createdAt: ISO,
					updatedAt: ISO,
				},
				{
					id: 'b-3',
					profileId: PROFILE,
					type: 'investment',
					name: 'ISA',
					currentBalance: 200_000,
					monthlyContribution: 120_000,
					frequency: 'annually',
					sortOrder: 2,
					createdAt: ISO,
					updatedAt: ISO,
				},
			] as never,
		})
		const view = renderWithRouter(<ForecastingPage />)
		typeInto(await view.findByLabelText('Annual return for Pension'), '0')
		typeInto(view.getByLabelText('Annual return for ISA'), '5.5')
		await new Promise((resolve) => setTimeout(resolve, 800))
		await pressSave(view)
		await view.findByTestId('save-success', {}, { timeout: 5000 })

		const stored = () =>
			db
				.select({
					version: forecastingProfiles.version,
					scenarioData: forecastingProfiles.scenarioData,
				})
				.from(forecastingProfiles)
		const [created, ...more] = await stored()
		expect(more).toEqual([])
		expect(created?.version).toBe(FORECAST_SAVE_VERSION)
		const inputs = (
			JSON.parse(String(created?.scenarioData)) as { inputs: Record<string, unknown> }
		).inputs
		expect(inputs.balanceAccounts).toEqual([
			{
				name: 'Pension',
				type: 'investment',
				balance: 1_000_001,
				contribution: 25_000,
				frequency: 'biweekly',
				contributionRecordedAsExpense: true,
				annualReturn: 0,
			},
			// The stored negative debt seeds as its magnitude. No rate on a debt.
			{
				name: 'Car loan',
				type: 'debt',
				balance: 500_000,
				contribution: 30_000,
				frequency: 'monthly',
				contributionRecordedAsExpense: false,
				paidByExpenseName: 'Car payment',
			},
			{
				name: 'ISA',
				type: 'investment',
				balance: 200_000,
				contribution: 120_000,
				frequency: 'annually',
				contributionRecordedAsExpense: false,
				annualReturn: 0.055,
			},
		])
		// Kept for an older cached client: the investment rows' sum, debts excluded.
		expect(inputs.investments).toBe(1_200_001)

		// Change the live store so a reload that read it would show different rows.
		useBalanceStore.setState({ entries: [] })
		rtl.fireEvent.click(
			await view.findByRole('button', { name: 'Edit My Financial Forecast' }, { timeout: 5000 })
		)
		const value = (label: string) => (view.getByLabelText(label) as HTMLInputElement).value
		await rtl.waitFor(() => expect(value('Balance for Pension')).toBe('10,000.01'))
		const section = view.getByRole('region', { name: 'Investments & Debts' })
		expect(
			rtl
				.within(section)
				.getAllByLabelText(/^Balance Name, row \d+$/)
				.map((el) => (el as HTMLInputElement).value)
		).toEqual(['Pension', 'Car loan', 'ISA'])
		expect(value('Type for Pension')).toBe('investment')
		expect(value('Contribution for Pension')).toBe('250.00')
		expect(value('Frequency for Pension')).toBe('biweekly')
		expect(
			view.getByLabelText('Not taken from the money left over, for Pension') as HTMLInputElement
		).toBeChecked()
		expect(value('Type for Car loan')).toBe('debt')
		expect(value('Balance for Car loan')).toBe('5,000.00')
		expect(value('Contribution for Car loan')).toBe('300.00')
		expect(value('Frequency for Car loan')).toBe('monthly')
		expect(value('Frequency for ISA')).toBe('annually')
		expect(
			view.getByLabelText('Not taken from the money left over, for ISA') as HTMLInputElement
		).not.toBeChecked()
		expect(value('Annual return for Pension')).toBe('0.00%')
		expect(value('Annual return for ISA')).toBe('5.50%')
		expect(view.queryByLabelText('Annual return for Car loan')).toBeNull()
		expect(rtl.within(section).getByText('from Expenses: Car payment')).toBeInTheDocument()
		expect(view.queryByLabelText('Payment already in Expenses, for Car loan')).toBeNull()

		typeInto(view.getByLabelText('Annual return for ISA'), '-2.5')
		await new Promise((resolve) => setTimeout(resolve, 800))
		await pressSave(view)
		await rtl.waitFor(() => expect(served.some((line) => line.startsWith('PUT '))).toBe(true), {
			timeout: 5000,
		})
		const [updated, ...others] = await stored()
		expect(others).toEqual([])
		expect(updated?.version).toBe(FORECAST_SAVE_VERSION)
		const after = (
			JSON.parse(String(updated?.scenarioData)) as {
				inputs: {
					balanceAccounts: Array<{
						annualReturn?: number
						contributionRecordedAsExpense: boolean
						paidByExpenseName?: string
					}>
				}
			}
		).inputs.balanceAccounts
		expect(after.map((row) => row.annualReturn)).toEqual([0, undefined, -0.025])
		expect(after[1]?.contributionRecordedAsExpense).toBe(false)
		expect(after[1]?.paidByExpenseName).toBe('Car payment')

		// The builder remounts on Load, so `-2.50%` shows only if the stored rate was read.
		rtl.fireEvent.click(
			await view.findByRole('button', { name: 'Edit My Financial Forecast' }, { timeout: 5000 })
		)
		await rtl.waitFor(() => expect(value('Annual return for ISA')).toBe('-2.50%'))
		expect(value('Annual return for Pension')).toBe('0.00%')
		expect(view.queryByLabelText('Annual return for Car loan')).toBeNull()
		expect(view.getByText('from Expenses: Car payment')).toBeInTheDocument()
	}, 30_000)
})

describe('asset rows round-trip through the real routes', () => {
	const ISO = '2026-10-06T00:00:00.000Z'

	afterEach(async () => {
		const { useBalanceStore } = await import('@/stores/balanceStore')
		useBalanceStore.setState({ entries: [] })
	})

	it('POST stores version 6 with the asset rows; Load brings them back from the database, not the store', async () => {
		const { useBalanceStore } = await import('@/stores/balanceStore')
		const asset = (id: string, name: string, currentBalance: number, sortOrder: number) => ({
			id,
			profileId: PROFILE,
			type: 'asset',
			name,
			currentBalance,
			monthlyContribution: 0,
			frequency: 'monthly',
			sortOrder,
			createdAt: ISO,
			updatedAt: ISO,
		})
		useBalanceStore.setState({
			entries: [asset('a-1', 'House', 30_000_001, 0), asset('a-2', 'Car', 1_250_099, 1)] as never,
		})
		const view = renderWithRouter(<ForecastingPage />)
		await pressSave(view)
		await view.findByTestId('save-success', {}, { timeout: 5000 })

		const [created, ...more] = await db
			.select({
				version: forecastingProfiles.version,
				scenarioData: forecastingProfiles.scenarioData,
			})
			.from(forecastingProfiles)
		expect(more).toEqual([])
		expect(created?.version).toBe(6)
		const saved = JSON.parse(String(created?.scenarioData)) as {
			inputs: Record<string, unknown>
			result: { summary: { startingNetWorth: number } }
		}
		expect(saved.inputs.assetAccounts).toEqual([
			{ name: 'House', balance: 30_000_001 },
			{ name: 'Car', balance: 1_250_099 },
		])
		expect(saved.result.summary.startingNetWorth).toBe(31_250_100)

		// Change the live store so a reload that read it would show different rows.
		useBalanceStore.setState({ entries: [asset('a-9', 'Live boat', 5, 0)] as never })
		rtl.fireEvent.click(
			await view.findByRole('button', { name: 'Edit My Financial Forecast' }, { timeout: 5000 })
		)
		const value = (label: string) => (view.getByLabelText(label) as HTMLInputElement).value
		await rtl.waitFor(() => expect(value('Value for House')).toBe('300,000.01'))
		const section = view.getByRole('region', { name: 'Assets' })
		expect(
			rtl
				.within(section)
				.getAllByLabelText(/^Asset Name, row \d+$/)
				.map((el) => (el as HTMLInputElement).value)
		).toEqual(['House', 'Car'])
		expect(value('Value for Car')).toBe('12,500.99')
	}, 20_000)
})
