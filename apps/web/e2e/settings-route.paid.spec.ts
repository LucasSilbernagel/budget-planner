import { type Page, expect, test } from '@playwright/test'
import { expectSignedInAs } from './helpers/account-menu'
import { LONG_EMAIL, NAV, mockSignedIn } from './helpers/nav-more'

/**
 * A SIGNED-IN user with JavaScript off still reaches `/settings` from the
 * chrome (story 69.3, decision D3, Lucas 2026-09-25).
 *
 * Story 69.2 moved Settings out of the nav's JS-free `<details>` and into the
 * account menu, which is a React `<button>` (59.3 D1), so a signed-in user with
 * JavaScript off lost their route (FR90, marked OPEN). D3 restores it with a
 * server-rendered `<noscript>` gear in the signed-in cluster.
 *
 * Why the PAID server (`:5174`): its SSR seed is AUTHENTICATED, so with
 * JavaScript off the page arrives with the signed-in cluster already rendered.
 * The free server has no session at all, and with JavaScript off nothing would
 * ever fetch one.
 *
 * ⚠️ HONEST SCOPE (D3): `<noscript>` covers JavaScript DISABLED. It does not
 * cover JavaScript that fails to load or the window before hydration; there the
 * account-menu trigger renders and does nothing until React runs.
 */

function settingsOutsideNav(page: Page) {
  return page.locator(`a[href="/settings"]:not(${NAV} *)`)
}

test.describe('signed in, JavaScript OFF (AC-6)', () => {
  test.use({ javaScriptEnabled: false })

  for (const width of [800, 1280] as const) {
    test(`a signed-in user reaches /settings from the chrome at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/income')
      // Anti-vacuity: prove this IS the signed-in cluster (the SSR seed), not a
      // signed-out strip whose own gear would satisfy the locator below.
      await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
      await expect(
        page
          .getByRole('status', { name: /account status/i })
          .getByRole('link', { name: /sign in/i })
      ).toHaveCount(0)

      const link = settingsOutsideNav(page)
      await expect(
        link,
        'no Settings link outside the nav for a signed-in JS-off user'
      ).toHaveCount(1)
      await expect(link).toBeVisible()
      await expect(link).toHaveAccessibleName('Settings')
      await link.click()
      await expect(page).toHaveURL(/\/settings$/)
    })
  }
})

test.describe('signed in, JavaScript ON (AC-6)', () => {
  test('there is no visible gear: the account menu is the only chrome route', async ({ page }) => {
    // BOTH channels (story 69.3 code review): React 19 reports a recoverable
    // hydration mismatch through `reportError`, which surfaces as a page error,
    // and in development it ALSO logs to the console. Any page error fails
    // this test, whatever its text (a production build minifies the message).
    const errors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await mockSignedIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/income')
    await expectSignedInAs(page, LONG_EMAIL)

    // The panel is closed, so its Settings link is not rendered either; any
    // match here would be the <noscript> content leaking into the live DOM.
    await expect(settingsOutsideNav(page)).toHaveCount(0)
    expect(
      errors.filter((e) => /hydrat|did not match|mismatch/i.test(e)),
      'the <noscript> gear caused a hydration error'
    ).toEqual([])
    expect(pageErrors, 'the page threw during load or hydration').toEqual([])
  })
})
