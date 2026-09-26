import { expect, test } from '@playwright/test'
import { sweepForOverlap, withRootFont } from './helpers/nav-more'

/**
 * The account cluster never covers the nav, at an enlarged root font (story
 * 69.3, decision D4; the finding deferred from 69.1's code review).
 *
 * Until 69.3 the cluster row was `sm:min-w-0 justify-end` around a `shrink-0`
 * region. Squeezed below its content, its box shrank and `justify-end` pushed
 * the overflow LEFTWARD, over the nav: 69.1's review measured the cluster
 * covering the More chevron at an 18px root. Nothing else in the suite could see
 * it (`scrollWidth` does not move, and the row sweeps ran at the default font).
 * D4 lets the header WRAP instead (`sm:flex-wrap` on the header row,
 * `sm:ml-auto` on the cluster, no `sm:min-w-0`).
 *
 * The claim is about OCCLUSION, so it is asserted with `elementFromPoint` (what
 * a press actually hits), not with rects alone: a rect can be right while
 * something paints over it. The paid half is `nav-enlarged-font.paid.spec.ts`.
 */

for (const root of [18, 20] as const) {
  test(`signed out, ${root}px root: the cluster never covers the nav, 640-1400px`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await withRootFont(page, root)
    // The signed-out strip must have resolved, or the sweep measures the
    // loading placeholder, which is narrower than "Upgrade · Sign in · gear".
    await expect(
      page.getByRole('status', { name: /account status/i }).getByRole('link', { name: /sign in/i })
    ).toBeVisible()
    expect(await sweepForOverlap(page)).toEqual([])
  })
}
