// @vitest-environment node
/**
 * The forecasting page, end to end below the browser (story 83.1, FR136).
 *
 * The REAL `ForecastingPage` runs against the REAL route handlers
 * (`/api/auth/me`, `/api/profiles`, `/api/forecasts`) on a real PostgreSQL
 * (PGlite, the migration chain): global `fetch` is routed to the handlers, the
 * way `lib/sync/__tests__/permanent-rejection-chain.db.test.ts` routes sync. Only
 * the session resolver is mocked.
 *
 * ## Why this file exists
 *
 * The page tests (`forecasting-*.test.tsx`) mock the transport module, and the
 * route tests call the handlers directly. Neither can catch the page and the
 * routes disagreeing about a URL, a method, a body field or a status (the
 * "mocked-core tests miss client→server contract bugs" lesson). Here a save is
 * followed into the database row it wrote.
 *
 * It also takes the NO-SEED path on purpose: there is no `SessionSeedProvider`,
 * so `usePremiumAccess` asks `/api/auth/me` itself (FR136 AC-2), which on
 * `31e74bf` imported `server/api/data/forecasting` in the browser instead.
 *
 * ⚠️ Node environment + a hand-built JSDOM, like the other `*.db.test.tsx`: the
 * persisted stores are rebound to the JSDOM storage (see
 * `components/sync/__tests__/refused-edit-notice.db.test.tsx`). Queries go
 * through the RENDER RESULT, not `screen`: RTL binds `screen` to the document
 * that existed when it was first imported (by `vitest.setup.ts`), i.e. none.
 */

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

import { GET as meGET } from '@/routes/api/auth/me'
import {
  DELETE as forecastsDELETE,
  GET as forecastsGET,
  POST as forecastsPOST,
} from '@/routes/api/forecasts'
import { GET as profilesGET } from '@/routes/api/profiles'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { forecastingProfiles, userProfiles, users } from '@budget-planner/db'
import { JSDOM } from 'jsdom'
import { migratedPglite } from '../../test/pglite-migrated'

const USER = '11111111-1111-4111-8111-111111111111'
const PROFILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let pg: PGlite
let db: ReturnType<typeof drizzle>
let rtl: typeof import('@testing-library/react')
let renderWithRouter: typeof import('@/test/utils').renderWithRouter
let ForecastingPage: () => React.ReactElement

const sessionMock = getCurrentUserSession as unknown as ReturnType<typeof vi.fn>

/** Every request the page made, as `METHOD path?query → status`. */
const served: string[] = []

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'https://app.test')
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init?.headers)
  if (typeof init?.body === 'string') {
    // undici sets no content-length on a constructed Request (story 79.3).
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
    // `vitest.setup.ts` writes these two before every test once `document`
    // exists; unbound, their persist write hits `undefined.setItem`.
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
  // Let React's queued Scheduler work run while `window` still exists. A commit
  // made while RTL's `findBy`/`waitFor` had the act environment switched off
  // queues its passive-effect flush on the real Scheduler (a `setImmediate`),
  // and that callback's first statement reads `window.event`
  // (`react-dom-client.development.js:17920`). Unstubbed first, it threw
  // `ReferenceError: window is not defined` after every test had passed and
  // vitest exited 1: 4 of 20 isolated runs (story 82.1, deferred-work F7).
  // One immediate is not enough in general: the Scheduler re-queues itself with a
  // NEW immediate when a slice runs past 5 ms, and a passive flush can schedule
  // another commit, so drain several turns, each an immediate (runs after the
  // ones already queued) and a timer (runs after an immediate queued from one).
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

describe('the forecasting page against the real routes (story 83.1)', () => {
  it('saves a forecast into the database, lists it, and deletes it', async () => {
    const view = renderWithRouter(<ForecastingPage />)

    const save = await view.findByRole('button', { name: 'Save Forecast' }, { timeout: 5000 })
    await rtl.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false), {
      timeout: 5000,
    })
    rtl.fireEvent.click(save)

    expect(await view.findByTestId('save-success', {}, { timeout: 5000 })).toBeTruthy()

    // The row really exists, under the profile the page resolved, owned by the
    // session user, holding what the builder built.
    const [row, ...rest] = await storedForecasts()
    expect(rest).toEqual([])
    expect(row).toMatchObject({ userId: USER, profileId: PROFILE, name: 'My Financial Forecast' })
    const saved = JSON.parse(String(row?.scenarioData)) as Record<string, unknown>
    expect(Object.keys(saved).sort()).toEqual(['inputs', 'result', 'scenario'])

    // "My Forecasts" lists it (the success switched tabs), from a real GET.
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
