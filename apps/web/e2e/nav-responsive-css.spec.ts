import { type Page, expect, test } from '@playwright/test'

/**
 * CSS-only responsive `GlobalNav` E2E (story 31.4, UX-DR38).
 *
 * The nav used to pick its layout in JavaScript (`useIsNarrowViewport`), a hook
 * that is `false` on the server AND on the first client render. On a phone that
 * painted the desktop top bar first and swapped in the fixed bottom bar at
 * hydration — a measured **133px** vertical jump at 320px (header wrapper
 * 165px -> 32px, the page `<h1>` from y=181 to y=48). This file guards the fix:
 * ONE DOM subtree whose layout is decided entirely by the CSS cascade.
 *
 * Three things this file proves that nothing else in the suite could:
 *
 *  1. **First paint == final paint** (AC-2). The nav's computed `position` and
 *     `getBoundingClientRect()` are snapshotted at `DOMContentLoaded` — before
 *     hydration — and compared to the settled values. On the old JS-branching
 *     build the DCL reading was `position: static, rect {0,0,320,133}`; every
 *     other spec in the suite measured only the settled DOM and was blind to it.
 *  2. **Desktop is untouched** (AC-3). Without a >= 640px assertion, a change
 *     that made the bar `fixed` at EVERY width passes every mobile test here.
 *     640px specifically guards `flex-wrap`, which is load-bearing on its own
 *     account: the desktop bar is already two rows from 640 to ~830px, and
 *     removing the class was measured at 138px of document overflow at 640px —
 *     invisible to `responsive-320.spec.ts` and `global-nav.spec.ts`, which
 *     both sweep 320px only.
 *  3. **The ink**, which no geometry assertion can see (AC-10). A reference
 *     implementation carrying 6px corners on every mobile cell AND a 2px focus
 *     ring painting OUTSET at x=-2/x=322 (off-screen on 4 of the 8 cells)
 *     passed all 129 tests of this suite. `border-radius` and `box-shadow`
 *     never affect `scrollWidth`, height or line count, so they are asserted
 *     directly here.
 *
 * ⚠️ The 320px viewport is established BEFORE `page.goto` (via `test.use` /
 * `setViewportSize` in a fixture), never after. Resizing after navigation makes
 * BOTH halves of AC-2 fail on a fully CORRECT implementation — the DCL snapshot
 * would be taken at the default 1280x720 (`position: static`, `iw: 1280`) and
 * compared against a settled 320px reading. `e2e/theme-dark-mode.spec.ts`'s
 * DCL-snapshot mechanism is the model here, but NOT its shape: that spec sets no
 * viewport at all because `documentElement.className` is viewport-independent.
 * Nav geometry is not.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const NAV = 'nav[aria-label="Primary"]'

interface NavSnapshot {
  position: string
  rect: { x: number; y: number; width: number; height: number; bottom: number }
  innerHeight: number
}

/** Read the nav's position + box exactly as the DCL listener does. */
function readNav(page: Page): Promise<NavSnapshot | null> {
  return page.evaluate((selector) => {
    const nav = document.querySelector(selector)
    if (!nav) return null
    const r = nav.getBoundingClientRect()
    return {
      position: globalThis.getComputedStyle(nav).position,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom },
      innerHeight: globalThis.innerHeight,
    }
  }, NAV)
}

test.describe('the mobile nav paints its final position on the first frame (AC-2)', () => {
  // Established BEFORE goto — see the file docblock.
  test.use({ viewport: { width: 320, height: 720 } })

  test('nav position + geometry at DOMContentLoaded are already the settled values', async ({
    page,
  }) => {
    await page.addInitScript((selector) => {
      document.addEventListener('DOMContentLoaded', () => {
        const nav = document.querySelector(selector)
        const snapshot = nav
          ? (() => {
              const r = nav.getBoundingClientRect()
              return {
                position: globalThis.getComputedStyle(nav).position,
                rect: { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom },
                innerHeight: globalThis.innerHeight,
              }
            })()
          : null
        ;(globalThis as unknown as { __navAtDCL?: unknown }).__navAtDCL = snapshot
      })
    }, NAV)

    const response = await page.goto('/')
    expect(response?.ok(), 'expected / to load').toBeTruthy()

    const atDCL = (await page.evaluate(
      () => (globalThis as unknown as { __navAtDCL?: NavSnapshot | null }).__navAtDCL ?? null
    )) as NavSnapshot | null

    // Anti-vacuous precondition: a null snapshot (listener never fired, nav not
    // in the pre-hydration HTML) or a zero-area box would satisfy the equality
    // check below while proving nothing.
    expect(atDCL, 'no nav was present/measured at DOMContentLoaded').not.toBeNull()
    const dcl = atDCL as NavSnapshot
    expect(dcl.rect.width, 'nav had a zero-width box at DOMContentLoaded').toBeGreaterThan(0)
    expect(dcl.rect.height, 'nav had a zero-height box at DOMContentLoaded').toBeGreaterThan(0)

    // (a) The first painted frame is already the fixed bottom bar.
    expect(dcl.position, 'nav is not fixed on the first painted frame').toBe('fixed')
    expect(
      Math.abs(dcl.rect.bottom - dcl.innerHeight),
      `nav bottom ${dcl.rect.bottom} is not flush with the viewport bottom ${dcl.innerHeight}`
    ).toBeLessThanOrEqual(2)

    // (b) Nothing moves afterwards — the flash was exactly this delta.
    await page.waitForLoadState('networkidle')
    const settled = await readNav(page)
    expect(settled, 'nav disappeared after hydration').not.toBeNull()
    expect(settled).toEqual(dcl)
  })
})

test.describe('desktop (>= 640px) keeps the in-flow top bar (AC-3)', () => {
  for (const width of [640, 1280]) {
    test(`at ${width}px the nav is a static top bar, not a fixed bottom bar`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 })
      const response = await page.goto('/')
      expect(response?.ok(), 'expected / to load').toBeTruthy()
      await page.waitForLoadState('networkidle')

      const snapshot = await readNav(page)
      expect(snapshot).not.toBeNull()
      const nav = snapshot as NavSnapshot

      expect(nav.position, `nav is out of flow at ${width}px`).toBe('static')
      // In flow at the top of the document, NOT anchored to the viewport bottom.
      expect(nav.rect.y, `nav does not sit at the top of the document at ${width}px`).toBeLessThan(
        120
      )
      expect(
        Math.abs(nav.rect.bottom - nav.innerHeight),
        `nav is bottom-anchored at ${width}px — the mobile layout leaked to desktop`
      ).toBeGreaterThan(2)
    })
  }

  // `flex-wrap` is the only thing keeping the eight desktop items inside a 640px
  // viewport: measured with the class removed, the row wants 778px, i.e. 138px
  // of overflow at 640px, 78px at 700px and 18px at 760px, clearing only at
  // 800px. Both a document-level AND an element-level check are made: a scroll
  // container between the list and <html> would absorb the former (31.2), while
  // the latter cannot be absorbed.
  for (const width of [640, 700, 760]) {
    test(`the desktop nav row wraps inside a ${width}px viewport (flex-wrap is load-bearing)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const measured = await page.evaluate((selector) => {
        const list = document.querySelector(`${selector} ul`)
        if (!list) return null
        const rights = [...list.querySelectorAll('a')].map((a) => a.getBoundingClientRect().right)
        return {
          listOverflow: list.scrollWidth - list.clientWidth,
          widestLinkRight: Math.max(...rights),
          documentOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          innerWidth: globalThis.innerWidth,
          wrap: globalThis.getComputedStyle(list).flexWrap,
        }
      }, NAV)

      expect(measured, 'nav list not found').not.toBeNull()
      const m = measured as NonNullable<typeof measured>
      expect(m.wrap, `the desktop nav row does not wrap at ${width}px`).toBe('wrap')
      expect(
        m.listOverflow,
        `the nav list overflows its own box at ${width}px`
      ).toBeLessThanOrEqual(0)
      expect(
        m.widestLinkRight,
        `a nav link paints past the ${width}px viewport edge`
      ).toBeLessThanOrEqual(m.innerWidth)
      expect(m.documentOverflow, `the document is wider than ${width}px`).toBeLessThanOrEqual(0)
    })
  }
})

/**
 * Exactly one layout applies at each width, and the two never co-apply (AC-3/AC-4).
 *
 * ⚠️ The 639.98–640px band that `useIsNarrowViewport`'s constant straddles is
 * NOT covered here, and cannot be: Chromium viewport widths are integer-only,
 * `deviceScaleFactor` 1.25/1.5 does not yield a fractional CSS width, and CDP
 * rejects `Emulation.setDeviceMetricsOverride {width: 639.99}` outright
 * ("Invalid parameters"). Recorded as not-covered rather than falsely walked.
 */
test.describe('exactly one nav layout applies at each viewport width', () => {
  for (const width of [320, 375, 414, 639, 640, 641, 1280]) {
    const mobile = width < 640

    test(`${width}px renders the ${
      mobile ? 'bottom-bar' : 'top-bar'
    } layout and only that`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const measured = await page.evaluate((selector) => {
        const nav = document.querySelector(selector)
        const list = nav?.querySelector('ul')
        const link = nav?.querySelector('a')
        if (!nav || !list || !link) return null
        const navStyle = globalThis.getComputedStyle(nav)
        const linkStyle = globalThis.getComputedStyle(link)
        return {
          navPosition: navStyle.position,
          navBorderTop: navStyle.borderTopWidth,
          listDisplay: globalThis.getComputedStyle(list).display,
          linkDisplay: linkStyle.display,
          linkRadius: linkStyle.borderRadius,
        }
      }, NAV)

      expect(measured, 'nav/list/link not found').not.toBeNull()
      const m = measured as NonNullable<typeof measured>

      if (mobile) {
        expect(m.navPosition).toBe('fixed')
        expect(m.navBorderTop, 'the mobile bar has no border of its own').toBe('1px')
        expect(m.listDisplay).toBe('grid')
        expect(m.linkDisplay).toBe('flex')
        // `rounded-md` is unprefixed and would otherwise reach every mobile cell.
        expect(m.linkRadius, 'mobile tab cells picked up desktop corner rounding').toBe('0px')
      } else {
        expect(m.navPosition).toBe('static')
        // The desktop bar's chrome lives on the `__root.tsx` wrapper (19-3).
        expect(m.navBorderTop, 'the mobile border-top leaked onto desktop').toBe('0px')
        expect(m.listDisplay).toBe('flex')
        expect(m.linkDisplay).toBe('inline-block')
        expect(m.linkRadius, 'desktop lost its `rounded-md` corners').toBe('6px')
      }
    })
  }
})

test.describe('mobile bottom-bar geometry and ink parity at 320px (AC-4/AC-5)', () => {
  test.use({ viewport: { width: 320, height: 720 } })

  test('the list reproduces the 4x80px grid with no inherited desktop spacing', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const list = await page.evaluate((selector) => {
      const el = document.querySelector(`${selector} ul`)
      if (!el) return null
      const s = globalThis.getComputedStyle(el)
      return {
        display: s.display,
        gridTemplateColumns: s.gridTemplateColumns,
        gap: s.gap,
        padding: s.padding,
      }
    }, NAV)

    expect(list).not.toBeNull()
    const m = list as NonNullable<typeof list>

    // The exact tracks measured on the pre-31.4 mobile bar. This is the assertion
    // with teeth: `grid-cols-4` is `repeat(4, minmax(0,1fr))`, so leaving ANY of
    // the desktop `gap-1 px-4 py-2` un-neutralised resizes every track — with
    // both live the cells compute to 69px, not 80px.
    expect(m.display).toBe('grid')
    expect(m.gridTemplateColumns, 'the mobile grid is not 4 x 80px at 320px').toBe(
      '80px 80px 80px 80px'
    )
    expect(m.padding, 'the desktop `px-4 py-2` leaked onto the mobile bar').toBe('0px')
    // A grid with no gap declared computes `normal`, with `gap-0` it computes
    // `0px`; both render identically, and `gap-1` would compute `4px`.
    expect(['0px', 'normal'], 'the desktop `gap-1` leaked onto the mobile bar').toContain(m.gap)
  })

  test('every mobile-only utility has a measurable computed consequence', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    expect(await readMergedStyles(page)).toEqual(MOBILE_STYLES)
  })

  test('every mobile tab cell has square corners (no `rounded-md` leak)', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const radii = await page.evaluate(
      (selector) =>
        [...document.querySelectorAll(`${selector} a`)].map((a) => ({
          label: a.textContent?.trim() ?? '',
          radius: globalThis.getComputedStyle(a).borderRadius,
        })),
      NAV
    )

    expect(radii).toHaveLength(8)
    for (const { label, radius } of radii) {
      expect(radius, `"${label}" cell paints rounded corners at 320px`).toBe('0px')
    }
  })

  test('the keyboard focus ring paints INSIDE the cell, not off the screen edge', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Keyboard focus (not `.focus()`) so `:focus-visible` is guaranteed to match.
    // Only the ring's INK is read here — never the element's position, which
    // focus scrolling would have moved (31.3).
    const focused = await tabToFirstNavLink(page)
    expect(focused, 'never reached a nav link by tabbing').not.toBeNull()

    // The grid columns are 80px x 4, flush to x=0..320. An OUTSET 2px ring paints
    // at x=-2 and x=322, i.e. clipped away on 4 of the 8 cells; `ring-inset` is
    // what keeps it on screen, and it is mobile-only.
    expect(hasVisibleRing(focused), `the mobile nav has no visible focus ring (${focused})`).toBe(
      true
    )
    expect(focused, 'the mobile focus ring is outset — clipped at the viewport edge').toContain(
      'inset'
    )
  })
})

test('the desktop focus ring stays OUTSET — `ring-inset` did not leak to >= 640px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const focused = await tabToFirstNavLink(page)
  expect(focused, 'never reached a nav link by tabbing').not.toBeNull()
  // `not.toContain('inset')` alone is satisfied by `box-shadow: none` AND by a
  // zero-width ring (`ring-0` computes to `... 0px 0px 0px 0px`, which is not
  // the string 'none'), so this test would pass on a desktop nav whose focus
  // ring is invisible. Existence has to be asserted separately from inset-ness.
  expect(hasVisibleRing(focused), `the desktop nav has no visible focus ring (${focused})`).toBe(
    true
  )
  expect(focused, '`ring-inset` leaked onto the desktop nav').not.toContain('inset')
})

/**
 * A focus ring is only real if some length in its `box-shadow` is non-zero.
 *
 * `box-shadow: none` and `rgb(34,197,94) 0px 0px 0px 0px` are both "no visible
 * ring", and only the first is caught by a `!== 'none'` check — which is how a
 * `focus-visible:ring-2` -> `ring-0` regression passed an earlier version of
 * these tests while keeping the class token that the unit suite pins.
 */
function hasVisibleRing(shadow: string | null): boolean {
  return shadow !== null && /\b[1-9]\d*(\.\d+)?px\b/.test(shadow)
}

/**
 * The mobile bar's own chrome, in BOTH themes.
 *
 * Below `sm` the bar is `position: fixed` — out of flow, and therefore beyond
 * the reach of the `sm:`-gated wrapper chrome in `__root.tsx` that dresses the
 * desktop row. So it carries its own `max-sm:bg-white` / `dark:max-sm:bg-gray-800`.
 * Drop either and the fixed bar becomes TRANSPARENT: page content scrolls
 * visibly through the tab bar, and the labels sit on whatever passes underneath.
 *
 * Nothing else in the suite can see that. `MOBILE_STYLES`/`DESKTOP_STYLES` pin
 * only theme-independent properties, `border-top-WIDTH` says nothing about the
 * background, and `theme-page-coverage.spec.ts` / `theme-dark-mode.spec.ts`
 * contain no nav assertions at all. The alpha channel is the load-bearing part
 * of this test — a dropped background computes to `rgba(0, 0, 0, 0)`.
 *
 * ⚠️ `max-sm:border-gray-200` is deliberately NOT asserted: Tailwind preflight
 * already defaults `border-color` to gray-200, so removing that token is a true
 * no-op with no observable consequence to guard.
 */
for (const [theme, expected] of [
  ['light', 'rgb(255, 255, 255)'],
  ['dark', 'rgb(31, 41, 55)'],
] as const) {
  test(`the mobile bar paints an opaque ${theme} background of its own`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.addInitScript((t) => {
      globalThis.localStorage.setItem(
        'budget-planner-theme-prefs-v1',
        JSON.stringify({ state: { theme: t }, version: 0 })
      )
    }, theme)
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const bg = await page.evaluate(
      (selector) => globalThis.getComputedStyle(document.querySelector(selector)).backgroundColor,
      NAV
    )

    // Opacity first: this is what actually fails when the token is dropped.
    expect(bg, `the ${theme} mobile bar is transparent — content shows through`).not.toMatch(
      /rgba\(.*,\s*0\)$/
    )
    expect(bg, `the ${theme} mobile bar lost its background`).toBe(expected)
  })
}

test('the desktop nav carries NO background of its own — the wrapper owns it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const bg = await page.evaluate(
    (selector) => globalThis.getComputedStyle(document.querySelector(selector)).backgroundColor,
    NAV
  )
  // An unprefixed `bg-*` leaking to desktop would paint a band inside the shared
  // nav+account row that `__root.tsx` dresses as one bar (story 19-3).
  expect(bg, 'a background leaked onto the desktop nav').toBe('rgba(0, 0, 0, 0)')
})

/**
 * The full merged-class inventory, read as COMPUTED style rather than as class
 * tokens (AC-10).
 *
 * The mutation pass is what motivated this. Enumerating the prescribed tokens
 * and asserting only the interesting-looking ones left real holes: dropping
 * `max-sm:text-[11px]` and dropping `max-sm:min-w-0` both passed the entire
 * suite — 22 unit cases and five e2e specs — because no assertion anywhere
 * observed a font size or a grid-item min-width. A token with no assertion is a
 * missing guard, not a passed mutation.
 *
 * ⚠️ This partition pins the THEME-INDEPENDENT properties only — it is not the
 * whole guard, and these tokens are deliberately covered elsewhere:
 *   - `max-sm:bg-white` / `dark:max-sm:bg-gray-800` — theme-dependent, so they
 *     get their own two-theme test above (a dropped background computes to
 *     `rgba(0, 0, 0, 0)`, which no theme-independent expectation could catch).
 *   - `max-sm:min-h-[44px]` / `max-sm:h-full` — `chrome-320.spec.ts` measures
 *     the rendered >= 44px tap target, which is the claim that matters.
 *   - `max-sm:bottom-0` — AC-2's flush-to-`innerHeight` assertion above.
 *   - `max-sm:pb-[env(safe-area-inset-bottom)]` — `env()` resolves to 0 in
 *     headless Chromium, so there is no computed consequence to read; the unit
 *     token check is its only possible guard.
 *   - `max-sm:border-gray-200` — preflight already defaults `border-color` to
 *     gray-200, so removing it is a true no-op with nothing to observe.
 */
function readMergedStyles(page: Page) {
  return page.evaluate((selector) => {
    const nav = document.querySelector(selector) as HTMLElement
    const item = nav.querySelector('li') as HTMLElement
    const link = nav.querySelector('a') as HTMLElement
    const n = globalThis.getComputedStyle(nav)
    const l = globalThis.getComputedStyle(link)
    return {
      // nav: max-sm:fixed / inset-x-0 / z-40 / border-t
      navPosition: n.position,
      navLeft: n.left,
      navRight: n.right,
      navZIndex: n.zIndex,
      navBorderTopWidth: n.borderTopWidth,
      // li: max-sm:min-w-0
      itemMinWidth: globalThis.getComputedStyle(item).minWidth,
      // link: max-sm:flex / items-center / justify-center / text-center /
      // text-[11px] / leading-tight / px-1 / break-words / rounded-none
      linkDisplay: l.display,
      linkAlignItems: l.alignItems,
      linkJustifyContent: l.justifyContent,
      linkTextAlign: l.textAlign,
      linkFontSize: l.fontSize,
      linkLineHeight: l.lineHeight,
      linkPadding: l.padding,
      linkOverflowWrap: l.overflowWrap,
      linkBorderRadius: l.borderRadius,
    }
  }, NAV)
}

/** Measured at 320px on the pre-31.4 mobile bar; matched exactly. */
const MOBILE_STYLES = {
  navPosition: 'fixed',
  navLeft: '0px',
  navRight: '0px',
  navZIndex: '40',
  navBorderTopWidth: '1px',
  itemMinWidth: '0px',
  linkDisplay: 'flex',
  linkAlignItems: 'center',
  linkJustifyContent: 'center',
  linkTextAlign: 'center',
  linkFontSize: '11px',
  linkLineHeight: '13.75px',
  linkPadding: '8px 4px',
  linkOverflowWrap: 'break-word',
  linkBorderRadius: '0px',
}

/**
 * The >= 640px counterpart, unchanged from `main`. Every value differs from its
 * mobile twin, which is what makes this pair a partition rather than two
 * overlapping claims: an unprefixed leak fails one side or the other.
 */
const DESKTOP_STYLES = {
  navPosition: 'static',
  navLeft: 'auto',
  navRight: 'auto',
  navZIndex: 'auto',
  navBorderTopWidth: '0px',
  itemMinWidth: 'auto',
  linkDisplay: 'inline-block',
  linkAlignItems: 'normal',
  linkJustifyContent: 'normal',
  linkTextAlign: 'start',
  linkFontSize: '14px',
  linkLineHeight: '20px',
  linkPadding: '8px 12px',
  linkOverflowWrap: 'normal',
  linkBorderRadius: '6px',
}

test('the desktop cascade is untouched — every mobile utility is absent at 1280px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  expect(await readMergedStyles(page)).toEqual(DESKTOP_STYLES)
})

/**
 * Tab until the active element is a nav link, then return its `box-shadow`.
 *
 * Keyboard traversal rather than `element.focus()`: Chromium only matches
 * `:focus-visible` on programmatic focus under a heuristic, so a scripted focus
 * can read back a ring that a real user would see and vice versa.
 */
async function tabToFirstNavLink(page: Page): Promise<string | null> {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    const shadow = await page.evaluate((selector) => {
      const active = document.activeElement
      if (!active || !active.closest(selector)) return null
      return globalThis.getComputedStyle(active).boxShadow
    }, NAV)
    if (shadow !== null) return shadow
  }
  return null
}
