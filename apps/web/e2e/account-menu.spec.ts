import { expect, test } from '@playwright/test'
import {
  SESSION_SETTLE_MS,
  accountPanel,
  accountTrigger,
  openAccountMenu,
} from './helpers/account-menu'
import {
  MORE_SUMMARY,
  isMoreOpen,
  mockSessionThatCanEnd,
  mockSignedIn,
  openMore,
} from './helpers/nav-more'

/**
 * The account menu, FREE server (story 59.3, FR99).
 *
 * A signed-in user signs out from the chrome, on every page and at every
 * width, instead of only from the bottom of `/settings`. The SSR seed here is
 * signed-out, so every test mocks `/api/auth/me` with `mockSignedIn()` and the
 * cluster flips to signed-in after mount. The paid seam, where the trigger is
 * in the FIRST paint, is in `account-menu.paid.spec.ts`. The routes to
 * `/settings` (the menu's link, and the signed-out gear) are in
 * `settings-route.spec.ts` (story 69.2).
 *
 * Everything here is a rendered fact that jsdom cannot see: geometry,
 * occlusion, real focus, real pointer sequences, a real document load.
 */

/** Wait for the post-mount session fetch to flip the cluster to signed-in. */
async function gotoSignedIn(
  page: import('@playwright/test').Page,
  path: string,
  subscriptionStatus = 'free'
) {
  await mockSignedIn(page, { subscriptionStatus })
  await page.goto(path)
  await expect(accountTrigger(page)).toBeVisible({ timeout: SESSION_SETTLE_MS })
}

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

/**
 * Two disclosures, one bar (UX record 2026-09-21, §5.4). Each closes the other
 * when the user PRESSES the other's trigger, in both orders, and neither is
 * left stuck open. Focus lands on what was pressed.
 *
 * ⚠️ The desktop arm is 1000px, not 1280px, since story 69.3: at `lg` (1024px)
 * and up a FREE session has no More (Balances and Retirement are on the row),
 * so there is only one disclosure left to interact with. 1000px is a free
 * desktop width that still has both (the widest is 1023px). The paid twin
 * keeps 1280px.
 */
for (const width of [320, 1000] as const) {
  test(`pressing one trigger closes the other disclosure, both orders, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await gotoSignedIn(page, '/')

    // Nav More open -> press the account trigger.
    await openMore(page)
    await accountTrigger(page).click()
    await expect.poll(() => isMoreOpen(page), 'More stayed open').toBe(false)
    await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(accountTrigger(page)).toBeFocused()

    // Account menu open -> press More.
    await page.locator(MORE_SUMMARY).click()
    await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(await accountPanel(page)).toHaveCount(0)
    await expect.poll(() => isMoreOpen(page), 'More did not open').toBe(true)
    await expect(page.locator(MORE_SUMMARY)).toBeFocused()
  })
}

test('by keyboard both can be open at once, and ONE Escape closes both without a focus fight', async ({
  page,
}) => {
  // Accepted, not a defect: the nav deliberately lets a keyboard user Tab past
  // its open panel (story 59.2 review), so no pointer event ever tells it the
  // account menu opened. 1000px: the free More exists only below `lg` since
  // story 69.3.
  await page.setViewportSize({ width: 1000, height: 800 })
  await gotoSignedIn(page, '/')

  await page.locator(MORE_SUMMARY).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => isMoreOpen(page)).toBe(true)
  await accountTrigger(page).focus()
  await page.keyboard.press('Enter')
  await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'true')
  expect(await isMoreOpen(page), 'the keyboard case this test is about did not arise').toBe(true)

  await page.keyboard.press('Escape')
  await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => isMoreOpen(page), 'More stayed open after Escape').toBe(false)
  // Focus was in the account cluster, so it returns to the account trigger,
  // and the nav does not yank it to More.
  await expect(accountTrigger(page)).toBeFocused()
})

test('Tab from the open trigger reaches Settings then Sign out, and Escape returns focus to the trigger', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await gotoSignedIn(page, '/')
  await accountTrigger(page).focus()
  await page.keyboard.press('Space')
  await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'true')
  // No auto-focus into the panel: disclosure convention.
  await expect(accountTrigger(page)).toBeFocused()
  // DOM order since story 69.2: the Settings link, then Sign out.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(accountTrigger(page)).toBeFocused()
})
