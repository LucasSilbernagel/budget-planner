import { type Page, type Route, expect, test } from '@playwright/test'
import { PROD_E2E_USER_ID, addProdSessionCookie, signProdSession } from './helpers/prod-session'

// Runs only on chromium-prod: the `Buffer is not defined` defect existed only in the
// production client bundle. /api/* is stubbed, so this proves the browser half.

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
          // The server stores scenarioData as a JSON string.
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
  // The builder heading renders before the profile load behind Save finishes, so
  // waiting on it alone misses a failure of that load.
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

  await page.getByLabel('Scenario Name').fill(FORECAST_NAME)
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(page.getByTestId('save-success')).toHaveText(
    `Saved "${FORECAST_NAME}" to My Forecasts.`
  )

  expect(server.posts).toHaveLength(1)
  expect(server.posts[0]).toMatchObject({ name: FORECAST_NAME, profileId: PROFILE_ID })
  expect(server.posts[0]?.['scenarioData']).toMatchObject({
    scenario: expect.any(Object),
    result: expect.any(Object),
  })

  const deleteButton = page.getByRole('button', { name: `Delete ${FORECAST_NAME}` })
  await expect(deleteButton).toBeVisible()

  await page.reload()
  await expect(builderHeading).toBeVisible({ timeout: 20_000 })
  await page.getByRole('tab', { name: /my forecasts/i }).click()
  await expect(deleteButton).toBeVisible()

  await deleteButton.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(deleteButton).toHaveCount(0)
  expect(server.deletes).toEqual(['1'])
  expect(server.forecasts).toEqual([])

  expect(errors.filter((e) => e.includes('Buffer is not defined'))).toEqual([])
})

// `request` bypasses page.route, so this proves the built server registers these
// routes: 503/401 handler JSON, not a 404 or the HTML shell.
test('the production server routes /api/profiles and /api/forecasts to their handlers', async ({
  request,
}) => {
  const signed = { cookie: `session=${encodeURIComponent(signProdSession())}` }
  const calls = [
    ['GET', '/api/profiles'],
    ['GET', '/api/forecasts'],
    ['POST', '/api/forecasts'],
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
