import { type Page, type Route, expect, test } from '@playwright/test'
import { expectSignedInAs } from './helpers/account-menu'
import { mockSignedIn } from './helpers/nav-more'
import { FIXED_NOW, SHOT_TIMEOUT, chartsDrawn, copyrightYear } from './helpers/screenshot'
import { seedFinanceRows } from './helpers/seed-finance-rows'

/**
 * Screenshots of the PAID surfaces (story 84.1, FR137): the paid header and
 * the forecasting page. Read the header of `pages.screenshot.spec.ts` first:
 * baselines are made in CI only, by `.github/workflows/screenshots.yml`.
 *
 * ⚠️ `.paid.spec.ts` is load-bearing: only `screenshots-paid` (:5174, booted
 * with an entitled `E2E_SESSION_SEED`) runs this file. On the free server the
 * header has the free anchors and `/forecasting` is the upgrade prompt.
 *
 * `/forecasting` fetches `/api/profiles` and `/api/forecasts` (story 83.1) and
 * the dev servers have no database, so both are STUBBED: one profile and NO
 * saved forecasts. That keeps the page's profile state `ready` rather than an
 * error. The shot is of the default Scenario Builder tab; the saved list isn't
 * in the picture (story 84.1 review corrected an earlier "one saved forecast").
 *
 * ⚠️ `mockSignedIn` + `expectSignedInAs` for the same reason as
 * `account-menu.paid.spec.ts`: the seed paints a signed-in cluster, but the
 * post-mount `/api/auth/me` resolves signed-OUT on this server and swaps in
 * "Upgrade / Sign in". MEASURED at story 84.1 without them: the paid shots
 * showed the signed-out cluster.
 */

/** Short and fixed, so the avatar initial and the sr-only identity never move. */
const PAID_EMAIL = 'paid@example.test'
const PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

async function stubForecastApi(page: Page) {
  const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } })
  await page.route('**/api/profiles', (route) =>
    ok(route, [{ id: PROFILE_ID, isDefault: true, name: 'Personal' }])
  )
  await page.route('**/api/forecasts**', (route) => ok(route, []))
}

async function open(page: Page, path: string, width: number, charts: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.clock.setFixedTime(FIXED_NOW)
  await seedFinanceRows(page)
  await stubForecastApi(page)
  await mockSignedIn(page, { email: PAID_EMAIL, subscriptionStatus: 'active' })
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await expectSignedInAs(page, PAID_EMAIL)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await chartsDrawn(page, charts)
}

test('forecasting-1280-light', async ({ page }) => {
  await open(page, '/forecasting', 1280, 0)
  await expect(page).toHaveScreenshot('forecasting-1280-light.png', {
    fullPage: true,
    mask: await copyrightYear(page),
    timeout: SHOT_TIMEOUT,
  })
})

for (const width of [768, 1280]) {
  test(`paid-header-${width}-light`, async ({ page }) => {
    await open(page, '/', width, 4)
    await expect(page).toHaveScreenshot(`paid-header-${width}-light.png`, {
      mask: await copyrightYear(page),
      timeout: SHOT_TIMEOUT,
    })
  })
}
