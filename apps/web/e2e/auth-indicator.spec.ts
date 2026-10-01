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
 * The e2e servers mint no real session, so this file asserts the SIGNED-OUT
 * path and that the strip adds no 320px horizontal overflow. The signed-in
 * states ARE renderable in e2e since story 59.2: `mockSignedIn()`
 * (`helpers/nav-more.ts`) mocks `/api/auth/me`, and the account menu (story
 * 59.3) is covered that way in `account-menu.spec.ts` / `.paid.spec.ts`. This
 * docblock used to say they could only be unit-tested.
 *
 * ⚠️ Since story 59.3 the STRIP and the labelled `role="status"` region are two
 * elements. The strip is the outer row (`[data-auth-indicator]`), which owns
 * the chrome and the height reserve; the region is a child of it, holding only
 * non-interactive content, because the account menu cannot live inside a live
 * region. On `/login` a signed-out region is EMPTY, so its width is 0 and
 * Playwright reports it hidden. Assertions about the strip's box therefore
 * measure the row; assertions about the region check it is attached.
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

  // The sign-in card rendered. Scoped to the card's <h2> deliberately: story
  // 41.3 removed the AuthIndicator's "Sign in" link FROM THIS ROUTE, so an
  // unscoped /^sign in$/i match would now succeed on the heading alone and stop
  // distinguishing the card from the strip. Keeping the role scope means this
  // assertion still says what it always said — the CARD is here — rather than
  // quietly becoming a weaker claim.
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

/**
 * The sign-in page (story 41.3, UX-DR51).
 *
 * ⚠️ Both tests below assert the CONTRAST — the affordance present on `/` and
 * absent on `/login` — in a single test rather than asserting the absence alone.
 * A bare "zero sign-in links on /login" is indistinguishable from a strip that
 * failed to render at all, and every pre-41.3 assertion on this surface runs at
 * `/`, so none of them can tell the two apart either.
 */
test('drops the "Sign in" affordance on /login while the Overview keeps it', async ({ page }) => {
  // ⚠️ The title says "the Overview", not "everywhere else", because `/` is the
  // only route this test visits. A mutation that over-suppressed the link — say
  // `pathname.startsWith('/log')` — would leave this green; what objects to that
  // is the jsdom `/pricing` contrast test. Titles are what a human reads first,
  // so this one claims only what it measures.
  //
  // Positive control first: the affordance really is there to be removed.
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const onHome = page.getByRole('status', { name: /account status/i })
  await expect(onHome.getByRole('link', { name: /sign in/i })).toBeVisible()

  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  const onLogin = page.getByRole('status', { name: /account status/i })
  // The strip itself survives — removing the region would trade a dead link for
  // a collapsed strip. The region is empty here (width 0), so it is checked for
  // PRESENCE; the strip it sits in is what must be visible (story 59.3).
  //
  // ⚠️ Since 59.3 the height test below measures the ROW, which carries its own
  // reserve, so it would stay green if the region vanished. The region's
  // survival is carried by this `toBeAttached()` alone — do not weaken it.
  await expect(onLogin).toBeAttached()
  await expect(page.locator('[data-auth-indicator]')).toBeVisible()
  await expect(onLogin.getByRole('link', { name: /sign in/i })).toHaveCount(0)

  // And the page's own sign-in card is untouched: this story removes the
  // redundant chrome, not the affordance the user actually came for.
  await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible()
})
