/**
 * FREE nav row — intrinsic width, available width, and a wrap sweep of every desktop width.
 *
 * Committed by story 59.1's code review, RE-SCOPED by story 59.2, and split
 * into TWO BANDS by story 69.3 (FR110, decision D1):
 *
 *   - below `lg` (640-1023px): the five-item row, Overview · Income · Expenses
 *     · Savings · More, with Balances and Retirement in the More panel;
 *   - at `lg` and up: SIX anchors, Overview · Income · Expenses · Savings ·
 *     Balances · Retirement, and NO More (nothing is left behind it for a free
 *     session).
 *
 * The figures this logs are quoted in `nav-responsive-css.spec.ts`; when they
 * change, re-run this and update that ONE place.
 *
 * It LOGS the figures (the measurement is the deliverable) and asserts only what
 * is font-independent, so it cannot go false-red between DejaVu/CI and Noto/dev:
 *
 *   - each band's row labels, so the file is known to be measuring that row;
 *   - that each row needs MORE width with a longer label than a shorter one —
 *     the exact bug 59.1 hit three times (see `helpers/nav-width.ts`);
 *   - two INDEPENDENT agreements per band: the summed row equals the rendered
 *     list, and the A/B saving equals the font's own delta between the strings;
 *   - the free row is one line at EVERY 5px step from 640 to 1400px (signed
 *     out), in both planner states, and fits the available width at each
 *     sampled width.
 */
import { type Page, expect, test } from '@playwright/test'
import { MORE_SUMMARY } from './helpers/nav-more'
import {
  LG,
  findWrappingWidths,
  hidePlannerBeforeLoad,
  measureAvailable,
  measureBands,
  measurePanel,
  probeFont,
} from './helpers/nav-width'

const WIDTHS = [640, 700, 760, 1000, 1024, 1152, 1280, 2400] as const
const LOG_TAG = '[free nav width]'
const LONGER = 'Expenses Tracking'
const FIVE_ITEM_ROW = ['Overview', 'Income', 'Expenses', 'Savings', 'More']

const r = (n: number) => Math.round(n * 100) / 100

async function measureFreeNav(page: Page, lgRow: string[], panelRows: number) {
  await page.setViewportSize({ width: 2400, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // The A/B swaps a label that is IN both rows. "Expenses Tracking" is two
  // words on purpose: if shrink were live on the `<li>`, it would wrap and
  // measure as its longest word, and the guard below would catch it.
  const font = await probeFont(page, ['Expenses', LONGER, 'Balances', 'Retirement', 'More'])
  const available = await measureAvailable(page, WIDTHS)
  // Every 5px from 640 to 1400, crossing the `lg` boundary.
  const wrappingWidths = await findWrappingWidths(page)
  // The panel exists only below `lg` for a free session.
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.waitForTimeout(120)
  const panelBelowLg = await measurePanel(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(120)
  const moreVisibleAtLg = await page.locator(MORE_SUMMARY).isVisible()

  const bands = await measureBands(page, LONGER)
  const needed = (w: number) => (w >= LG ? bands.lg.totalNeeded : bands.belowLg.totalNeeded)
  const headroom = Object.fromEntries(
    Object.entries(available).map(([w, a]) => [w, r(a.available - needed(Number(w)))])
  )
  const fontDelta = r((font.widths[LONGER] ?? 0) - (font.widths.Expenses ?? 0))

  // eslint-disable-next-line no-console -- the measurement IS the deliverable
  console.log(
    LOG_TAG,
    JSON.stringify(
      {
        font,
        available,
        wrappingWidths,
        panelBelowLg,
        moreVisibleAtLg,
        bands,
        headroom,
        fontDelta,
      },
      null,
      2
    )
  )

  expect(bands.belowLg.labels, 'not measuring the five-item row below lg').toEqual(FIVE_ITEM_ROW)
  expect(bands.lg.labels, 'not measuring the free lg row').toEqual(lgRow)
  expect(moreVisibleAtLg, 'a free session has a More trigger at lg').toBe(false)
  expect(panelBelowLg.visible, 'the panel did not open for measurement').toBe(true)
  expect(panelBelowLg.rowHeights, 'not measuring this tier’s panel').toHaveLength(panelRows)
  for (const [name, shipped, longer] of [
    ['below lg', bands.belowLg, bands.belowLgLonger],
    ['lg', bands.lg, bands.lgLonger],
  ] as const) {
    expect(longer.itemCount).toBe(shipped.itemCount)
    // The harness-correctness guard — see `helpers/nav-width.ts`.
    expect(
      longer.totalNeeded,
      `${name}: the LONGER label measured NARROWER: the row is being compressed, so the number is wrong (flex-shrink must be killed on the <li>, not the <a>)`
    ).toBeGreaterThan(shipped.totalNeeded)
    // Independent probe 1: the sum must agree with what the browser rendered.
    expect(
      Math.abs(shipped.renderedListWidth - shipped.totalNeeded),
      `${name}: the summed row disagrees with the rendered list — the harness is summing the wrong elements`
    ).toBeLessThanOrEqual(1)
    // Independent probe 2: the A/B saving must agree with the font's own delta.
    expect(
      Math.abs(r(longer.totalNeeded - shipped.totalNeeded) - fontDelta),
      `${name}: the A/B saving disagrees with the font probe — the swapped label is not what the row measured`
    ).toBeLessThanOrEqual(1)
  }
  // The claim for the free tier: one row at every desktop width 640-1400px,
  // fitting the available width at every sampled one.
  for (const [width, a] of Object.entries(available)) {
    expect(a.rows, `the free row wraps at ${width}px`).toBe(1)
    expect(needed(Number(width)), `the free row does not fit at ${width}px`).toBeLessThanOrEqual(
      a.available
    )
  }
  expect(wrappingWidths, 'the free row wraps at these desktop widths').toEqual([])
}

test('MEASURE: the free desktop row — five items below lg, six anchors from lg', async ({
  page,
}) => {
  await measureFreeNav(
    page,
    ['Overview', 'Income', 'Expenses', 'Savings', 'Balances', 'Retirement'],
    2
  )
})

// Epic AC-6 / story AC-5: a user with the planner off has one fewer anchor, so
// the row is measured in BOTH states.
test('MEASURE: the free desktop row with the Retirement planner hidden', async ({ page }) => {
  await hidePlannerBeforeLoad(page)
  await measureFreeNav(page, ['Overview', 'Income', 'Expenses', 'Savings', 'Balances'], 1)
})
