/**
 * PAID nav row (11 anchors) — intrinsic width, the source of AC-7's figures.
 *
 * Committed by story 59.1's code review. The numbers this produces are quoted in
 * `nav-tier-aware.paid.spec.ts`'s AC-6 docblock; when they change, re-run this and
 * update that ONE place. Same shape and the same harness-correctness guard as the
 * free-row spec — see `helpers/nav-width.ts` for the `<li>`-vs-`<a>` trap.
 */
import { expect, test } from '@playwright/test'
import {
  liftConstraints,
  measureAvailable,
  measureIntrinsic,
  measureWithLabel,
  probeFont,
} from './helpers/nav-width'

test('MEASURE: the paid desktop row at 11 anchors', async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const font = await probeFont(page, ['Balances', 'Balance Tracking'])
  const available = await measureAvailable(page, [1024, 1152, 1280, 1440, 2400])

  await page.setViewportSize({ width: 2400, height: 900 })
  await liftConstraints(page)
  const shipped = await measureIntrinsic(page)
  const withOldLabel = await measureWithLabel(page, '/balance', 'Balance Tracking')

  const saturated = available[2400]?.clientWidth ?? 0

  // eslint-disable-next-line no-console -- the measurement IS the deliverable
  console.log(
    '[paid nav width]',
    JSON.stringify(
      {
        font,
        available,
        shipped,
        withOldLabel,
        savingFromRename: Math.round((withOldLabel.totalNeeded - shipped.totalNeeded) * 100) / 100,
        shortfallNow: Math.round((shipped.totalNeeded - saturated) * 100) / 100,
        shortfallBefore59_1: Math.round((withOldLabel.totalNeeded - saturated) * 100) / 100,
      },
      null,
      2
    )
  )

  expect(shipped.anchorCount, 'not measuring the 11-anchor paid row').toBe(11)
  expect(withOldLabel.anchorCount).toBe(shipped.anchorCount)
  expect(
    withOldLabel.totalNeeded,
    'the LONGER label measured NARROWER: the row is being compressed, so the number is wrong (flex-shrink must be killed on the <li>, not the <a>)'
  ).toBeGreaterThan(shipped.totalNeeded)
  // The finding 59.1 had to state plainly: the rename did NOT buy a single row.
  expect(
    shipped.totalNeeded,
    'the paid row now FITS — that is an improvement; update the AC-6 docblock table'
  ).toBeGreaterThan(saturated)
})
