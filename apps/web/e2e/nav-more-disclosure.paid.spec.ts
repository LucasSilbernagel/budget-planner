import { expect, test } from '@playwright/test'
import { expectSignedInAs } from './helpers/account-menu'
import {
  LONG_EMAIL,
  MORE_PANEL,
  MORE_SUMMARY,
  NAV,
  isMoreOpen,
  mockSignedIn,
  openMore,
  panelLabels,
  readChevron,
  sweepHeaderRow,
} from './helpers/nav-more'
import { LG } from './helpers/nav-width'

/**
 * The "More" disclosure for a PAID session (story 59.2, FR90).
 *
 * ⚠️ `.paid.spec.ts` is load-bearing: only the `chromium-paid` project (:5174,
 * booted with an entitled `E2E_SESSION_SEED`) runs this file. Rename it and it
 * silently measures the FREE nav. See `playwright.config.ts`.
 *
 * This is the story's reason to exist: until 59.2 a paying user's eleven anchors
 * wrapped to TWO rows at every desktop width. Since story 58.2 this nav is also a
 * paying user's ONLY route to Forecasting, Profiles, Report and Categories, with
 * no footer or Overview fallback. So every assertion below proves REACH (role-
 * visible and clickable), not DOM presence.
 */

const PAID_PANEL = [
  'Balances',
  'Retirement',
  'Forecasting',
  'Profiles',
  'Report',
  'Categories',
] as const

/**
 * The panel at `lg` and up (story 69.3, FR110): Balances and Retirement are ROW
 * anchors there, so the paid panel is the premium four. Below `lg` it is all
 * six, as before.
 */
const PAID_PANEL_LG = ['Forecasting', 'Profiles', 'Report', 'Categories'] as const

const PANEL_ROUTES: readonly [label: string, path: string][] = [
  ['Balances', '/balance'],
  ['Retirement', '/retirement'],
  ['Forecasting', '/forecasting'],
  ['Profiles', '/profiles'],
  ['Report', '/report'],
  ['Categories', '/categories'],
]

// Five items below `lg`, seven from `lg` (story 69.3: Balances and Retirement
// join the row there). Either way ONE row, with More last.
for (const width of [640, 1000, 1024, 1280] as const) {
  const expected = width >= LG ? 7 : 5
  test(`the paid desktop row is ONE row of ${expected} items at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const row = await page.evaluate((nav) => {
      // RENDERED items only: the promoted row copies are `display:none` below
      // `lg` (story 69.3).
      const items = ([...document.querySelectorAll(`${nav} > ul > li`)] as HTMLElement[]).filter(
        (li) => li.getClientRects().length > 0
      )
      return {
        count: items.length,
        tops: [...new Set(items.map((li) => Math.round(li.getBoundingClientRect().top)))],
        more: items.at(-1)?.querySelector(':scope > details > summary')?.textContent?.trim(),
      }
    }, NAV)
    expect(row.count, `the paid row is not ${expected} items`).toBe(expected)
    expect(row.more).toBe('More')
    expect(row.tops, `the paid row still wraps at ${width}px`).toHaveLength(1)

    // Seam check: this really is the paid nav (6 panel rows below lg, the
    // premium 4 from lg; not the free 2).
    expect(await panelLabels(page)).toEqual(width >= LG ? [...PAID_PANEL_LG] : [...PAID_PANEL])
  })
}

/**
 * The row for the user this story exists for: SIGNED IN and paying (story 59.2
 * code review, finding D1).
 *
 * ⚠️⚠️ Every other width assertion in the suite runs beside a "Sign in"
 * cluster, because e2e has no real session. Measured with a signed-in cluster
 * mocked in (CI fonts), the shipped row WRAPPED: 3 rows at 640px, 2 up to
 * ~849px, and the email's `truncate` never engaged. Both header flex items
 * could shrink, and the nav, with the larger basis, wrapped first. Fixed by
 * `sm:shrink-0` on the nav plus `sm:min-w-0` on the account strip, so the email
 * truncated instead. At the time (59.2), removing either token turned this red,
 * mutation-measured. ⚠️ That is HISTORY: story 69.2 removed the email and story
 * 69.3 (decision D4) removed `sm:min-w-0` itself, and this test is green
 * without it. It does not guard either token any more.
 *
 * ⚠️ RE-POINTED by story 59.3, which moved the visible email into the
 * account-menu trigger, and RE-SCOPED by story 69.2, which took it out of the
 * chrome altogether (decision D2). There is no truncation left to read, so what
 * this test still owns is the ONE-ROW claim for a signed-in Premium cluster
 * (avatar + chevron + Premium pill) beside the paid nav, swept every 5px.
 */
test('a signed-in Premium user gets ONE row at every desktop width', async ({ page }) => {
  await mockSignedIn(page)
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Precondition: this really is the MOCKED signed-in cluster, with the Premium
  // pill. The announced email is the proof the mock landed (the SSR seed's
  // identity is a different address), and the trigger shows none of it.
  await expectSignedInAs(page, LONG_EMAIL)
  const strip = page.getByRole('status', { name: /account status/i })
  await expect(strip.getByText('Premium', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Account menu' })).not.toContainText('@')

  expect(await sweepHeaderRow(page), 'the signed-in header row broke').toEqual([])
})

for (const [width, rows] of [
  [1000, PAID_PANEL],
  [1280, PAID_PANEL_LG],
] as const) {
  test(`the open paid panel shows its ${rows.length} rows, on screen and unoccluded, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await openMore(page)

    const panel = page.locator(MORE_PANEL)
    for (const label of rows) {
      await expect(panel.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    // Exactly these: at `lg` the Balances/Retirement panel rows must NOT render.
    await expect(panel.getByRole('link')).toHaveCount(rows.length)
    const hits = await page.evaluate((sel) => {
      const vh = globalThis.innerHeight
      // Rendered rows only (story 69.3).
      return [...document.querySelectorAll(`${sel} > li > a`)]
        .filter((a) => a.getClientRects().length > 0)
        .map((a) => {
          const r = a.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return {
            label: a.textContent?.trim(),
            onScreen: r.top >= 0 && r.bottom <= vh,
            inside: hit !== null && a.contains(hit),
          }
        })
    }, MORE_PANEL)
    expect(
      hits.filter((h) => !h.onScreen || !h.inside),
      'a paid row is off-screen or painted over'
    ).toEqual([])
  })
}

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false })

  for (const width of [320, 1280] as const) {
    test(`every paid destination is reachable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      for (const [label, path] of PANEL_ROUTES) {
        await page.goto('/')
        expect(await isMoreOpen(page)).toBe(false)
        await page.locator(MORE_SUMMARY).click()
        const link = page
          .getByRole('navigation', { name: 'Primary' })
          .getByRole('link', { name: label, exact: true })
        await expect(link, `${label} is unreachable with JS off at ${width}px`).toBeVisible()
        await link.click()
        await expect(page).toHaveURL(new RegExp(`${path}$`))
      }
    })
  }
})

/**
 * The open panel is never painted over, on ANY page (story 59.2, AC-16).
 *
 * ⚠️ This is why the desktop panel carries `sm:z-40`, and it was MEASURED, not
 * assumed. Without the z-index, the panel is a positioned box with `z-index:
 * auto`, so positioned page content that comes later in the DOM paints over
 * it. At both 640px and 1280px, `elementFromPoint` on the open panel's rows
 * landed on `/pricing`'s plan-card headings (Categories, Settings rows) and on
 * `/forecasting`'s page header (Balances, Retirement rows). Those rows had
 * perfect rects and passed `toBeVisible()`. Every other route was clean
 * without it. So the sweep covers every route the nav reaches plus `/pricing`
 * and `/docs`, and probes three points per row, not just the centre.
 *
 * Paid tier on purpose: it has the tallest panel (six rows since story 69.2
 * took Settings out; seven before), so it covers
 * the most page content.
 */
const ROUTES = [
  '/',
  '/income',
  '/expenses',
  '/savings',
  '/balance',
  '/retirement',
  '/settings',
  '/forecasting',
  '/profiles',
  '/report',
  '/categories',
  '/pricing',
  '/docs',
] as const

for (const width of [640, 1280] as const) {
  test(`the open panel is painted over on no page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    const occluded: string[] = []
    for (const route of ROUTES) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await openMore(page)
      const hits = await page.evaluate((sel) => {
        // Rendered rows only (story 69.3): at `lg` the Balances/Retirement
        // panel rows are `display:none`, and probing a zero rect "misses".
        const rows = ([...document.querySelectorAll(`${sel} > li > a`)] as HTMLElement[]).filter(
          (a) => a.getClientRects().length > 0
        )
        return {
          rows: rows.length,
          misses: rows.flatMap((a) => {
            const r = a.getBoundingClientRect()
            const y = r.top + r.height / 2
            return [r.left + 4, r.left + r.width / 2, r.right - 4]
              .filter((x) => {
                const hit = document.elementFromPoint(x, y)
                return !(hit && a.contains(hit))
              })
              .map((x) => `${a.textContent?.trim()}@${Math.round(x)},${Math.round(y)}`)
          }),
        }
      }, MORE_PANEL)
      // Anti-vacuity: an empty panel would have nothing to occlude.
      expect(hits.rows, `the panel on ${route} has the wrong rows to probe`).toBe(
        width >= LG ? PAID_PANEL_LG.length : PAID_PANEL.length
      )
      occluded.push(...hits.misses.map((m) => `${route} ${m}`))
      await page.keyboard.press('Escape')
    }
    expect(occluded, 'a panel row is painted over by page content').toEqual([])
  })
}

/**
 * The More chevron for a PAID session (story 69.1, FR108). Since story 69.3 a
 * FREE session has no More trigger at `lg` and up (nothing is left behind it),
 * so at 1280px this is the only tier with the cue. The free twin runs below
 * `lg`, in `nav-more-disclosure.spec.ts`.
 */
test('the paid More trigger carries a chevron that turns with the panel at 1280px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const closed = await readChevron(page)
  expect(closed.count, 'the More trigger has no disclosure chevron').toBe(1)
  expect(closed.visible, 'the chevron is hidden').toBe(true)
  expect(closed.transform).toBe('none')
  const chevronA = async () => (await readChevron(page)).a
  await openMore(page)
  await expect.poll(chevronA, { message: 'the chevron did not turn when opened' }).toBe(-1)
  await page.keyboard.press('Escape')
  await expect.poll(() => isMoreOpen(page)).toBe(false)
  await expect.poll(chevronA, { message: 'the chevron stayed turned after Escape' }).toBe(1)
})
