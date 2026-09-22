import { expect, test } from '@playwright/test'
import {
  LONG_EMAIL,
  MORE_PANEL,
  MORE_SUMMARY,
  NAV,
  isMoreOpen,
  mockSignedIn,
  openMore,
  panelLabels,
  sweepHeaderRow,
} from './helpers/nav-more'

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
  'Settings',
] as const

const PANEL_ROUTES: readonly [label: string, path: string][] = [
  ['Balances', '/balance'],
  ['Retirement', '/retirement'],
  ['Forecasting', '/forecasting'],
  ['Profiles', '/profiles'],
  ['Report', '/report'],
  ['Categories', '/categories'],
  ['Settings', '/settings'],
]

for (const width of [640, 1024, 1280] as const) {
  test(`the paid desktop row is ONE row of five items at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const row = await page.evaluate((nav) => {
      const items = [...document.querySelectorAll(`${nav} > ul > li`)] as HTMLElement[]
      return {
        count: items.length,
        tops: [...new Set(items.map((li) => Math.round(li.getBoundingClientRect().top)))],
        more: items.at(-1)?.querySelector(':scope > details > summary')?.textContent?.trim(),
      }
    }, NAV)
    expect(row.count, 'the paid row is not five items').toBe(5)
    expect(row.more).toBe('More')
    expect(row.tops, `the paid row still wraps at ${width}px`).toHaveLength(1)

    // Seam check: this really is the paid nav (7 panel rows, not the free 3).
    expect(await panelLabels(page)).toEqual([...PAID_PANEL])
  })
}

/**
 * The row for the user this story exists for: SIGNED IN, paying, with a long
 * email (story 59.2 code review, finding D1).
 *
 * ⚠️⚠️ Every other width assertion in the suite runs beside a "Sign in"
 * cluster, because e2e has no real session. Measured with a signed-in cluster
 * mocked in (CI fonts), the shipped row WRAPPED: 3 rows at 640px, 2 up to
 * ~849px, and the email's `truncate` never engaged. Both header flex items
 * could shrink, and the nav, with the larger basis, wrapped first. Fixed by
 * `sm:shrink-0` on the nav plus `sm:min-w-0` on the account strip, so the email
 * truncates instead. Mutation-measured: remove either token and this goes red.
 */
test('a signed-in Premium user with a long email gets ONE row at every desktop width', async ({
  page,
}) => {
  await mockSignedIn(page)
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Precondition: this really is the signed-in cluster, with the Premium pill.
  const strip = page.getByRole('status', { name: /account status/i })
  await expect(strip.getByText(LONG_EMAIL)).toHaveCount(1)
  await expect(strip.getByText('Premium', { exact: true })).toBeVisible()

  // The mechanism, at the narrowest desktop width: the EMAIL gives way.
  const email = await strip.getByText(LONG_EMAIL).evaluate((el) => ({
    visible: el.clientWidth,
    full: el.scrollWidth,
  }))
  expect(email.visible, 'the email did not truncate at 640px').toBeLessThan(email.full)
  expect(email.visible, 'the email truncated to nothing at 640px').toBeGreaterThan(0)

  expect(await sweepHeaderRow(page), 'the signed-in header row broke').toEqual([])
})

test('the open paid panel shows all seven rows, on screen and unoccluded, at 1280px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await openMore(page)

  const nav = page.getByRole('navigation', { name: 'Primary' })
  for (const label of PAID_PANEL) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
  }
  const hits = await page.evaluate((sel) => {
    const vh = globalThis.innerHeight
    return [...document.querySelectorAll(`${sel} > li > a`)].map((a) => {
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
 * Paid tier on purpose: it has the tallest panel (seven rows), so it covers
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
        const rows = [...document.querySelectorAll(`${sel} > li > a`)] as HTMLElement[]
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
      expect(hits.rows, `the panel on ${route} has no rows to probe`).toBe(PAID_PANEL.length)
      occluded.push(...hits.misses.map((m) => `${route} ${m}`))
      await page.keyboard.press('Escape')
    }
    expect(occluded, 'a panel row is painted over by page content').toEqual([])
  })
}
