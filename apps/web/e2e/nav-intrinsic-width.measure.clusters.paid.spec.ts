/**
 * The ACCOUNT CLUSTER's width in every state the header row must fit beside
 * (story 69.3 code review). Paid server (`:5174`), so a JavaScript-off page
 * arrives with the SSR seed's signed-in cluster.
 *
 * Until this file, the signed-in cluster widths in the width record came from
 * throwaway probes (69.2, then 69.3's dev pass), so no committed harness could
 * reproduce the figures the record quotes. This is that harness. It LOGS the
 * widths (the measurement is the deliverable) and asserts only what is
 * font-independent, plus the DejaVu fingerprint when run under CI fonts:
 *
 *   FONTCONFIG_FILE=<ci-fonts.conf> playwright test nav-intrinsic-width.measure.clusters.paid
 *
 * The figures are quoted in `nav-responsive-css.spec.ts` (the one record).
 */
import { type Page, expect, test } from '@playwright/test'
import { expectSignedInAs } from './helpers/account-menu'
import { LONG_EMAIL, mockSignedIn } from './helpers/nav-more'
import { measureAvailable, probeFont } from './helpers/nav-width'

const WIDTHS = [640, 1000, 1024, 1280] as const
const LOG_TAG = '[cluster width]'

async function measureCluster(page: Page, state: string) {
  const font = await probeFont(page, ['Expenses'])
  const available = await measureAvailable(page, WIDTHS)
  // eslint-disable-next-line no-console -- the measurement IS the deliverable
  console.log(LOG_TAG, state, JSON.stringify({ font, available }))
  // The cluster is a fixed-width row WITHIN each band. Its right padding is
  // `sm:pr-1 lg:pr-2` (story 69.3 code review), so it is exactly 4px wider
  // from `lg` than below it, and nothing else may vary.
  const below = Object.entries(available).filter(([w]) => Number(w) < 1024)
  const atLg = Object.entries(available).filter(([w]) => Number(w) >= 1024)
  const belowWidths = new Set(below.map(([, a]) => a.accountCluster))
  const lgWidths = new Set(atLg.map(([, a]) => a.accountCluster))
  expect(belowWidths.size, `${state}: the cluster varies below lg`).toBe(1)
  expect(lgWidths.size, `${state}: the cluster varies at lg`).toBe(1)
  expect(
    Math.round(([...lgWidths][0] - [...belowWidths][0]) * 100) / 100,
    `${state}: the lg cluster is not exactly the 4px of padding wider`
  ).toBe(4)
  for (const [w, a] of Object.entries(available)) {
    expect(a.rows, `${state}: the nav row wraps at ${w}px`).toBe(1)
  }
}

test('MEASURE: signed-out cluster', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/income')
  // The paid seam's post-mount fetch resolves signed OUT (no real session).
  await expect(
    page.getByRole('status', { name: /account status/i }).getByRole('link', { name: /sign in/i })
  ).toBeVisible()
  await measureCluster(page, 'signed out')
})

for (const status of ['free', 'active'] as const) {
  test(`MEASURE: signed-in cluster (${status})`, async ({ page }) => {
    await mockSignedIn(page, { subscriptionStatus: status })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/income')
    await expectSignedInAs(page, LONG_EMAIL)
    await measureCluster(page, `signed in ${status}`)
  })
}

test.describe('JavaScript off', () => {
  test.use({ javaScriptEnabled: false })

  test('MEASURE: signed-in Premium cluster with the <noscript> gear', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/income')
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
    await measureCluster(page, 'JS off, signed in active, <noscript> gear')
  })
})
