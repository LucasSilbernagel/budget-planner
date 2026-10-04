import { type Page, type Route, expect, test } from '@playwright/test'
import { expectSignedInAs } from './helpers/account-menu'
import { mockSignedIn, openMore } from './helpers/nav-more'
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

async function open(page: Page, path: string, width: number, charts: number, height = 900) {
  await page.setViewportSize({ width, height })
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

test('paid-sheet-320', async ({ page }) => {
  // 320x640: the phone the 6-row sheet's on-screen claims were measured at.
  await open(page, '/', 320, 4, 640)
  await openMore(page)
  // The OPEN, PAID sheet, asserted: six visible rows (the free sheet has two).
  await expect(page.locator('nav[aria-label="Primary"] details ul').getByRole('link')).toHaveCount(
    6
  )
  // Viewport, not full page: the sheet is a fixed overlay above the bottom bar.
  await expect(page).toHaveScreenshot('paid-sheet-320.png', {
    mask: await copyrightYear(page),
    timeout: SHOT_TIMEOUT,
  })
})

/**
 * `/report` (story 91.2, FR145): fits the window on screen at 320 and 1280, and
 * prints every column. It is premium, hence this paid file.
 *
 * ⚠️ The browser clock is NOT fixed here, unlike every other shot. /report
 * stamps "Generated <date>" on the server AND the client; a fixed browser date
 * disagrees with the server's and hydration fails (88.4, MEASURED 5/5 widths).
 * The stamp is MASKED instead, like the footer year, and no page error may
 * occur. Nothing else on the page reads the clock (the seed's dates are fixed).
 */
async function openReport(page: Page, width: number) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ colorScheme: 'light' })
  await seedFinanceRows(page)
  await mockSignedIn(page, { email: PAID_EMAIL, subscriptionStatus: 'active' })
  await page.goto('/report')
  await page.waitForLoadState('networkidle')
  await expectSignedInAs(page, PAID_EMAIL)
  await expect(page.getByRole('heading', { level: 1, name: 'Financial summary' })).toBeVisible()
  await chartsDrawn(page, 0)
  expect(errors, 'no page error (a fixed clock fails hydration here)').toEqual([])
}

/** The report's date stamp, asserted to match exactly once (a mask on nothing passes). */
async function reportDate(page: Page) {
  const stamp = page
    .locator('#financial-summary-report header p')
    .filter({ hasText: /^Generated / })
  await expect(stamp, 'the report date mask matched nothing').toHaveCount(1)
  return stamp
}

for (const width of [320, 1280]) {
  test(`report-${width}-light`, async ({ page }) => {
    await openReport(page, width)
    await expect(page).toHaveScreenshot(`report-${width}-light.png`, {
      fullPage: true,
      mask: [...(await copyrightYear(page)), await reportDate(page)],
      timeout: SHOT_TIMEOUT,
    })
  })
}

test('report-print', async ({ page }) => {
  // 794 px = A4's width at 96 dpi. `emulateMedia` applies the `@media print`
  // rules but not paper size or margins: this pins the print CSS, not the PDF.
  await openReport(page, 794)
  // After `expectSignedInAs`: the header is `data-print-hide`, hidden in print.
  await page.emulateMedia({ media: 'print', colorScheme: 'light' })
  // The print rule hides every print button: the media switch took effect.
  await expect(page.getByRole('button', { name: /print \/ save as pdf/i })).toHaveCount(0)
  await expect(page).toHaveScreenshot('report-print.png', {
    fullPage: true,
    mask: [await reportDate(page)],
    timeout: SHOT_TIMEOUT,
  })
})
