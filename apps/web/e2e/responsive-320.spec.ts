import { expect, test } from '@playwright/test'

/**
 * Responsive guard E2E (Story 6.1 / UX-DR9).
 *
 * Asserts that every primary route is free of horizontal overflow at a 320px
 * viewport — the narrowest target width (small/older phones). Horizontal
 * overflow is the dominant 320px failure mode (page-padding, fixed-width grids,
 * non-wrapping toolbars), so this is the story's primary automated proof (AC-5).
 *
 * The check compares the document's full scroll width against its visible
 * client width; any element that pushes the page wider than the viewport makes
 * `scrollWidth > clientWidth` and fails the route.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const NARROW_WIDTH = 320

// Primary routes from AC-1. A doc page (`/docs/getting-started`) exercises the
// docs detail layout in addition to the docs index.
const ROUTES = [
  '/',
  '/income',
  '/expenses',
  '/savings',
  '/savings-goals',
  '/balance',
  '/balance-tracking',
  '/net-worth-projection',
  '/retirement',
  '/forecasting',
  '/profiles',
  '/login',
  '/pricing',
  '/terms',
  '/privacy',
  '/refund',
  '/docs',
  '/docs/getting-started',
] as const

async function assertNoHorizontalOverflow(evaluate: <R>(fn: () => R) => Promise<R>, label: string) {
  const { scrollWidth, clientWidth } = await evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))

  expect(
    scrollWidth,
    `${label} overflows horizontally: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`
  ).toBeLessThanOrEqual(clientWidth)
}

test.describe('no horizontal overflow at 320px', () => {
  for (const route of ROUTES) {
    test(`${route} fits a 320px viewport`, async ({ page }) => {
      await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })

      const response = await page.goto(route)
      expect(response?.ok(), `expected ${route} to load`).toBeTruthy()

      // Allow the client bundle to hydrate so client-only layout (charts,
      // currency toggle controls) is measured, not just the SSR markup.
      await page.waitForLoadState('networkidle')

      // Guard against a spurious pass: a route that hydrates blank or to an
      // error fallback would trivially satisfy the overflow check on a near-
      // empty document. Every primary route renders at least one heading.
      await expect(page.getByRole('heading').first()).toBeVisible()

      await assertNoHorizontalOverflow((fn) => page.evaluate(fn), route)
    })
  }

  // The route sweep above runs with empty localStorage, so the dashboard shows
  // its empty state. This seeds free-tier data (localStorage only, no auth) so
  // the data-dependent widgets — the Recharts pie/bar charts and the large
  // `text-2xl` overview figures — actually render, then re-checks overflow with
  // the currency symbols turned on (the widest CurrencyToggle state).
  //
  // It deliberately seeds MANY distinct expense/income categories so the pie
  // renders many slices: that is the path where the narrow-viewport change
  // suppresses the per-slice labels and moves the legend to a wrapping bottom
  // row, so we also assert the legend stays within its chart container (no
  // vertical clipping that would silently hide the category breakdown).
  test('dashboard with multi-category data and currency symbols fits a 320px viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })

    await page.addInitScript(() => {
      const now = new Date().toISOString()
      const row = (name: string, amount: number, frequency: string) => ({
        id: crypto.randomUUID(),
        userId: 0,
        name,
        amount,
        frequency,
        createdAt: now,
        updatedAt: now,
      })
      // Amounts are in cents; large values stress numeric wrapping. Distinct
      // names become distinct pie slices (category falls back to name).
      localStorage.setItem(
        'budget-planner-income-v1',
        JSON.stringify({
          state: {
            incomeSources: [
              row('Primary Salary Long Name', 1234567890, 'monthly'),
              row('Freelance & Consulting', 45678900, 'monthly'),
              row('Dividends', 12345600, 'monthly'),
            ],
          },
          version: 1,
        })
      )
      localStorage.setItem(
        'budget-planner-expenses-v1',
        JSON.stringify({
          state: {
            expenses: [
              row('Mortgage & Housing Costs', 987654321, 'monthly'),
              row('Groceries', 65432100, 'monthly'),
              row('Transportation', 43210000, 'monthly'),
              row('Utilities', 32100000, 'monthly'),
              row('Insurance Premiums', 21000000, 'monthly'),
              row('Entertainment & Dining', 19000000, 'monthly'),
            ],
          },
          version: 1,
        })
      )
      // Explicit-symbols mode renders both currency + locale selects in the
      // toggle — its widest layout.
      localStorage.setItem(
        'budget-planner-currency-prefs-v1',
        JSON.stringify({ state: { mode: 'symbol', currency: 'USD', locale: 'en-US' }, version: 0 })
      )
    })

    const response = await page.goto('/')
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState('networkidle')

    // Confirm the data path actually rendered a chart (not the empty state).
    const chart = page.locator('.recharts-responsive-container').first()
    await expect(chart).toBeVisible()

    await assertNoHorizontalOverflow((fn) => page.evaluate(fn), '/ (with data)')

    // The bottom legend must stay inside its chart container — a wrapping
    // multi-row legend that overflows the fixed-height box would clip the
    // category names the suppressed slice labels used to show.
    const clip = await page.evaluate(() => {
      const container = document.querySelector('.recharts-responsive-container')
      const legend = container?.querySelector('.recharts-legend-wrapper')
      if (!container || !legend) {
        return { ok: true, reason: 'no legend rendered' }
      }
      const c = container.getBoundingClientRect()
      const l = legend.getBoundingClientRect()
      // 2px tolerance for sub-pixel rounding.
      return {
        ok: l.bottom <= c.bottom + 2 && l.right <= c.right + 2,
        legendBottom: l.bottom,
        containerBottom: c.bottom,
      }
    })
    expect(clip.ok, `pie legend clips its container: ${JSON.stringify(clip)}`).toBeTruthy()
  })
})
