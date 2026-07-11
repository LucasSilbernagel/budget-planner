import { expect, test } from '@playwright/test'

/**
 * Global chrome (Footer + mobile bottom nav) at 320px E2E (Story 18-2 / UX-DR23).
 *
 * At 320px the `GlobalNav` renders as a fixed bottom bar and the `Footer` stacks
 * vertically. This guards the two runtime facts jsdom cannot measure (no layout
 * engine, no matchMedia):
 *
 *  1. Every bottom-nav label fits its cell — no per-anchor horizontal overflow
 *     (the eight destinations are a 4x2 grid, ~80px per cell at 320px, so no
 *     label overlaps its neighbour), each label renders on a SINGLE line (guards
 *     AC-2's "no crushed/mid-word-broken labels" — a clean wrap would clear the
 *     overflow check but still fail here), and each tap target is >=44px tall.
 *  2. The fixed bottom bar does not cover the Footer when scrolled to the bottom
 *     (the root layout reserves `pb-24` for the two-row bar).
 *
 * The bottom bar only appears after hydration flips `useIsNarrowViewport` to
 * true (SSR + first client render emit the desktop top bar), so the test waits
 * for the fixed positioning before measuring.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const NARROW_WIDTH = 320

test.describe('global chrome at 320px (story 18-2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })
    const response = await page.goto('/')
    expect(response?.ok(), 'expected / to load').toBeTruthy()
    await page.waitForLoadState('networkidle')
    // Wait for hydration to swap in the fixed bottom bar.
    await expect(page.locator('nav[aria-label="Primary"]')).toHaveCSS('position', 'fixed')
  })

  test('every bottom-nav label fits its cell and stays a 44px tap target', async ({ page }) => {
    const nav = page.locator('nav[aria-label="Primary"]')
    const links = nav.locator('a')
    const count = await links.count()
    expect(count).toBe(8)

    for (let i = 0; i < count; i++) {
      const link = links.nth(i)
      const { label, overflows, height, lineCount } = await link.evaluate((a) => {
        // getClientRects() on the label's text contents returns one rect per
        // rendered line box, so its length is the label's line count.
        const range = document.createRange()
        range.selectNodeContents(a)
        return {
          label: a.textContent?.trim() ?? '',
          // scrollWidth > clientWidth means the label paints past its cell and
          // collides with the neighbouring destination (the pre-18-2 defect).
          overflows: a.scrollWidth > a.clientWidth,
          height: Math.round(a.getBoundingClientRect().height),
          lineCount: range.getClientRects().length,
        }
      })
      expect(overflows, `"${label}" label overflows its cell at 320px`).toBe(false)
      // A clean single-word wrap fits horizontally (no overflow) but still reads
      // as crushed — AC-2 forbids it. Require exactly one line.
      expect(lineCount, `"${label}" label wraps to ${lineCount} lines at 320px`).toBe(1)
      expect(height, `"${label}" tap target is under 44px`).toBeGreaterThanOrEqual(44)
    }
  })

  test('the fixed bottom bar does not cover the Footer when scrolled to bottom', async ({
    page,
  }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    // Let the scroll settle before measuring.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const footer = document.querySelector('footer')?.getBoundingClientRect()
          const nav = document.querySelector('nav[aria-label="Primary"]')?.getBoundingClientRect()
          if (!footer || !nav) return null
          // Footer's last content must sit above the fixed bar's top edge.
          return footer.bottom <= nav.top ? 'clear' : 'covered'
        })
      )
      .toBe('clear')
  })
})
