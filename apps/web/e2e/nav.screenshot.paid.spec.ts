import { type Page, type Route, expect, test } from '@playwright/test'
import { accountTrigger, expectSignedInAs } from './helpers/account-menu'
import { mockSignedIn, openMore } from './helpers/nav-more'
import {
  FIXED_NOW,
  SHOT_TIMEOUT,
  chartsDrawn,
  copyrightYear,
  expectPhoneStrip,
  expectTarget,
} from './helpers/screenshot'
import { seedFinanceRows } from './helpers/seed-finance-rows'

// Only screenshots-paid runs `.paid.spec.ts`; baselines are made in CI only. The dev
// servers have no DB, so /api/profiles and /api/forecasts are stubbed.

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

test('forecasting-320-light', async ({ page }) => {
  await open(page, '/forecasting', 320, 0)
  await expect(page).toHaveScreenshot('forecasting-320-light.png', {
    fullPage: true,
    mask: await copyrightYear(page),
    timeout: SHOT_TIMEOUT,
  })
})

// The tab click retries: a click before hydration only focuses the
// server-rendered button.
for (const width of [320, 1280]) {
  test(`forecasting-projections-${width}-light`, async ({ page }) => {
    await open(page, '/forecasting', width, 0)
    const heading = page.getByRole('heading', { name: 'Forecast Projections' })
    await expect(async () => {
      if (!(await heading.isVisible())) {
        await page.getByRole('tab', { name: 'Projections' }).click({ timeout: 1000 })
      }
      await expect(heading).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: SHOT_TIMEOUT })
    await chartsDrawn(page, 3)
    await expect(page).toHaveScreenshot(`forecasting-projections-${width}-light.png`, {
      fullPage: true,
      mask: await copyrightYear(page),
      timeout: SHOT_TIMEOUT,
    })
  })
}

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
  await open(page, '/', 320, 4, 640)
  await expectTarget(accountTrigger(page), 'Account menu trigger')
  await expectPhoneStrip(page, 320)
  await openMore(page)
  const rows = page.locator('nav[aria-label="Primary"] details ul').getByRole('link')
  await expect(rows).toHaveCount(7)
  for (let i = 0; i < 7; i++) await expectTarget(rows.nth(i), `paid sheet row ${i + 1}`)
  await expect(rows.last()).toHaveAccessibleName('Settings')
  await expect(rows.last()).toBeVisible()
  // `toBeVisible()` ignores clipping by the sheet's max-h scroll box.
  await expect(rows.last()).toBeInViewport({ ratio: 1 })
  // Viewport, not full page: the sheet is a fixed overlay above the bottom bar.
  await expect(page).toHaveScreenshot('paid-sheet-320.png', {
    mask: await copyrightYear(page),
    timeout: SHOT_TIMEOUT,
  })
})

/**
 * The browser clock is not fixed here: the date is stamped on server and client, so a
 * fixed browser date fails hydration. The stamp is masked instead.
 */
async function openReport(page: Page, width: number) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ colorScheme: 'light' })
  await seedFinanceRows(page)
  await mockSignedIn(page, { email: PAID_EMAIL, subscriptionStatus: 'active' })
  await page.goto('/financial-summary')
  await page.waitForLoadState('networkidle')
  await expectSignedInAs(page, PAID_EMAIL)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Financial Summary', exact: true })
  ).toBeVisible()
  await chartsDrawn(page, 0)
  expect(errors, 'no page error (a fixed clock fails hydration here)').toEqual([])
}

/** Asserted to match exactly once: a mask on nothing passes. */
async function reportDate(page: Page) {
  const stamp = page
    .locator('#financial-summary-report header p')
    .filter({ hasText: /^Generated / })
  await expect(stamp, 'the report date mask matched nothing').toHaveCount(1)
  return stamp
}

for (const width of [320, 1280]) {
  test(`financial-summary-${width}-light`, async ({ page }) => {
    await openReport(page, width)
    await expect(page).toHaveScreenshot(`financial-summary-${width}-light.png`, {
      fullPage: true,
      mask: [...(await copyrightYear(page)), await reportDate(page)],
      timeout: SHOT_TIMEOUT,
    })
  })
}

test('financial-summary-print', async ({ page }) => {
  // A4's width at 96 dpi. emulateMedia applies `@media print` rules but not paper
  // size or margins.
  await openReport(page, 794)
  // After expectSignedInAs: the header is hidden in print.
  await page.emulateMedia({ media: 'print', colorScheme: 'light' })
  // Proves the media switch took effect.
  await expect(page.getByRole('button', { name: /print \/ save as pdf/i })).toHaveCount(0)
  await expect(page).toHaveScreenshot('financial-summary-print.png', {
    fullPage: true,
    mask: [await reportDate(page)],
    timeout: SHOT_TIMEOUT,
  })
})
