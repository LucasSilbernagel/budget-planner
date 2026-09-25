import { expect, test } from '@playwright/test'
import {
  SESSION_SETTLE_MS,
  accountTrigger,
  expectSignedInAs,
  openAccountMenu,
} from './helpers/account-menu'
import {
  LONG_EMAIL,
  MORE_PANEL,
  MORE_SUMMARY,
  isMoreOpen,
  mockSessionThatCanEnd,
  mockSignedIn,
  openMore,
  sweepHeaderRow,
} from './helpers/nav-more'

/**
 * The account menu for a PAID session (story 59.3, FR99).
 *
 * ⚠️ `.paid.spec.ts` is load-bearing: only the `chromium-paid` project (:5174,
 * booted with an entitled `E2E_SESSION_SEED`) runs this file. Rename it and it
 * silently measures the FREE nav. See `playwright.config.ts`.
 *
 * Two things only this server can show:
 *  - the trigger in the FIRST painted frame, from the SSR seed, rather than
 *    after the post-mount `/api/auth/me`;
 *  - the account menu beside a paid user's nav, which since story 58.2 is the
 *    SOLE route to Forecasting, Profiles, Report and Categories.
 *
 * `mockSignedIn()` is still needed: the seed paints the signed-in cluster, but
 * the post-mount fetch resolves signed-OUT on this server too and would unmount
 * the trigger (the 59.2 review's finding D1).
 */

const PREMIUM_ROUTES: readonly [label: string, path: string][] = [
  ['Forecasting', '/forecasting'],
  ['Profiles', '/profiles'],
  ['Report', '/report'],
  ['Categories', '/categories'],
]

test('the SSR seed paints the account trigger in the first frame', async ({ page }) => {
  // No mock and no hydration: the raw HTML the server sends. The strip's
  // authenticated branch, and with it the trigger, must already be there, or a
  // paying user sees the cluster appear late on every page load.
  const response = await page.request.get('/')
  const html = await response.text()
  expect(html).toContain('aria-label="Account menu"')
  expect(html).toContain('e2e-paid@example.test')
  // Closed in the first frame: the panel is rendered only while open.
  expect(html).not.toContain('Sign out')
  // ⚠️ Scoped to the trigger's own tag. A bare `toContain('aria-expanded=
  // "false"')` would be satisfied by any other collapsed control on the page
  // (review finding), so it is matched in the same element as the label,
  // in either attribute order.
  expect(
    /aria-expanded="false"[^>]*aria-label="Account menu"|aria-label="Account menu"[^>]*aria-expanded="false"/.test(
      html
    ),
    'the trigger is not server-rendered in the collapsed state'
  ).toBe(true)
  // And no dangling IDREF while closed.
  expect(/aria-label="Account menu"[^>]*aria-controls=/.test(html)).toBe(false)
})

test('the paid cluster carries the Premium pill OUTSIDE the trigger, at every width', async ({
  page,
}) => {
  await mockSignedIn(page, { subscriptionStatus: 'active' })
  for (const width of [320, 640, 1024, 1440] as const) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const pill = page.getByRole('status', { name: /account status/i }).getByText('Premium', {
      exact: true,
    })
    await expect(pill, `no Premium pill at ${width}px`).toBeVisible()
    const insideTrigger = await accountTrigger(page).evaluate(
      (el, text) => [...el.querySelectorAll('*')].some((n) => n.textContent?.trim() === text),
      'Premium'
    )
    expect(insideTrigger, `the pill was folded into the trigger at ${width}px`).toBe(false)
  }
})

/**
 * ⚠️ Story 69.2 (decision D2, Lucas 2026-09-25) removed the email from the
 * trigger. This file used to hold AC-13 of story 59.3: the trigger email's
 * MEASURED visible width at 320-1152px, hidden for a Premium user below 660px.
 * That table and its test were deleted with the email rather than kept as
 * history, because a width record that outlives its element reads like current
 * fact. The trigger's absence of any email is asserted below and in
 * `auth-indicator.test.tsx`.
 */
// One assertion, not a viewport loop (69.2 code review): `textContent` does not
// change with the viewport, so looping widths around it proved the same thing
// four times. What changes with the viewport (one row) is swept elsewhere.
test('the paid trigger carries no email', async ({ page }) => {
  await mockSignedIn(page, { subscriptionStatus: 'active' })
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  // Gate FIRST: the SSR seed paints a signed-in cluster with the SEED's email
  // in the first frame, so wait for the MOCKED identity to be announced.
  await expectSignedInAs(page, LONG_EMAIL)
  await expect(accountTrigger(page), 'the trigger shows an email').not.toContainText('@')
})

test('a paid signed-in cluster keeps the header to ONE row at every desktop width', async ({
  page,
}) => {
  await mockSignedIn(page, { subscriptionStatus: 'active' })
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  await expect(accountTrigger(page)).toBeVisible({ timeout: SESSION_SETTLE_MS })
  expect(await sweepHeaderRow(page), 'the signed-in header row broke').toEqual([])
})

test('the four premium routes stay reachable with the account menu open and closed', async ({
  page,
}) => {
  // Since story 58.2 the nav is a paying user's ONLY route to these four, with
  // no Overview card, no /settings tile and no footer fallback. A new
  // disclosure in the same bar must not cost any of them.
  await mockSignedIn(page, { subscriptionStatus: 'active' })
  await page.setViewportSize({ width: 1280, height: 800 })
  for (const [label, path] of PREMIUM_ROUTES) {
    await page.goto('/')
    // With the account menu OPEN: pressing More closes it and opens the nav
    // panel, so the destination is one further click away, never lost.
    await openAccountMenu(page, { acrossHydration: true })
    await page.locator(MORE_SUMMARY).click()
    await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => isMoreOpen(page)).toBe(true)
    await page.locator(`${MORE_PANEL} >> role=link[name="${label}"]`).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))

    // And with it closed, from the new page.
    await openMore(page)
    await expect(page.locator(`${MORE_PANEL} >> role=link[name="${label}"]`)).toBeVisible()
  }
})

test('a signed-in user signs out from the paid chrome too, at 2400px', async ({ page }) => {
  // AC-1 says every tier and every width from 320 to 2400. The free server
  // covers the sign-out click at 1280; this covers the paid seam and the widest
  // viewport, where the header is capped by `max-w-6xl` rather than the window.
  await page.setViewportSize({ width: 2400, height: 900 })
  let logoutPosts = 0
  const session = await mockSessionThatCanEnd(page, { subscriptionStatus: 'active' })
  await page.route('**/api/auth/logout', async (route) => {
    if (route.request().method() === 'POST') logoutPosts += 1
    // The session ends: from here on the mock reports nobody signed in. A flag,
    // not a re-route from inside a live route handler (`mockSessionThatCanEnd`).
    session.signedOut = true
    await route.fulfill({ json: { success: true } })
  })
  await page.goto('/report')
  const panel = await openAccountMenu(page, { acrossHydration: true })
  await panel.getByRole('button', { name: 'Sign out' }).click()

  await expect(page).toHaveURL(/\/$/)
  // ⚠️ This server's SSR seed is authenticated, so the reload REPAINTS the
  // trigger and it is removed only once the post-mount fetch reports signed-out.
  // The default 5s was not enough for that on CI (run 35782927398).
  await expect(accountTrigger(page)).toHaveCount(0, { timeout: SESSION_SETTLE_MS })
  expect(logoutPosts, 'expected exactly one logout POST').toBe(1)
})

test('a FREE signed-in cluster on the paid nav also keeps the header to one row', async ({
  page,
}) => {
  // The fourth tier x server combination (AC-12): the widest nav (paid) beside
  // a cluster with no Premium pill. Review found only two of the four were
  // covered.
  await mockSignedIn(page, { subscriptionStatus: 'free' })
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  // The seed is PAID, so the free cluster this test is about exists only after
  // the mocked fetch lands. Gate on the identity, not just on the trigger.
  await expectSignedInAs(page, LONG_EMAIL)
  await expect(
    page.getByRole('status', { name: /account status/i }).getByText('Premium', { exact: true })
  ).toHaveCount(0)
  expect(await sweepHeaderRow(page), 'the free-cluster paid header row broke').toEqual([])
})
