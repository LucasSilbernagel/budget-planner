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
  // a collapsed strip, which is what the height test below measures.
  await expect(onLogin).toBeVisible()
  await expect(onLogin.getByRole('link', { name: /sign in/i })).toHaveCount(0)

  // And the page's own sign-in card is untouched: this story removes the
  // redundant chrome, not the affordance the user actually came for.
  await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible()
})

/**
 * AC-3: the strip must not collapse when its only child is removed.
 *
 * ⚠️ This is the half of the requirement jsdom cannot see — every rect there is
 * `{0,0,0,0}`, so the unit suite's `min-h-[2rem]` is a class token, not a height.
 *
 * ⚠️ Nothing here is compared against a pixel constant. The reading on `/login`
 * is compared against the reading on `/` at the SAME viewport, so whatever the
 * host font does it does to both — the comparison cannot drift the way epic 34's
 * hard-coded 768px budget did.
 */
for (const viewport of [
  { width: 320, height: 720, label: '320px' },
  { width: 1280, height: 800, label: 'desktop' },
]) {
  test(`the account strip is the same height on /login as elsewhere at ${viewport.label}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const home = page.getByRole('status', { name: /account status/i })
    // Anti-vacuity: if the link were absent here too, equal heights would prove
    // nothing about removing it.
    await expect(home.getByRole('link', { name: /sign in/i })).toBeVisible()
    const homeBox = await home.boundingBox()

    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    const login = page.getByRole('status', { name: /account status/i })
    await expect(login.getByRole('link', { name: /sign in/i })).toHaveCount(0)
    const loginBox = await login.boundingBox()

    expect(homeBox, 'the strip has no box on /').not.toBeNull()
    expect(loginBox, 'the strip has no box on /login').not.toBeNull()
    // A collapsed strip would measure 0 and would also "equal" a second
    // collapsed reading, so the floor is asserted as well as the equality.
    expect(loginBox?.height, `the strip collapsed on /login at ${viewport.label}`).toBeGreaterThan(
      0
    )
    expect(
      loginBox?.height,
      `strip height differs between / and /login at ${viewport.label}: ` +
        `${loginBox?.height} vs ${homeBox?.height}`
    ).toBe(homeBox?.height)
  })
}
