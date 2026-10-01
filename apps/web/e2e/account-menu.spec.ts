import { expect, test } from '@playwright/test'
import { SESSION_SETTLE_MS, accountTrigger, openAccountMenu } from './helpers/account-menu'
import { mockSessionThatCanEnd } from './helpers/nav-more'

/**
 * Sign out end to end, FREE server (story 59.3, FR99): critical flow F4 of
 * FR137 (`sprint-change-proposal-2026-09-30.md` D4).
 *
 * This file used to hold the account menu's disclosure, keyboard and
 * mutual-dismissal tests too. Story 84.3 moved them below the browser
 * (`auth-indicator.test.tsx`, `nav-account-row.test.tsx`); the inventory is
 * `_bmad-output/implementation-artifacts/84-3-evidence/inventory.md`. What
 * stays is the flow only a browser can run: a real logout POST followed by a
 * real document load. The paid twin is `account-menu.paid.spec.ts`.
 */

test('signs out end to end: one logout POST, then a document load to /', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  let logoutPosts = 0
  const session = await mockSessionThatCanEnd(page, { subscriptionStatus: 'free' })
  await page.route('**/api/auth/logout', async (route) => {
    if (route.request().method() === 'POST') logoutPosts += 1
    // The session ends: from here on the mock reports nobody signed in. A flag,
    // not a re-route from inside a live route handler (`mockSessionThatCanEnd`).
    session.signedOut = true
    await route.fulfill({ json: { success: true } })
  })
  await page.goto('/income')
  await expect(accountTrigger(page)).toBeVisible({ timeout: SESSION_SETTLE_MS })
  // A marker that only survives a CLIENT navigation. Its absence afterwards
  // proves a document load, which is the whole point of the shared sign-out
  // (`lib/account/sign-out.ts`): a client navigation keeps the seed-once nav
  // showing the signed-in state.
  await page.evaluate(() => {
    ;(window as unknown as { __beforeSignOut: boolean }).__beforeSignOut = true
  })

  const panel = await openAccountMenu(page)
  await panel.getByRole('button', { name: 'Sign out' }).click()

  await expect(page).toHaveURL(/\/$/)
  // ⚠️ What these two lines do NOT prove, corrected in review: neither e2e
  // server has a real session, so "Sign in" and a zero trigger count would
  // appear even if the logout had cleared nothing server-side. They are a
  // sanity check that the reload landed on the signed-out chrome, no more.
  // The load-bearing assertions are the single POST and the lost marker below.
  const strip = page.getByRole('status', { name: /account status/i })
  await expect(strip.getByRole('link', { name: /sign in/i })).toBeVisible()
  await expect(accountTrigger(page)).toHaveCount(0)
  expect(
    await page.evaluate(() => (window as unknown as { __beforeSignOut?: boolean }).__beforeSignOut),
    'sign-out was a client navigation, not a document load'
  ).toBeUndefined()
  expect(logoutPosts, 'expected exactly one logout POST').toBe(1)
})
