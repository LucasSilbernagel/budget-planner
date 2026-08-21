import { expect, test } from '@playwright/test'

/**
 * Savings at a Glance chart (story 37.1, FR64 / UX-DR42).
 *
 * ⚠️ WHY THESE ASSERTIONS LIVE IN E2E AND NOT IN THE UNIT SUITE. jsdom gives
 * Recharts' `ResponsiveContainer` a 0×0 box, so the chart renders NO SVG there —
 * every `.recharts-*` selector returns 0 whether the chart is right, broken, or
 * absent. Painted colour, real layout, 320px containment, whether the narrow
 * branch actually applies, and whether the accessible name reaches the a11y
 * tree are ALL unfalsifiable in a unit test. They are only testable here.
 */

const LONG_UNBROKEN_NAME = 'Longestpossibleaccountnicknamewithoutanyspaces'.repeat(3)
const CARD_DARK = 'rgb(31, 41, 55)'
const AXIS_DARK = '#9ca3af'
const AXIS_DARK_RGB = 'rgb(156, 163, 175)'
const CHART_ARIA_LABEL = 'Savings by account — current balance against target'

/**
 * ⚠️ CI resolves `system-ui` to DejaVu Sans; a dev box resolves it to the
 * narrower Noto Sans. A width assertion measured in the narrow font is not
 * evidence about CI — that is exactly how epic 34 shipped a broken 768px width
 * budget with every gate green. `responsive-320.spec.ts`'s own DejaVu pin is
 * scoped to a single `describe` and none of the `/savings` cases inherit it, so
 * this file pins its own.
 */
const WIDE_FONT = '*,*::before,*::after{font-family:"DejaVu Sans"!important}'

/**
 * One goal with a target and a 138-character unbroken name, plus one ACCOUNT
 * with no target.
 *
 * ⚠️ The long name is deliberate and load-bearing. It is the repo's own
 * adversarial 320px fixture (`responsive-320.spec.ts`'s `LONG_UNBROKEN_NAME`,
 * seeded there as `sav-1`). Nothing caps a savings goal's name, and Recharts
 * paints axis ticks as SVG `<text>`, which neither wraps nor ellipsizes. A
 * benign short name would make every containment assertion below pass on broken
 * and fixed code alike.
 */
function seedSavings() {
  const now = new Date().toISOString()
  localStorage.setItem(
    'budget-planner:savings-goals',
    JSON.stringify({
      state: {
        savingsGoals: [
          {
            id: 'sav-1',
            name: 'Longestpossibleaccountnicknamewithoutanyspaces'.repeat(3),
            targetAmount: 1000000,
            currentBalance: 600000,
            allocationMode: 'automatic',
            monthlyAllocation: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'sav-2',
            name: 'Emergency Fund',
            targetAmount: null,
            currentBalance: 450000,
            allocationMode: 'automatic',
            monthlyAllocation: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 3,
    })
  )
}

/**
 * Wait for the chart to have actually PAINTED before asserting anything about
 * it — and especially before asserting anything is ABSENT.
 *
 * ⚠️ Witness first, absence second. Recharts renders asynchronously and
 * animates; an absence assertion that runs before the first paint passes
 * vacuously, and it passes identically against code that would have painted the
 * thing. Story 36.2 measured exactly that failure.
 */
async function chartPainted(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('savings-chart')).toBeVisible()
  await expect(
    page.locator('[data-testid="savings-chart"] path.recharts-rectangle')
  ).not.toHaveCount(0)
}

/**
 * The Y-axis gutter in px: the distance from the chart's left edge to the
 * vertical axis line.
 *
 * ⚠️ NOT `.recharts-yAxis`'s bounding box. That `<g>` contains the tick TEXT,
 * which paints outside the reserved gutter when a label is long — measured at
 * 948px inside a 1280px chart and 870px inside a 320px one. The bbox reports the
 * overflow, not the gutter, so it is useless as a gutter assertion in both
 * directions.
 */
async function yAxisGutterPx(page: import('@playwright/test').Page): Promise<number> {
  const chart = await page.locator('[data-testid="savings-chart"]').boundingBox()
  const axisLine = await page
    .locator('[data-testid="savings-chart"] .recharts-yAxis .recharts-cartesian-axis-line')
    .first()
    .boundingBox()
  expect(chart).not.toBeNull()
  expect(axisLine).not.toBeNull()
  return (axisLine?.x ?? 0) - (chart?.x ?? 0)
}

test.describe('Savings chart', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedSavings)
  })

  test('renders a named plot whose values stay readable in the table', async ({ page }) => {
    await page.goto('/savings')
    await chartPainted(page)

    // ⚠️ Queried BY NAME. Several elements expose role="img" on this page, so a
    // bare getByRole('img') is a strict-mode violation. The label carries a
    // U+2014 EM DASH — a typed hyphen silently fails to match.
    await expect(page.getByRole('img', { name: CHART_ARIA_LABEL })).toBeVisible()

    // `role="img"` makes the plot OPAQUE to assistive tech, which is why the
    // chart must stay additive: the table is the accessible path to the numbers.
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('cell', { name: '$6,000.00', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: '$4,500.00', exact: true })).toBeVisible()
  })

  // AC-2's rendering half. An entry with no usable target must plot NO target
  // bar — not a zero-length one.
  test('plots no target bar for a savings account with no target', async ({ page }) => {
    await page.goto('/savings')
    await chartPainted(page)

    // Two Saved bars + one Target bar = 3.
    //
    // ⚠️ MEASURED LIMIT OF THIS ASSERTION. It proves no SPURIOUS target bar is
    // drawn for the account row, but it does NOT distinguish an ABSENT target
    // from a ZERO one: Recharts returns `null` from `Rectangle` whenever
    // `width === 0`, so `target: 0` paints exactly as much as `target: null` —
    // nothing. Mutating the component to emit `0` for an absent target left
    // this spec GREEN (mutation M16b). The null-vs-zero distinction is carried
    // by the data layer (`savings-chart-data.test.ts`) and the wiring test,
    // both of which go RED on that mutation. Recorded so the next reader does
    // not mistake this count for a guard it is not.
    await expect(page.locator('[data-testid="savings-chart"] path.recharts-rectangle')).toHaveCount(
      3
    )
  })

  test('shows an empty state and no plot when there are no savings goals', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('budget-planner:savings-goals'))
    await page.goto('/savings')

    await expect(page.getByTestId('savings-chart-empty')).toBeVisible()
    await expect(page.getByTestId('savings-chart-empty')).toHaveText(
      'Add a savings goal to see it charted here'
    )
    await expect(page.getByTestId('savings-chart')).toHaveCount(0)
  })

  test('uses the wide desktop axis gutter at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/savings')
    await page.addStyleTag({ content: WIDE_FONT })
    await chartPainted(page)

    expect(await yAxisGutterPx(page)).toBeGreaterThan(100)
  })

  test('fits a 320px viewport, gutter shrunk and labels truncated', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/savings')
    await page.addStyleTag({ content: WIDE_FONT })
    await chartPainted(page)

    // ⚠️ The narrow branch ACTUALLY applying. Nothing else proves the component
    // calls `getSavingsChartChrome` — a hard-coded `width={132}` passes every
    // unit assertion, because jsdom has no matchMedia and only ever reaches the
    // desktop branch.
    expect(await yAxisGutterPx(page)).toBeLessThan(100)

    // The 138-character name must be truncated, not painted out of the gutter.
    const tickTexts = await page
      .locator('[data-testid="savings-chart"] .recharts-yAxis .recharts-cartesian-axis-tick-value')
      .allTextContents()
    expect(tickTexts.length).toBeGreaterThan(0)
    for (const text of tickTexts) {
      // The NARROW limit, not the desktop one. `labelMaxChars` shrinks with the
      // gutter (10 vs 16) because 16 characters at 11px DejaVu still measures
      // wider than the 76px narrow gutter.
      expect(text.trim().length).toBeLessThanOrEqual(10)
    }
    // The truncation is real, not just short: the full name IS the underlying
    // category, and the painted tick is its 10-char prefix plus an ellipsis.
    // (A bare `not.toContain(LONG_UNBROKEN_NAME)` here would be vacuous — the
    // loop above already caps every tick at 10 characters, so a 138-character
    // needle could never be found regardless of whether truncation worked.)
    expect(tickTexts.some((text) => text.trim().endsWith('…'))).toBe(true)
    expect(tickTexts.some((text) => LONG_UNBROKEN_NAME.startsWith(text.trim().slice(0, -1)))).toBe(
      true
    )

    // Wrapper-level containment. ⚠️ The document-level check alone is
    // insufficient — an `overflow-x-auto` ancestor ABSORBS overflow instead of
    // propagating it. The `+ 1` matches every sibling assertion in the suite.
    const wrapper = await page.locator('[data-testid="savings-chart"]').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    expect(
      wrapper.scrollWidth,
      `chart overflows its wrapper: ${wrapper.scrollWidth} > ${wrapper.clientWidth}`
    ).toBeLessThanOrEqual(wrapper.clientWidth + 1)

    // AC-6 on mobile: the legend is the only place the words "Saved" and
    // "Target" appear, so if it were dropped at 320px the non-colour cue would
    // be gone exactly where the plot is smallest.
    const narrowLegend = page.locator(
      '[data-testid="savings-chart"] .recharts-legend-item-text > span'
    )
    await expect(narrowLegend).toHaveCount(2)
    await expect(narrowLegend.nth(0)).toBeVisible()
    await expect(narrowLegend.nth(1)).toBeVisible()

    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(
      doc.scrollWidth,
      `/savings overflows horizontally: ${doc.scrollWidth} > ${doc.clientWidth}`
    ).toBeLessThanOrEqual(doc.clientWidth)
  })

  // ⚠️ This does NOT live in `theme-page-coverage.spec.ts`. `/savings` is
  // already in that sweep's PAGES, but it asserts only the FIRST `.surface`
  // match on a page — the stats card — so it covers this section not at all
  // (its own comment says so). Adding a case there would have been false
  // coverage.
  test('renders theme-aware chart chrome on the dark surface', async ({ page }) => {
    // ⚠️ SEED THE THEME STORE — do NOT just add `.dark` to <html>.
    // `theme-page-coverage.spec.ts`'s classList idiom flips CSS-driven surfaces,
    // but Recharts chrome is painted from SVG attributes that `useChartColors()`
    // reads out of the zustand theme STORE. Adding the class alone leaves every
    // axis, grid and legend colour on the LIGHT palette while the card behind
    // them turns dark — which is the sub-AA combination this test exists to
    // catch. Measured: the classList version passed the card assertion and
    // failed the axis one with #6b7280.
    await page.addInitScript(() => {
      localStorage.setItem(
        'budget-planner-theme-prefs-v1',
        JSON.stringify({ state: { theme: 'dark' }, version: 0 })
      )
    })
    await page.goto('/savings')
    await chartPainted(page)

    await page.waitForFunction((cardDark) => {
      const section = document.querySelector('[data-testid="savings-chart-section"]')
      return !!section && getComputedStyle(section).backgroundColor === cardDark
    }, CARD_DARK)

    await expect(page.getByTestId('savings-chart-section')).toHaveCSS('background-color', CARD_DARK)

    // Axis chrome takes the dark palette, not the light one.
    const axisStroke = await page
      .locator('[data-testid="savings-chart"] .recharts-cartesian-axis-line')
      .first()
      .getAttribute('stroke')
    expect(axisStroke?.toLowerCase()).toBe(AXIS_DARK)

    // ⚠️ BOTH legend labels, not just the first. Recharts colours each label
    // from its own payload entry and overrides `wrapperStyle.color`, so without
    // the explicit formatter "Saved" would paint #8B5CF6 — 3.47:1 on this card.
    // ⚠️ Target the span the FORMATTER renders, not `.recharts-legend-item-text`
    // itself. Recharts sets the outer span's inline colour from the payload
    // entry (the SWATCH colour) and nests the formatter's output inside it — so
    // the outer element reads rgb(139, 92, 246) even when the visible text is
    // correctly themed. Asserting on the outer span tests the swatch, not the
    // label; asserting on the inner one tests what the user actually reads.
    const legendLabels = page.locator(
      '[data-testid="savings-chart"] .recharts-legend-item-text > span'
    )
    await expect(legendLabels).toHaveCount(2)
    for (let index = 0; index < 2; index += 1) {
      await expect(legendLabels.nth(index)).toHaveCSS('color', AXIS_DARK_RGB)
    }
    await expect(legendLabels.nth(0)).toHaveText('Saved')
    await expect(legendLabels.nth(1)).toHaveText('Target')
  })

  // AC-6: the two series must be told apart without relying on hue.
  test('distinguishes the target series by texture, not colour alone', async ({ page }) => {
    await page.goto('/savings')
    await chartPainted(page)

    const target = page
      .locator('[data-testid="savings-chart"] path.recharts-rectangle')
      .filter({ has: page.locator(':scope[stroke-dasharray]') })
    await expect(target).not.toHaveCount(0)
    await expect(target.first()).toHaveAttribute('fill', 'none')
    await expect(target.first()).toHaveAttribute('stroke-dasharray', '4 3')
  })
})
