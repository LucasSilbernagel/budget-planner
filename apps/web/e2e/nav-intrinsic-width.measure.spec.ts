/**
 * FREE nav row — intrinsic width, available width, and a wrap sweep of every desktop width.
 *
 * Committed by story 59.1's code review and RE-SCOPED by story 59.2. Since 59.2
 * the desktop row is five items (Overview · Income · Expenses · Savings · More)
 * in both tiers; the three free More destinations are in an overlay panel,
 * measured separately. The figures this logs are quoted in
 * `nav-responsive-css.spec.ts`; when they change, re-run this and update that
 * ONE place.
 *
 * It LOGS the figures (the measurement is the deliverable) and asserts only what
 * is font-independent, so it cannot go false-red between DejaVu/CI and Noto/dev:
 *
 *   - the five row labels, so the file is known to be measuring the row;
 *   - that the row needs MORE width with a longer label than a shorter one —
 *     the exact bug 59.1 hit three times (see `helpers/nav-width.ts`);
 *   - two INDEPENDENT agreements: the summed row equals the rendered list, and
 *     the A/B saving equals the font's own delta between the two strings;
 *   - the free row is one line at EVERY 5px step from 640 to 1400px (signed out).
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

const WIDTHS = [640, 700, 760, 1024, 1152, 1280, 2400] as const
const PANEL_ROWS = 3
const LOG_TAG = '[free nav width]'

test('MEASURE: the free desktop row — five items, More panel of three', async ({ page }) => {
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
  // The story's claim for the free tier: one row at every desktop width 640-1400px.
  expect(wrappingWidths, 'the free row wraps at these desktop widths').toEqual([])
})
