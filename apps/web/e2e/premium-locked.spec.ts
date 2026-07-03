import { expect, test } from '@playwright/test'

/**
 * Premium locked-state E2E (story 7-2, FR24).
 *
 * A first-time visitor has no session, so `usePremiumAccess` resolves to the
 * free tier on the client. This test drives the REAL hydration path (not a
 * mocked hook): after the client resolves the tier, the homepage must surface
 * Advanced Forecasting as a locked, discoverable control — with an upgrade
 * prompt on activation — rather than hiding it.
 *
 * This deliberately asserts the hydrated client DOM, the exact transition that
 * SSR-HTML smoke and mocked-only unit tests miss (project memory, 4-11).
 */
test('free visitor sees Advanced Forecasting locked and can open the upgrade prompt', async ({
  page,
}) => {
  await page.goto('/')

  // The gate renders a neutral skeleton during the in-flight tier check, then
  // resolves to the locked control for a free/unauthenticated user.
  const lockedFeature = page.getByRole('button', {
    name: /advanced forecasting — premium, locked/i,
  })
  await expect(lockedFeature).toBeVisible()

  // The lock badge is discoverable (FR24 — not hidden from the user).
  await expect(page.getByText('Premium', { exact: true }).first()).toBeVisible()

  // Activating the locked feature opens the upgrade prompt instead of navigating.
  await lockedFeature.click()
  await expect(page.getByRole('heading', { name: /go premium/i })).toBeVisible()
})
