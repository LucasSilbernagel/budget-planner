import { expect, test } from '@playwright/test'

/**
 * Global navigation E2E (story 11-1).
 *
 * Proves the persistent primary nav on the real route tree and against the
 * hydrated client DOM (active state only resolves after hydration, so SSR HTML
 * alone would not show it — see project note "SSR smoke misses client render").
 *
 * Covers:
 *  - AC-1/AC-4: the nav is present on a deep sub-page (replacing the removed
 *    per-page footer link blocks).
 *  - AC-2: the current route is marked `aria-current="page"`.
 *  - The core promise: from a deep sub-page you can reach another section in a
 *    single click without routing back through Home.
 *  - AC-3: the nav stays usable at a narrow (mobile/PWA) viewport.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

test('reaches another section from a deep sub-page in one click', async ({ page }) => {
  await page.goto('/savings')
  await page.waitForLoadState('networkidle')

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav).toBeVisible()

  // One click from Savings to Balance — no detour through the Home dashboard.
  await nav.getByRole('link', { name: 'Balance' }).click()
  await expect(page).toHaveURL(/\/balance$/)

  // The destination is marked active in the hydrated DOM.
  await expect(nav.getByRole('link', { name: 'Balance' })).toHaveAttribute('aria-current', 'page')
})

test('marks the current section active and leaves others inactive', async ({ page }) => {
  await page.goto('/income')
  await page.waitForLoadState('networkidle')

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.getByRole('link', { name: 'Income' })).toHaveAttribute('aria-current', 'page')
  // Overview matches "/" exactly, so it is not active on a sub-route.
  await expect(nav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
})

test('reaches the consolidated settings surface from the nav', async ({ page }) => {
  await page.goto('/income')
  await page.waitForLoadState('networkidle')

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await nav.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)

  // The settings surface hosts the relocated display controls (story 11-6).
  await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible()
  await expect(page.getByRole('group', { name: /currency display/i })).toBeVisible()
})

test('stays usable at a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/expenses')
  await page.waitForLoadState('networkidle')

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav).toBeVisible()

  await nav.getByRole('link', { name: 'Savings' }).click()
  await expect(page).toHaveURL(/\/savings$/)
})
