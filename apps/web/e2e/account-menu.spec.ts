import { expect, test } from '@playwright/test'
import { SESSION_SETTLE_MS, accountTrigger, openAccountMenu } from './helpers/account-menu'
import { mockSessionThatCanEnd } from './helpers/nav-more'

test('signs out end to end: one logout POST, then a document load to /', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  let logoutPosts = 0
  const session = await mockSessionThatCanEnd(page, { subscriptionStatus: 'free' })
  await page.route('**/api/auth/logout', async (route) => {
    if (route.request().method() === 'POST') logoutPosts += 1
    session.signedOut = true
    await route.fulfill({ json: { success: true } })
  })
  await page.goto('/income')
  await expect(accountTrigger(page)).toBeVisible({ timeout: SESSION_SETTLE_MS })
  // Survives only a client navigation, so its absence proves the full document
  // load sign-out needs to drop the seed-once nav state.
  await page.evaluate(() => {
    ;(window as unknown as { __beforeSignOut: boolean }).__beforeSignOut = true
  })

  const panel = await openAccountMenu(page)
  await panel.getByRole('button', { name: 'Sign out' }).click()

  await expect(page).toHaveURL(/\/$/)
  // No real server session exists, so these only sanity-check the signed-out
  // chrome; the single POST and the lost marker are the real proof.
  const strip = page.getByRole('status', { name: /account status/i })
  await expect(strip.getByRole('link', { name: /sign in/i })).toBeVisible()
  await expect(accountTrigger(page)).toHaveCount(0)
  expect(
    await page.evaluate(() => (window as unknown as { __beforeSignOut?: boolean }).__beforeSignOut),
    'sign-out was a client navigation, not a document load'
  ).toBeUndefined()
  expect(logoutPosts, 'expected exactly one logout POST').toBe(1)
})
