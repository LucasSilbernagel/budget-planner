import { expect, test } from '@playwright/test'

/**
 * AuthIndicator E2E (story 13-2).
 *
 * The persistent signed-in / Premium indicator is server-rendered then resolves
 * its session on the client via `fetch('/api/auth/me')`. This proves the
 * hydrated behaviour that SSR HTML + jsdom cannot (see project note "SSR smoke
 * misses client render"): against the real route tree with no session, the strip
 * resolves to the "Sign in" affordance and never leaks a Premium marker.
 *
 * The preview runtime cannot mint a real signed-in session (no test session +
 * the premium-check Buffer gap), so the SIGNED-IN states — email + the
 * active-only "Premium" marker — are covered by the unit suite
 * (`auth-indicator.test.tsx`). Here we assert the signed-out path e2e and that
 * the strip adds no 320px horizontal overflow.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

test('resolves to a "Sign in" affordance with no Premium marker when signed out', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const indicator = page.getByRole('status', { name: /account status/i })
  await expect(indicator).toBeVisible()

  // Hydrated session resolves to signed-out: a Sign in link to /login, and no
  // account-specific content (never a false Premium marker).
  const signIn = indicator.getByRole('link', { name: /sign in/i })
  await expect(signIn).toBeVisible()
  await expect(signIn).toHaveAttribute('href', /\/login$/)
  await expect(indicator.getByText(/premium/i)).toHaveCount(0)

  // Reaches the login page in one click.
  await signIn.click()
  await expect(page).toHaveURL(/\/login$/)
})

test('adds no horizontal overflow at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('status', { name: /account status/i })).toBeVisible()

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    scrollWidth,
    `home overflows horizontally with the auth indicator: ${scrollWidth} > ${clientWidth}`
  ).toBeLessThanOrEqual(clientWidth)
})
