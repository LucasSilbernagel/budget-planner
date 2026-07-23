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

test('login page keeps its card affordances and drops the redundant copyright line (story 21-2)', async ({
  page,
}) => {
  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  // The sign-in card rendered (scoped to the card's <h2>, not the AuthIndicator
  // "Sign in" link that also renders on this route via the root layout).
  await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible()

  // Terms of Service / Privacy Policy links are preserved INSIDE the card's
  // consent line (AC-2). Scoped to that paragraph because the global Footer also
  // links Terms/Privacy on this page — an unscoped match would be ambiguous.
  const consent = page.getByText(/by signing in, you agree to our/i)
  await expect(consent.getByRole('link', { name: /terms of service/i })).toBeVisible()
  await expect(consent.getByRole('link', { name: /privacy policy/i })).toBeVisible()

  // The "Continue without account" affordance is preserved (AC-2).
  await expect(page.getByRole('link', { name: /continue without account/i })).toBeVisible()

  // The redundant page-level "© … All rights reserved." line is gone (AC-1).
  // The global Footer's copyright reads "Copyright <year> Lucas Silbernagel",
  // not "All rights reserved", so this targets only the removed login line.
  await expect(page.getByText(/all rights reserved/i)).toHaveCount(0)
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
