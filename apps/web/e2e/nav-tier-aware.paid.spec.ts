import { type Page, expect, test } from '@playwright/test'
import { MORE_PANEL, NAV } from './helpers/nav-more'
import { PLANNER_STORAGE_KEY } from './helpers/nav-width'
const SHEET = MORE_PANEL
const STORAGE_KEY = PLANNER_STORAGE_KEY

/** The free server, for the negative control. Absolute: this project's baseURL is :5174. */
const FREE_ORIGIN = 'http://localhost:5173'

async function gotoNav(page: Page, url = '/'): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  await expect(page.locator(NAV)).toBeVisible()
}

/**
 * ⚠️ Every `${SHEET} > li` count in this file is DOM PRESENCE too, for the same
 * reason: CSS locators match the rows of a CLOSED `<details>`. They are the
 * right instrument for "the seam rendered the paid list". Reach is proven in
 * `tier-aware-surfaces.paid.spec.ts` and `nav-more-disclosure.paid.spec.ts`.
 */

/**
 * Anchor count in the nav, regardless of which are CSS-hidden at this width.
 *
 * ⚠️ DOM PRESENCE, not reachability. It is a CSS count, so since story 59.2 it
 * also counts the rows inside the CLOSED More `<details>`, at every width. That
 * is the right instrument for "the seam rendered the paid list" and the wrong
 * one for "a user can reach it" — `tier-aware-surfaces.paid.spec.ts` and
 * `nav-more-disclosure.paid.spec.ts` prove reach.
 */
async function anchorCount(page: Page): Promise<number> {
  return page.locator(`${NAV} a`).count()
}

test.describe('the paid nav really is the paid nav', () => {
  // The precondition every other test in this file rests on. If the seam stops
  // working, this fails FIRST and unambiguously, instead of leaving the
  // geometry assertions quietly measuring the free nav (6 anchors since 69.2).
  // Counts since story 69.2, which took Settings out of the nav: 10
  // destinations / 6 sheet rows paid, 6 / 2 free (11 / 7 and 7 / 3 before).
  // Since story 69.3 the DOM anchor count is two higher in both tiers:
  // Balances and Retirement also have a ROW copy (`hidden lg:block`), so 12
  // paid and 8 free. The sheet row counts are unchanged.
  test('the seam delivers an entitled session — 12 DOM anchors, 6 sheet rows', async ({ page }) => {
    await gotoNav(page)

    expect(await anchorCount(page)).toBe(12)
    await expect(page.locator(`${SHEET} > li`)).toHaveCount(6)

    for (const path of ['/forecasting', '/profiles', '/report', '/categories']) {
      await expect(
        page.locator(`${NAV} li[data-nav-path="${path}"]`),
        `${path} missing from the paid nav`
      ).toHaveCount(1)
    }
  })

  // ⚠️ THE NEGATIVE CONTROL. Without it, a seam that silently stopped working
  // would leave every "paid" assertion above passing against the free nav.
  test('the FREE server on :5173 is unaffected — 8 DOM anchors, 2 sheet rows', async ({ page }) => {
    await gotoNav(page, `${FREE_ORIGIN}/`)

    expect(await anchorCount(page)).toBe(8)
    await expect(page.locator(`${SHEET} > li`)).toHaveCount(2)
    for (const path of ['/forecasting', '/profiles', '/report', '/categories']) {
      await expect(
        page.locator(`${NAV} li[data-nav-path="${path}"]`),
        `${path} leaked into the FREE nav`
      ).toHaveCount(0)
    }
  })
})

/**
 * Tier and the Retirement preference are independent filters on one list, so the
 * PRODUCT of the two needs its own measurement — 9 anchors, 5 sheet rows (10 and
 * 6 until story 69.2 took Settings out).
 */
test('paid session with the Retirement planner hidden: 9 destinations, 5 rows', async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) => {
      localStorage.setItem(
        key,
        JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
      )
    },
    { key: STORAGE_KEY }
  )
  await page.setViewportSize({ width: 1280, height: 720 })
  await gotoNav(page)

  // 9 destinations + the Balances row copy (story 69.3; the Retirement row copy
  // is filtered with its sheet row) = 10 DOM anchors.
  expect(await anchorCount(page)).toBe(10)
  await expect(page.locator(`${SHEET} > li`)).toHaveCount(5)
  await expect(page.locator(`${NAV} li[data-nav-path="/retirement"]`)).toHaveCount(0)
  // The premium four are unaffected by a preference that is not about them.
  await expect(page.locator(`${NAV} li[data-nav-path="/report"]`)).toHaveCount(1)
})
