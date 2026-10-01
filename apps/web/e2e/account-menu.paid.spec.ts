import { expect, test } from '@playwright/test'
import { SESSION_SETTLE_MS, accountTrigger, openAccountMenu } from './helpers/account-menu'
import { mockSessionThatCanEnd } from './helpers/nav-more'

/**
 * Sign out end to end for a PAID session (story 59.3, FR99): critical flow F4
 * of FR137, at the widest viewport.
 *
 * ⚠️ `.paid.spec.ts` is load-bearing: only the `chromium-paid` project (:5174,
 * booted with an entitled `E2E_SESSION_SEED`) runs this file. Rename it and it
 * silently measures the FREE chrome. See `playwright.config.ts`.
 *
 * Moved below the browser in story 84.3: the email-free trigger and the
 * premium routes beside an open menu (`auth-indicator.test.tsx`,
 * `nav-account-row.test.tsx`), and the COMPONENT half of the first paint:
 * given an entitled seed, the server HTML holds the collapsed trigger
 * (`auth-indicator.ssr.dom.test.tsx`). The SERVER half, the root loader
 * turning `E2E_SESSION_SEED` into that seed, is exercised by flow F5
 * (`tier-aware-surfaces.paid`, `forecasting-seed.paid`) and is 84.4's to pin.
 */

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
