import { type Page, expect, test } from '@playwright/test'

/**
 * Global chrome (Footer + mobile bottom nav) at 320px E2E (Story 18-2 / UX-DR23,
 * rewritten for the 5-tab bar + "More" sheet in story 31.5).
 *
 * At 320px the `GlobalNav` renders as a fixed bottom bar and the `Footer` stacks
 * vertically. This guards the two runtime facts jsdom cannot measure (no layout
 * engine, no matchMedia):
 *
 *  1. Every bottom-bar label fits its cell — no per-cell horizontal overflow
 *     (five cells, 64px tracks at 320px, so no label overlaps its neighbour),
 *     each label renders on a SINGLE line (guards "no crushed/mid-word-broken
 *     labels" — a clean wrap would clear the overflow check but still fail
 *     here), and each tap target is >=44px tall.
 *  2. The fixed bottom bar neither covers the Footer NOR strands it above a dead
 *     gap (the root layout reserves
 *     `pb-[calc(3.75rem_+_env(safe-area-inset-bottom))]` for the 56.75px bar).
 *
 * ⚠️⚠️ TWO TRAPS THAT MADE THE PRE-31.5 VERSION OF THIS FILE GO FALSE-RED ON A
 * CORRECT IMPLEMENTATION, both measured. Fix the probe, never the design:
 *
 *   - The Range probe used to select the whole anchor's contents. With an icon
 *     in the cell the real measured rect count is **3** (the 24px icon box, the
 *     label, and the SVG's own line box), not the "1" a line-count assertion
 *     means — and not the ">=2" a casual reading would guess. The Range is
 *     scoped to the `[data-nav-label]` span, which is what "the label is on one
 *     line" is actually a claim about.
 *   - The loop used to iterate all `nav a`. Four of those eight anchors are now
 *     the sheet's rows, which are `display: none` while the sheet is closed and
 *     therefore measure `height: 0` — so the >=44px assertion failed on the
 *     SHEET rather than on the bar. Every measurement here is scoped to the
 *     bar's own direct cells.
 *
 * ⚠️⚠️ AND A COUNT THAT WOULD STAY GREEN WHILE MEANING NOTHING. `nav.locator('a')`
 * is a CSS query, and CSS queries match `display: none` elements: with the sheet
 * closed it still counts **8**. Merely changing that `8` to a `5` would be a
 * vacuous rewrite. Measured at 320px, sheet CLOSED: `locator('a')` = 8 but
 * `getByRole('link')` = 4 and `getByRole('link', {name: 'Retirement'})` = 0;
 * sheet OPEN: both are 8. The bar's cell set is asserted by structure, and the
 * negative claim — that the four sheet destinations are ABSENT from the bar — is
 * asserted explicitly, because that absence is the whole point of this story.
 *
 * Since story 31.4 the bottom bar is decided by the CSS cascade alone — it is
 * present in the very first painted frame, with no hydration swap to wait for.
 * That first-paint guarantee is proven in `e2e/nav-responsive-css.spec.ts`; this
 * file measures the settled layout.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const NARROW_WIDTH = 320
const NAV = 'nav[aria-label="Primary"]'

/** The four destinations that keep a cell in the bar. */
const BAR_LABELS = ['Overview', 'Income', 'Expenses', 'Savings'] as const
/** The four that moved behind the More trigger. */
const SHEET_LABELS = ['Balance Tracking', 'Net Worth', 'Retirement', 'Settings'] as const

/**
 * The bar's own cells, structurally: anchors that are direct grandchildren of
 * the outer `<ul>`. The sheet's rows sit one level deeper (`> li > ul > li > a`),
 * so this selector cannot drift onto them however the sheet is styled.
 */
const BAR_CELL_SELECTOR = `${NAV} > ul > li > a`

function readBarCells(page: Page) {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll(selector)].map((a) => {
      const label = a.querySelector('[data-nav-label]')
      // getClientRects() on the LABEL's contents returns one rect per rendered
      // line box, so its length is the label's line count. Ranged over the whole
      // anchor it would measure 3 on a correct cell — see the file docblock.
      const range = document.createRange()
      if (label) range.selectNodeContents(label)
      return {
        label: label?.textContent?.trim() ?? '',
        // scrollWidth > clientWidth means the label paints past its cell and
        // collides with the neighbouring destination (the pre-18-2 defect).
        overflows: a.scrollWidth > a.clientWidth,
        height: Math.round(a.getBoundingClientRect().height),
        lineCount: label ? range.getClientRects().length : -1,
      }
    })
  }, BAR_CELL_SELECTOR)
}

test.describe('global chrome at 320px (story 18-2, 5-tab bar since 31.5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })
    const response = await page.goto('/')
    expect(response?.ok(), 'expected / to load').toBeTruthy()
    await page.waitForLoadState('networkidle')
    // This USED to be the wait for hydration to swap in the fixed bottom bar.
    // Since 31.4 it waits for nothing — `max-sm:fixed` is satisfied on the first
    // frame. Kept because it is still a real guard: it is the precondition that
    // everything measured below is the BOTTOM bar and not the desktop top bar,
    // and it goes red the moment `max-sm:fixed` stops being load-bearing.
    await expect(page.locator(NAV)).toHaveCSS('position', 'fixed')
  })

  test('the bar holds exactly the four primary tabs plus the More trigger', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Primary' })

    const cells = await readBarCells(page)
    expect(cells.map((c) => c.label)).toEqual([...BAR_LABELS])

    // Exactly one More trigger, scoped and EXACT: Playwright name matching is
    // substring by default, and the home page also carries a
    // "More information about net worth" button, so an unscoped non-exact
    // locator is a hard strict-mode failure on `/`.
    await expect(nav.getByRole('button', { name: 'More', exact: true })).toHaveCount(1)

    // The negative claim this story is actually about: with the sheet closed the
    // four More destinations are not reachable in the bar. Role locators respect
    // `display: none`; the CSS `locator('a')` count deliberately is NOT used here
    // because it still returns 8 and would pass on a bar that shows all eight.
    for (const label of SHEET_LABELS) {
      await expect(
        nav.getByRole('link', { name: label, exact: true }),
        `"${label}" is still in the closed bar — it belongs behind More`
      ).toHaveCount(0)
    }
    await expect(nav.getByRole('link')).toHaveCount(BAR_LABELS.length)
  })

  test('every bottom-bar label fits its cell and stays a 44px tap target', async ({ page }) => {
    const cells = await readBarCells(page)
    expect(cells).toHaveLength(BAR_LABELS.length)

    for (const { label, overflows, height, lineCount } of cells) {
      expect(overflows, `"${label}" label overflows its cell at 320px`).toBe(false)
      // A clean single-word wrap fits horizontally (no overflow) but still reads
      // as crushed. Require exactly one line — of the LABEL, not the anchor.
      expect(lineCount, `"${label}" label wraps to ${lineCount} lines at 320px`).toBe(1)
      expect(height, `"${label}" tap target is under 44px`).toBeGreaterThanOrEqual(44)
    }

    // The More trigger is a cell too, and it is a <button> — every anchor-scoped
    // sweep in this suite skips it.
    const trigger = await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More', exact: true })
      .evaluate((el) => ({
        height: Math.round(el.getBoundingClientRect().height),
        overflows: el.scrollWidth > el.clientWidth,
      }))
    expect(trigger.overflows, 'the More label overflows its cell at 320px').toBe(false)
    expect(trigger.height, 'the More tap target is under 44px').toBeGreaterThanOrEqual(44)
  })

  /**
   * ⚠️⚠️ THE DEFECT THIS TEST EXISTS TO CATCH IS THE ONE THE OLD VERSION COULD
   * NOT SEE. The previous assertion was `footer.bottom <= nav.top` — satisfied
   * only if the reserve is too SMALL. Leaving the old 96px reserve against the
   * 56.75px bar strands the footer above **39.25px** of measured dead space, and
   * that one-directional check passes MORE comfortably than before. The gap is
   * asserted from both sides. Measured on a correct build: 3.25px, invariant
   * across 320x568 / 320x720 / 360x640 / 390x844 / 412x915 / 639x720 and both
   * themes.
   */
  test('the fixed bottom bar neither covers the Footer nor strands it above a dead gap', async ({
    page,
  }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const readGap = () =>
      page.evaluate((selector) => {
        const footer = document.querySelector('footer')?.getBoundingClientRect()
        const nav = document.querySelector(selector)?.getBoundingClientRect()
        if (!footer || !nav) return null
        return Math.round((nav.top - footer.bottom) * 100) / 100
      }, NAV)

    // Polled rather than read once so the scroll has a chance to settle; each
    // poll re-measures, so a genuinely wrong reserve times out and reports the
    // measured gap rather than flaking.
    // Footer's last content must sit above the fixed bar's top edge...
    await expect.poll(readGap, { message: 'the fixed bar covers the Footer' }).toBeGreaterThan(0)
    // ...but only just. A too-large reserve is the silent half of this coupling:
    // the old 96px reserve leaves 39.25px of dead space and passes the check
    // above more comfortably than a correct build does.
    await expect
      .poll(readGap, { message: 'the reserve strands the Footer above a dead gap' })
      .toBeLessThanOrEqual(8)
  })

  /**
   * ⚠️⚠️ FOUND BY CODE REVIEW: the two-sided gap above is measured only at the
   * DEFAULT root font size, and the coupling DRIFTS with that size.
   *
   * The bar's height is `2.625rem + 14.75px` — its spacing tokens scale with the
   * root font but its `text-[11px]` label line box does not. A pure-rem reserve
   * therefore diverges from the bar as soon as a user changes their browser's
   * default font size. Measured against the old `3.75rem` reserve: a 12px root
   * font put the fixed bar **1.25px OVER the footer**, and a 24px root font left
   * 12.25px of dead space — while every existing assertion stayed green because
   * they all ran at 16px. The reserve now mirrors the bar's own rem+px
   * composition, holding the gap constant at every size.
   */
  for (const root of [12, 14, 20, 24]) {
    test(`the footer clearance holds at a ${root}px root font size`, async ({ page }) => {
      await page.addInitScript((px) => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.fontSize = `${px}px`
        })
      }, root)
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await page.evaluate((px) => {
        document.documentElement.style.fontSize = `${px}px`
      }, root)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

      const readGap = () =>
        page.evaluate((selector) => {
          const footer = document.querySelector('footer')?.getBoundingClientRect()
          const nav = document.querySelector(selector)?.getBoundingClientRect()
          if (!footer || !nav) return null
          return Math.round((nav.top - footer.bottom) * 100) / 100
        }, NAV)

      await expect
        .poll(readGap, { message: `the bar covers the Footer at a ${root}px root font` })
        .toBeGreaterThan(0)
      await expect
        .poll(readGap, { message: `dead gap above the Footer at a ${root}px root font` })
        .toBeLessThanOrEqual(8)
    })
  }

  /**
   * The bar's rendered height, which NOTHING in the suite asserted before 31.5 —
   * the 89px figure lived only in production comments. A bar that silently grew
   * back to two rows (a ninth item, a lost `sm:hidden` on an icon, a wrapped
   * label) would have gone completely unnoticed, and it is exactly what the
   * `__root.tsx` / `InstallPrompt.tsx` reserves are sized against.
   */
  test('the bar is a single row of the height the root reserve is sized for', async ({ page }) => {
    const height = await page
      .locator(NAV)
      .evaluate((el) => Math.round(el.getBoundingClientRect().height * 100) / 100)
    // Measured 56.75px: py-2 16 + h-6 icon 24 + gap-0.5 2 + 11px label at
    // leading-tight 13.75 + 1px border-t. The window is tight on purpose — the
    // 60px reserve is only correct for a bar of about this size.
    expect(
      height,
      `the mobile bar is ${height}px — the 3.75rem reserve assumes ~56.75px`
    ).toBeGreaterThanOrEqual(56)
    expect(height).toBeLessThanOrEqual(58)
  })
})
