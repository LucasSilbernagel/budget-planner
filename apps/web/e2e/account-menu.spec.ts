import { expect, test } from '@playwright/test'
import {
  accountPanel,
  accountTrigger,
  openAccountMenu,
  panelOcclusion,
} from './helpers/account-menu'
import {
  LONG_EMAIL,
  MORE_SUMMARY,
  isMoreOpen,
  mockSignedIn,
  openMore,
  sweepHeaderRow,
} from './helpers/nav-more'

/**
 * The account menu, FREE server (story 59.3, FR99).
 *
 * A signed-in user signs out from the chrome, on every page and at every
 * width, instead of only from the bottom of `/settings`. The SSR seed here is
 * signed-out, so every test mocks `/api/auth/me` with `mockSignedIn()` and the
 * cluster flips to signed-in after mount. The paid seam, where the trigger is
 * in the FIRST paint, and the narrow-width email table are in
 * `account-menu.paid.spec.ts`.
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
  await expect(accountTrigger(page)).toBeVisible()
}

test('signs out end to end: one logout POST, then a document load to /', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  let logoutPosts = 0
  await page.route('**/api/auth/logout', async (route) => {
    if (route.request().method() === 'POST') logoutPosts += 1
    // The session ends: from here on the server reports nobody signed in.
    await page.unroute('**/api/auth/me')
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: { user: null } }))
    await route.fulfill({ json: { success: true } })
  })
  await gotoSignedIn(page, '/income')
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

const ROUTES = ['/', '/income', '/settings', '/login', '/pricing', '/forecasting'] as const

for (const width of [320, 1280] as const) {
  test(`the menu opens, holds Sign out and is painted over on no page at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await mockSignedIn(page, { subscriptionStatus: 'free' })
    const problems: string[] = []
    for (const route of ROUTES) {
      await page.goto(route)
      await expect(accountTrigger(page), `no trigger on ${route}`).toBeVisible()
      const panel = await openAccountMenu(page)
      await expect(panel.getByRole('button', { name: 'Sign out' })).toBeVisible()
      await expect(panel).toContainText(`Signed in as ${LONG_EMAIL}`)
      for (const miss of await panelOcclusion(panel)) problems.push(`${route}: ${miss}`)
    }
    expect(problems, 'something paints over the open account panel').toEqual([])
  })
}

test('at 320px the panel hangs DOWN from the strip, full width, over the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await gotoSignedIn(page, '/')
  const panel = await openAccountMenu(page)
  const strip = await page.locator('[data-auth-indicator]').boundingBox()
  const box = await panel.boundingBox()
  expect(strip).not.toBeNull()
  expect(box).not.toBeNull()
  if (!strip || !box) return
  // Downward: the mirror of the nav sheet, which opens UP from the bottom bar.
  expect(box.y, 'the panel does not start at the bottom of the strip').toBeGreaterThanOrEqual(
    strip.y + strip.height - 1
  )
  expect(box.y, 'the panel is detached from the strip').toBeLessThanOrEqual(
    strip.y + strip.height + 1
  )
  expect(box.x).toBeCloseTo(0, 0)
  expect(box.width).toBeCloseTo(320, 0)
  // Opaque: the page must not show through.
  const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg, 'the panel is transparent').not.toMatch(/rgba\(.*, 0\)|transparent/)
})

test('at 1280px the panel hangs below the trigger, right-aligned and on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await gotoSignedIn(page, '/')
  const trigger = await accountTrigger(page).boundingBox()
  const panel = await openAccountMenu(page)
  const box = await panel.boundingBox()
  expect(trigger).not.toBeNull()
  expect(box).not.toBeNull()
  if (!trigger || !box) return
  expect(box.y).toBeGreaterThanOrEqual(trigger.y + trigger.height)
  expect(box.x + box.width, 'the panel is not right-aligned to the trigger').toBeCloseTo(
    trigger.x + trigger.width,
    0
  )
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(1280)
})

for (const width of [320, 1280] as const) {
  test(`the trigger and the Sign out row meet the 28px target floor at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await gotoSignedIn(page, '/')
    const trigger = await accountTrigger(page).boundingBox()
    expect(trigger?.height ?? 0, 'trigger height').toBeGreaterThanOrEqual(28)
    expect(trigger?.width ?? 0, 'trigger width').toBeGreaterThanOrEqual(28)
    const panel = await openAccountMenu(page)
    const row = await panel.getByRole('button', { name: 'Sign out' }).boundingBox()
    expect(row?.height ?? 0, 'Sign out row height').toBeGreaterThanOrEqual(28)
  })
}

test('the 320px strip is the same height signed in as signed out (no layout shift)', async ({
  page,
}) => {
  // Story 13-2's reserve. MEASURED during 59.3: the first build grew the
  // signed-in strip to 33px, because a 32px trigger and a 32px status region
  // both sat inside a row whose 32px includes its 1px bottom border. The
  // primary claim is the COMPARISON — signed-in against signed-out, same page
  // and viewport — so the host font cannot move it. The absolute pin below is
  // there because the comparison alone cannot see a reserve that grew in both
  // states at once.
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  const strip = page.locator('[data-auth-indicator]')
  await expect(strip.getByRole('link', { name: /sign in/i })).toBeVisible()
  const signedOut = await strip.boundingBox()

  await mockSignedIn(page, { subscriptionStatus: 'active' })
  await page.reload()
  await expect(accountTrigger(page)).toBeVisible()
  const signedIn = await strip.boundingBox()

  expect(signedOut?.height ?? 0).toBeGreaterThan(0)
  expect(signedIn?.height, 'the strip changed height when the user signed in').toBe(
    signedOut?.height
  )
  // ⚠️ The equality alone is not enough, and a mutation proved it: put the
  // status region's mobile reserve back to a full 32px and BOTH states become
  // 33px, so they still match. 32 is the reserve itself (`min-h-[2rem]`,
  // border included) — a design constant from story 13-2, not a font-dependent
  // measurement — so it is pinned outright.
  expect(signedIn?.height, 'the 320px strip is no longer the 2rem reserve').toBe(32)
  expect(signedOut?.height).toBe(32)
})

/**
 * Two disclosures, one bar (UX record 2026-09-21, §5.4). Each closes the other
 * when the user PRESSES the other's trigger, in both orders, and neither is
 * left stuck open. Focus lands on what was pressed.
 */
for (const width of [320, 1280] as const) {
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
  // account menu opened.
  await page.setViewportSize({ width: 1280, height: 800 })
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

test('Tab from the open trigger reaches Sign out, and Escape returns focus to the trigger', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await gotoSignedIn(page, '/')
  await accountTrigger(page).focus()
  await page.keyboard.press('Space')
  await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'true')
  // No auto-focus into the panel: disclosure convention.
  await expect(accountTrigger(page)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(accountTrigger(page)).toBeFocused()
})

test('a FREE signed-in user with a long email keeps one header row and a legible email', async ({
  page,
}) => {
  await mockSignedIn(page, { subscriptionStatus: 'free' })
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  await expect(accountTrigger(page)).toBeVisible()
  // No Premium pill for a free user, so the email keeps the room the pill
  // would take, and the narrow-width hiding (Premium only) does not apply.
  const strip = page.getByRole('status', { name: /account status/i })
  await expect(strip.getByText('Premium', { exact: true })).toHaveCount(0)
  const email = accountTrigger(page).getByText(LONG_EMAIL, { exact: true })
  await expect(email).toBeVisible()
  const visible = await email.evaluate((el) => el.clientWidth)
  expect(visible, 'a free user’s email is under 24px at 640px').toBeGreaterThanOrEqual(24)

  expect(await sweepHeaderRow(page), 'the signed-in header row broke').toEqual([])
})

test('an open account panel never reaches paper', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await gotoSignedIn(page, '/')
  const panel = await openAccountMenu(page)
  await page.emulateMedia({ media: 'print' })
  await expect(panel).toBeHidden()
  await expect(accountTrigger(page)).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  await expect(panel).toBeVisible()
})

test('a PREMIUM signed-in cluster on the free nav also keeps the header to one row', async ({
  page,
}) => {
  // The tier x server combination AC-12 asks for that the paid spec cannot
  // cover: the Premium pill beside the FREE nav. Review found only two of the
  // four combinations were swept.
  await mockSignedIn(page, { subscriptionStatus: 'active' })
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  await expect(accountTrigger(page)).toBeVisible()
  await expect(
    page.getByRole('status', { name: /account status/i }).getByText('Premium', { exact: true })
  ).toBeVisible()
  expect(await sweepHeaderRow(page), 'the premium-cluster free header row broke').toEqual([])
})
