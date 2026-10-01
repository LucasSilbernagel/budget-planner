import { expect, test } from '@playwright/test'
import { MORE_SUMMARY, isMoreOpen } from './helpers/nav-more'

/**
 * The "More" disclosure for a PAID session (story 59.2, FR90).
 *
 * ⚠️ `.paid.spec.ts` is load-bearing: only the `chromium-paid` project (:5174,
 * booted with an entitled `E2E_SESSION_SEED`) runs this file. Rename it and it
 * silently measures the FREE nav. See `playwright.config.ts`.
 *
 * This is the story's reason to exist: until 59.2 a paying user's eleven anchors
 * wrapped to TWO rows at every desktop width. Since story 58.2 this nav is also a
 * paying user's ONLY route to Forecasting, Profiles, Report and Categories, with
 * no footer or Overview fallback. So every assertion below proves REACH (role-
 * visible and clickable), not DOM presence.
 */

const PANEL_ROUTES: readonly [label: string, path: string][] = [
  ['Balances', '/balance'],
  ['Retirement', '/retirement'],
  ['Forecasting', '/forecasting'],
  ['Profiles', '/profiles'],
  ['Report', '/report'],
  ['Categories', '/categories'],
]

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false })

  for (const width of [320, 1280] as const) {
    test(`every paid destination is reachable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      for (const [label, path] of PANEL_ROUTES) {
        await page.goto('/')
        expect(await isMoreOpen(page)).toBe(false)
        await page.locator(MORE_SUMMARY).click()
        const link = page
          .getByRole('navigation', { name: 'Primary' })
          .getByRole('link', { name: label, exact: true })
        await expect(link, `${label} is unreachable with JS off at ${width}px`).toBeVisible()
        await link.click()
        await expect(page).toHaveURL(new RegExp(`${path}$`))
      }
    })
  }
})
