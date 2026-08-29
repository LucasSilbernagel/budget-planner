import { type Page, expect, test } from '@playwright/test'

/**
 * The "Retirement target model" group's label sits cleanly (Story 44.2, UX-DR49).
 *
 * ⚠️⚠️ READ THIS BEFORE CHANGING AN ASSERTION HERE — THE EPIC'S STATED MECHANISM
 * IS WRONG, AND THE OBVIOUS GUARD PASSES ON BROKEN CODE.
 *
 * `epics.md:445` says the legend "is positioned across the fieldset's border box
 * … it reads as text straddling the edge". MEASURED at `816bdf6`, before the fix,
 * at BOTH widths: `legend.top === fieldset.top`, nothing overflowed, and
 * `legendInsideBox` was already `true`. So a containment assertion — the guard a
 * developer naturally writes from that wording — is UNFALSIFIABLE here.
 *
 * The real defect was that the rendered legend is laid out against the
 * fieldset's BORDER edge, so the panel's `p-4` never applied to it: the title sat
 * 0px from the filled panel's top edge while every radio below sat 16px in.
 *
 * What this file asserts instead is the label's position RELATIVE TO THE FILLED
 * SURFACE it heads — resolved by paint, not by a test hook, for the reason
 * `measure()` documents — which genuinely reverses when the fix is reverted:
 *   before — label inside the panel, `panel.top - label.bottom` NEGATIVE (-20px)
 *   after  — label above the panel,  `panel.top - label.bottom` POSITIVE (+8px)
 *
 * ⚠️ The -20px baseline was measured with a probe that selected the FIELDSET as
 * the panel, because `data-testid="retirement-model-panel"` did not exist at
 * `816bdf6` — this spec cannot itself be run against that commit, where
 * `measure()` would throw on a null panel. The mutation arm that exercises the
 * assertion is a revert WITH the testid moved onto the fieldset, which is what
 * the panel is under that structure (story 44.2, notes 3 and 10).
 *
 * ⚠️ jsdom cannot carry any of this: every rect there is {0,0,0,0}. The
 * structural half (legend still first child, group still named) lives in
 * `src/components/__tests__/retirement-model-group.test.tsx`.
 */

const PANEL = '[data-testid="retirement-model-panel"]'
/**
 * ⚠️ Scoped THROUGH the panel's own fieldset, not `document.querySelector('fieldset
 * legend')`. That form takes the first match in the document, so if any other
 * fieldset ever lands on this route (a consent banner, another form group) the
 * geometry would silently pair an unrelated legend with this panel and read
 * green with the fix reverted.
 */
const LEGEND = 'fieldset:has([data-testid="retirement-model-panel"]) > legend'
const THEME_KEY = 'budget-planner-theme-prefs-v1'

/** sRGB relative luminance, per WCAG 2.x. */
function luminance([r, g, b]: readonly number[]): number {
  const [rl, gl, bl] = [r, g, b].map((v) => {
    const c = (v as number) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (rl as number) + 0.7152 * (gl as number) + 0.0722 * (bl as number)
}

function contrastRatio(fg: readonly number[], bg: readonly number[]): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return ((a as number) + 0.05) / ((b as number) + 0.05)
}

/**
 * Parse a computed colour into `[r, g, b, a]`.
 *
 * ⚠️ THROWS on anything that is not legacy `rgb()`/`rgba()`. Chromium serializes
 * this app's Tailwind-3 palette as `rgb(...)` today, but a palette authored in
 * `oklch()`/`lab()` would serialize verbatim — and a naive "first three numbers"
 * parse turns `oklch(0.985 0.002 247.839)` into `[0.985, 0.002, 247.839]`, i.e.
 * a near-white read as almost black, with a hue component above 255 driving the
 * linear value past 1. That produces confident nonsense in BOTH directions.
 * Failing loudly is the only safe behaviour for a test that exists to certify a
 * contrast number.
 */
function parseColour(value: string): [number, number, number, number] {
  const match = /^rgba?\(([^)]+)\)$/.exec(value.trim())
  if (!match) {
    throw new Error(`Unsupported colour serialization for a contrast check: ${value}`)
  }
  const parts = (match[1] as string)
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) {
    throw new Error(`Unparseable colour: ${value}`)
  }
  const [r, g, b, a] = parts
  return [r as number, g as number, b as number, a === undefined ? 1 : (a as number)]
}

/** Composite a possibly-translucent colour over an opaque backdrop. */
function over(top: readonly number[], backdrop: readonly number[]): [number, number, number] {
  const alpha = top[3] as number
  return [0, 1, 2].map(
    (i) => (top[i] as number) * alpha + (backdrop[i] as number) * (1 - alpha)
  ) as [number, number, number]
}

/**
 * ⚠️ Playwright waits for ACTIONABLE, not HYDRATED, and server-rendered markup is
 * already actionable. Story 44.1 lost an hour to acting before React took over.
 */
async function gotoPlanner(page: Page, width: number, theme?: 'light' | 'dark'): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  if (theme) {
    // ⚠️ Seed the theme STORE. Never hand-add `.dark` to <html>: `ThemeProvider`
    // re-applies the persisted preference after mount and would strip it,
    // silently turning a dark test into a light one. `deferred-work.md:58`
    // records `theme-page-coverage.spec.ts` failing for exactly that reason,
    // which is why this file does not extend it.
    await page.addInitScript(
      ({ key, value }) => {
        localStorage.setItem(key, JSON.stringify({ state: { theme: value }, version: 0 }))
      },
      { key: THEME_KEY, value: theme }
    )
  }
  await page.goto('/retirement')
  await page.waitForFunction(() => {
    const el = document.querySelector('#currentAge')
    return !!el && Object.keys(el).some((key) => key.startsWith('__reactEvents'))
  })
}

/**
 * Geometry of the label against the FILLED SURFACE it heads, plus the first card.
 *
 * ⚠️⚠️ THE PANEL IS FOUND BY ITS PAINT, NOT BY ITS `data-testid`, AND THAT
 * DISTINCTION IS THE WHOLE GUARD. Review measured the realistic regression —
 * `p-4 surface-inset rounded-lg` moved back onto the `<fieldset>`, the legend
 * un-floated, and the testid left exactly where a refactorer would leave it —
 * and ALL ELEVEN tests in this file passed. Anchored to the testid, the
 * assertion measured the label against the inner grid, which sits below it
 * either way; the defect was caught only by the jsdom token tests, the precise
 * inverse of what this file's header claims to own.
 *
 * Resolving the panel as "the nearest element that actually paints a
 * background" makes the assertion track the surface the user sees: under the
 * fix that is the inner div (gap +8px), under the regression it is the fieldset,
 * which CONTAINS the legend (gap negative). The testid is still used to scope
 * the card queries, where its stability is a feature.
 */
async function measure(page: Page) {
  return page.evaluate(
    ({ panelSel, legendSel }) => {
      const legend = document.querySelector(legendSel) as HTMLElement | null
      if (!legend) {
        throw new Error(`No legend matched ${legendSel}`)
      }
      const fieldset = legend.closest('fieldset') as HTMLElement | null
      if (!fieldset) {
        throw new Error('The legend is not inside a fieldset')
      }
      const paints = (el: Element) => {
        const bg = getComputedStyle(el).backgroundColor
        return bg !== '' && bg !== 'transparent' && !/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(bg)
      }
      // Nearest painted surface at or below the fieldset — the box the user
      // perceives as "the panel", whichever element happens to carry it.
      const panel = (
        paints(fieldset) ? fieldset : [...fieldset.querySelectorAll('*')].find(paints)
      ) as HTMLElement | null
      if (!panel) {
        throw new Error('No painted panel surface found inside the fieldset')
      }
      const firstCard = document.querySelector(`${panelSel} label`) as HTMLElement | null
      if (!firstCard) {
        throw new Error(`No radio card matched ${panelSel} label`)
      }
      const p = panel.getBoundingClientRect()
      const l = legend.getBoundingClientRect()
      const c = firstCard.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(legend)
      const cards = [...panel.querySelectorAll('label')].map((n) => n.getBoundingClientRect())
      return {
        gapLabelToPanel: p.top - l.bottom,
        labelOverlapsFirstCard: c.top < l.bottom - 0.5,
        labelLeft: l.left,
        panelLeft: p.left,
        labelScrollWidth: legend.scrollWidth,
        labelClientWidth: legend.clientWidth,
        labelLineCount: range.getClientRects().length,
        // AC-4's "the grid is unchanged" clause, pinned rather than eyeballed:
        // two cards on one row is 2 columns, stacked is 1.
        columns:
          cards.length === 2 && Math.abs((cards[0] as DOMRect).top - (cards[1] as DOMRect).top) < 2
            ? 2
            : 1,
      }
    },
    { panelSel: PANEL, legendSel: LEGEND }
  )
}

for (const width of [320, 1280]) {
  test.describe(`retirement target model group at ${width}px`, () => {
    test('the label sits clear ABOVE the panel, not jammed inside its edge', async ({ page }) => {
      await gotoPlanner(page, width)
      const m = await measure(page)

      // ⚠️ THE LOAD-BEARING ASSERTION. Reverting the fix puts the label back
      // inside the panel and makes this negative (measured -20px before the fix).
      expect(m.gapLabelToPanel).toBeGreaterThan(0)
      expect(m.labelOverlapsFirstCard).toBe(false)
    })

    test('the label is left-aligned with the panel it heads', async ({ page }) => {
      await gotoPlanner(page, width)
      const m = await measure(page)

      // ⚠️ RENAMED AND NARROWED IN REVIEW. This used to be called "does not
      // overflow or clip" and also asserted `labelWidth <= panelWidth + 1` —
      // which is true BY CONSTRUCTION, since the legend is `w-full` and the
      // panel is a full-span sibling in the same unpadded fieldset. It was
      // insensitive to both clipping and wrapping, the two things its name
      // claimed. Alignment is what it actually measures, and that does reverse:
      // a rendered legend carries `px-1` inside a padded fieldset and sits ~17px
      // right of the panel's edge.
      expect(Math.abs(m.labelLeft - m.panelLeft)).toBeLessThanOrEqual(1)
    })

    test('the two-column desktop / one-column mobile grid is unchanged', async ({ page }) => {
      // ⚠️ ADDED IN REVIEW. AC-4's "the grid is unchanged" clause was satisfied by
      // the code but pinned by nothing — the claim rested on a one-time manual
      // probe. Moving `grid-cols-1 sm:grid-cols-2` off the panel during a future
      // refactor would have been caught by no test at all.
      await gotoPlanner(page, width)
      const m = await measure(page)
      expect(m.columns).toBe(width >= 640 ? 2 : 1)
    })

    test('the label is neither clipped nor wrapped', async ({ page }) => {
      await gotoPlanner(page, width)
      const m = await measure(page)

      // The assertions the renamed test above only claimed to make.
      // `scrollWidth > clientWidth` is real horizontal clipping; the Range's
      // client-rect count is the line count of the text itself.
      // ⚠️ Range, not `element.getClientRects()`: on a block or flex item that
      // returns 1 even on broken code (stories 18, 42.3).
      expect(m.labelScrollWidth).toBeLessThanOrEqual(m.labelClientWidth + 1)
      expect(m.labelLineCount).toBe(1)
    })
  })
}

for (const theme of ['light', 'dark'] as const) {
  test(`the label is legible against the surface it sits on in ${theme} mode`, async ({ page }) => {
    await gotoPlanner(page, 1280, theme)
    // ⚠️ Token membership, not a substring: `/^(?!.*dark).*$/` false-fails on any
    // unrelated class that merely CONTAINS "dark" (`no-dark-flash`, `text-darkslate`).
    const htmlClasses = await page.locator('html').evaluate((el) => [...el.classList])
    expect(htmlClasses.includes('dark')).toBe(theme === 'dark')

    // ⚠️ The fix moved the label OFF `.surface-inset` and onto the card behind
    // it, so the background this is measured against is not the one it had
    // before — a contrast claim carried over from the old surface would be about
    // the wrong pair of colours.
    // ⚠️ COLLECT THE WHOLE ANCESTOR STACK, not just the first painter. A
    // background can be translucent — `.surface-inset` is `dark:bg-gray-700/40`
    // — and stopping at the first non-`rgba(0,0,0,0)` value then discarding its
    // alpha scores it as opaque. Measured cost of that shortcut: slate-200 over
    // a 50% overlay on white computes 14.48:1 while the painted result is
    // 2.77:1, so a hard AA failure certifies as AAA. Composite instead.
    const { fg, stack } = await page.evaluate(
      ({ legendSel }) => {
        const legend = document.querySelector(legendSel) as HTMLElement
        const backgrounds: string[] = []
        let node: HTMLElement | null = legend
        while (node) {
          backgrounds.push(getComputedStyle(node).backgroundColor)
          node = node.parentElement
        }
        // The page's own canvas is the final backdrop.
        backgrounds.push(getComputedStyle(document.documentElement).backgroundColor)
        return { fg: getComputedStyle(legend).color, stack: backgrounds }
      },
      { legendSel: LEGEND }
    )

    // Flatten from the bottom up, starting from an opaque white canvas.
    let backdrop: readonly number[] = [255, 255, 255, 1]
    for (const layer of [...stack].reverse()) {
      const colour = parseColour(layer)
      if (colour[3] > 0) {
        backdrop = [...over(colour, backdrop), 1]
      }
    }
    const foreground = parseColour(fg)
    const painted = over(foreground, backdrop)

    const ratio = contrastRatio(painted, backdrop)
    // ⚠️ The bar is AAA (7:1), deliberately stricter than the AA 4.5:1 this text
    // legally needs. The headroom is the point: it is what makes M7
    // (`.text-label` -> `.text-faint`) redden in BOTH themes rather than only in
    // light, where `gray-400` measures ~2.6:1 against ~5.6:1 dark. A legitimate
    // future colour change that lands between 4.5 and 7 will fail here and
    // should be re-ratified rather than silently loosened.
    expect(
      ratio,
      `${theme}: ${fg} over ${stack.join(' / ')} = ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(7)
  })
}

test('the radio cards keep their focus ring and 44px targets (AC-5)', async ({ page }) => {
  await gotoPlanner(page, 1280)

  const cards = page.locator(`${PANEL} label`)
  await expect(cards).toHaveCount(2)
  for (let i = 0; i < 2; i++) {
    const box = await cards.nth(i).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  const radio = page.locator(`${PANEL} input[type="radio"]`).first()
  const blurred = await radio.evaluate((el) => getComputedStyle(el).boxShadow)
  await radio.focus()
  const focused = await radio.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(focused).not.toBe(blurred)
})
