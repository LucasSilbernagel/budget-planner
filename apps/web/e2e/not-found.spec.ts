import { expect, test } from '@playwright/test'

/**
 * Not-found (404) page E2E (Story 6.4 / UX-DR12).
 *
 * Proves that an unmatched URL renders the branded, recoverable 404 — the app's
 * shell (Longhand Budget wordmark + global Footer) rather than an unstyled
 * default (AC-1) — and that the "Go home" link navigates back to the dashboard
 * (AC-3). The 404 markup is server-rendered, so these assertions hold before
 * hydration; the "Go home" click needs hydration, so it is retried via `toPass`.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const UNKNOWN_ROUTE = '/this-route-does-not-exist'

test.describe('Not-found page (story 6-4)', () => {
  test('renders the branded 404 with app chrome', async ({ page }) => {
    await page.goto(UNKNOWN_ROUTE)

    // Single subject heading (AC-3) — and it must be the ONLY <h1> on the fully
    // rendered shell, so a future root-layout change that adds an h1 is caught.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: /page not found/i })).toBeVisible()
    // Decorative eyebrow (exact match — avoids a brittle substring hit if any
    // other chrome ever contains "404").
    await expect(page.getByText('404', { exact: true })).toBeVisible()
    // Shared branding (AC-1): the app wordmark is present…
    await expect(page.getByText('Longhand Budget').first()).toBeVisible()
    // …and the global footer still wraps the page (proves it renders inside the
    // root layout, not a bare fallback).
    await expect(page.getByRole('contentinfo')).toBeVisible()
    // Accessible recovery link (AC-3).
    await expect(page.getByRole('link', { name: /go home/i })).toBeVisible()
  })

  test('serves a real HTTP 404 status (not a soft-200)', async ({ page }) => {
    // The docs route deliberately throws notFound() for a real 404; confirm the
    // global unmatched-route fallback is likewise a true 404, not a soft-200
    // that crawlers would index as a valid page.
    const response = await page.goto(UNKNOWN_ROUTE)
    expect(response?.status()).toBe(404)
  })

  test('fits a 320px viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto(UNKNOWN_ROUTE)
    await expect(page.getByRole('heading', { level: 1, name: /page not found/i })).toBeVisible()

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(
      scrollWidth,
      `404 overflows horizontally: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`
    ).toBeLessThanOrEqual(clientWidth)
  })

  test('"Go home" navigates back to the dashboard', async ({ page }) => {
    await page.goto(UNKNOWN_ROUTE)

    const goHome = page.getByRole('link', { name: /go home/i })

    // The client-side Link only navigates once React has hydrated the SSR
    // markup; retry until the URL is exactly the site root (origin + "/"), not
    // merely any trailing-slash path.
    await expect(async () => {
      await goHome.click()
      await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/, { timeout: 1000 })
    }).toPass({ timeout: 15000 })

    // Positively confirm the dashboard rendered — the always-present "Financial
    // Overview" section — not merely that the 404 heading disappeared.
    await expect(page.getByRole('heading', { name: /financial overview/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: /page not found/i })).toBeHidden()
  })
})
