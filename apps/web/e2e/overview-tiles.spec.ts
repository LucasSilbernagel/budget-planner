import { expect, test } from '@playwright/test'

/**
 * "Manage Your Finances" tile-label guard E2E (story 18-1, UX-DR22).
 *
 * The overview tiles are hidden below 640px (story 18-3, `hidden sm:block`) — the
 * fixed bottom nav covers those destinations there — so they render only at
 * ≥640px, two columns until `lg` (1024px) and five columns at ≥1024px
 * (`grid-cols-2 lg:grid-cols-5`).
 *
 * The label a tile can least afford to break is "Projections". Its tightest
 * layout is the five-column grid at exactly 1024px (the narrowest width the
 * `lg:` step is active), where each column is the smallest it ever gets. 768px is
 * the widest two-column layout before `lg:` — and the width where the grid used
 * to jump to five columns and break every label mid-word ("Incom/e",
 * "Projec/tions") before this story moved the five-column step to `lg:`. Guarding
 * both widths proves labels stay on one line across the whole render range.
 *
 * The core assertion is **no wrap**: each label must render on a single line
 * (`Range.getClientRects()` returns one rect per line box, so length === 1). A
 * mid-word break — not just a horizontal overflow — is the UX-DR22 defect, and a
 * label clipped inside a fixed grid track (`minmax(0, 1fr)`) would not widen the
 * page, so a document-level overflow check alone would miss it. We still assert
 * page-level and per-tile overflow as cheap sanity checks.
 *
 * Overflow/wrapping is theme-independent (identical box sizing in light and dark;
 * dark mode only recolors), and dark mode is premium-gated here, so the guard
 * runs in the default theme.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const TILE_LABELS = ['Income', 'Expenses', 'Savings', 'Balance', 'Projections'] as const

// 768px = widest two-column layout (and the old five-column break point);
// 1024px = narrowest five-column layout, where "Projections" has the least room.
const WIDTHS = [768, 1024] as const

async function assertNoHorizontalOverflow(
  evaluate: <R>(fn: () => R) => Promise<R>,
  label: string
): Promise<void> {
  const { scrollWidth, clientWidth } = await evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    scrollWidth,
    `${label} overflows horizontally: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`
  ).toBeLessThanOrEqual(clientWidth)
}

test.describe('overview tiles keep their labels inside the button', () => {
  for (const width of WIDTHS) {
    test(`labels stay on one line inside their tiles at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })

      const response = await page.goto('/')
      expect(response?.ok(), 'expected / to load').toBeTruthy()
      await page.waitForLoadState('networkidle')

      // The tiles render at this width (≥640px), so the section heading is visible.
      await expect(page.getByRole('heading', { name: 'Manage Your Finances' })).toBeVisible()

      // Cheap page-level sanity: nothing pushes the document wider than the viewport.
      await assertNoHorizontalOverflow((fn) => page.evaluate(fn), `/ @${width}px`)

      // Scope to the tiles section: at ≥640px the GlobalNav top bar links to the
      // same five destinations, so a page-wide `getByRole('link', { name })`
      // would ambiguously match both the nav link and the tile.
      const tilesSection = page.locator('section', {
        has: page.getByRole('heading', { name: 'Manage Your Finances' }),
      })

      for (const label of TILE_LABELS) {
        const tile = tilesSection.getByRole('link', { name: label })
        await expect(tile).toBeVisible()

        // Core UX-DR22 guard: the label renders on a single line (no mid-word
        // break). A Range over the label's text yields one client rect per line
        // box, independent of the span's flex-item box, so this counts text lines
        // directly.
        const lineCount = await tile
          .locator('span')
          .first()
          .evaluate((span) => {
            const range = document.createRange()
            range.selectNodeContents(span)
            return range.getClientRects().length
          })
        expect(
          lineCount,
          `"${label}" wraps to ${lineCount} lines at ${width}px (expected 1 — a mid-word break)`
        ).toBe(1)

        // Sanity: the tile's content never exceeds its own width either.
        const overflow = await tile.evaluate((el) => el.scrollWidth - el.clientWidth)
        expect(
          overflow,
          `"${label}" tile content overflows its button at ${width}px by ${overflow}px`
        ).toBeLessThanOrEqual(0)
      }
    })
  }
})
