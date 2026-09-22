/**
 * FREE nav row (7 anchors) — intrinsic width and single-row threshold.
 *
 * Committed by story 59.1's code review, which found that 59.1 re-measured only
 * the PAID row. At >= 640px `sm:contents` dissolves the sheet into the same row
 * (`GlobalNav.tsx`), so the `/balance` label 59.1 shortened is in the FREE row
 * too, and `nav-responsive-css.spec.ts`'s "single live record" — which had
 * re-measured itself for 43.2 and 43.3 — went stale unnoticed.
 *
 * This file exists so that record has a source that reruns. It LOGS the figures
 * (the measurement is the deliverable) and asserts only what is font-independent,
 * so it cannot go false-red between DejaVu/CI and Noto/dev:
 *
 *   - the anchor count, so the file is known to be measuring the free row;
 *   - that the row needs MORE width with a longer label than a shorter one.
 *
 * That second assertion is not a formality. It is the exact bug 59.1 hit three
 * times: with `flex-shrink: 0` on the anchors instead of the `<li>`, a two-word
 * label wraps and measures as its longest word, so the harness reports the longer
 * label as NARROWER. This test goes red on that mistake. See `helpers/nav-width.ts`.
 */
import { expect, test } from '@playwright/test'
import {
  findSingleRowThreshold,
  liftConstraints,
  measureAvailable,
  measureIntrinsic,
  measureWithLabel,
  probeFont,
} from './helpers/nav-width'

test('MEASURE: the free desktop row at 7 anchors', async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const font = await probeFont(page, ['Balances', 'Balance Tracking'])
  const available = await measureAvailable(page, [640, 760, 1024, 1152, 1280, 2400])
  // Both arms, so the rename's effect on the threshold is isolated from any
  // drift since 43.3 measured it (58.1/58.2 changed the header this row shares).
  const thresholdShipped = await findSingleRowThreshold(page)
  const thresholdOldLabel = await findSingleRowThreshold(page, {
    href: '/balance',
    label: 'Balance Tracking',
  })

  await page.setViewportSize({ width: 2400, height: 900 })
  await liftConstraints(page)
  const shipped = await measureIntrinsic(page)
  const withOldLabel = await measureWithLabel(page, '/balance', 'Balance Tracking')

  // eslint-disable-next-line no-console -- the measurement IS the deliverable
  console.log(
    '[free nav width]',
    JSON.stringify(
      {
        font,
        available,
        singleRowThresholdViewport: { shipped: thresholdShipped, withOldLabel: thresholdOldLabel },
        shipped,
        withOldLabel,
        savingFromRename: Math.round((withOldLabel.totalNeeded - shipped.totalNeeded) * 100) / 100,
      },
      null,
      2
    )
  )

  expect(shipped.anchorCount, 'not measuring the 7-anchor free row').toBe(7)
  expect(withOldLabel.anchorCount).toBe(shipped.anchorCount)
  // The harness-correctness guard — see the file docblock.
  expect(
    withOldLabel.totalNeeded,
    'the LONGER label measured NARROWER: the row is being compressed, so the number is wrong (flex-shrink must be killed on the <li>, not the <a>)'
  ).toBeGreaterThan(shipped.totalNeeded)
})
