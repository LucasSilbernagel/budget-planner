import { type Page, type Route, expect, test } from '@playwright/test'
import { PROD_E2E_USER_ID, addProdSessionCookie, signProdSession } from './helpers/prod-session'

/**
 * A saved forecast survives a reload, on the PRODUCTION build (story 83.1, FR136, AC-5).
 *
 * ⚠️ `.prod.spec.ts` is load-bearing: only the `chromium-prod` project runs it,
 * against `pnpm build && node server-entry.mjs` (see `playwright.config.ts`). The
 * defect this story fixes existed ONLY in the production client bundle: the page
 * `import()`ed `server/functions/*`, the browser chunk carried `pg`, and it failed
 * with `ReferenceError: Buffer is not defined`. A dev-server or SSR check cannot
 * see that (the story 62.2 D4 mistake), so this spec must never move to `:5173`.
 *
 * ## ⚠️⚠️ What is REAL here and what is STUBBED
 *
 * REAL: the production client bundle, the production SSR server, and the path a
 * paid user takes when the SSR seed cannot be resolved (`usePremiumAccess` → a
 * browser-side access check). The signed cookie makes the seed resolve to `null`
 * on this database-less server (`helpers/prod-session.ts`).
 *
 * STUBBED with `page.route`: `/api/auth/me`, `/api/profiles` and `/api/forecasts`.
 * There is no database under e2e (CI has no Postgres service, and the only real
 * one is production). So this proves the BROWSER half: the bundle loads, the
 * page speaks to these URLs with these methods and bodies, and renders the
 * answers. The SERVER half is proven below the browser: the PGlite route tests
 * (`routes/api/__tests__/*.route.db.test.ts`) and the in-process chain test that
 * runs this page against the real handlers (`forecasting-transport-chain.db.test.tsx`).
 *
 * ## The RED on `31e74bf`
 *
 * The first assertion after the page settles is that no page or console error
 * contains `Buffer is not defined`. MEASURED on `31e74bf`: a paid user on this
 * path got the upgrade prompt and `Premium access check failed: Buffer is not
 * defined`. The assertion goes first so the RED names the cause, not a missing
 * selector.
 */

const PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FORECAST_NAME = 'Round trip plan'

interface StoredForecast {
  id: number
  userId: string
  profileId: string
  name: string
  description: string | null
  scenarioData: string
  version: number
  isDefault: boolean
  createdAt: string
  updatedAt: string
  profileName: string
}

/** The server this spec stands in for, holding its state across the reload. */
function stubServer(page: Page) {
  const forecasts: StoredForecast[] = []
  const posts: Record<string, unknown>[] = []
  const deletes: string[] = []
  let nextId = 1

  const ok = (route: Route, data?: unknown) =>
    route.fulfill({ json: data === undefined ? { success: true } : { success: true, data } })

  const install = async () => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        json: {
          user: {
            userId: PROD_E2E_USER_ID,
            email: 'e2e-prod@example.test',
            subscriptionStatus: 'active',
            isAuthenticated: true,
          },
        },
      })
    )
    await page.route('**/api/profiles', (route) =>
      ok(route, [{ id: PROFILE_ID, isDefault: true, name: 'Personal' }])
    )
    await page.route('**/api/forecasts**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'GET') {
        return ok(route, [...forecasts].reverse())
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>
        posts.push(body)
        const now = new Date().toISOString()
        const row: StoredForecast = {
          id: nextId++,
          userId: PROD_E2E_USER_ID,
          profileId: String(body['profileId']),
          name: String(body['name']),
          description: null,
          // The server stores the object as a JSON string (`validateScenarioData`).
          scenarioData: JSON.stringify(body['scenarioData']),
          version: 1,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
          profileName: 'Personal',
        }
        forecasts.push(row)
        return ok(route, row)
      }
      if (request.method() === 'DELETE') {
        const id = url.searchParams.get('id') ?? ''
        deletes.push(id)
        const index = forecasts.findIndex((f) => String(f.id) === id)
        if (index === -1) {
          return route.fulfill({ status: 404, json: { success: false, error: 'not found' } })
        }
        forecasts.splice(index, 1)
        return ok(route)
      }
      return route.fulfill({ status: 405, json: { success: false, error: 'method' } })
    })
  }

  return { install, forecasts, posts, deletes }
}

/** Enough of the user's own money that the builder computes a result to save. */
async function seedIncome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const now = '2026-09-29T00:00:00.000Z'
    localStorage.setItem(
      'budget-planner-income-v1',
      JSON.stringify({
        state: {
          incomeSources: [
            {
              id: 'inc-1',
              userId: 0,
              name: 'Consulting',
              amount: 500000,
              frequency: 'monthly',
              categoryId: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        version: 2,
      })
    )
  })
}

test('a paid user saves a forecast, finds it after a reload, and deletes it (83.1 AC-5)', async ({
  page,
  context,
  baseURL,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  await addProdSessionCookie(context, baseURL ?? 'http://127.0.0.1:5175')
  const server = stubServer(page)
  await server.install()
  await seedIncome(page)

  await page.goto('/forecasting')

  const builderHeading = page.getByRole('heading', { name: 'Scenario Builder' })
  const upgradePrompt = page.getByRole('heading', { name: /go premium/i })
  const saveButton = page.getByRole('button', { name: 'Save Forecast' })
  // Settle on WHICHEVER the page resolves to (the access check AND, for a paid
  // user, the profile load behind Save), then check the cause first.
  //
  // ⚠️ Waiting for the builder heading alone is too early: it renders before the
  // profile load finishes, so a failure of THAT load (the path-1 variant of the
  // defect: the page's own server import) had not been logged yet and the RED
  // surfaced later as a disabled Save button, a symptom (MEASURED, story 83.1).
  await expect(
    page
      .getByRole('button', { name: 'Save Forecast', disabled: false })
      .or(page.getByTestId('save-blocked-notice'))
      .or(upgradePrompt)
      .first()
  ).toBeVisible({ timeout: 20_000 })
  expect(
    errors.filter((e) => e.includes('Buffer is not defined')),
    `browser errors: ${errors.join(' | ')}`
  ).toEqual([])
  await expect(builderHeading).toBeVisible()

  // Save.
  await page.getByLabel('Scenario Name').fill(FORECAST_NAME)
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(page.getByTestId('save-success')).toHaveText(
    `Saved "${FORECAST_NAME}" to My Forecasts.`
  )

  // The request carried the profile the page resolved, and the builder's scenario.
  expect(server.posts).toHaveLength(1)
  expect(server.posts[0]).toMatchObject({ name: FORECAST_NAME, profileId: PROFILE_ID })
  expect(server.posts[0]?.['scenarioData']).toMatchObject({
    scenario: expect.any(Object),
    result: expect.any(Object),
  })

  // The success switches to "My Forecasts", which lists it.
  const deleteButton = page.getByRole('button', { name: `Delete ${FORECAST_NAME}` })
  await expect(deleteButton).toBeVisible()

  // Reload: the list comes back from the "server", not from page state.
  await page.reload()
  await expect(builderHeading).toBeVisible({ timeout: 20_000 })
  await page.getByRole('tab', { name: /my forecasts/i }).click()
  await expect(deleteButton).toBeVisible()

  // Delete.
  await deleteButton.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(deleteButton).toHaveCount(0)
  expect(server.deletes).toEqual(['1'])
  expect(server.forecasts).toEqual([])

  expect(errors.filter((e) => e.includes('Buffer is not defined'))).toEqual([])
})

/**
 * The BUILT server really serves these routes (story 83.1 code review).
 *
 * The round trip above stubs every `/api/*` call in the browser, and the chain
 * test calls the handlers directly, so neither would notice a route the
 * production build does not register (a 404, or the SSR HTML shell answering
 * instead). These requests go through Playwright's `request` fixture, which
 * `page.route` does not intercept, to the real :5175 server. With no database
 * behind it, a signed session cannot be resolved (503) and no cookie is signed
 * out (401): both are the handlers' own JSON, which only a registered route can
 * produce.
 */
test('the production server routes /api/profiles and /api/forecasts to their handlers', async ({
  request,
}) => {
  const signed = { cookie: `session=${encodeURIComponent(signProdSession())}` }
  const calls = [
    ['GET', '/api/profiles'],
    ['GET', '/api/forecasts'],
    ['POST', '/api/forecasts'],
    // Story 97.1 (FR157): saving over a loaded forecast.
    ['PUT', '/api/forecasts?id=1'],
    ['DELETE', '/api/forecasts?id=1'],
  ] as const

  for (const [method, path] of calls) {
    const unresolved = await request.fetch(path, { method, headers: signed, data: {} })
    expect(unresolved.status(), `${method} ${path} with a signed cookie`).toBe(503)
    expect(await unresolved.json()).toEqual({
      success: false,
      error: 'Your session could not be checked. Try again in a moment.',
    })

    const signedOut = await request.fetch(path, { method, data: {} })
    expect(signedOut.status(), `${method} ${path} with no cookie`).toBe(401)
    expect(await signedOut.json()).toEqual({ success: false, error: 'Authentication required' })
  }
})
