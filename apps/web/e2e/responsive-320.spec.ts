import { type Page, expect, test } from '@playwright/test'

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
// docs detail layout in addition to the docs index. (The global 404 route is
// checked separately in `not-found.spec.ts` — this sweep's `response.ok()` guard
// assumes a 2xx route, which an unmatched URL is not.)
const ROUTES = [
  '/',
  '/income',
  '/expenses',
  '/savings',
  '/balance',
  '/net-worth-projection',
  '/retirement',
  '/forecasting',
  '/settings',
  '/profiles',
  // Premium-gated (story 30.4b): this sweep is unauthenticated, so what gets
  // measured here is the full-page upgrade surface, not the manager.
  '/categories',
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

      // Allow the client bundle to hydrate so client-only layout (charts, the
      // settings controls, currency-formatted figures) is measured, not just the
      // SSR markup.
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
  // the currency symbols turned on (the widest currency-formatted figures). It
  // also visits /settings, where the CurrencyToggle now lives (story 11-6), to
  // guard its widest control layout (currency select revealed in symbol mode).
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
        // Story 30.4a: persist v2 shape. Seeding the CURRENT shape (rather than
        // a v1 payload) keeps this a fixture of what a real user's storage holds
        // instead of silently exercising the migration path.
        categoryId: null,
        createdAt: now,
        updatedAt: now,
      })
      // Amounts are in cents; large values stress numeric wrapping. These rows
      // are UNCATEGORIZED (`categoryId: null`), and story 30.4b makes an
      // uncategorized row fall back to its own name (Decision 10) — so distinct
      // names still become distinct slices here. Rows that SHARE a category
      // would merge into one; that path is covered by HomePage's unit suite.
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
          version: 2,
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
          version: 2,
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

    // The CurrencyToggle's widest layout (currency <select> revealed in symbol
    // mode) now lives on /settings, not the page headers. The seeded symbol-mode
    // preference persists across this navigation, so this exercises that widest
    // control state at 320px.
    const settingsResponse = await page.goto('/settings')
    expect(settingsResponse?.ok()).toBeTruthy()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('combobox', { name: /currency/i })).toBeVisible()
    await assertNoHorizontalOverflow((fn) => page.evaluate(fn), '/settings (symbol mode)')
  })

  /**
   * brand-1 AC-6 — the positioning framing line WRAPS rather than overflowing.
   *
   * The FR45 amendment grew this line from 43 to 56 characters, the largest
   * single copy growth in the rename. AC-6 requires proof "with a test, not by
   * eye", and it cannot be a jsdom test: jsdom computes no layout, so every
   * width there is 0 and a wrap assertion passes VACUOUSLY (the 29.1 lesson —
   * a guard that cannot fail is not a guard). Only a real browser can measure it.
   *
   * Two assertions, because they fail for different reasons:
   *   - no overflow  → the line does not push the page wider than the viewport
   *   - >1 line box  → it actually wrapped, rather than being clipped or
   *                    truncated into looking fine
   */
  test('the positioning framing line wraps, not overflows, at 320px (brand-1 AC-6)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })
    const response = await page.goto('/')
    expect(response?.ok(), 'expected / to load').toBeTruthy()
    await page.waitForLoadState('networkidle')

    const framing = page.getByText('Intentional budgeting without bank sync or AI integrations.')
    await expect(framing).toBeVisible()

    // Line boxes are counted with a Range over the TEXT, not el.getClientRects():
    // on a block-level <p> the latter always returns exactly one rect (the border
    // box), so it can never detect wrapping. This is a real trap — the first
    // version of this test used it and reported "1 line box" for copy that does
    // in fact wrap. A Range returns one rect per rendered line.
    const box = await framing.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        lineBoxes: range.getClientRects().length,
      }
    })

    expect(
      box.scrollWidth,
      `framing line overflows: scrollWidth ${box.scrollWidth} > clientWidth ${box.clientWidth}`
    ).toBeLessThanOrEqual(box.clientWidth)
    expect(
      box.lineBoxes,
      `framing line did not wrap at 320px (rendered on ${box.lineBoxes} line box)`
    ).toBeGreaterThan(1)

    // And the block as a whole still does not widen the page.
    await assertNoHorizontalOverflow((fn) => page.evaluate(fn), '/ (positioning block)')
  })
})

/**
 * Story 31.2 (UX-DR36) — the four finance TABLES fit 320px, with real rows.
 *
 * The route sweep above runs with empty localStorage (see the comment at the
 * seeded-dashboard test), so /income, /expenses, /savings and /balance are
 * measured there in their EMPTY state — the tables this story fixes are never
 * actually rendered by that gate.
 *
 * ⚠️ The document-level check alone CANNOT fail on these pages. Every table
 * sits inside `<div className="overflow-x-auto">`, and a scroll container
 * absorbs its content's overflow instead of propagating it to
 * `documentElement`. `categories-premium.spec.ts` already seeds rows, sets a
 * 320px viewport and runs the identical document-level check on /income and
 * /expenses — and it passes on the pre-31.2 markup. Seeding more adversarial
 * data does not change that; the tautology comes from the WRAPPER, not the
 * data — and the wrapper deliberately stays a scroll container, because
 * containing a future regression to one table beats letting it scroll the whole
 * document on a phone. So `assertFinanceTablesFit` asserts three separate
 * things, and (b) is the one that does the work:
 *
 *   (a) the document does not overflow — the escape hatch for overflow that
 *       bypasses the wrapper entirely; it cannot see table overflow;
 *   (b) THE GUARD — no `div.overflow-x-auto` holding a finance table is itself
 *       scrollable (`el.scrollWidth <= el.clientWidth`). This is red against
 *       the pre-31.2 markup (measured 1661px vs a 240px client width);
 *   (c) no row is clipped — every rendered row rect lies inside [0, 320].
 */

const FINANCE_THEME_KEY = 'budget-planner-theme-prefs-v1'

// A single unbroken 138-character run (46 x 3). Reachable in production: none of the
// four name inputs has a `maxLength`. `overflow-wrap: break-word` does NOT
// reduce min-content width, so an auto-layout table sizes to this whole run —
// which is exactly the failure mode this seed has to produce.
const LONG_UNBROKEN_NAME = 'Longestpossibleaccountnicknamewithoutanyspaces'.repeat(3)

/**
 * Seed all four finance stores plus categories, currency (symbol mode, the
 * widest figures) and the theme.
 *
 * Store keys, wrapper shapes and versions are the CURRENT ones — note that
 * savings/balance break the `-v1` convention (colon-separated keys), currency
 * persists `{ mode, currency }` at version 2 (`locale` was removed in story
 * 8-1 and is derived), and a balance row without `frequency` makes the
 * normalization engine throw. Every store uses `skipHydration: true`, which is
 * why writing localStorage in `addInitScript` before `goto` takes effect.
 */
async function seedFinanceRows(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ([longName, themeValue, themeKey]) => {
      const now = '2026-08-11T00:00:00.000Z'

      localStorage.setItem(
        'budget-planner-categories-v1',
        JSON.stringify({
          state: {
            categories: [
              {
                id: 'cat-income-1',
                userId: 0,
                profileId: null,
                name: 'Employment Income',
                kind: 'income',
                isDeleted: false,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'cat-expense-1',
                userId: 0,
                profileId: null,
                name: 'Household & Utilities',
                kind: 'expense',
                isDeleted: false,
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          version: 1,
        })
      )

      const flowRow = (id: string, name: string, amount: number, categoryId: string | null) => ({
        id,
        userId: 0,
        name,
        amount,
        frequency: 'monthly',
        categoryId,
        createdAt: now,
        updatedAt: now,
      })

      localStorage.setItem(
        'budget-planner-income-v1',
        JSON.stringify({
          state: {
            incomeSources: [
              flowRow('inc-1', longName, 1234567890, 'cat-income-1'),
              flowRow('inc-2', 'Freelance & Consulting', 45678900, null),
            ],
          },
          version: 2,
        })
      )
      localStorage.setItem(
        'budget-planner-expenses-v1',
        JSON.stringify({
          state: {
            expenses: [
              flowRow('exp-1', longName, 987654321, 'cat-expense-1'),
              flowRow('exp-2', 'Groceries', 65432100, null),
            ],
          },
          version: 2,
        })
      )

      localStorage.setItem(
        'budget-planner:savings-goals',
        JSON.stringify({
          state: {
            savingsGoals: [
              {
                id: 'sav-1',
                name: longName,
                targetAmount: 5000000000,
                currentBalance: 1234567890,
                allocationMode: 'manual',
                monthlyAllocation: 98765400,
                createdAt: now,
                updatedAt: now,
              },
              {
                // Account row (null target) — exercises the "No target" / "N/A"
                // progress branch alongside the goal row above.
                id: 'sav-2',
                name: 'Emergency Fund',
                targetAmount: null,
                currentBalance: 87654300,
                allocationMode: 'automatic',
                monthlyAllocation: null,
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          version: 2,
        })
      )

      localStorage.setItem(
        'budget-planner:balance-tracking',
        JSON.stringify({
          state: {
            entries: [
              {
                // All seven columns non-empty: investment type fills both the
                // Max Contribution and Remaining Room cells (debts show None/—).
                id: 'bal-1',
                type: 'investment',
                name: longName,
                currentBalance: 1234567890,
                maxContributionLimit: 9876543210,
                monthlyContribution: 45678900,
                frequency: 'biweekly',
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'bal-2',
                type: 'debt',
                name: 'Mortgage',
                currentBalance: -98765432100,
                monthlyContribution: 234567800,
                frequency: 'monthly',
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          version: 2,
        })
      )

      // Explicit-symbols mode renders the widest currency-formatted figures.
      // Current persist shape: `{ mode, currency }` at version 2.
      localStorage.setItem(
        'budget-planner-currency-prefs-v1',
        JSON.stringify({ state: { mode: 'symbol', currency: 'USD' }, version: 2 })
      )

      // Seed the theme STORE — never hand-add `.dark` to <html>: ThemeProvider
      // re-applies the persisted preference shortly after mount and would strip
      // a hand-added class, silently turning a dark test into a light one.
      localStorage.setItem(themeKey, JSON.stringify({ state: { theme: themeValue }, version: 0 }))
    },
    [LONG_UNBROKEN_NAME, theme, FINANCE_THEME_KEY] as const
  )
}

async function assertFinanceTablesFit(page: Page, label: string): Promise<void> {
  // (a) Document level. The wrapper is a scroll container at every width, so
  //     table overflow is absorbed here rather than reaching `documentElement`
  //     — this assertion cannot catch it and is NOT the guard. It is kept as
  //     the escape hatch for overflow that bypasses the wrapper entirely
  //     (page padding, a fixed-width sibling, an element positioned out of it).
  await assertNoHorizontalOverflow((fn) => page.evaluate(fn), label)

  // (b) THE GUARD: the table's own scroll wrapper must have nothing to scroll.
  const wrappers = await page.evaluate(() =>
    [...document.querySelectorAll('div.overflow-x-auto')]
      .filter((el) => el.querySelector('table') !== null)
      .map((el, index) => ({
        index,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
  )
  expect(wrappers.length, `${label}: expected at least one finance table wrapper`).toBeGreaterThan(
    0
  )
  for (const wrapper of wrappers) {
    expect(
      wrapper.scrollWidth,
      `${label}: table wrapper #${wrapper.index} scrolls horizontally — scrollWidth ${wrapper.scrollWidth} > clientWidth ${wrapper.clientWidth}`
    ).toBeLessThanOrEqual(wrapper.clientWidth)
  }

  // (c) No row is clipped by the viewport.
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('div.overflow-x-auto table tbody tr')].map((el) => {
      const rect = el.getBoundingClientRect()
      return { left: rect.left, right: rect.right, text: (el.textContent ?? '').slice(0, 30) }
    })
  )
  expect(rows.length, `${label}: expected at least one seeded row to render`).toBeGreaterThan(0)
  for (const row of rows) {
    expect(
      row.left,
      `${label}: row "${row.text}" starts left of the viewport`
    ).toBeGreaterThanOrEqual(0)
    expect(
      row.right,
      `${label}: row "${row.text}" extends past 320px (right ${row.right})`
    ).toBeLessThanOrEqual(NARROW_WIDTH)
  }
}

/**
 * AC-1 — the row actually reads as a stacked CARD, not a squeezed table row.
 *
 * Fitting inside 320px is necessary but NOT sufficient: with the cells set to
 * `overflow-wrap: anywhere`, a seven-column row still "fits" 320px while
 * rendering as seven unreadable ~40px columns. Only geometry separates the two,
 * and jsdom computes none — the unit suite can prove the classes are present,
 * never that they stack.
 *
 * The class that actually carries the stacking is `max-sm:flex` on each `<td>`
 * (it takes the cell out of table formatting); dropping it was measured
 * overflowing at 351px. The `max-sm:block` on the table/tbody/tr is defensive —
 * removing it leaves this assertion green, because the non-table cells already
 * stack inside a generated anonymous cell.
 *
 * Measured as vertical ordering of each row's direct cell children: every cell
 * must start at or below the previous cell's bottom.
 */
async function assertRowsStackAsCards(page: Page, label: string): Promise<void> {
  // EVERY row, not just the first. The seed deliberately builds a second row
  // per store to exercise the branch-y cells — Savings' "No target"/"N/A"
  // absent-progress row and Balance's debt row with its `None`/`—`
  // investment-only placeholders. Checking only `tbody tr:first-child` would
  // leave exactly those cells unproven.
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('div.overflow-x-auto table')].flatMap((table, tableIndex) =>
      [...table.querySelectorAll('tbody tr')].map((row, rowIndex) => ({
        tableIndex,
        rowIndex,
        cells: [...row.children].map((cell) => {
          const rect = cell.getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom, text: (cell.textContent ?? '').slice(0, 24) }
        }),
      }))
    )
  )

  expect(rows.length, `${label}: expected at least one finance table row`).toBeGreaterThan(0)
  for (const row of rows) {
    const where = `table #${row.tableIndex} row #${row.rowIndex}`
    expect(row.cells.length, `${label}: ${where} rendered no cells`).toBeGreaterThan(1)
    for (let i = 1; i < row.cells.length; i++) {
      const previous = row.cells[i - 1]
      const current = row.cells[i]
      if (!previous || !current) continue
      // 1px tolerance for sub-pixel rounding.
      expect(
        current.top,
        `${label}: ${where} field "${current.text}" sits BESIDE "${previous.text}" instead of below it — the row is still a table row, not a card`
      ).toBeGreaterThanOrEqual(previous.bottom - 1)
    }
  }
}

/**
 * AC-6 — the >= 44px tap target is a RENDERED size, not merely a class.
 * A concrete floor, per the story-24.1 lesson that a test pinning only relative
 * ordering ("narrower than desktop") missed a real 18px clipping regression.
 */
async function assertRowActionTapTargets(page: Page, label: string): Promise<void> {
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('div.overflow-x-auto table tbody button')].map((el) => {
      const rect = el.getBoundingClientRect()
      return { width: rect.width, height: rect.height, name: el.getAttribute('aria-label') ?? '' }
    })
  )
  expect(buttons.length, `${label}: expected row action buttons to render`).toBeGreaterThan(0)
  for (const button of buttons) {
    expect(
      button.height,
      `${label}: "${button.name}" is only ${button.height}px tall`
    ).toBeGreaterThanOrEqual(44)
    expect(
      button.width,
      `${label}: "${button.name}" is only ${button.width}px wide`
    ).toBeGreaterThanOrEqual(44)
  }
}

test.describe('finance tables fit a 320px viewport with real rows (story 31.2)', () => {
  for (const route of ['/income', '/expenses', '/savings', '/balance'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${route} fits 320px with seeded rows (${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })
        await seedFinanceRows(page, theme)

        const response = await page.goto(route)
        expect(response?.ok(), `expected ${route} to load`).toBeTruthy()
        await page.waitForLoadState('networkidle')

        // The theme actually took (see seedFinanceRows).
        await expect
          .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
          .toBe(theme === 'dark')

        // Anti-vacuous guard: an empty table would satisfy every check below
        // trivially. Prove the seeded row actually rendered first.
        await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

        await assertFinanceTablesFit(page, `${route} (${theme}, seeded)`)
        await assertRowsStackAsCards(page, `${route} (${theme}, seeded)`)
        await assertRowActionTapTargets(page, `${route} (${theme}, seeded)`)
      })
    }
  }

  // AC-2 — the exact inverse, at a desktop viewport. The mobile switch is
  // `max-sm:`-only, so >= 640px must still render a real table: header row
  // visible, cells SIDE BY SIDE. Without this the suite would happily accept a
  // change that stacked every table at every width.
  for (const route of ['/income', '/expenses', '/savings', '/balance'] as const) {
    test(`${route} still renders as a real table at 1280px (AC-2)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 })
      await seedFinanceRows(page, 'light')

      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

      // The column header row is back — in EVERY table. `/balance` has two, so
      // a page-wide `.first()` would pass while the second table's <thead>
      // stayed hidden at all widths.
      const headers = await page.evaluate(() =>
        [...document.querySelectorAll('div.overflow-x-auto table')].map((table, index) => ({
          index,
          visibleHeaderCells: [...table.querySelectorAll('thead th')].filter(
            (th) => getComputedStyle(th).display !== 'none' && th.getBoundingClientRect().height > 0
          ).length,
        }))
      )
      expect(headers.length).toBeGreaterThan(0)
      for (const header of headers) {
        expect(
          header.visibleHeaderCells,
          `table #${header.index} has no visible column headers at 1280px`
        ).toBeGreaterThan(0)
      }

      // Cells sit on one line — checked for every row of every table.
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('div.overflow-x-auto table')].flatMap((table, tableIndex) =>
          [...table.querySelectorAll('tbody tr')].map((row, rowIndex) => ({
            tableIndex,
            rowIndex,
            tops: [...row.children].map((cell) => cell.getBoundingClientRect().top),
          }))
        )
      )
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.tops.length).toBeGreaterThan(1)
        const [first] = row.tops
        for (const top of row.tops) {
          expect(
            Math.abs(top - (first as number)),
            `table #${row.tableIndex} row #${row.rowIndex}: desktop cells are no longer on one line`
          ).toBeLessThanOrEqual(1)
        }
      }

      // And EVERY mobile-only field label is out of the desktop rendering —
      // `display: none`, so it is also out of the accessibility tree.
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll('div.overflow-x-auto table tbody span.sm\\:hidden')].map(
          (el) => ({
            text: (el.textContent ?? '').trim(),
            display: getComputedStyle(el).display,
          })
        )
      )
      expect(labels.length, 'expected mobile field labels in the DOM at 1280px').toBeGreaterThan(0)
      for (const label of labels) {
        expect(label.display, `field label "${label.text}" is visible on desktop`).toBe('none')
      }
    })
  }

  // UX-DR9 requires controls to be "reachable and OPERABLE" at 320px, not
  // merely present. Presence is a class/DOM fact the unit suite already pins;
  // this drives the real card controls in a real browser, and covers the
  // per-row accessible-name rename end to end.
  for (const { route, editTitle } of [
    { route: '/income', editTitle: 'Edit Income Source' },
    { route: '/expenses', editTitle: 'Edit Expense' },
    { route: '/savings', editTitle: 'Edit Savings Goal' },
    { route: '/balance', editTitle: 'Edit Balance Entry' },
  ] as const) {
    test(`${route} row Edit and Delete are operable at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })
      await seedFinanceRows(page, 'light')

      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

      // Per-row accessible names (story 31.2 AC-4/§4): every row used to expose
      // an identically named "Edit"/"Delete", so a bare-name query was
      // ambiguous. Scoping by the row name is the point of the rename.
      const editButton = page.getByRole('button', { name: `Edit ${LONG_UNBROKEN_NAME}` })
      await expect(editButton).toBeVisible()
      await editButton.click()
      const editModal = page.getByRole('dialog', { name: editTitle })
      await expect(editModal).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(editModal).toBeHidden()

      const deleteButton = page.getByRole('button', { name: `Delete ${LONG_UNBROKEN_NAME}` })
      await expect(deleteButton).toBeVisible()
      await deleteButton.click()
      // ConfirmDialog is an `alertdialog` titled "Confirm Delete"; the row name
      // appears in its message, which is what proves the RIGHT row was wired.
      const confirm = page.getByRole('alertdialog', { name: 'Confirm Delete' })
      await expect(confirm).toBeVisible()
      await expect(confirm).toContainText(LONG_UNBROKEN_NAME)
    })
  }
})
