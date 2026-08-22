import { expect, test } from '@playwright/test'

/**
 * What You Own vs What You Owe — the Balance page chart (story 37.2, FR64 / UX-DR42).
 *
 * ⚠️ WHY THESE ASSERTIONS LIVE IN E2E AND NOT IN THE UNIT SUITE. jsdom gives
 * Recharts' `ResponsiveContainer` a 0×0 box, so the chart renders NO SVG there —
 * every `.recharts-*` selector returns 0 whether the chart is right, broken, or
 * absent. Painted colour, real layout, 320px containment, whether the narrow
 * branch actually applies, and whether the accessible name reaches the a11y tree
 * are ALL unfalsifiable in a unit test.
 */

const CARD_DARK = 'rgb(31, 41, 55)'
const AXIS_DARK = '#9ca3af'

/** A 138-character unbroken name, the repo's own adversarial fixture. */
const LONG_UNBROKEN_NAME = 'Longestpossibleaccountnicknamewithoutanyspaces'.repeat(3)

/**
 * ⚠️ CI resolves `system-ui` to DejaVu Sans; a dev box resolves it to the
 * narrower Noto Sans. A width assertion measured in the narrow font is not
 * evidence about CI — that is exactly how epic 34 shipped a broken 768px width
 * budget with every gate green. `responsive-320.spec.ts`'s own DejaVu pin is
 * scoped to a single `describe` and no `/balance` case inherits it, so this file
 * pins its own.
 */
const WIDE_FONT = '*,*::before,*::after{font-family:"DejaVu Sans"!important}'

/**
 * Two investments, two debts and two savings goals.
 *
 * ⚠️ `version: 2`, NOT 3. Version 3 skips the store's `migrate` entirely, so
 * rows arrive with no `sortOrder` — and the ordering this chart depends on is
 * exactly what that backfills. `net-worth-savings.spec.ts` and
 * `responsive-320.spec.ts` both seed 2 for the same reason.
 *
 * ⚠️ One investment carries a 138-character unbroken name. Nothing caps an entry
 * name (100 chars at the form, unbounded from storage), and it is the only
 * unbounded text this chart can paint — it reaches the TOOLTIP, since the
 * category axis only ever reads "Assets"/"Liabilities". A benign short name
 * would make the tooltip containment assertion pass on broken and fixed code
 * alike.
 *
 * Totals: assets 300,000 savings + 2,500,000 investments = 2,800,000c;
 * liabilities 900,000c; net worth 1,900,000c → "$19,000.00".
 */
function seedBalances() {
  const now = new Date().toISOString()
  localStorage.setItem(
    'budget-planner:balance-tracking',
    JSON.stringify({
      state: {
        entries: [
          {
            id: 'inv-1',
            type: 'investment',
            name: 'Longestpossibleaccountnicknamewithoutanyspaces'.repeat(3),
            currentBalance: 2000000,
            maxContributionLimit: null,
            monthlyContribution: 0,
            frequency: 'monthly',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'inv-2',
            type: 'investment',
            name: 'TFSA',
            currentBalance: 500000,
            maxContributionLimit: null,
            monthlyContribution: 0,
            frequency: 'monthly',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'debt-1',
            type: 'debt',
            name: 'Mortgage',
            currentBalance: 800000,
            maxContributionLimit: null,
            monthlyContribution: 0,
            frequency: 'monthly',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'debt-2',
            type: 'debt',
            name: 'Car loan',
            currentBalance: 100000,
            maxContributionLimit: null,
            monthlyContribution: 0,
            frequency: 'monthly',
            createdAt: now,
            updatedAt: now,
          },
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
            name: 'Emergency fund',
            targetAmount: 1000000,
            currentBalance: 250000,
            allocationMode: 'automatic',
            monthlyAllocation: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'sav-2',
            name: 'Rainy day',
            targetAmount: null,
            currentBalance: 50000,
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
}

/**
 * Wait for the chart to have actually PAINTED before asserting anything about
 * it — and especially before asserting anything is ABSENT.
 *
 * ⚠️ Witness first, absence second. Recharts renders asynchronously and
 * animates; an absence assertion that runs before the first paint passes
 * vacuously, and identically against code that would have painted the thing.
 * Story 36.2 measured exactly that failure.
 */
async function chartPainted(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('balance-chart')).toBeVisible()
  await expect(
    page.locator('[data-testid="balance-chart"] path.recharts-rectangle')
  ).not.toHaveCount(0)
}

/**
 * Wait until the bars have finished ANIMATING, not merely appeared.
 *
 * ⚠️ `chartPainted` proves a `<path>` exists; it does not prove the path has its
 * final geometry. Recharts animates bars up from zero height on mount, so any
 * measurement taken during that window reads a box that is too short — or, at
 * the very first frame, no box at all (`boundingBox()` returns null for a
 * zero-size element). Both failure modes are ORDER-DEPENDENT: they pass when the
 * test runs alone and fail in a full-file run, which is the worst shape a flake
 * can have. Poll until two consecutive samples agree and every bar has height.
 */
async function barsSettled(page: import('@playwright/test').Page) {
  await chartPainted(page)
  const heights = () =>
    page.locator('[data-testid="balance-chart"] path.recharts-rectangle').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect()
        return [Math.round(rect.width), Math.round(rect.height)]
      })
    )
  let previous: string | null = null
  await expect
    .poll(
      async () => {
        const current = await heights()
        const settled =
          previous === JSON.stringify(current) &&
          current.length > 0 &&
          current.every(([width, height]) => (width ?? 0) > 0 && (height ?? 0) > 0)
        previous = JSON.stringify(current)
        return settled
      },
      { timeout: 10_000 }
    )
    .toBe(true)
}

/**
 * The value-axis gutter in px: the distance from the chart's left edge to the
 * vertical axis line.
 *
 * ⚠️ NOT `.recharts-yAxis`'s bounding box. That `<g>` contains the tick TEXT,
 * which paints outside the reserved gutter, so the bbox reports the overflow
 * rather than the gutter and is useless as a gutter assertion in both
 * directions.
 *
 * ⚠️ In THIS chart the Y axis is the VALUE axis — the chart uses Recharts'
 * default column layout, the inverse of `SavingsChart`'s `layout="vertical"`.
 */
async function valueAxisGutterPx(page: import('@playwright/test').Page): Promise<number> {
  const chart = await page.locator('[data-testid="balance-chart"]').boundingBox()
  const axisLine = await page
    .locator('[data-testid="balance-chart"] .recharts-yAxis .recharts-cartesian-axis-line')
    .first()
    .boundingBox()
  expect(chart).not.toBeNull()
  expect(axisLine).not.toBeNull()
  return (axisLine?.x ?? 0) - (chart?.x ?? 0)
}

test.describe('Balance chart', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedBalances)
  })

  test('renders a named plot whose values stay readable in the tables', async ({ page }) => {
    await page.goto('/balance')
    await chartPainted(page)

    // ⚠️ Queried BY NAME. Other elements expose role="img", so a bare
    // getByRole('img') is a strict-mode violation. The label carries a U+2014 EM
    // DASH — a typed hyphen silently fails to match.
    const plot = page.getByRole('img', { name: /^What you own against what you owe — / })
    await expect(plot).toBeVisible()

    // `role="img"` makes the plot OPAQUE to assistive tech, so the chart must
    // stay additive: the tables are the text path to the per-entry numbers.
    await expect(page.getByRole('cell', { name: '$5,000.00', exact: true }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: '$8,000.00', exact: true }).first()).toBeVisible()
  })

  // AC-13's entry-name fence, asserted at the ONLY layer that could break it.
  // ⚠️ The page test cannot see SVG (jsdom renders none) and the contract test
  // stubs the chart by construction, so both are structurally incapable of
  // catching a `<Legend>`, a `LabelList`, or any other Recharts-rendered entry
  // name. Without this case, adding one would keep all three suites green while
  // breaking the fence — and detonate the 138-character name at 320px.
  test('renders no entry name anywhere in the chart except the tooltip', async ({ page }) => {
    await page.goto('/balance')
    await chartPainted(page)

    const chartText = await page.locator('[data-testid="balance-chart"]').evaluate((element) => {
      const clone = element.cloneNode(true) as HTMLElement
      for (const tip of clone.querySelectorAll('.recharts-tooltip-wrapper')) tip.remove()
      return clone.textContent ?? ''
    })

    for (const name of [LONG_UNBROKEN_NAME, 'TFSA', 'Mortgage', 'Car loan']) {
      expect(chartText).not.toContain(name)
    }
    // Anti-vacuity: the chart DID render text (its axis ticks), so the absences
    // above are real rather than an empty-string trivially containing nothing.
    expect(chartText).toContain('Assets')
  })

  // AC-3. The chart carries no total of its own, so the equality is asserted on
  // the two figures it DOES expose: the reference-line label and the accessible
  // name. Both must equal the Net Worth card exactly.
  test('agrees with the page’s Net Worth card', async ({ page }) => {
    await page.goto('/balance')
    await chartPainted(page)

    const cardText = (await page.getByTestId('stat-net-worth').textContent())?.trim()
    expect(cardText).toBe('$19,000.00')

    // 1. The painted reference-line label.
    const referenceLabel = page.locator(
      '[data-testid="balance-chart"] .recharts-reference-line text'
    )
    await expect(referenceLabel).toHaveText(`Net worth ${cardText}`)

    // 2. The accessible name, which is the ONLY non-visual path to the three
    //    aggregates — neither column total appears anywhere else on the page,
    //    and the savings figure is in a stat card, not a table.
    const label = await page
      .getByRole('img', { name: /^What you own against what you owe — / })
      .getAttribute('aria-label')
    expect(label).toContain('assets $28,000.00')
    expect(label).toContain('liabilities $9,000.00')
    expect(label).toContain(`net worth ${cardText}`)
  })

  // AC-2. The two sides are told apart by axis position and label, never by hue.
  test('labels both columns on the category axis', async ({ page }) => {
    await page.goto('/balance')
    await chartPainted(page)

    const categories = page.locator(
      '[data-testid="balance-chart"] .recharts-xAxis .recharts-cartesian-axis-tick-value'
    )
    await expect(categories).toHaveCount(2)
    await expect(categories.nth(0)).toHaveText('Assets')
    await expect(categories.nth(1)).toHaveText('Liabilities')
  })

  // AC-4 cases 1/2. "Column absent" means the model emits no datum for that
  // side — a padded two-element array would paint an empty labelled axis slot.
  test('renders ONE labelled column for a debts-only user', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('budget-planner:savings-goals')
      const now = new Date().toISOString()
      localStorage.setItem(
        'budget-planner:balance-tracking',
        JSON.stringify({
          state: {
            entries: [
              {
                id: 'debt-only',
                type: 'debt',
                name: 'Mortgage',
                currentBalance: 800000,
                maxContributionLimit: null,
                monthlyContribution: 0,
                frequency: 'monthly',
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          version: 2,
        })
      )
    })
    await page.goto('/balance')
    await chartPainted(page)

    const categories = page.locator(
      '[data-testid="balance-chart"] .recharts-xAxis .recharts-cartesian-axis-tick-value'
    )
    await expect(categories).toHaveCount(1)
    await expect(categories.nth(0)).toHaveText('Liabilities')
  })

  test('shows an empty state and no plot when there is nothing at all', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('budget-planner:balance-tracking')
      localStorage.removeItem('budget-planner:savings-goals')
    })
    await page.goto('/balance')

    await expect(page.getByTestId('balance-chart-empty')).toBeVisible()
    await expect(page.getByTestId('balance-chart-empty')).toHaveText(
      'Add an investment or debt to see what you own against what you owe'
    )
    await expect(page.getByTestId('balance-chart')).toHaveCount(0)
  })

  test('uses the wide value-axis gutter at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/balance')
    await page.addStyleTag({ content: WIDE_FONT })
    await chartPainted(page)

    expect(await valueAxisGutterPx(page)).toBeGreaterThan(70)
  })

  // AC-7. ⚠️ The detector that works here is the GUTTER, not a tick-length
  // assertion. Story 37.1's tick-length check worked because a 138-character
  // entry name was its category axis; here the category axis reads
  // "Assets"/"Liabilities" and the value axis uses the COMPACT formatter, so a
  // truncation assertion on that axis has nothing unbounded to catch.
  //
  // ⚠️ CORRECTED IN REVIEW: an earlier version of this comment claimed the
  // compact formatter's widest reachable output is "about eight characters".
  // That is false above the M band — `formatCompactAxisTick` has NO B band
  // despite its docstring, so a $10B stack sum renders "$10000.0M" and grows
  // without bound. It does not change which detector belongs here, but the
  // premise was wrong and is logged in `deferred-work.md`.
  test('fits a 320px viewport, with the gutter shrunk and the chart contained', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/balance')
    await page.addStyleTag({ content: WIDE_FONT })
    await chartPainted(page)

    expect(await valueAxisGutterPx(page)).toBeLessThan(70)

    // The reference-line label stays inside the chart's own box.
    const chartBox = await page.locator('[data-testid="balance-chart"]').boundingBox()
    const labelBox = await page
      .locator('[data-testid="balance-chart"] .recharts-reference-line text')
      .boundingBox()
    expect(chartBox).not.toBeNull()
    expect(labelBox).not.toBeNull()
    expect(labelBox?.x ?? 0).toBeGreaterThanOrEqual((chartBox?.x ?? 0) - 1)
    expect((labelBox?.x ?? 0) + (labelBox?.width ?? 0)).toBeLessThanOrEqual(
      (chartBox?.x ?? 0) + (chartBox?.width ?? 0) + 1
    )

    // ⚠️ The wrapper check is kept because it prevents measuring an UNMOUNTED
    // chart — but it cannot see SVG label overflow, because text painted outside
    // its box does not contribute to an HTML ancestor's scrollWidth. Story 37.1
    // measured that two-arm control coming back GREEN/GREEN.
    const contained = await page.evaluate(() => {
      const wrapper = document.querySelector('[data-testid="balance-chart"]')
      return !!wrapper && wrapper.scrollWidth <= wrapper.clientWidth + 1
    })
    expect(contained).toBe(true)

    const pageContained = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
    expect(pageContained).toBe(true)
  })

  // AC-7's third detector. The tooltip is the ONE place unbounded text reaches
  // this chart, via `<Bar name={entry.name}>` with a 138-character fixture name.
  test('keeps the tooltip inside the viewport at 320px with a 138-character name', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/balance')
    await page.addStyleTag({ content: WIDE_FONT })
    // ⚠️ Scroll BEFORE settling. `getBoundingClientRect` is viewport-relative and
    // `page.mouse.move` takes viewport coordinates, but at 320px the four stat
    // cards stack and push this section far below the fold — a point computed
    // off-screen reaches nothing. Scrolling also re-triggers the container's
    // measure, so the settle has to come after it, not before.
    await page.locator('[data-testid="balance-chart"]').scrollIntoViewIfNeeded()
    await barsSettled(page)

    // ⚠️ A real mouse MOVE, not `.hover()` on the path. This chart's tooltip is
    // axis-type (the default), so Recharts listens for mousemove on the chart
    // ROOT and derives the active column from the pointer's x — a synthetic
    // hover forced onto a `<path>` never reaches that handler, and the wrapper
    // stays `visibility: hidden` with the assertion passing or failing for the
    // wrong reason.
    // ⚠️ Read the rect through `evaluate`, not Playwright's `boundingBox()`.
    // For this SVG `<path>` after a programmatic scroll the latter intermittently
    // resolves to null while the element is plainly rendered — and a null here
    // fails the test for a reason that has nothing to do with the tooltip.
    const bar = await page
      .locator('[data-testid="balance-chart"] path.recharts-rectangle')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })
    expect(bar.width).toBeGreaterThan(0)
    const targetX = bar.x + bar.width / 2
    const targetY = bar.y + bar.height / 2
    // ⚠️ TWO moves. Recharts activates on a mousemove whose coordinates DIFFER
    // from the last one it saw; a single move from the page's initial pointer
    // position can be coalesced into a no-op and the wrapper stays hidden.
    await page.mouse.move(targetX - 20, targetY)
    await page.mouse.move(targetX, targetY)

    const wrapper = page.locator('[data-testid="balance-chart"] .recharts-tooltip-wrapper')
    await expect(wrapper).toBeVisible()
    // The long name is really in there — otherwise this assertion is vacuous.
    await expect(wrapper).toContainText(LONG_UNBROKEN_NAME.slice(0, 40))

    // ⚠️ The assertion that matters, and the one that caught the real defect:
    // an unbounded entry name in the tooltip made the whole PAGE scroll sideways
    // at 320px (measured right edge 356 against a 320px client width) until the
    // tooltip was given a fixed width.
    const pageContained = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
    expect(pageContained).toBe(true)
  })

  // AC-3's clipping clause. ⚠️ This case needs a fixture whose net worth lies
  // OUTSIDE both columns' painted extents — with a balanced fixture the domain
  // already spans it and the assertion cannot fail. Debts far exceeding assets
  // put net worth well below every segment, so a domain built without it clips
  // the line straight out of the plot.
  test('keeps the net-worth line inside the plot when net worth falls outside both columns', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('budget-planner:savings-goals')
      const now = new Date().toISOString()
      localStorage.setItem(
        'budget-planner:balance-tracking',
        JSON.stringify({
          state: {
            entries: [
              {
                id: 'inv-small',
                type: 'investment',
                name: 'Chequing',
                currentBalance: 100000,
                maxContributionLimit: null,
                monthlyContribution: 0,
                frequency: 'monthly',
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'debt-huge',
                type: 'debt',
                name: 'Mortgage',
                currentBalance: 9000000,
                maxContributionLimit: null,
                monthlyContribution: 0,
                frequency: 'monthly',
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          version: 2,
        })
      )
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/balance')
    await barsSettled(page)

    // Net worth is -$89,000.00, far below the lowest painted segment edge.
    await expect(page.getByTestId('stat-net-worth')).toHaveText('-$89,000.00')

    const chartBox = await page.locator('[data-testid="balance-chart"]').boundingBox()
    const lineBox = await page
      .locator('[data-testid="balance-chart"] .recharts-reference-line line')
      .boundingBox()
    expect(chartBox).not.toBeNull()
    expect(lineBox).not.toBeNull()
    expect(lineBox?.y ?? 0).toBeGreaterThanOrEqual(chartBox?.y ?? 0)
    expect(lineBox?.y ?? 0).toBeLessThanOrEqual((chartBox?.y ?? 0) + (chartBox?.height ?? 0))
  })

  // ⚠️ This does NOT live in `theme-page-coverage.spec.ts`. `/balance` is already
  // in that sweep's PAGES, but it flips dark with `classList.add('dark')` while
  // `useChartColors()` reads the zustand theme STORE — so every chart colour
  // stays on the LIGHT palette there. It also asserts only the FIRST `.surface`
  // match, which on this page is the Financial Overview card. Adding a case
  // there would have been false coverage.
  test('renders theme-aware chart chrome on the dark surface', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'budget-planner-theme-prefs-v1',
        JSON.stringify({ state: { theme: 'dark' }, version: 0 })
      )
    })
    await page.goto('/balance')
    await chartPainted(page)

    await page.waitForFunction((cardDark) => {
      const section = document.querySelector('[data-testid="balance-chart-section"]')
      return !!section && getComputedStyle(section).backgroundColor === cardDark
    }, CARD_DARK)
    await expect(page.getByTestId('balance-chart-section')).toHaveCSS('background-color', CARD_DARK)

    // Axis chrome takes the dark palette, not the light one.
    const axisStroke = await page
      .locator('[data-testid="balance-chart"] .recharts-cartesian-axis-line')
      .first()
      .getAttribute('stroke')
    expect(axisStroke?.toLowerCase()).toBe(AXIS_DARK)

    // And so does the reference line, which would otherwise paint #6b7280.
    const referenceStroke = await page
      .locator('[data-testid="balance-chart"] .recharts-reference-line line')
      .first()
      .getAttribute('stroke')
    expect(referenceStroke?.toLowerCase()).toBe(AXIS_DARK)

    // ⚠️ The SEGMENT ramp is theme-keyed too — the light ramp's darker blues fall
    // to 2.84:1 on this card. Assert a painted fill is from the DARK ramp.
    const fills = await page
      .locator('[data-testid="balance-chart"] path.recharts-rectangle')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('fill')?.toLowerCase()))
    expect(fills).toContain('#60a5fa')
    expect(fills).not.toContain('#3b82f6')
  })

  // AC-4 case 7. A negative balance paints BELOW the zero baseline, which is
  // what `stackOffset="sign"` buys and what Recharts' default would not do.
  test('draws a negative balance below the zero baseline', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('budget-planner:savings-goals')
      const now = new Date().toISOString()
      localStorage.setItem(
        'budget-planner:balance-tracking',
        JSON.stringify({
          state: {
            entries: [
              {
                id: 'inv-pos',
                type: 'investment',
                name: 'Brokerage',
                currentBalance: 1000000,
                maxContributionLimit: null,
                monthlyContribution: 0,
                frequency: 'monthly',
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'inv-neg',
                type: 'investment',
                name: 'Margin',
                currentBalance: -400000,
                maxContributionLimit: null,
                monthlyContribution: 0,
                frequency: 'monthly',
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          version: 2,
        })
      )
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/balance')
    await barsSettled(page)

    // The zero gridline's y, and the two segments' boxes.
    const zeroY = await page.evaluate(() => {
      const ticks = [
        ...document.querySelectorAll(
          '[data-testid="balance-chart"] .recharts-yAxis .recharts-cartesian-axis-tick'
        ),
      ]
      // ⚠️ `$0`, not `0`. The browser runs the real currency default (symbol /
      // USD), unlike the unit suite, which is forced currency-less.
      const zero = ticks.find((tick) => /^-?\$?0$/.test(tick.textContent?.trim() ?? ''))
      if (!zero) return null
      const rect = zero.querySelector('text')?.getBoundingClientRect()
      // ⚠️ The tick text's CENTRE, not its top. Recharts centres the label on the
      // tick, so `rect.y` sits roughly half a line-height above the baseline the
      // bars are actually drawn from.
      return rect ? rect.y + rect.height / 2 : null
    })
    expect(zeroY).not.toBeNull()

    // ⚠️ Each side is identified as a DISTINCT box, not merely asserted to exist.
    // Two bare `some()` checks over an unidentified set are both satisfiable by a
    // SINGLE short rectangle straddling the baseline — so a broken render that
    // collapsed both segments into one sliver at zero would have passed.
    //
    // ⚠️ Identified by GEOMETRY, not by fill. The e2e seed path and the unit
    // setState path order the entries differently, so which ramp colour lands on
    // which row is not stable across harnesses — measured: the ramp's first hue
    // went to the negative row here and the positive row in the unit tests.
    const boxes = await page
      .locator('[data-testid="balance-chart"] path.recharts-rectangle')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom, height: rect.height }
        })
      )
    expect(boxes).toHaveLength(2)
    const above = boxes.filter((box) => box.bottom <= (zeroY ?? 0) + 6)
    const below = boxes.filter((box) => box.top >= (zeroY ?? 0) - 6)
    // Exactly one segment on each side — and they must be DIFFERENT boxes.
    expect(above).toHaveLength(1)
    expect(below).toHaveLength(1)
    expect(above[0]).not.toBe(below[0])
    // The +$10,000 row is taller than the -$4,000 one, which pins the magnitudes
    // to the right sides of the baseline rather than merely to opposite sides.
    expect(above[0]?.height ?? 0).toBeGreaterThan(below[0]?.height ?? 0)
  })
})
