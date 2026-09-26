import { expect, test } from '@playwright/test'
import { expectSignedInAs } from './helpers/account-menu'
import { LONG_EMAIL, mockSignedIn, sweepForOverlap, withRootFont } from './helpers/nav-more'

/**
 * The PAID half of `nav-enlarged-font.spec.ts` (story 69.3, D4): a Premium
 * signed-in cluster (avatar trigger + pill) beside the paid row, which at `lg`
 * is the widest row this nav has (six anchors + More).
 */
for (const root of [18, 20] as const) {
  test(`Premium signed in, ${root}px root: the cluster never covers the nav, 640-1400px`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await mockSignedIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await withRootFont(page, root)
    await expectSignedInAs(page, LONG_EMAIL)
    await expect(page.getByText('Premium', { exact: true })).toBeVisible()
    expect(await sweepForOverlap(page)).toEqual([])
  })
}
