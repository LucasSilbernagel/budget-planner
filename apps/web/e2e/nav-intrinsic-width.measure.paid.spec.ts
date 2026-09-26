/**
 * PAID nav row — intrinsic width, available width, and the open panel, in TWO
 * BANDS since story 69.3 (FR110, decision D1):
 *
 *   - below `lg` (640-1023px): the five-item row, with a six-row panel
 *     (seven until story 69.2 moved Settings to the account cluster);
 *   - at `lg` and up: SIX anchors plus More, whose panel is the premium four.
 *
 * Committed by story 59.1's code review and RE-SCOPED by story 59.2. The numbers
 * this produces are quoted in `nav-tier-aware.paid.spec.ts`'s desktop docblock;
 * when they change, re-run this and update that ONE place. Same shape and the
 * same self-validation as the free-row spec. See `helpers/nav-width.ts` for the
 * `<li>`-vs-`<a>` trap and for why "available" is no longer the list's width.
 */
import { type Page, expect, test } from '@playwright/test'
import {
  LG,
  findWrappingWidths,
  hidePlannerBeforeLoad,
  measureAvailable,
  measureBands,
  measurePanel,
  probeFont,
} from './helpers/nav-width'

const WIDTHS = [640, 700, 760, 1000, 1024, 1152, 1280, 1440, 2400] as const
const LOG_TAG = '[paid nav width]'
const LONGER = 'Expenses Tracking'
const FIVE_ITEM_ROW = ['Overview', 'Income', 'Expenses', 'Savings', 'More']

const r = (n: number) => Math.round(n * 100) / 100

async function measurePaidNav(
  page: Page,
  lgRow: string[],
  panelRows: { belowLg: number; lg: number }
) {
  await page.setViewportSize({ width: 2400, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const font = await probeFont(page, ['Expenses', LONGER, 'Balances', 'Retirement', 'More'])
  const available = await measureAvailable(page, WIDTHS)
  // Every 5px from 640 to 1400, crossing the `lg` boundary.
  const wrappingWidths = await findWrappingWidths(page)
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.waitForTimeout(120)
  const panelBelowLg = await measurePanel(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(120)
  const panelLg = await measurePanel(page)

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
      { font, available, wrappingWidths, panelBelowLg, panelLg, bands, headroom, fontDelta },
      null,
      2
    )
  )

  expect(bands.belowLg.labels, 'not measuring the five-item row below lg').toEqual(FIVE_ITEM_ROW)
  expect(bands.lg.labels, 'not measuring the paid lg row').toEqual(lgRow)
  expect(panelBelowLg.visible, 'the panel did not open for measurement').toBe(true)
  expect(panelBelowLg.rowHeights, 'not measuring this tier’s panel below lg').toHaveLength(
    panelRows.belowLg
  )
  expect(panelLg.rowHeights, 'the lg panel is not the premium rows').toHaveLength(panelRows.lg)
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
  // Story 59.2's reason to exist, stated as a measurement: the paid row FITS.
  // Until 59.2 this asserted the opposite (a 60.80px shortfall at 11 anchors).
  // Since 69.3 each width is compared with ITS band's row.
  for (const [width, a] of Object.entries(available)) {
    expect(a.rows, `the paid row wraps at ${width}px`).toBe(1)
    expect(needed(Number(width)), `the paid row does not fit at ${width}px`).toBeLessThanOrEqual(
      a.available
    )
  }
  expect(wrappingWidths, 'the paid row wraps at these desktop widths').toEqual([])
}

test('MEASURE: the paid desktop row — five items below lg, six anchors + More from lg', async ({
  page,
}) => {
  await measurePaidNav(
    page,
    ['Overview', 'Income', 'Expenses', 'Savings', 'Balances', 'Retirement', 'More'],
    { belowLg: 6, lg: 4 }
  )
})

// Epic AC-6 / story AC-5: a user with the planner off has one fewer anchor.
test('MEASURE: the paid desktop row with the Retirement planner hidden', async ({ page }) => {
  await hidePlannerBeforeLoad(page)
  await measurePaidNav(page, ['Overview', 'Income', 'Expenses', 'Savings', 'Balances', 'More'], {
    belowLg: 5,
    lg: 4,
  })
})
