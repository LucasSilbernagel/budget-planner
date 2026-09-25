import { type Page, expect, test } from '@playwright/test'
import { SESSION_SETTLE_MS, accountTrigger, openAccountMenu } from './helpers/account-menu'
import { NAV, mockSignedIn } from './helpers/nav-more'

/**
 * Every session keeps a route to `/settings` (story 69.2, FR109; epic 69 AC-5
 * and AC-6).
 *
 * Story 69.2 took Settings OUT of the nav. A signed-in user reaches it from the
 * account menu; a signed-OUT visitor has no account menu, so they get an
 * icon-only gear link in the account cluster (decision D1, Lucas 2026-09-25).
 * `/settings` holds the currency, theme and retirement-planner toggles and
 * Clear local data, all free-tier, so stranding a signed-out visitor from it
 * would be a worse regression than the width this story saves.
 *
 * The locator is the claim: a link to `/settings` that is NOT inside the
 * primary `<nav>`. It is scoped by exclusion rather than to the cluster so that
 * the test asks "can a signed-out user get there from the chrome?" and not
 * "is the gear exactly where this story put it". Its RED run, against a build
 * with Settings already gone from the nav and no gear yet, is recorded in the
 * story's Dev Agent Record.
 */

/** A link to /settings anywhere in the page EXCEPT inside the primary nav. */
function settingsOutsideNav(page: Page) {
  return page.locator(`a[href="/settings"]:not(${NAV} *)`)
}

for (const width of [320, 1280] as const) {
  test(`a signed-out visitor reaches /settings from the chrome, not the nav, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    for (const route of ['/', '/income'] as const) {
      await page.goto(route)
      await expect(
        page
          .getByRole('status', { name: /account status/i })
          .getByRole('link', { name: /sign in/i }),
        `the signed-out cluster never resolved on ${route}`
      ).toBeVisible()
      const link = settingsOutsideNav(page)
      await expect(link, `no Settings link outside the nav on ${route}`).toHaveCount(1)
      await expect(link).toBeVisible()
      await expect(link).toHaveAccessibleName('Settings')
      // The nav no longer carries it, at either width.
      await expect(page.locator(`${NAV} a[href="/settings"]`)).toHaveCount(0)
    }
    // AC-6: the gear is a real 28x28 target and it is what a press there hits
    // (a token check cannot see either; 69.2 code review).
    const box = await settingsOutsideNav(page).boundingBox()
    expect(box, 'the gear has no box').not.toBeNull()
    const b = box as { x: number; y: number; width: number; height: number }
    expect(b.height, 'the gear is under the 28px target floor').toBeGreaterThanOrEqual(28)
    expect(b.width, 'the gear is under 24px wide').toBeGreaterThanOrEqual(24)
    const hitsGear = await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y)
        return hit?.closest('a[href="/settings"]') !== null && hit?.closest('nav') === null
      },
      { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    )
    expect(hitsGear, 'a press on the gear lands on something else').toBe(true)
    await settingsOutsideNav(page).click()
    await expect(page).toHaveURL(/\/settings$/)
    // On the page itself the gear stays, marked current: Settings is no longer
    // a nav destination, so this is the only "you are here" cue (UX-DR28).
    await expect(settingsOutsideNav(page)).toHaveAttribute('aria-current', 'page')
  })
}

test('the sign-in page keeps its deliberately empty strip: no gear on /login (D3)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  // Anti-vacuity, both halves (69.2 code review): prove the gear renders on a
  // route where it SHOULD, then LOAD /login (a document load, not a client
  // navigation) and wait for the cluster to have RESOLVED before asserting the
  // absence. The row is visible in the loading state too, so its visibility is
  // no gate; the resolved signed-out strip on /login is an EMPTY status region,
  // while the loading state holds one `aria-hidden` placeholder.
  await page.goto('/')
  await expect(settingsOutsideNav(page)).toHaveCount(1)
  await page.goto('/login')
  const region = page.getByRole('status', { name: /account status/i })
  await expect
    .poll(() => region.evaluate((el) => el.children.length), {
      message: 'the /login strip never resolved to its empty signed-out state',
    })
    .toBe(0)
  await expect(settingsOutsideNav(page)).toHaveCount(0)
})

test('a signed-in user reaches /settings from the account menu, which then closes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockSignedIn(page, { subscriptionStatus: 'free' })
  await page.goto('/income')
  await expect(accountTrigger(page)).toBeVisible({ timeout: SESSION_SETTLE_MS })
  // No gear for a signed-in user: the menu is their route.
  await expect(settingsOutsideNav(page)).toHaveCount(0)

  let panel = await openAccountMenu(page)
  await panel.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'false')

  // The SAME-ROUTE case (story 69.2, Read-first #4): on /settings, clicking
  // Settings changes no pathname, so only the link's own `onClick` closes it.
  panel = await openAccountMenu(page)
  const link = panel.getByRole('link', { name: 'Settings', exact: true })
  await expect(link).toHaveAttribute('aria-current', 'page')
  await link.click()
  await expect(
    accountTrigger(page),
    'the panel stayed open after a same-route click on Settings'
  ).toHaveAttribute('aria-expanded', 'false')
  await expect(page).toHaveURL(/\/settings$/)
})

// The nav's `<details>` exists so its routes survive with JavaScript off (story
// 59.2). Settings left that `<details>` in story 69.2, so the signed-out gear
// must carry the same guarantee: it is a server-rendered `<a>`, not a
// React-only control. (A SIGNED-IN user's route, the account menu, needs
// JavaScript to open, which story 59.3's decision D1 accepted for Sign out.)
test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false })

  for (const width of [320, 1280] as const) {
    test(`a signed-out visitor still reaches /settings at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/income')
      const link = settingsOutsideNav(page)
      await expect(link, 'the gear is not in the server-rendered HTML').toHaveCount(1)
      await expect(link).toBeVisible()
      // AC-4's JS-off arm, asserted rather than implied (69.2 code review): the
      // nav's JS-free `<details>` no longer carries Settings in either state.
      await expect(page.locator(`${NAV} a[href="/settings"]`)).toHaveCount(0)
      await page.locator(`${NAV} details > summary`).click()
      await expect(page.locator(`${NAV} a[href="/settings"]`)).toHaveCount(0)
      await link.click()
      await expect(page).toHaveURL(/\/settings$/)
      await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible()
    })
  }
})
