/**
 * PAID nav row — intrinsic width, available width, and the open six-row panel
 * (seven until story 69.2 moved Settings to the account cluster).
 *
 * Committed by story 59.1's code review and RE-SCOPED by story 59.2. The numbers
 * this produces are quoted in `nav-tier-aware.paid.spec.ts`'s desktop docblock;
 * when they change, re-run this and update that ONE place. Same shape and the
 * same self-validation as the free-row spec. See `helpers/nav-width.ts` for the
 * `<li>`-vs-`<a>` trap and for why "available" is no longer the list's width.
 */
import { expect, test } from '@playwright/test'
import {
  findWrappingWidths,
  liftConstraints,
  measureAvailable,
  measureIntrinsic,
  measurePanel,
  measureWithLabel,
  probeFont,
} from './helpers/nav-width'

const WIDTHS = [640, 1024, 1152, 1280, 1440, 2400] as const
const PANEL_ROWS = 6
const LOG_TAG = '[paid nav width]'

test('MEASURE: the paid desktop row — five items, More panel of six', async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // The A/B swaps a label that is IN the row (story 59.2 moved `/balance` out of
  // it). "Expenses Tracking" is two words on purpose: if shrink were live on
  // the `<li>`, it would wrap and measure as its longest word, and the guard
  // below would catch it.
  const LONGER = 'Expenses Tracking'
  const font = await probeFont(page, ['Expenses', LONGER])
  const available = await measureAvailable(page, WIDTHS)
  // Every 5px from 640 to 1400, not just the first one-row width.
  const wrappingWidths = await findWrappingWidths(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(120)
  const panel = await measurePanel(page)

  await page.setViewportSize({ width: 2400, height: 900 })
  await liftConstraints(page)
  const shipped = await measureIntrinsic(page)
  const withLongerLabel = await measureWithLabel(page, '/expenses', LONGER)

  const r = (n: number) => Math.round(n * 100) / 100
  const abSaving = r(withLongerLabel.totalNeeded - shipped.totalNeeded)
  const fontDelta = r((font.widths[LONGER] ?? 0) - (font.widths.Expenses ?? 0))
  const headroom = Object.fromEntries(
    Object.entries(available).map(([w, a]) => [w, r(a.available - shipped.totalNeeded)])
  )

  // eslint-disable-next-line no-console -- the measurement IS the deliverable
  console.log(
    LOG_TAG,
    JSON.stringify(
      {
        font,
        available,
        wrappingWidths,
        panel,
        shipped,
        withLongerLabel,
        abSaving,
        fontDelta,
        headroom,
      },
      null,
      2
    )
  )

  expect(shipped.labels, 'not measuring the five-item row').toEqual([
    'Overview',
    'Income',
    'Expenses',
    'Savings',
    'More',
  ])
  expect(withLongerLabel.itemCount).toBe(shipped.itemCount)
  expect(panel.visible, 'the panel did not open for measurement').toBe(true)
  expect(panel.rowHeights, 'not measuring this tier’s panel').toHaveLength(PANEL_ROWS)
  // The harness-correctness guard — see `helpers/nav-width.ts`.
  expect(
    withLongerLabel.totalNeeded,
    'the LONGER label measured NARROWER: the row is being compressed, so the number is wrong (flex-shrink must be killed on the <li>, not the <a>)'
  ).toBeGreaterThan(shipped.totalNeeded)
  // Independent probe 1: the sum must agree with what the browser rendered.
  expect(
    Math.abs(shipped.renderedListWidth - shipped.totalNeeded),
    'the summed row disagrees with the rendered list — the harness is summing the wrong elements'
  ).toBeLessThanOrEqual(1)
  // Independent probe 2: the A/B saving must agree with the font's own delta.
  expect(
    Math.abs(abSaving - fontDelta),
    'the A/B saving disagrees with the font probe — the swapped label is not what the row measured'
  ).toBeLessThanOrEqual(1)
  // Story 59.2's reason to exist, stated as a measurement: the paid row FITS.
  // Until 59.2 this asserted the opposite (a 60.80px shortfall at 11 anchors).
  for (const [width, a] of Object.entries(available)) {
    expect(a.rows, `the paid row wraps at ${width}px`).toBe(1)
    expect(shipped.totalNeeded, `the paid row does not fit at ${width}px`).toBeLessThanOrEqual(
      a.available
    )
  }
  expect(wrappingWidths, 'the paid row wraps at these desktop widths').toEqual([])
})
