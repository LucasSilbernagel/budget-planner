import { type Page, expect, test } from '@playwright/test'
import { seedFinanceRows } from './helpers/seed-finance-rows'

/**
 * "Your Savings Until Retirement" is labelled by age (Story 44.3, UX-DR50).
 *
 * ⚠️⚠️ READ BEFORE ADDING OR "STRENGTHENING" AN ASSERTION HERE — TWO OF THIS
 * STORY'S ACs CANNOT FAIL, AND A GUARD WRITTEN FOR THEM CERTIFIES NOTHING.
 *
 * The X axis is CATEGORICAL: Recharts places category N from the category
 * COUNT, never from the label text. Renaming every tick from a years-from-now
 * number to an age therefore moves the geometry by exactly nothing. Measured in
 * this browser at `468a3e9`, before the change and after it:
 *
 *                          320 before   320 after   1280 before   1280 after
 *   chart card right edge      287.0       287.0        1183.0       1183.0
 *   last tick right edge       249.0       249.0        1126.0       1126.0
 *   "Retirement" label box  195.6-279.7 195.6-279.7  1045.0-1129.1 1045.0-1129.1
 *
 * ⚠️ READ THAT TABLE NARROWLY — IT COVERS THOSE THREE MEASUREMENTS, NOT "the
 * axis". The tick labels themselves DID change: they went from one digit to two,
 * and 320px went from 10 rendered ticks to 8. So AC-5 is satisfied by
 * construction (the plot box and the marker's category index are untouched),
 * but **AC-6 is NOT** — it survives because Recharts THINS ticks by measured
 * text width and absorbed the wider labels. That is contingent behaviour, and
 * font-dependent (see `xForAge`), not a structural guarantee. An earlier version
 * of this comment claimed both were "by construction"; that was wrong, and the
 * distinction matters to anyone deciding whether to re-measure.
 *
 * Either way the tests for them below are FLOORS — they hold the line against a
 * future change that forces more ticks or widens the margin — and they are
 * explicitly NOT evidence that this story's change works. Story 44.2 shipped exactly such an assertion
 * believing it was a guard; its review found the realistic regression sailed
 * through 11/11. The assertions that actually reverse are the ones on tick
 * TEXT, on the tooltip header, and on where the reference line lands.
 *
 * ⚠️ Ages are read from the page rather than hard-coded: `#currentAge` for the
 * start and the "Earliest retirement age" output row for the marker. The one
 * exception is the tooltip test, which hard-codes the hovered dot INDEX and
 * relies on dot *i* being projection year *i*; that mapping fails loudly (a
 * wrong age, not a silent pass) if the series ever stops starting at year 0. That row renders
 * `Math.round(earliestRetirementAge)` while the marker is placed at
 * `Math.round(earliestRetirementAge - currentAge) + currentAge` — identical for
 * a whole-number `currentAge`, which the input always holds.
 *
 * ⚠️ jsdom carries none of this: Recharts renders no SVG at all under its
 * zero-size `ResponsiveContainer`, so an axis assertion there passes vacuously
 * in BOTH directions. The tooltip's own header is pinned in
 * `src/components/__tests__/RetirementTimelineChart.test.tsx`, which can render
 * `CustomTooltip` directly.
 */

const WIDTHS = [320, 1280] as const

/**
 * Recharts' own wrapper — used ONLY to scope the tooltip locator.
 *
 * ⚠️ NOT the surface the AC-5/AC-6 bounds are measured against. Those use this
 * element's PARENT, the bordered card (see `readAxis`), which is a larger box.
 * Do not reuse this constant for a bounds assertion: every number recorded in
 * this file's header comes from the parent.
 */
const CARD = '.recharts-wrapper'

interface Tick {
  age: number
  left: number
  right: number
  centre: number
}

interface Axis {
  ticks: Tick[]
  cardLeft: number
  cardRight: number
  /** Centre x of the "Retirement" reference line itself, not its label. */
  refLineCentre: number | null
  refLabel: { left: number; right: number } | null
  /** Axis titles rendered INSIDE the SVG (desktop only). */
  svgTitles: string[]
  currentAge: number
  /** The last age on the curve, from the summary sentence. */
  finalAge: number
  /** The solver's earliest retirement age, from the outputs panel. */
  earliestRetirementAge: number
}

/**
 * Navigate to the planner with a solvable scenario and WAIT FOR HYDRATION.
 *
 * ⚠️ Playwright waits for an element to be ACTIONABLE, which server-rendered
 * markup already is — so without the `__reactEvents` gate a test can act on
 * markup React has not claimed yet and fail against a feature that works.
 * Story 44.1 lost an hour to this; the gate is borrowed from
 * `retirement-plan-persistence.spec.ts`.
 *
 * The chart renders only once the planner has source data, which
 * `seedFinanceRows` provides.
 */
async function gotoPlanner(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await seedFinanceRows(page, 'light')
  await page.goto('/retirement')
  await page.waitForFunction(() => {
    const el = document.querySelector('#currentAge')
    return !!el && Object.keys(el).some((key) => key.startsWith('__reactEvents'))
  })
  await page.waitForSelector('.recharts-xAxis .recharts-cartesian-axis-tick text')
}

async function readAxis(page: Page): Promise<Axis> {
  return page.evaluate(() => {
    const box = (el: Element | null) => (el as SVGGraphicsElement | null)?.getBoundingClientRect()

    const ticks = [
      ...document.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick text'),
    ].map((node) => {
      const r = (node as SVGGraphicsElement).getBoundingClientRect()
      return {
        age: Number(node.textContent),
        left: r.left,
        right: r.right,
        centre: (r.left + r.right) / 2,
      }
    })

    const card = document.querySelector('.recharts-wrapper')?.parentElement?.getBoundingClientRect()
    const refLine = box(document.querySelector('.recharts-reference-line line'))
    const refLabelRect = box(document.querySelector('.recharts-reference-line text'))

    // ⚠️ Scoped to the SVG. The page ALSO carries a "Current age" form label and
    // an "at age 35" phrase in the summary, so an unscoped text query for "Age"
    // matches with the axis untouched.
    const svgTitles = [...document.querySelectorAll('.recharts-surface .recharts-label')].map(
      (node) => node.textContent ?? ''
    )

    // "…your assets reach $X in 29 years, at age 64." — the LAST "at age" in the
    // sentence; the first one is the starting age.
    const summary = document.body.innerText.match(/Projection Summary:[^\n]*/)?.[0] ?? ''
    const ages = [...summary.matchAll(/at age (\d+)/g)].map((m) => Number(m[1]))

    const retirementRow = [...document.querySelectorAll('dt')].find(
      (dt) => dt.textContent === 'Earliest retirement age'
    )

    return {
      ticks,
      cardLeft: card?.left ?? Number.NaN,
      cardRight: card?.right ?? Number.NaN,
      refLineCentre: refLine ? (refLine.left + refLine.right) / 2 : null,
      refLabel: refLabelRect ? { left: refLabelRect.left, right: refLabelRect.right } : null,
      svgTitles,
      currentAge: Number((document.querySelector('#currentAge') as HTMLInputElement)?.value),
      finalAge: ages.at(-1) ?? Number.NaN,
      earliestRetirementAge: Number(retirementRow?.nextElementSibling?.textContent),
    }
  })
}

/**
 * The x a given age sits at, fitted from the ticks that ARE rendered.
 *
 * ⚠️ Deliberately interpolated rather than matched to a tick. Recharts thins
 * ticks by MEASURED TEXT WIDTH, and CI resolves `system-ui` to the wider DejaVu
 * Sans while dev boxes get the narrower Noto Sans — so which ticks survive is
 * font-dependent and the marker's own age may well have been dropped. The axis
 * is uniform, so two surviving ticks fix the whole scale. This is the same
 * font-width trap that let epic 34 ship green with a broken width budget.
 */
function xForAge(ticks: Tick[], age: number): number {
  const first = ticks[0] as Tick
  const last = ticks[ticks.length - 1] as Tick
  const perYear = (last.centre - first.centre) / (last.age - first.age)
  return first.centre + (age - first.age) * perYear
}

for (const width of WIDTHS) {
  test.describe(`@${width}px`, () => {
    /**
     * ⚠️ THE ASSERTION THAT REVERSES. Before this story the ticks read
     * 0, 1, 2 … 29 — every one of them BELOW the current age — so this fails
     * hard on a revert at both widths. Stated as a range rather than an exact
     * tick list for the font reason in `xForAge`.
     */
    test('the axis plots ages, not years from now (AC-1, AC-2)', async ({ page }) => {
      await gotoPlanner(page, width)
      const axis = await readAxis(page)

      expect(axis.currentAge).toBeGreaterThan(0)
      expect(axis.finalAge).toBeGreaterThan(axis.currentAge)
      expect(axis.ticks.length).toBeGreaterThanOrEqual(2)

      for (const tick of axis.ticks) {
        // ⚠️ `Number.isInteger` is a sanity check, NOT part of the reversal:
        // years-from-now are integers too. The range check on the next two lines
        // is what flips — every reverted tick (0…29) is below `currentAge`.
        expect(Number.isInteger(tick.age)).toBe(true)
        expect(tick.age).toBeGreaterThanOrEqual(axis.currentAge)
        expect(tick.age).toBeLessThanOrEqual(axis.finalAge)
      }

      // STRICTLY increasing left to right — a sort-equality check would also
      // pass on duplicate adjacent ticks, which is a real symptom of an upstream
      // rounding bug and would additionally break `xForAge`'s scale fit. Ordering
      // itself is a sanity check rather than a reversal (years ascend too); the
      // line that flips is the end-of-curve pin beneath it.
      const ages = axis.ticks.map((t) => t.age)
      for (let i = 1; i < ages.length; i++) {
        expect(ages[i] as number).toBeGreaterThan(ages[i - 1] as number)
      }
      // Recharts' default `preserveEnd` interval keeps the last tick whatever
      // the font does to the rest.
      expect(ages.at(-1)).toBe(axis.finalAge)
    })

    /**
     * ⚠️ AC-4. A revert that leaves `x={retirementYearOffset}` on the
     * `ReferenceLine` while the axis plots ages puts the marker at a category
     * that does not exist, which is what this catches — along with the subtler
     * case of an off-by-`currentAge` conversion.
     */
    test('the "Retirement" marker lands on the solver’s earliest retirement age (AC-4)', async ({
      page,
    }) => {
      await gotoPlanner(page, width)
      const axis = await readAxis(page)

      // Precondition, asserted rather than assumed: this scenario really does
      // reach retirement, so there really is a marker to place.
      expect(Number.isInteger(axis.earliestRetirementAge)).toBe(true)
      expect(axis.earliestRetirementAge).toBeGreaterThan(axis.currentAge)
      expect(axis.refLineCentre).not.toBeNull()
      // ⚠️ `xForAge` needs two distinct ticks to fit a scale; with one it
      // computes 0/0 and the assertion below fails as `toBeCloseTo(NaN)`, which
      // is loud but says nothing about the cause. Fail here instead, where the
      // message names the real problem.
      expect(axis.ticks.length).toBeGreaterThanOrEqual(2)

      // ⚠️ Tolerance is ±0.5px against a per-year step of ~5.4px at 320px and
      // ~32px at 1280px, so an off-by-one-YEAR marker cannot slip through — the
      // headroom is roughly 10x at the tighter width. Measured margin on correct
      // code at 320px: fitted 237.68 vs rendered 237.55, i.e. 0.13px. If this
      // ever flakes in CI, find out why before loosening the precision; slackening
      // it past ~2px starts admitting a genuinely misplaced marker.
      expect(axis.refLineCentre as number).toBeCloseTo(
        xForAge(axis.ticks, axis.earliestRetirementAge),
        0
      )
    })

    /**
     * FLOOR, NOT A GUARD (see the file header): measured identical before and
     * after this story. It exists to catch a future change to `marginRight` or
     * to the label, not to certify this one.
     */
    test('FLOOR — the "Retirement" label stays inside the chart card (AC-5)', async ({ page }) => {
      await gotoPlanner(page, width)
      const axis = await readAxis(page)

      expect(axis.refLabel).not.toBeNull()
      const label = axis.refLabel as { left: number; right: number }
      expect(label.right).toBeLessThanOrEqual(axis.cardRight)
      expect(label.left).toBeGreaterThanOrEqual(axis.cardLeft)
    })

    /**
     * FLOOR, NOT A GUARD. Ages are two digits where years-from-now were often
     * one, but Recharts absorbs that by thinning: measured, 320px went from 10
     * ticks to 8 and nothing moved. What this does catch is a future
     * `interval={0}`, which forces every category to render and overlaps them.
     */
    test('FLOOR — tick labels neither overlap nor overflow the card (AC-6)', async ({ page }) => {
      await gotoPlanner(page, width)
      const axis = await readAxis(page)

      for (const tick of axis.ticks) {
        expect(tick.left).toBeGreaterThanOrEqual(axis.cardLeft)
        expect(tick.right).toBeLessThanOrEqual(axis.cardRight)
      }

      for (let i = 1; i < axis.ticks.length; i++) {
        const previous = axis.ticks[i - 1] as Tick
        const current = axis.ticks[i] as Tick
        expect(previous.right).toBeLessThan(current.left)
      }
    })
  })
}

/**
 * ⚠️ Desktop only — `getRetirementChartChrome` drops both axis titles below the
 * `sm` breakpoint, so their ABSENCE at 320px is correct, not a miss.
 */
test('the axis title inside the chart reads "Age" (AC-1)', async ({ page }) => {
  await gotoPlanner(page, 1280)
  const axis = await readAxis(page)

  expect(axis.svgTitles).toContain('Age')
  expect(axis.svgTitles).not.toContain('Years from Now')
})

test('the axis titles stay off at 320px (AC-1, unchanged by this story)', async ({ page }) => {
  await gotoPlanner(page, 320)
  const axis = await readAxis(page)

  expect(axis.svgTitles).not.toContain('Age')
  expect(axis.svgTitles).not.toContain('Assets')
})

/**
 * ⚠️ AC-3, AND THE DEFECT THIS STORY EXISTS TO PREVENT. Measured against the
 * half-done change — axis switched to `age`, tooltip header left alone — this
 * tooltip read "Year 41" for projection year 6 of a 35-year-old: an age wearing
 * the word "year", in the one place a reader goes to resolve what the axis
 * means. Every unit test in the suite stayed green through it.
 *
 * ⚠️ The word is pinned WITH the value on purpose. `toContain('41')` passes
 * against the broken header too. And the hovered index (6) is far from the age
 * it maps to (41) precisely so the two cannot be confused for one another.
 */
test('the tooltip header agrees with the axis (AC-3)', async ({ page }) => {
  await gotoPlanner(page, 1280)
  const { currentAge } = await readAxis(page)

  const hoveredIndex = 6
  const dot = page.locator('.recharts-line-dot').nth(hoveredIndex)
  await dot.scrollIntoViewIfNeeded()
  const dotBox = await dot.boundingBox()
  expect(dotBox).not.toBeNull()
  const { x, y, width, height } = dotBox as { x: number; y: number; width: number; height: number }

  // ⚠️ A single `mouse.move` onto the point leaves the tooltip wrapper EMPTY —
  // measured. Recharts needs movement across the chart to register a hover, so
  // approach from a short distance away in steps.
  await page.mouse.move(x + width / 2 - 30, y + height / 2)
  await page.waitForTimeout(150)
  await page.mouse.move(x + width / 2, y + height / 2, { steps: 8 })

  // ⚠️ Scoped through the chart: `breakdown-pie-labels.spec.ts:339-340` records
  // a bare `.recharts-tooltip-wrapper` resolving to the wrong chart and reading
  // empty.
  const tooltip = page.locator(`${CARD} .recharts-tooltip-wrapper`)
  const expectedAge = currentAge + hoveredIndex
  expect(expectedAge).not.toBe(hoveredIndex)

  await expect(tooltip).toContainText(`Age ${expectedAge}`)
  await expect(tooltip).not.toContainText(`Year ${expectedAge}`)
})
