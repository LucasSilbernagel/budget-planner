import { type Locator, type Page, expect, test } from '@playwright/test'
import { LONG_UNBROKEN_NAME, seedFinanceRows } from './helpers/seed-finance-rows'

/**
 * Responsive guard E2E (Story 6.1 / UX-DR9, extended by 31.2 and 31.3).
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
 * ⚠️ **That horizontal-only, document-level premise is no longer the whole
 * story, and this file no longer claims it is.** Two later stories falsified
 * it from opposite directions:
 *
 *  - 31.2 — every finance table sits in an `overflow-x-auto` wrapper, and a
 *    scroll container ABSORBS its content's overflow instead of propagating it
 *    to `documentElement`. The document-level check cannot see it (see the
 *    31.2 block below).
 *  - 31.3 — the failure mode on a phone in LANDSCAPE is vertical, not
 *    horizontal, and it is invisible here twice over: `position: fixed` keeps
 *    the modal overlay out of `documentElement.scrollHeight` entirely, and
 *    `Modal` sets `body { overflow: hidden }` while open. A modal whose title
 *    sat 96px above the top of the screen passed every check in this file.
 *
 * So the height-constrained block at the end of this file measures ELEMENTS,
 * not the document — and the assertion that does the real work is a
 * scrollability probe, not a visibility check.
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
  // Story 32.3: the FIRST doc page with a fenced code block (the worked
  // example). `prose pre` carries `overflow-x: auto`, so it should scroll inside
  // itself rather than widen the page — but that is exactly the kind of
  // assumption §4b's regression was made of, so it is measured here rather than
  // reasoned about. The page also deliberately uses no markdown table, which
  // `MarkdownRenderer` would render with no overflow wrapper at all.
  '/docs/how-totals-are-calculated',
  // Story 36.3: the longest prose doc in the set, and the only one whose body
  // is mostly bulleted lists of what each figure does and does not change.
  // A unit guard forbids a markdown table on it; this measures the result.
  '/docs/where-a-mortgage-belongs',
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
  // It deliberately seeds MANY distinct expense/income categories so the pies
  // render many slices, which is the widest case for the colour-keyed list
  // beneath each plot — since story 36.2 removed the in-plot slice labels at
  // every width, that list plus the hover tooltip is the ONLY way to read the
  // breakdown, so we assert it names every seeded slice.
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

    // ⚠️ This replaced a probe that could not fail (story 36.2). It looked for
    // `.recharts-legend-wrapper` inside the chart container and returned
    // `{ ok: true, reason: 'no legend rendered' }` when it found none — but
    // `BreakdownPie` renders NO Recharts `<Legend>` at all (story 12-4 removed
    // it; `HomePage.tsx` does not even import `Legend`), so that branch was the
    // only one ever taken and the assertion was vacuous.
    //
    // The real failure mode was never vertical clipping — the list is a plain
    // `<ul>` in normal document flow BELOW the fixed-height chart box, so it
    // grows the card rather than being clipped by it. What can actually go
    // wrong is the list being short or missing, which since story 36.2 would
    // leave a narrow user with no way at all to read the breakdown. So assert
    // that: one row per seeded slice, each naming its category.
    const expensePie = page.locator('[data-testid="breakdown-pie-expense"]')
    const incomePie = page.locator('[data-testid="breakdown-pie-income"]')
    await expect(expensePie.locator('li')).toHaveCount(6)
    await expect(incomePie.locator('li')).toHaveCount(3)
    for (const name of [
      'Mortgage & Housing Costs',
      'Groceries',
      'Transportation',
      'Utilities',
      'Insurance Premiums',
      'Entertainment & Dining',
    ]) {
      await expect(expensePie.locator('li').filter({ hasText: name })).toBeVisible()
    }
    for (const name of ['Primary Salary Long Name', 'Freelance & Consulting', 'Dividends']) {
      await expect(incomePie.locator('li').filter({ hasText: name })).toBeVisible()
    }

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

// Story 42.2 extracted this fixture so `table-scroll-affordance.spec.ts` measures
// the SAME rows this suite asserts fit at 320px. A divergent copy would mean the
// weakest copy defines the protection (`src/test/responsive-table-tokens.ts:5-10`).
// The 768px assertions below are unchanged.
// (imported at the top of this file)

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

        // Story 37.1 — /savings now carries a chart above its table, seeded here
        // with the same 138-character unbroken name. ⚠️ The document-level sweep
        // cannot see a chart that overflows only inside its OWN container, so
        // assert the wrapper directly.
        if (route === '/savings') {
          await expect(page.getByTestId('savings-chart')).toBeVisible()
          // ⚠️ WITNESS FIRST. The wrapper div is visible the instant React mounts
          // it, SVG or not, and the geometry read below is a ONE-SHOT evaluate
          // with no retry — so without this wait the measurement can snapshot an
          // empty box where scrollWidth === clientWidth trivially.
          //
          // ⚠️ MEASURED LIMIT — do not over-trust the assertion below. Adding
          // this witness does NOT make the scrollWidth check able to see a
          // chart label painting out of its gutter. Two-arm control (review
          // 37.1): with the Y-axis truncation removed so a 138-character label
          // overflows, this case passed **both** with and without the witness.
          // SVG text painted outside its box does not contribute to an HTML
          // ancestor's scrollWidth. What actually catches that defect is the
          // tick-length assertion in `savings-chart.spec.ts` (verified RED,
          // "Received: 138"). This check guards HTML-box overflow only.
          await expect(
            page.locator('[data-testid="savings-chart"] path.recharts-rectangle')
          ).not.toHaveCount(0)
          const chart = await page.locator('[data-testid="savings-chart"]').evaluate((element) => ({
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          }))
          expect(
            chart.scrollWidth,
            `${route} (${theme}, seeded): chart overflows its wrapper, ${chart.scrollWidth} > ${chart.clientWidth}`
          ).toBeLessThanOrEqual(chart.clientWidth + 1)
        }
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

      // The column header row is back — in EVERY table. Asserted per-table
      // rather than via a page-wide `.first()`, so a route that renders more
      // than one table cannot pass on its first table while a later one's
      // <thead> stays hidden at all widths.
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

  /**
   * The `PeriodTotal` headline figure fits 320px in a WIDE font stack.
   *
   * ⚠️ WHY THIS FORCES A FONT. The tests above found this defect in CI and could
   * not reproduce it on a developer machine: the figure fitted in the local font
   * and overflowed to 325px on the runner, purely on glyph metrics. An
   * environment-dependent guard is not a guard — so this one pins the font to
   * DejaVu Sans, the widest of the common Linux stacks, and is therefore
   * deterministic everywhere.
   *
   * WHAT BROKE. Story 32.1 made this figure DENORMALIZE to the selected period,
   * and the default period is `annually` — so the same data started rendering up
   * to 12× larger ("$12,802,467.90" → "$153,629,614.80") with no change to its
   * `text-3xl` styling. It needed ~285px in a card that has 240px.
   *
   * ⚠️ THE THREE ASSERTIONS PIN THREE DIFFERENT THINGS, and the split is
   * deliberate — the fix has two halves and a page-overflow check alone can only
   * see them BOTH reverted at once (measured; each half individually keeps the
   * document at 320 and the guard would have stayed green):
   *
   *   1. page does not overflow    → RED only if BOTH halves are reverted
   *   2. the figure stays on ONE line → RED if the `text-2xl` arm is reverted
   *   3. the figure does not spill out of its own box (extreme amount)
   *                                → RED if `[overflow-wrap:anywhere]` is dropped
   *
   * Nothing between the figure and the viewport has `overflow: hidden`, so a
   * spill here paints over the card rather than being clipped — invisible to any
   * document-level check, which is what assertion 3 exists for.
   */
  test.describe('the period total fits 320px in a wide font stack', () => {
    const WIDE_FONT = '*,*::before,*::after{font-family:"DejaVu Sans"!important}'

    async function renderTotal(page: Page, route: string, monthlyCents: number) {
      await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })
      await page.addInitScript(
        ([key, listKey, amount]) => {
          const now = '2026-08-11T00:00:00.000Z'
          localStorage.setItem(
            key as string,
            JSON.stringify({
              state: {
                [listKey as string]: [
                  {
                    id: 'row-1',
                    userId: 0,
                    name: 'Salary',
                    amount: amount as number,
                    frequency: 'monthly',
                    categoryId: null,
                    createdAt: now,
                    updatedAt: now,
                  },
                ],
              },
              version: 2,
            })
          )
          // Symbol mode is the widest rendering (currency-less drops the "$").
          localStorage.setItem(
            'budget-planner-currency-prefs-v2',
            JSON.stringify({ state: { mode: 'symbol', currency: 'USD' }, version: 2 })
          )
        },
        [
          route === '/income' ? 'budget-planner-income-v1' : 'budget-planner-expenses-v1',
          route === '/income' ? 'incomeSources' : 'expenses',
          monthlyCents,
        ] as const
      )
      const response = await page.goto(route)
      expect(response?.ok(), `expected ${route} to load`).toBeTruthy()
      await page.waitForLoadState('networkidle')
      await page.addStyleTag({ content: WIDE_FONT })
      // Anti-vacuous: the figure must actually be the denormalized annual total.
      // Without this a missing element would satisfy every check below.
      await expect(page.getByTestId('period-total-amount')).toBeVisible()
      return page.evaluate(() => {
        const el = document.querySelector('[data-testid="period-total-amount"]') as HTMLElement
        const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight)
        return {
          text: (el.textContent ?? '').trim(),
          lines: Math.round(el.getBoundingClientRect().height / lineHeight),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }
      })
    }

    for (const route of ['/income', '/expenses'] as const) {
      test(`${route} headline total fits 320px with a large annual figure`, async ({ page }) => {
        // $12,802,467.90/month → "$153,629,614.80" at the `annually` default.
        // This is the exact figure the seeded-rows tests above produce, and the
        // one that overflowed CI to 325px.
        const total = await renderTotal(page, route, 1_280_246_790)
        expect(total.text, 'expected the annually-denormalized total').toBe('$153,629,614.80')

        // 1. The page itself.
        await assertNoHorizontalOverflow(
          (fn) => page.evaluate(fn),
          `${route} (wide font, big total)`
        )

        // 2. A realistic large total is not made to wrap. Money broken across
        //    two lines mid-digits is legible only by accident.
        expect(
          total.lines,
          `${route}: "${total.text}" wrapped onto ${total.lines} lines at 320px`
        ).toBe(1)
      })

      test(`${route} headline total stays inside its card at any magnitude`, async ({ page }) => {
        // Deliberately absurd ($1.23bn/month). The figure may wrap here — what it
        // must never do is paint outside the card, which no page-level overflow
        // assertion can see.
        const total = await renderTotal(page, route, 123_456_789_000)
        expect(
          total.scrollWidth,
          `${route}: "${total.text}" spills out of its card (scrollWidth ${total.scrollWidth} > clientWidth ${total.clientWidth})`
        ).toBeLessThanOrEqual(total.clientWidth)
        await assertNoHorizontalOverflow(
          (fn) => page.evaluate(fn),
          `${route} (wide font, extreme total)`
        )
      })
    }
  })

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

  /**
   * Column sorting (story 34.2, FR61).
   *
   * ⚠️ These run at 1280px, not 320px, and that is the point: the `<thead>` is
   * `max-sm:hidden`, so the HEADER affordance does not exist below `sm`.
   *
   * ⚠️ It is no longer true that "sorting is a >= 640px feature by ratified
   * decision" — story 48.1 (UX-DR53) added `TableSortControl`, which starts a
   * sort below `sm`. The test after this one covers it at 320px in both schemes,
   * including the case this suite has always cared about: a sort started on
   * desktop and carried into a narrow viewport.
   *
   * ⚠️ Expected sequences are written out as LITERALS per route. Deriving them
   * from the seed with a comparator would guard nothing — the comparator is the
   * thing under test. The seed has two rows per table, and on `/balance` the
   * ascending order deliberately EQUALS the manual order ('Longest…' < 'Mortgage'),
   * which is why both directions are pinned rather than just "the order changed".
   */
  /** Each table's mobile sort control, by its accessible name (story 48.1).
   * The names mirror the table wrappers' own `aria-label` region names. */
  const MOBILE_SORT_LABEL: Record<string, string> = {
    '/income': 'Sort income sources',
    '/expenses': 'Sort expenses',
    '/savings': 'Sort savings goals and accounts',
    '/balance': 'Sort balance entries',
  }

  const SORT_BY_NAME_EXPECTATIONS: Record<string, { asc: string[]; desc: string[] }> = {
    '/income': {
      asc: ['Freelance & Consulting', LONG_UNBROKEN_NAME],
      desc: [LONG_UNBROKEN_NAME, 'Freelance & Consulting'],
    },
    '/expenses': {
      asc: ['Groceries', LONG_UNBROKEN_NAME],
      desc: [LONG_UNBROKEN_NAME, 'Groceries'],
    },
    '/savings': {
      asc: ['Emergency Fund', LONG_UNBROKEN_NAME],
      desc: [LONG_UNBROKEN_NAME, 'Emergency Fund'],
    },
    '/balance': {
      asc: [LONG_UNBROKEN_NAME, 'Mortgage'],
      desc: ['Mortgage', LONG_UNBROKEN_NAME],
    },
  }

  for (const route of ['/income', '/expenses', '/savings', '/balance'] as const) {
    /** The EDITABLE table's `<thead>` — the one carrying the per-row Edit controls.
     *
     * ⚠️ Scoped on purpose, mirroring the BalancePage unit suite, even though
     * `/balance` now renders a single table. An unscoped
     * `getByRole('columnheader', {name})` would silently widen to any table a
     * future story adds to this page, and a duplicated column name there would
     * surface as a strict-mode violation rather than a caught regression. */
    function sortHeader(page: import('@playwright/test').Page, name: string) {
      return page
        .locator('div.overflow-x-auto table')
        .filter({ has: page.getByRole('button', { name: /^Edit .+$/ }) })
        .getByRole('columnheader', { name })
    }

    /** Row order in the EDITABLE table, by whichever seeded name each row carries.
     *
     * ⚠️⚠️ THE SCOPING IS REAL BUT ITS ENFORCEMENT IS NOT STRICT HERE (48.2 review):
     * `evaluateAll` does NOT apply Playwright strict mode, so if a second
     * Edit-carrying table ever appeared this would CONCATENATE both tables' rows
     * rather than fail. `/^Edit .+$/` is a likelier future collision than the
     * `/^Move .+ up$/` it replaced. The `sortHeader` helper above IS strict and
     * would redden first (proven by mutation arm M8: 7 failures), which is what
     * keeps this acceptable rather than silent.
     *
     * ⚠️ Scoped to the table holding the per-row Edit controls. Kept scoped even though
     * `/balance` now renders one table: an unscoped query would concatenate the
     * rows of any table later added to this page, silently corrupting every
     * ordering assertion below rather than failing. */
    function editableOrder(page: import('@playwright/test').Page, names: string[]) {
      return page
        .locator('div.overflow-x-auto table')
        .filter({ has: page.getByRole('button', { name: /^Edit .+$/ }) })
        .locator('tbody tr')
        .evaluateAll(
          (rows, seeded) =>
            rows.map((row) => seeded.find((name) => (row.textContent ?? '').includes(name)) ?? ''),
          names
        )
    }

    /** The mobile sort control for this route (story 48.1). Named per table, so
     * it cannot accidentally match a form select in a modal. */
    function sortControl(page: Page) {
      return page.getByRole('combobox', { name: MOBILE_SORT_LABEL[route] })
    }

    test(`${route} sorts by a column header at 1280px (34.2)`, async ({ page }) => {
      const expected = SORT_BY_NAME_EXPECTATIONS[route] as { asc: string[]; desc: string[] }
      const names = expected.asc
      await page.setViewportSize({ width: 1280, height: 720 })
      await seedFinanceRows(page, 'light')

      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

      const nameHeader = sortHeader(page, 'Name')
      await expect(nameHeader).toHaveAttribute('aria-sort', 'none')
      const manual = await editableOrder(page, names)
      expect(manual).toHaveLength(2)

      const sortButton = nameHeader.getByRole('button', { name: 'Name' })
      await sortButton.click()
      await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
      await expect.poll(() => editableOrder(page, names)).toEqual(expected.asc)

      await sortButton.click()
      await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
      await expect.poll(() => editableOrder(page, names)).toEqual(expected.desc)

      // The third activation is the return to manual order — there is no
      // separate reset control at this width.
      await sortButton.click()
      await expect(nameHeader).toHaveAttribute('aria-sort', 'none')
      await expect.poll(() => editableOrder(page, names)).toEqual(manual)
    })

    /** ⚠️ Run in BOTH schemes: the claim is that the control fits 320px in light
     * and dark, and a light-only case proves half of that.
     *
     * ⚠️ Story 48.1 rewrote this against `TableSortControl`, which REPLACED
     * `TableSortNotice`. The scenario is unchanged — start a sort on desktop,
     * narrow below `sm`, escape it — but the control now also renders while the
     * table is in manual order, because it is how a phone STARTS a sort. */
    for (const scheme of ['light', 'dark'] as const) {
      test(`${route} sort started on desktop stays escapable at 320px, ${scheme} (34.2/48.1)`, async ({
        page,
      }) => {
        const expected = SORT_BY_NAME_EXPECTATIONS[route] as { asc: string[]; desc: string[] }
        const names = expected.asc
        await page.setViewportSize({ width: 1280, height: 720 })
        await seedFinanceRows(page, scheme)

        await page.goto(route)
        await page.waitForLoadState('networkidle')
        await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

        // ⚠️ AT 1280px THE CONTROL IS `sm:hidden`, so this is the DESKTOP half
        // of the visibility rule. Asserting it here rather than "the control
        // reports manual order" — that claim needs a narrow viewport and lives
        // in `mobile-table-sort.spec.ts`, and asserted at this width it passes
        // for the wrong reason: a role query finds nothing in a hidden subtree.
        await expect(sortControl(page)).toBeHidden()

        // ⚠️ Sort to a state that DIFFERS from manual order on every route. On
        // `/balance` the ascending order deliberately equals manual, so stopping at
        // one click would leave both the post-sort and the post-reset assertions
        // comparing an order that never changed — a broken reset would pass.
        const sortButton = sortHeader(page, 'Name').getByRole('button', { name: 'Name' })
        const manual = await editableOrder(page, names)
        await sortButton.click()
        // ⚠️ Track WHICH state the header reached, so the narrow-viewport
        // assertion below can pin the exact value rather than merely
        // "not manual" — see the comment there.
        let expectedValue = 'name:asc'
        if ((await editableOrder(page, names)).join('|') === manual.join('|')) {
          await sortButton.click()
          expectedValue = 'name:desc'
        }
        await expect.poll(() => editableOrder(page, names)).not.toEqual(manual)

        // Narrow BELOW `sm`. The header that started this sort is now
        // `display: none`, so without the control the sort would be inescapable.
        await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })
        await expect(sortHeader(page, 'Name')).toBeHidden()

        // The control reports the sort the DESKTOP header started — the
        // single-source-of-truth claim, observed across a viewport change.
        //
        // ⚠️ The EXACT value, not `not.toHaveValue('manual')`. That weaker form
        // is satisfied by any wrong non-manual state — a hardcoded value, the
        // wrong column, the wrong direction, another table's stale slice — and
        // the test it replaced pinned the column ("Sorted by Name").
        const control = sortControl(page)
        await expect(control).toBeVisible()
        await expect(control).toHaveValue(expectedValue)

        // ⚠️ A RENDERED box, not a class. `assertHasMobileTapTarget` proves the
        // `max-sm:` tokens are declared; only a real layout can prove they
        // resolve to 44px on an element that is not `display: none`.
        const box = await control.boundingBox()
        expect(box, 'the mobile sort control has no layout box at 320px').not.toBeNull()
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)

        await control.selectOption('manual')
        await expect(control).toHaveValue('manual')
        // Manual order restored — compared against the order MEASURED before the
        // sort, not a hand-written literal, so it cannot drift from the seed.
        await expect.poll(() => editableOrder(page, names)).toEqual(manual)

        await assertNoHorizontalOverflow(
          (fn) => page.evaluate(fn),
          `${route} with the mobile sort control at 320px (${scheme})`
        )
      })
    }
  }

  // The 33.3 lesson: "an overflow assertion is only as good as the widths it runs
  // at, and the width that matters is the one just above the breakpoint". 320 and
  // 1280 both passed while a 768px wrapper overflow went unseen in 33.3.
  //
  // ⚠️ KEPT, NOT DELETED, BY STORY 48.2. This block arrived with 34.1b because the
  // actions cell had gained two 44px targets; 48.2 removed them again. The width
  // coverage is independent of what prompted it — this is the repo's only
  // just-above-`sm` document-overflow guard, and removing two buttons only makes
  // the table narrower, so it cannot fail for a new reason. Its move-button
  // visibility assertion is gone; the DOCUMENT-level overflow claim is not.
  for (const route of ['/income', '/expenses', '/savings', '/balance'] as const) {
    test(`${route} finance tables fit 768px`, async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 900 })
      await seedFinanceRows(page, 'light')

      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()
      await expect(page.getByRole('button', { name: `Delete ${LONG_UNBROKEN_NAME}` })).toBeVisible()

      // ⚠️ The assertion is DOCUMENT-level, not wrapper-level, and the distinction
      // is the whole point. Above `sm` the cards revert to a real table and the
      // `overflow-x-auto` wrapper is SUPPOSED to scroll — the 138-char unbroken
      // seed name alone makes the table ~1500px wide. The first version of this
      // test asserted `wrapper.scrollWidth <= clientWidth` and failed on all four
      // routes for exactly that reason: it measured the feature, not a defect.
      // What must hold is that the wrapper ABSORBS that width rather than pushing
      // the PAGE wider than the viewport.
      await assertNoHorizontalOverflow((fn) => page.evaluate(fn), `${route} at 768px`)

      // ...and the row's other action controls stay reachable at this width.
      await expect(page.getByRole('button', { name: `Edit ${LONG_UNBROKEN_NAME}` })).toBeVisible()
    })
  }
})

// ---------------------------------------------------------------------------
// Story 31.3 (UX-DR37) — modals fit height-constrained viewports.
// ---------------------------------------------------------------------------

/** Portrait phone, height-constrained. The epic's primary target. */
const SHORT_HEIGHT = 480
/** iPhone SE in LANDSCAPE — the epic's literal floor ("down to 320px height"). */
const LANDSCAPE = { width: 568, height: 320 } as const
/**
 * Total vertical space the overlay's `p-4` takes from the card (1rem each side).
 * The card is capped at `innerHeight - OVERLAY_GUTTER`, so this is the real
 * "available height", and the threshold every fit assertion is measured against.
 */
const OVERLAY_GUTTER = 32

/**
 * ⚠️ Almost every Playwright matcher is VACUOUS on this story. Read before
 * adding an assertion here.
 *
 *  - `toBeVisible()` is *attached + non-empty box + not `visibility:hidden`*.
 *    It ignores viewport position, ancestor scroll offset and clipping, so it
 *    is true even for a card whose title sits 96px above the screen. Ten such
 *    assertions across five specs stay green through a completely botched
 *    implementation of this story.
 *  - `documentElement.scrollHeight <= clientHeight` is decoupled from modal
 *    height entirely (fixed overlay + body scroll lock), and is measured FALSE
 *    on `/balance` at 320x480 in all three states anyway, because the PAGE is
 *    taller than the viewport.
 *  - `card.scrollHeight > card.clientHeight` alone is green for the CLIPPED
 *    variant (`max-h-full` without `overflow-y-auto`) — `scrollHeight` counts
 *    overflowing content even under `overflow: visible`.
 *  - `footerButton.bottom <= innerHeight` at `scrollTop === 0` is INVERTED, not
 *    merely weak: `getBoundingClientRect()` reports UNCLIPPED geometry, so on a
 *    CORRECT implementation the un-scrolled footer legitimately sits below the
 *    card's visible box and this goes red.
 *  - Anything measured after `click()` / `fill()` / `hover()` / `press()` /
 *    `focus()` / `scrollIntoViewIfNeeded()` on the element being measured:
 *    Playwright actionability scrolls ALL scrollable ancestors, including the
 *    card this story creates. Everything below therefore measures through
 *    `locator.evaluate()`, which performs no actionability and no scrolling.
 *
 * What DOES work: `toBeInViewport({ ratio: 1 })` (IntersectionObserver-backed,
 * so the intersection rect is clipped by every ancestor scroll container) and
 * the scrollability probe below.
 */
interface CardMetrics {
  top: number
  bottom: number
  left: number
  right: number
  height: number
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
  borderRadius: string
  overflowY: string
  innerHeight: number
  innerWidth: number
  bodyOverflow: string
}

async function readCardMetrics(card: Locator): Promise<CardMetrics> {
  return card.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      height: rect.height,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      borderRadius: getComputedStyle(el).borderTopLeftRadius,
      overflowY: getComputedStyle(el).overflowY,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }
  })
}

/**
 * THE load-bearing assertion of story 31.3.
 *
 * Setting `scrollTop` on a non-scroll container is a silent no-op that reads
 * back 0. This is what separates a real scroll container from `max-h-full`
 * plus `overflow: visible`, where the content simply spills — every geometric
 * assertion above it is satisfied by both. Scroll position is restored so the
 * caller can still measure the un-scrolled state afterwards.
 *
 * ⚠️ **The probe alone is NOT sufficient, and a mutation run proved it.**
 * `overflow: hidden` is still programmatically scrollable — `scrollTop` moves
 * on it exactly as it does on `auto` — so swapping `overflow-y-auto` for
 * `overflow-y-hidden` leaves this probe, and the whole footer-reachability
 * assertion below it, GREEN, while a real user can no longer reach the footer
 * by any means. That is why the caller also pins the COMPUTED `overflow-y` to
 * a user-scrollable value. Neither check subsumes the other: computed style
 * cannot prove there is anything to scroll, and the probe cannot prove the
 * user can do the scrolling.
 *
 * Deliberately NOT `scrollHeight <= clientHeight + 1`: that is scrollbar-model
 * dependent. It holds under this Chromium's overlay scrollbars but a
 * classic-scrollbar build reserves height for the horizontal scrollbar that
 * `overflow-y-auto`'s computed `overflow-x: auto` introduces.
 */
async function probeScrollability(card: Locator): Promise<number> {
  return card.evaluate((el) => {
    const before = el.scrollTop
    el.scrollTop = 1e6
    const reached = el.scrollTop
    el.scrollTop = before
    return reached
  })
}

/**
 * Open the tallest modal in the app: the `/balance` Add form.
 *
 * ⚠️ The field count depends on the selected type and is NOT asserted here — this
 * is a helper comment, not a guard. Investment (the default) shows the most
 * fields; story 43.4's `asset` type hides two of them (contribution amount and
 * frequency), so an asset form is the SHORTEST, not the tallest. Tests that need
 * the tall fixture must leave the type at its default.
 *
 * ⚠️ Story 49.1 (FR75) removed a THIRD conditional field, the contribution limit,
 * from the investment arm. MEASURED before and after, not estimated:
 *
 *   viewport        available   scrollHeight before -> after   over-tall by
 *   320x480             448            892 -> 810              444 -> 362
 *   568x320 (landscape) 288            786 -> 704              498 -> 416
 *
 * So the card lost 82px and is still over-tall by 362px at the tighter viewport —
 * this remains comfortably the tallest modal in the app and the anti-vacuous
 * precondition below is nowhere near flipping. Checked rather than assumed,
 * because a deletion story with no height AC can still have a height regression.
 */
async function openBalanceAddModal(page: Page): Promise<Locator> {
  const trigger = page.getByTestId('balance-add-button')
  const dialog = page.getByRole('dialog', { name: 'Add Balance Entry' })
  await expect(async () => {
    // Check BEFORE clicking. If the first click opened the dialog but the
    // visibility wait timed out once, a retry would re-click a trigger that is
    // now covered by the fixed overlay — never actionable — burning the full
    // 15s with the dialog already open. Same guard as the premium helper below.
    if (!(await dialog.isVisible())) {
      await trigger.click()
    }
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  return dialog
}

/**
 * AC-3, AC-4, AC-8 — a genuinely over-tall modal fits and scrolls internally.
 *
 * `top >= -2` is half the defect, not padding on the assertion. The overlay
 * centres with `flex items-center` and has no overflow of its own, so before
 * this story an over-tall card overflowed BOTH ends and its top went negative
 * (measured -96 for this fixture at 320x480). You cannot scroll up to a centred
 * flex item, the overlay is `position: fixed`, and body scroll is locked — so
 * the title and Close button were unreachable, which is the half users notice
 * first. A bottom-only assertion misses it entirely.
 */
async function assertTallModalFitsAndScrolls(
  card: Locator,
  footer: Locator,
  label: string
): Promise<void> {
  const metrics = await readCardMetrics(card)

  // (1) Anti-vacuous precondition. A fixture that already fits satisfies every
  //     check below trivially — 31.2's "an empty table would pass" guard,
  //     transposed to the vertical axis.
  //
  //     Measured against the AVAILABLE height (viewport minus the overlay
  //     gutter), which is what the card is actually capped at — not the raw
  //     viewport, which would false-red a fixture over-tall by less than the
  //     gutter. Deliberately NOT `scrollHeight > clientHeight`: that reads
  //     equal on a BROKEN implementation (an unclipped card's scrollHeight IS
  //     its clientHeight), so it would fail here with a misleading "fixture is
  //     not over-tall" instead of letting the real assertion below report the
  //     real defect. This threshold is independent of whether the fix works.
  const available = metrics.innerHeight - OVERLAY_GUTTER
  expect(
    metrics.scrollHeight,
    `${label}: fixture is NOT over-tall (content ${metrics.scrollHeight} <= available ${available}) — every assertion below is vacuous`
  ).toBeGreaterThan(available)

  // (2) Both ends inside the viewport.
  expect(
    metrics.top,
    `${label}: card top ${metrics.top} is above the viewport`
  ).toBeGreaterThanOrEqual(-2)
  expect(
    metrics.bottom,
    `${label}: card bottom ${metrics.bottom} overruns the viewport (${metrics.innerHeight})`
  ).toBeLessThanOrEqual(metrics.innerHeight + 2)

  // (3) It is a REAL scroll container, and one the USER can scroll. Both halves
  //     are needed: the probe alone cannot tell `auto` from `hidden` (both move
  //     `scrollTop`), and the computed style alone cannot prove there is
  //     anything to scroll.
  expect(
    ['auto', 'scroll'],
    `${label}: card computes overflow-y: ${metrics.overflowY} — the user cannot scroll it`
  ).toContain(metrics.overflowY)

  const reached = await probeScrollability(card)
  expect(
    reached,
    `${label}: card did not scroll (scrollTop stayed ${reached}) — max-height without an overflow value SPILLS`
  ).toBeGreaterThan(0)

  // (3b) The card's own computed `overflow-x: auto` (forced by `overflow-y`)
  //      makes it a HORIZONTAL scroll container too, so its BOX can never
  //      exceed the viewport however far its CONTENT overflows. Checking the
  //      box position alone would be 31.2's absorption trap recreated by this
  //      story's own constraint — on modals nobody had measured horizontally.
  expect(
    metrics.scrollWidth,
    `${label}: card scrolls horizontally — scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth}. Absorbed by the card, so no document-level check can see this.`
  ).toBeLessThanOrEqual(metrics.clientWidth + 1)

  // (4) The footer is genuinely out of reach before scrolling, and fully
  //     reachable after. The negative half is what proves the positive half is
  //     not a tautology, so it must be more than the bare complement of it:
  //     `not.toBeInViewport({ ratio: 1 })` is satisfied by a footer one pixel
  //     short of fully visible, which would let a barely-over-tall fixture
  //     masquerade as proof.
  //
  //     MEASURED at rest: the `/balance` submit button is at ratio 0 (entirely
  //     below the card's visible box) and the premium prompt's CTA at ~0.375
  //     — its card is less over-tall. 0.5 is therefore the tightest shared
  //     threshold, and it is a real claim: more than half the control is out of
  //     reach until the user scrolls.
  await expect(
    footer,
    `${label}: footer is already mostly visible without scrolling — fixture too short to prove reachability`
  ).not.toBeInViewport({ ratio: 0.5 })

  await card.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(footer, `${label}: footer unreachable after scrolling to the bottom`).toBeInViewport(
    {
      ratio: 1,
    }
  )

  const footerRect = await footer.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  })
  const scrolled = await readCardMetrics(card)
  expect(
    footerRect.bottom,
    `${label}: footer sits below the card's own box after scrolling`
  ).toBeLessThanOrEqual(scrolled.bottom + 2)
  expect(
    footerRect.bottom,
    `${label}: footer sits below the viewport after scrolling`
  ).toBeLessThanOrEqual(scrolled.innerHeight + 2)

  // (5) Body scroll stays locked THROUGHOUT — sampled before and after the
  //     scroll sequence, since writing `scrollTop` on the card is exactly the
  //     kind of thing that could release it.
  expect(metrics.bodyOverflow, `${label}: body scroll is not locked on open`).toBe('hidden')
  expect(
    scrolled.bodyOverflow,
    `${label}: body scroll lock was released by scrolling the card`
  ).toBe('hidden')

  await card.evaluate((el) => {
    el.scrollTop = 0
  })
}

test.describe('modals fit height-constrained viewports (story 31.3)', () => {
  test(`the tallest modal fits and scrolls at ${NARROW_WIDTH}x${SHORT_HEIGHT}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: SHORT_HEIGHT })
    // Deliberately UNSEEDED: the Add form renders its full field set on an empty
    // /balance because the type defaults to `investment`, the only arm that shows
    // the contribution amount, the frequency AND the recorded-as-expense checkbox.
    await page.goto('/balance')
    await page.waitForLoadState('networkidle')

    const card = await openBalanceAddModal(page)
    const submit = card.getByRole('button', { name: 'Add Balance Entry' })

    await assertTallModalFitsAndScrolls(
      card,
      submit,
      `/balance add (${NARROW_WIDTH}x${SHORT_HEIGHT})`
    )

    // AC-6 at the element level. A document-level "no new horizontal overflow"
    // claim is UNFALSIFIABLE inside a modal: `overflow-y-auto` computes
    // `overflow-x` to `auto` too (CSS Overflow 3), so the card absorbs its own
    // horizontal overflow, and the body lock hides it from `documentElement`.
    const metrics = await readCardMetrics(card)
    expect(metrics.left, 'card starts left of the viewport').toBeGreaterThanOrEqual(0)
    expect(metrics.right, 'card extends past 320px').toBeLessThanOrEqual(NARROW_WIDTH)
  })

  test(`the tallest modal fits and scrolls at ${LANDSCAPE.width}x${LANDSCAPE.height} (landscape)`, async ({
    page,
  }) => {
    // iPhone SE landscape: only 320px of HEIGHT. Harsher than 640x360 and the
    // epic's literal floor.
    await page.setViewportSize({ width: LANDSCAPE.width, height: LANDSCAPE.height })
    await page.goto('/balance')
    await page.waitForLoadState('networkidle')

    const card = await openBalanceAddModal(page)
    const submit = card.getByRole('button', { name: 'Add Balance Entry' })

    await assertTallModalFitsAndScrolls(
      card,
      submit,
      `/balance add (${LANDSCAPE.width}x${LANDSCAPE.height})`
    )
  })

  /**
   * Story 36.3 (UX-DR40 / AC-7) — the debt guidance at the narrow floor.
   *
   * ⚠️ A NEW case, deliberately not a change to the two above. Those are
   * UNSEEDED so the type defaults to `investment`, the arm with the most fields
   * and therefore the tallest modal in the app. Selecting Debt REMOVES the
   * recorded-as-expense checkbox, so converting either case would have traded a
   * taller fixture for a shorter one and quietly weakened the guard it exists to
   * be. (Before story 49.1 the field Debt removed was the contribution limit;
   * that field is gone for every type now, but the investment arm is still the
   * tallest — re-measured in 49.1, see `openBalanceAddModal`.)
   *
   * The debt hint is the longer of the story's two strings and wraps to several
   * lines in a ~272px content box, so it is measured rather than reasoned about.
   */
  test(`the debt guidance fits at ${NARROW_WIDTH}x${SHORT_HEIGHT} in both themes (36.3)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: SHORT_HEIGHT })
    await page.goto('/balance')
    await page.waitForLoadState('networkidle')

    const card = await openBalanceAddModal(page)
    await card.getByLabel(/type/i).selectOption('debt')

    const hint = card.getByTestId('balance-debt-hint')
    await expect(hint).toBeVisible()

    // (1) The hint wraps INSIDE its own box rather than widening it, and the
    //     box stays within the card. `scrollWidth > clientWidth` here would mean
    //     an unbreakable run of text pushing the card wider than the viewport.
    const box = await hint.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      right: el.getBoundingClientRect().right,
      left: el.getBoundingClientRect().left,
    }))
    // ⚠️ `+ 1`, matching every sibling comparison in this file (`:1363`, `:1587`).
    // `scrollWidth` and `clientWidth` round independently under subpixel layout,
    // so a paragraph whose content box lands on a fraction can report one pixel
    // of phantom overflow. A CI font change is exactly what moves a wrap point
    // onto such a boundary.
    expect(box.scrollWidth, 'debt hint overflows its own box').toBeLessThanOrEqual(
      box.clientWidth + 1
    )
    expect(box.left, 'debt hint starts left of the viewport').toBeGreaterThanOrEqual(0)
    expect(box.right, 'debt hint extends past 320px').toBeLessThanOrEqual(NARROW_WIDTH)

    // (2) The CARD must not be pushed past the viewport by the taller content.
    //
    // ⚠️ This deliberately does NOT use `assertNoHorizontalOverflow`. A
    // document-level overflow claim is UNFALSIFIABLE inside a modal — the same
    // fact the sibling test records above: `overflow-y-auto` computes
    // `overflow-x` to `auto`, so the card absorbs its own horizontal overflow,
    // and the body lock hides it from `documentElement`. The first draft of this
    // test asserted it anyway and would have passed against any defect.
    // (Review 36.3.)
    const cardMetrics = await readCardMetrics(card)
    expect(cardMetrics.left, 'card starts left of the viewport').toBeGreaterThanOrEqual(0)
    expect(cardMetrics.right, 'card extends past 320px').toBeLessThanOrEqual(NARROW_WIDTH)

    // (3) The full house assertion — over-tall precondition, both ends inside the
    //     viewport, internal scroll, and the submit control reachable.
    //
    // ⚠️ MEASURED, and it overturned story 36.3's own written assumption. That
    // spec predicted the helper's over-tall precondition would REJECT the debt
    // form (Debt rendered one field fewer than investment) and told the
    // implementer to substitute a hand-rolled reachability check. Probed in
    // review 36.3: the helper PASSES — the debt form plus this hint is still
    // over-tall at 320x480. So the real assertion is used rather than the weaker
    // substitute, and the prediction is recorded as wrong rather than quietly
    // inherited. (Still true after story 49.1 removed the contribution-limit
    // field from every arm — re-measured; see `openBalanceAddModal`'s table.)
    const submit = card.getByRole('button', { name: 'Add Balance Entry' })
    await assertTallModalFitsAndScrolls(
      card,
      submit,
      `/balance add debt (${NARROW_WIDTH}x${SHORT_HEIGHT})`
    )

    // (4) Dark mode.
    //
    // ⚠️ The assertion must be something a THEME can change. A first draft
    // re-measured `scrollWidth` here, which is font geometry — no `.dark` token
    // touches it, so that arm could not fail independently of step (1) and the
    // "both themes" in this test's name was unearned (review 36.3). The colour
    // is what dark mode alters, so the colour is what gets asserted: it must
    // actually differ from the light value, and it must not be transparent.
    const lightColor = await hint.evaluate((el) => getComputedStyle(el).color)

    // Apply the class and confirm it STUCK — ThemeProvider applies the store's
    // 'light' default once on mount and could otherwise strip it. Hydration is
    // long finished by this point (we have already driven a <select>), so a
    // poll on the class is enough and keeps the colour check below as the thing
    // that reports a failure.
    //
    // ⚠️ Deliberately NOT `waitForFunction(colour !== light)`: that form makes a
    // theme-invariant colour fail as a 30s TIMEOUT instead of naming the defect.
    // Verified — it did exactly that before this was split (review 36.3).
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true)

    await expect(hint).toBeVisible()
    const darkColor = await hint.evaluate((el) => getComputedStyle(el).color)
    expect(darkColor, 'debt hint colour is unchanged in dark mode').not.toBe(lightColor)
    expect(darkColor, 'debt hint is transparent in dark mode').not.toMatch(/rgba\(.*,\s*0\)$/)

    const darkBox = await hint.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(darkBox.scrollWidth, 'debt hint overflows its box in dark').toBeLessThanOrEqual(
      darkBox.clientWidth + 1
    )
  })

  /**
   * Story 36.3 (AC-7) — the OTHER hint. AC-7 says "both hints survive 320px in
   * light and dark"; the case above covers only the balance one, and no e2e
   * anywhere opened the Expenses modal at this width. Added in review 36.3
   * rather than left as a disclosure, because "both" is the AC's word.
   */
  test(`the expenses guidance fits at ${NARROW_WIDTH}x${SHORT_HEIGHT} in both themes (36.3)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: SHORT_HEIGHT })
    await page.goto('/expenses')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: '+ Add Expense' }).click()
    const card = page.getByRole('dialog', { name: 'Add Expense' })
    await expect(card).toBeVisible()

    const hint = card.getByTestId('expense-mortgage-hint')
    await expect(hint).toBeVisible()

    const box = await hint.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right,
    }))
    expect(box.scrollWidth, 'expenses hint overflows its own box').toBeLessThanOrEqual(
      box.clientWidth + 1
    )
    expect(box.left, 'expenses hint starts left of the viewport').toBeGreaterThanOrEqual(0)
    expect(box.right, 'expenses hint extends past 320px').toBeLessThanOrEqual(NARROW_WIDTH)

    const submit = card.getByRole('button', { name: 'Add Expense' })
    await submit.scrollIntoViewIfNeeded()
    await expect(submit).toBeVisible()

    // Dark: assert the COLOUR, the one thing a theme actually changes here.
    const lightColor = await hint.evaluate((el) => getComputedStyle(el).color)
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true)
    await expect(hint).toBeVisible()
    const darkColor = await hint.evaluate((el) => getComputedStyle(el).color)
    expect(darkColor, 'expenses hint colour is unchanged in dark mode').not.toBe(lightColor)
  })

  test(`a short modal is unchanged at ${NARROW_WIDTH}x${SHORT_HEIGHT} (AC-5, AC-6)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: SHORT_HEIGHT })
    await seedFinanceRows(page, 'light')
    await page.goto('/balance')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

    await page.getByRole('button', { name: `Delete ${LONG_UNBROKEN_NAME}` }).click()
    const card = page.getByRole('alertdialog', { name: 'Confirm Delete' })
    await expect(card).toBeVisible()

    const metrics = await readCardMetrics(card)

    // Nothing to scroll. This is what catches an `h-full` typo for `max-h-full`
    // or a stray `min-h`: without it, a change that stretched EVERY modal to
    // full height would ship green against the tall-modal tests above.
    const reached = await probeScrollability(card)
    expect(reached, 'a short dialog must have nothing to scroll').toBe(0)

    // Not stretched: strictly under the cap (viewport minus the overlay's 1rem
    // gutter on each side). `h-full` would land exactly ON the cap.
    const cap = metrics.innerHeight - 32
    expect(metrics.height, `short dialog was stretched to the height cap (${cap})`).toBeLessThan(
      cap
    )

    // Still centred with the existing gutter.
    expect(metrics.top, 'short dialog is not centred').toBeGreaterThan(0)
    expect(metrics.bottom).toBeLessThan(metrics.innerHeight)
    expect(
      Math.abs(metrics.top - (metrics.innerHeight - metrics.height) / 2),
      'short dialog is no longer vertically centred'
    ).toBeLessThanOrEqual(2)

    // AC-6 — the element-level horizontal check, the only version of this
    // assertion that can fail. The delete message interpolates a 138-character
    // unbroken name; before `break-words` this measured scrollWidth 1214 vs
    // clientWidth 288, entirely invisible to `documentElement`.
    expect(
      metrics.scrollWidth,
      `confirm dialog scrolls horizontally: scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth}`
    ).toBeLessThanOrEqual(metrics.clientWidth + 1)
    expect(metrics.left).toBeGreaterThanOrEqual(0)
    expect(metrics.right).toBeLessThanOrEqual(NARROW_WIDTH)
  })

  for (const viewport of [
    { width: NARROW_WIDTH, height: SHORT_HEIGHT },
    { width: LANDSCAPE.width, height: LANDSCAPE.height },
  ] as const) {
    test(`dismissal still works at ${viewport.width}x${viewport.height} (AC-7, UX-DR10)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/balance')
      await page.waitForLoadState('networkidle')

      const card = await openBalanceAddModal(page)
      await page.keyboard.press('Escape')
      await expect(card).toBeHidden()

      const reopened = await openBalanceAddModal(page)
      // Confirm the corner is actually backdrop at THIS viewport rather than
      // inheriting `modal-dismissal.spec.ts`'s assumption — the card is wider
      // relative to the viewport here, and a press that lands on the card
      // would (correctly, per AC-7) no longer dismiss.
      const cornerIsOverlay = await page.evaluate(() => {
        const el = document.elementFromPoint(8, 8)
        return el?.matches('.fixed.inset-0') ?? false
      })
      expect(cornerIsOverlay, 'the 8,8 corner is not the backdrop at this viewport').toBe(true)

      await page.mouse.click(8, 8)
      await expect(reopened).toBeHidden()
    })
  }

  test(`the premium prompt fits and scrolls at ${NARROW_WIDTH}x${SHORT_HEIGHT}`, async ({
    page,
  }) => {
    // The only OTHER tall modal reachable unauthenticated, and the one that
    // covers the transparent-outer-card branch `/balance` cannot.
    //
    // Still accurate after story 41.1 made the sync box activatable: sync opens
    // this SAME `PremiumPrompt`, so the count of tall modal TYPES is unchanged —
    // there are just five gates that can open this one now instead of four. The
    // locator below stays on Advanced Forecasting deliberately; measuring the
    // prompt from any single gate is enough, and `premium-locked.spec.ts` is what
    // proves every gate reaches it.
    await page.setViewportSize({ width: NARROW_WIDTH, height: SHORT_HEIGHT })
    await page.goto('/')

    const lockedFeature = page.getByRole('button', {
      name: /advanced forecasting — premium, locked/i,
    })
    const goPremium = page.getByRole('heading', { name: /go premium/i })
    await expect(async () => {
      if (!(await goPremium.isVisible())) {
        await lockedFeature.click()
      }
      await expect(goPremium).toBeVisible({ timeout: 1000 })
    }).toPass()

    const card = page.getByRole('dialog', { name: 'Go Premium' })
    // Use the SHARED assertion, not a hand-rolled subset. The first version of
    // this test ran the scrollability probe alone, and the `overflow-hidden`
    // mutation left it green while both `/balance` tests went red — the one
    // fixture covering the transparent-outer-card branch had the weakest
    // assertions in the file.
    const upgrade = card.getByRole('link', { name: /upgrade to premium/i })
    await assertTallModalFitsAndScrolls(
      card,
      upgrade,
      `premium prompt (${NARROW_WIDTH}x${SHORT_HEIGHT})`
    )

    // This card is fully TRANSPARENT — the visible gradient panel is its child.
    // Now that the wrapper is the scroll (and therefore clip) box, its clip
    // radius must MATCH the panel's, or the panel's corners are cropped.
    // Asserting equality rather than "not 0px": any nonzero radius passes a
    // not-0px check while still cropping an `xl` corner.
    const radii = await card.evaluate((el) => {
      const panel = el.firstElementChild
      return {
        clipBox: getComputedStyle(el).borderTopLeftRadius,
        panel: panel === null ? null : getComputedStyle(panel).borderTopLeftRadius,
      }
    })
    expect(
      radii.panel,
      'the inner premium panel is not rounded — fixture assumption broken'
    ).not.toBe('0px')
    expect(
      radii.clipBox,
      `the scroll box radius (${radii.clipBox}) does not match the panel it clips (${radii.panel})`
    ).toBe(radii.panel)

    const metrics = await readCardMetrics(card)
    expect(metrics.left).toBeGreaterThanOrEqual(0)
    expect(metrics.right).toBeLessThanOrEqual(NARROW_WIDTH)
  })
})
