import { expect, test } from '@playwright/test'
import { accountTrigger, openAccountMenu } from './helpers/account-menu'
import {
  LONG_EMAIL,
  MORE_PANEL,
  MORE_SUMMARY,
  isMoreOpen,
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
 * AC-13: the trigger email's visible width, MEASURED. Decision D2 (Lucas,
 * 2026-09-22) is to hide it wherever it measures under 24px, which for a
 * Premium user is below 660px.
 *
 * ⚠️ THE ONE PLACE these numbers live. Three files have carried stale copies of
 * nav widths before; do not restate them elsewhere.
 *
 * `LONG_EMAIL` is 44 characters. Full text width: 335px under DejaVu (what CI
 * resolves `system-ui` to), 313px under Noto (a typical dev box).
 *
 * | viewport | visible, DejaVu | visible, Noto |
 * |---|---|---|
 * | 320 (mobile strip) | 131 of 335 | 137 of 313 |
 * | 640 | HIDDEN (10 with the rule removed) | HIDDEN (32 with it removed) |
 * | 660 | 30 | 52 |
 * | 680 | 50 | 72 |
 * | 700 | 70 | 92 |
 * | 800 | 170 | 192 |
 * | 1024 | 335 (full) | 313 (full) |
 * | 1152 | 335 (full) | 313 (full) |
 *
 * ⚠️ The 320px Noto cell read "full" until review measured it: 137 of 313, i.e.
 * truncated, like every other narrow reading. It was never measured — it was
 * filled in. The rest of the column reproduces exactly.
 *
 * The pre-59.3 figures, for comparison (the email was then in the status
 * region, with no trigger chrome around it): 50px at 640, 110 at 700, 210 at
 * 800, full from 1024 (DejaVu).
 *
 * The assertions are font-independent on purpose: hidden below 660, at least
 * 24px at 660, and monotonically wider as the viewport grows. The table is the
 * record; the assertions are what CI can hold to under either font.
 */
test('the trigger email is hidden where it would be an ellipsis, and grows with the viewport', async ({
  page,
}) => {
  await mockSignedIn(page, { subscriptionStatus: 'active' })
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  const email = accountTrigger(page).getByText(LONG_EMAIL, { exact: true })
  await expect(email).toHaveCount(1)

  await expect(email, 'the email is not hidden at 640px').toBeHidden()
  await page.setViewportSize({ width: 659, height: 800 })
  await expect(email, 'the email is not hidden at 659px').toBeHidden()

  const widths: number[] = []
  for (const width of [660, 680, 700, 800, 1024, 1152] as const) {
    await page.setViewportSize({ width, height: 800 })
    await expect(email, `the email is hidden at ${width}px`).toBeVisible()
    widths.push(await email.evaluate((el) => el.clientWidth))
  }
  const [at660] = widths
  expect(
    at660,
    'the email is under 24px at 660px, which is what D2 forbids'
  ).toBeGreaterThanOrEqual(24)
  // Monotonic: every step wider shows at least as much email.
  for (let i = 1; i < widths.length; i += 1) {
    expect(
      widths[i],
      `the email shrank between steps: ${widths.join(', ')}`
    ).toBeGreaterThanOrEqual(widths[i - 1])
  }
  // And it really is truncation, not a short string: the full text is wider.
  const full = await email.evaluate((el) => el.scrollWidth)
  expect(widths[0]).toBeLessThan(full)
  expect(widths[widths.length - 1], 'the email never reaches full width').toBe(full)
})

test('a paid signed-in cluster keeps the header to ONE row at every desktop width', async ({
  page,
}) => {
  await mockSignedIn(page, { subscriptionStatus: 'active' })
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  await expect(accountTrigger(page)).toBeVisible()
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
  await page.route('**/api/auth/logout', async (route) => {
    if (route.request().method() === 'POST') logoutPosts += 1
    await page.unroute('**/api/auth/me')
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: { user: null } }))
    await route.fulfill({ json: { success: true } })
  })
  await mockSignedIn(page, { subscriptionStatus: 'active' })
  await page.goto('/report')
  const panel = await openAccountMenu(page, { acrossHydration: true })
  await panel.getByRole('button', { name: 'Sign out' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(accountTrigger(page)).toHaveCount(0)
  expect(logoutPosts, 'expected exactly one logout POST').toBe(1)
})

test('a FREE signed-in cluster on the paid nav also keeps the header to one row', async ({
  page,
}) => {
  // The fourth tier x server combination (AC-12): the widest nav (paid) beside
  // a cluster with no Premium pill, so the email keeps the pill's width and the
  // narrow-width hiding does not apply. Review found only two of the four were
  // covered.
  await mockSignedIn(page, { subscriptionStatus: 'free' })
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  await expect(accountTrigger(page)).toBeVisible()
  await expect(
    page.getByRole('status', { name: /account status/i }).getByText('Premium', { exact: true })
  ).toHaveCount(0)
  expect(await sweepHeaderRow(page), 'the free-cluster paid header row broke').toEqual([])
})
