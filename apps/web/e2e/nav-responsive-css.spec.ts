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
 *     ring painting OUTSET at x=-2/x=322 (off-screen on the 1st and 5th of the
 *     five 64px cells) passed all 129 tests of this suite. `border-radius` and
 *     `box-shadow` never affect `scrollWidth`, height or line count, so they are
 *     asserted directly here.
 *  4. **The heights** (story 31.5). `readMergedStyles` read no height at all
 *     before, which is why the two worst regressions this redesign can ship —
 *     icons without `sm:hidden`, the nested `<ul>` without `sm:contents` — were
 *     each measured taking the desktop nav from 52px to 76px and 160px
 *     respectively while ZERO tests went red, this file's own "the desktop
 *     cascade is untouched" included.
 *
 * ⚠️ Since 31.5 the nav holds TWO lists: the bar's outer `<ul>` and a nested
 * `<ul>` (the "More" sheet) inside its fifth `<li>`, dissolved at >= 640px with
 * `sm:contents`. Every helper here is anchored with `:scope >` rather than
 * `nav.querySelector('ul'|'a')`, which returns the first match in DOCUMENT
 * order and would silently start measuring sheet elements if the JSX were
 * reordered. And note that CSS queries match `display: none` elements: with the
 * sheet closed `nav a` still counts 8, so any count assertion must distinguish
 * bar from sheet structurally rather than by number.
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
  /** The sheet must be CLOSED on the first frame (story 31.5, AC-9). */
  sheetDisplay: string
  triggerExpanded: string | null
  /**
   * The More tab's active treatment. It is DERIVED from the router location
   * rather than applied by `<Link activeProps>`, so unlike every other tab it
   * could in principle disagree between the server render and the settled
   * client one — which would be a flash of an unhighlighted bar on the four
   * routes More owns. This is the assertion that would catch it.
   */
  moreActive: boolean
}

/** Read the nav's position + box exactly as the DCL listener does. */
function readNav(page: Page): Promise<NavSnapshot | null> {
  return page.evaluate((selector) => {
    const nav = document.querySelector(selector)
    if (!nav) return null
    const r = nav.getBoundingClientRect()
    const sheet = nav.querySelector(':scope > ul > li > ul')
    const trigger = nav.querySelector('button')
    return {
      position: globalThis.getComputedStyle(nav).position,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom },
      innerHeight: globalThis.innerHeight,
      sheetDisplay: sheet ? globalThis.getComputedStyle(sheet).display : 'MISSING',
      triggerExpanded: trigger ? trigger.getAttribute('aria-expanded') : null,
      moreActive: trigger ? trigger.className.split(/\s+/).includes('bg-green-50') : false,
    }
  }, NAV)
}

test.describe('the mobile nav paints its final position on the first frame (AC-2)', () => {
  // Established BEFORE goto — see the file docblock.
  test.use({ viewport: { width: 320, height: 720 } })

  // `/` is not a More-owned route; `/retirement` is. Both are checked because
  // the More tab's active state is the one piece of this nav that is DERIVED
  // rather than declarative, so it is the only plausible source of a new flash.
  for (const path of ['/', '/retirement']) {
    test(`nav position + geometry at DOMContentLoaded are already the settled values (${path})`, async ({
      page,
    }) => {
      await page.addInitScript((selector) => {
        document.addEventListener('DOMContentLoaded', () => {
          const nav = document.querySelector(selector)
          const snapshot = nav
            ? (() => {
                const r = nav.getBoundingClientRect()
                const sheet = nav.querySelector(':scope > ul > li > ul')
                const trigger = nav.querySelector('button')
                return {
                  position: globalThis.getComputedStyle(nav).position,
                  rect: { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom },
                  innerHeight: globalThis.innerHeight,
                  sheetDisplay: sheet ? globalThis.getComputedStyle(sheet).display : 'MISSING',
                  triggerExpanded: trigger ? trigger.getAttribute('aria-expanded') : null,
                  moreActive: trigger
                    ? trigger.className.split(/\s+/).includes('bg-green-50')
                    : false,
                }
              })()
            : null
          ;(globalThis as unknown as { __navAtDCL?: unknown }).__navAtDCL = snapshot
        })
      }, NAV)

      const response = await page.goto(path)
      expect(response?.ok(), `expected ${path} to load`).toBeTruthy()

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

      // (b) The sheet is CLOSED on the first frame (story 31.5). Open state is
      // user-initiated and initialised to closed precisely so the server render
      // and the first client render agree — a viewport-derived or effect-derived
      // open state would flash the sheet on every page load.
      expect(dcl.sheetDisplay, 'the More sheet is not closed on the first painted frame').toBe(
        'none'
      )
      expect(dcl.triggerExpanded, 'the More trigger is not collapsed at first paint').toBe('false')

      // (c) The derived More-active state is already correct at first paint.
      expect(
        dcl.moreActive,
        `the More tab's active state at DCL does not match the route (${path})`
      ).toBe(path === '/retirement')

      // (d) Nothing moves afterwards — the flash was exactly this delta.
      await page.waitForLoadState('networkidle')
      const settled = await readNav(page)
      expect(settled, 'nav disappeared after hydration').not.toBeNull()
      expect(settled).toEqual(dcl)
    })
  }
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
  // viewport. Re-measured for story 43.2, which widened the Balance label to
  // "Balance Tracking" and so widened this row:
  //
  //                        row's intrinsic width   single-row from
  //   before 43.2 (DejaVu)        753px                857px
  //   after  43.2 (DejaVu)        815px                920px
  //
  // i.e. 175px of overflow at 640px, 115px at 700px and 55px at 760px; the row
  // needs a 920px viewport before it stops wrapping. Figures are CI-representative
  // (`system-ui` -> DejaVu Sans); this repo's dev boxes resolve the narrower Noto
  // Sans and measure 721 -> 780 / 822 -> 881.
  //
  // ⚠️ The number this comment carried until 43.2 — "the row wants 778px …
  // clearing only at 800px" — did NOT reproduce at 43.2's baseline under either
  // font (753/857 DejaVu, 721/822 Noto). It was stale BEFORE this story, so it is
  // replaced rather than adjusted. Measure with a viewport at least as wide as the
  // row: setting `flex-wrap: nowrap` in a NARROWER one makes the anchors shrink
  // (`flex-shrink` defaults to 1) and reports the container's width back at you.
  //
  // Both a document-level AND an element-level check are made: a scroll
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
        const list = document.querySelector(`${selector} > ul`)
        if (!list) return null
        // All eight anchors, deliberately: at >= 640px `sm:contents` dissolves
        // the wrapper <li> and the nested <ul>, so every destination really is
        // an item of this one row and every one of them must fit inside it.
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
        // Anchored to the bar's own outer list / first cell — see the note on
        // `readMergedStyles` about document-order helpers drifting onto the sheet.
        const list = nav?.querySelector(':scope > ul')
        const link = nav?.querySelector(':scope > ul > li > a')
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

  test('the list reproduces the 5x64px grid with no inherited desktop spacing', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const list = await page.evaluate((selector) => {
      const el = document.querySelector(`${selector} > ul`)
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

    // The exact tracks measured on the 31.5 mobile bar. This is the assertion
    // with teeth: `grid-cols-5` is `repeat(5, minmax(0,1fr))`, so leaving ANY of
    // the desktop `gap-1 px-4 py-2` un-neutralised resizes every track. The
    // 64px figure is also the fit budget the labels were chosen against —
    // `max-sm:px-1` leaves a 56px content box, and the widest bar label
    // ("Expenses", 48.45px at 11px) clears it by 3.8px per side.
    expect(m.display).toBe('grid')
    expect(m.gridTemplateColumns, 'the mobile grid is not 5 x 64px at 320px').toBe(
      '64px 64px 64px 64px 64px'
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

  /**
   * ⚠️ Re-scoped in 31.5, and NOT merely by changing an 8 to a 5.
   * `querySelectorAll` is a CSS query and CSS queries match `display: none`, so
   * with the sheet closed `${NAV} a` still returns all EIGHT anchors — a count
   * that stays green while no longer distinguishing bar from sheet, which is the
   * only distinction this story is about. The bar's cells and the sheet's rows
   * are read separately, and BOTH are asserted square: the sheet's rows are new
   * anchors that inherit none of the bar's ink coverage.
   */
  test('every mobile cell has square corners (no `rounded-md` leak), bar and sheet', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const read = (selector: string) =>
      page.evaluate(
        (sel) =>
          [...document.querySelectorAll(sel)].map((a) => ({
            label: a.textContent?.trim() ?? '',
            radius: globalThis.getComputedStyle(a).borderRadius,
          })),
        selector
      )

    const barCells = await read(`${NAV} > ul > li > a`)
    expect(barCells.map((c) => c.label)).toEqual(['Overview', 'Income', 'Expenses', 'Savings'])

    const sheetRows = await read(`${NAV} > ul > li > ul > li > a`)
    expect(sheetRows.map((r) => r.label)).toEqual([
      'Balance Tracking',
      'Net Worth',
      'Retirement',
      'Settings',
    ])

    // The More trigger is a <button>, so every anchor sweep in this file misses
    // it — including this one before 31.5 added the line below.
    const triggerRadius = await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More', exact: true })
      .evaluate((el) => globalThis.getComputedStyle(el).borderRadius)

    for (const { label, radius } of [...barCells, ...sheetRows]) {
      expect(radius, `"${label}" cell paints rounded corners at 320px`).toBe('0px')
    }
    expect(triggerRadius, 'the More trigger paints rounded corners at 320px').toBe('0px')
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

    // The grid columns are 64px x 5, flush to x=0..320. An OUTSET 2px ring paints
    // at x=-2 and x=322, i.e. clipped away on the 1st and 5th cells; `ring-inset`
    // is what keeps it on screen, and it is mobile-only.
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

/**
 * The MORE SHEET's own chrome (story 31.5, AC-11).
 *
 * The sheet is a second out-of-flow surface below `sm` and needs its own opaque
 * background for exactly the reason the bar does — it is `absolute`, so page
 * content passes underneath it. The two-theme test above is scoped to the `<nav>`
 * element and cannot see the sheet at all; a dropped background computes to
 * `rgba(0, 0, 0, 0)` and the four destinations sit on whatever scrolls past.
 */
for (const [theme, expected] of [
  ['light', 'rgb(255, 255, 255)'],
  ['dark', 'rgb(31, 41, 55)'],
] as const) {
  test(`the open More sheet paints an opaque ${theme} background of its own`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.addInitScript((t) => {
      globalThis.localStorage.setItem(
        'budget-planner-theme-prefs-v1',
        JSON.stringify({ state: { theme: t }, version: 0 })
      )
    }, theme)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More', exact: true })
      .click()

    const bg = await page.evaluate(
      (selector) =>
        globalThis.getComputedStyle(document.querySelector(`${selector} > ul > li > ul`))
          .backgroundColor,
      NAV
    )
    expect(bg, `the ${theme} More sheet is transparent — content shows through`).not.toMatch(
      /rgba\(.*,\s*0\)$/
    )
    expect(bg, `the ${theme} More sheet lost its background`).toBe(expected)
  })
}

test.describe('the More sheet below `sm` (story 31.5, AC-2/AC-6/AC-11)', () => {
  test.use({ viewport: { width: 320, height: 720 } })

  test('the open sheet sits ON SCREEN, flush on top of the bar', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More', exact: true })
      .click()

    const measured = await page.evaluate((selector) => {
      const nav = document.querySelector(selector)
      const sheet = nav.querySelector(':scope > ul > li > ul')
      const s = sheet.getBoundingClientRect()
      const n = nav.getBoundingClientRect()
      return {
        position: globalThis.getComputedStyle(sheet).position,
        top: s.top,
        bottom: s.bottom,
        left: s.left,
        right: s.right,
        navTop: n.top,
        innerHeight: globalThis.innerHeight,
        innerWidth: globalThis.innerWidth,
        // `overflow-y-auto` computes `overflow-x` to `auto` as well, which would
        // make the panel a horizontal scroll container silently absorbing any
        // overflowing label (31.2's absorption trap). Element-level, so no
        // ancestor can absorb it either.
        overflowX: sheet.scrollWidth - sheet.clientWidth,
      }
    }, NAV)

    // ⚠️⚠️ `toBeVisible()` CANNOT MAKE THIS CLAIM. Measured on the `max-sm:fixed`
    // version of this sheet — the mistake this assertion exists to catch —
    // `bottom: 100%` resolved against the VIEWPORT and put the sheet at
    // {x: 0, y: -279}, entirely above the top edge of the screen, and
    // `toBeVisible()` PASSED on it because Playwright only checks for a
    // non-empty box. Assert the rect is actually inside the viewport.
    expect(measured.position, 'the sheet is not `absolute` — see the y=-279 trap').toBe('absolute')
    expect(measured.top, 'the sheet is rendered above the top edge of the screen').toBeGreaterThan(
      0
    )
    expect(measured.bottom, 'the sheet hangs below the viewport').toBeLessThanOrEqual(
      measured.innerHeight
    )
    expect(measured.left).toBeGreaterThanOrEqual(0)
    expect(measured.right).toBeLessThanOrEqual(measured.innerWidth)
    // Anchored to the bar, not floating: its bottom edge is the bar's top edge.
    expect(
      Math.abs(measured.bottom - measured.navTop),
      'the sheet is not flush on the bar'
    ).toBeLessThanOrEqual(2)
    expect(
      measured.overflowX,
      'the sheet absorbs a horizontally overflowing row'
    ).toBeLessThanOrEqual(0)
  })

  /**
   * ⚠️⚠️ FOUND BY CODE REVIEW. The panel's height is content-driven and anchored
   * to the bar's TOP edge, so without a cap it grows off the top of the screen —
   * and because it is out of flow, page scrolling cannot reach what it pushes
   * away. Measured on the unfixed build at 568x320 with a 24px root font: panel
   * 301px tall, top at y=-57.75, and the "Balance" row at y=-51 — off-screen,
   * un-tappable and unscrollable.
   *
   * This runs OUTSIDE the 320x720 describe on purpose: it needs a short viewport
   * AND an enlarged root font, which is exactly the combination every other
   * measurement in this file holds fixed. Reachability is proven by
   * `elementFromPoint`, never by `toBeVisible()`.
   */
  test.describe('the sheet stays reachable when it cannot fit above the bar', () => {
    for (const [w, h, root] of [
      [568, 320, 24],
      [320, 400, 24],
      [360, 320, 20],
    ] as const) {
      test(`every row is reachable at ${w}x${h} with a ${root}px root font`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h })
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

        await page
          .getByRole('navigation', { name: 'Primary' })
          .getByRole('button', { name: 'More', exact: true })
          .click()

        const measured = await page.evaluate((selector) => {
          const sheet = document.querySelector(`${selector} > ul > li > ul`) as HTMLElement
          const r = sheet.getBoundingClientRect()
          const style = globalThis.getComputedStyle(sheet)
          return {
            top: Math.round(r.top * 100) / 100,
            overflowY: style.overflowY,
            // The panel must be capped, and if content exceeds the cap it must
            // be scrollable rather than clipped.
            scrollable: sheet.scrollHeight > sheet.clientHeight,
            // Element-level: `overflow-y-auto` computes `overflow-x` to `auto`
            // too, so the panel could silently absorb an overflowing label.
            overflowX: sheet.scrollWidth - sheet.clientWidth,
            // Each row is scrolled into view within the PANEL before it is
            // hit-tested, because once the panel is capped a lower row is
            // legitimately below its fold. The claim is "reachable", not
            // "reachable without scrolling".
            //
            // ⚠️ This is NOT the tautology 31.3 warned about (a probe that
            // reaches its target by scripting the very affordance under test).
            // The affordance under test is scrollABILITY, and that is pinned
            // separately and independently by the computed `overflow-y`
            // assertion below — a check that scrolling cannot manufacture.
            // Neither subsumes the other: computed style cannot prove there is
            // anything to scroll to, and the hit test cannot prove the user is
            // allowed to scroll.
            rows: [...sheet.querySelectorAll('a')].map((a) => {
              a.scrollIntoView({ block: 'nearest' })
              const rr = a.getBoundingClientRect()
              const cx = Math.round(rr.x + rr.width / 2)
              const cy = Math.round(rr.y + rr.height / 2)
              const hit =
                cy > 0 && cy < globalThis.innerHeight ? document.elementFromPoint(cx, cy) : null
              return {
                label: a.textContent?.trim() ?? '',
                top: Math.round(rr.top),
                reachable: !!hit && (a.contains(hit) || a === hit),
              }
            }),
          }
        }, NAV)

        expect(
          measured.top,
          'the sheet is rendered off the top of the screen'
        ).toBeGreaterThanOrEqual(0)
        expect(measured.overflowY, 'the sheet cannot scroll when it does not fit').toMatch(
          /^(auto|scroll)$/
        )
        expect(
          measured.overflowX,
          'the sheet absorbs a horizontally overflowing row'
        ).toBeLessThanOrEqual(0)
        for (const row of measured.rows) {
          expect(row.reachable, `sheet row "${row.label}" is unreachable (top ${row.top})`).toBe(
            true
          )
        }
      })
    }
  })

  test('every sheet row is a >=44px target with an INSET focus ring', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More', exact: true })
      .click()

    const rows = await page.evaluate(
      (selector) =>
        [...document.querySelectorAll(`${selector} > ul > li > ul > li > a`)].map((a) => {
          // ⚠️ `lineCount` is NOT decoration, and story 43.2 proved it by mutation.
          // A sheet row is `display: flex` with a wrapping label, so a label too
          // wide for its box WRAPS instead of overflowing: `scrollWidth` never
          // exceeds `clientWidth` and the height only GROWS, which the `>= 44`
          // floor accepts. Measured under a mutation that cut the row's content
          // box to 28px (`max-sm:px-4` -> `px-32`): "Balance Tracking" went to two
          // lines at height 59 and this test stayed GREEN on every assertion it
          // had. So the two guards below cannot see a label that WRAPS — the exact
          // property 43.2's longer label needed verified.
          //
          // ⚠️ That does NOT make `overflows` dead, and code review caught this
          // comment implying it was: an UNBREAKABLE token (no space to wrap at)
          // still overflows its box and `overflows` still fires. The two guards
          // and this one cover different failures — wrappable vs unwrappable
          // content — so none of the three is redundant. Ranged over
          // the LABEL, mirroring `e2e/chrome-320.spec.ts`'s bar-cell probe: on the
          // whole anchor a correct row measures 2 rects (icon box + label), not 1.
          const label = a.querySelector('[data-nav-label]')
          const range = document.createRange()
          if (label) range.selectNodeContents(label)
          return {
            label: a.textContent?.trim() ?? '',
            height: Math.round(a.getBoundingClientRect().height),
            overflows: a.scrollWidth > a.clientWidth,
            lineCount: label ? range.getClientRects().length : -1,
          }
        }),
      NAV
    )

    expect(rows.map((r) => r.label)).toEqual([
      'Balance Tracking',
      'Net Worth',
      'Retirement',
      'Settings',
    ])
    for (const { label, height, overflows, lineCount } of rows) {
      expect(height, `sheet row "${label}" is under 44px`).toBeGreaterThanOrEqual(44)
      expect(overflows, `sheet row "${label}" overflows its box`).toBe(false)
      expect(lineCount, `sheet row "${label}" wraps to ${lineCount} lines at 320px`).toBe(1)
    }

    // The rows are new anchors and inherit NONE of the bar's ink coverage.
    // Keyboard focus so `:focus-visible` is guaranteed to match.
    let ring: string | null = null
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab')
      const found = await page.evaluate((selector) => {
        const active = document.activeElement
        if (!active?.closest(`${selector} > ul > li > ul`)) return null
        return globalThis.getComputedStyle(active).boxShadow
      }, NAV)
      if (found !== null) {
        ring = found
        break
      }
    }
    expect(ring, 'never reached a sheet row by tabbing').not.toBeNull()
    expect(hasVisibleRing(ring), `a sheet row has no visible focus ring (${ring})`).toBe(true)
    expect(ring, 'the sheet row focus ring is outset — clipped at the viewport edge').toContain(
      'inset'
    )
  })
})

/**
 * `sm:contents` on BOTH the wrapper `<li>` and the nested `<ul>` is what makes
 * the nested structure legal — it dissolves them into the one desktop flex row.
 * Measured by mutation: without it the desktop nav goes 52px -> 160px at 1280px
 * (140 computed diffs) and NOT ONE of the 69 tests across this file,
 * `global-nav.spec.ts` and `responsive-320.spec.ts` went red.
 */
test('the nested sheet list DISSOLVES into the desktop row at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const measured = await page.evaluate((selector) => {
    const nav = document.querySelector(selector)
    const wrapper = nav.querySelector(':scope > ul > li:last-child')
    const sheet = nav.querySelector(':scope > ul > li > ul')
    const trigger = nav.querySelector('button')
    const anchors = [...nav.querySelectorAll('a')]
    return {
      wrapperDisplay: globalThis.getComputedStyle(wrapper).display,
      sheetDisplay: globalThis.getComputedStyle(sheet).display,
      triggerDisplay: globalThis.getComputedStyle(trigger).display,
      navHeight: Math.round(nav.getBoundingClientRect().height * 100) / 100,
      // All eight anchors on ONE row: same y, ascending x, none clipped.
      ys: [...new Set(anchors.map((a) => Math.round(a.getBoundingClientRect().y)))],
      count: anchors.length,
      // Icons are mobile-only elements; a stray one adds 24px to every cell.
      visibleIcons: [...nav.querySelectorAll('svg')].filter(
        (svg) => globalThis.getComputedStyle(svg).display !== 'none'
      ).length,
    }
  }, NAV)

  expect(measured.wrapperDisplay, 'the sheet wrapper <li> did not dissolve').toBe('contents')
  expect(measured.sheetDisplay, 'the nested <ul> did not dissolve').toBe('contents')
  expect(measured.triggerDisplay, 'the mobile-only More trigger reached the desktop row').toBe(
    'none'
  )
  expect(measured.count).toBe(8)
  expect(measured.ys, 'the desktop nav is no longer one row').toHaveLength(1)
  expect(measured.visibleIcons, 'an icon is missing `sm:hidden` and reached desktop').toBe(0)
  expect(measured.navHeight, 'the desktop nav grew — a dissolution or icon regression').toBe(52)
})

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
    // ⚠️ Anchored to the BAR's outer list explicitly. `nav.querySelector('li')`
    // and `nav.querySelector('a')` return the first in DOCUMENT order, which is
    // only the bar's first cell as long as the sheet happens to come later in
    // source. Reorder the JSX and those helpers would silently start measuring
    // SHEET elements while still reading perfectly plausibly.
    const item = nav.querySelector(':scope > ul > li') as HTMLElement
    const link = nav.querySelector(':scope > ul > li > a') as HTMLElement
    const n = globalThis.getComputedStyle(nav)
    const l = globalThis.getComputedStyle(link)
    return {
      // nav: max-sm:fixed / inset-x-0 / z-50 / border-t
      navPosition: n.position,
      navLeft: n.left,
      navRight: n.right,
      navZIndex: n.zIndex,
      navBorderTopWidth: n.borderTopWidth,
      // ⚠️⚠️ `navHeight` and `linkHeight` are the two properties whose ABSENCE
      // made this partition blind to the redesign's two worst failure modes.
      // Measured by mutation against a green control: icons rendered without
      // `sm:hidden` take the desktop nav 52px -> 76px at 1280px (every anchor
      // 36 -> 60px, 212 computed diffs) and the nested `<ul>` without
      // `sm:contents` takes it 52px -> 160px (140 diffs) — and in BOTH cases
      // ZERO of the 69 tests across this file, `global-nav` and `responsive-320`
      // went red, including the test named "the desktop cascade is untouched"
      // directly below, because nothing anywhere read a height.
      navHeight: `${Math.round(nav.getBoundingClientRect().height * 100) / 100}px`,
      linkHeight: `${Math.round(link.getBoundingClientRect().height * 100) / 100}px`,
      // li: max-sm:min-w-0
      itemMinWidth: globalThis.getComputedStyle(item).minWidth,
      // link: max-sm:flex / flex-col / items-center / justify-center /
      // text-center / text-[11px] / leading-tight / px-1 / break-words /
      // rounded-none
      linkDisplay: l.display,
      // ⚠️ `flex-col` is the single token this whole redesign turns on, and this
      // helper did not read `flex-direction` before 31.5 — the file's own thesis
      // is that a token with no assertion is a missing guard.
      linkFlexDirection: l.flexDirection,
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

/** Measured at 320px on the 31.5 five-tab mobile bar; matched exactly. */
const MOBILE_STYLES = {
  navPosition: 'fixed',
  navLeft: '0px',
  navRight: '0px',
  // Raised from 40 in 31.5: at z-40 the z-50 InstallPrompt banner painted over
  // the open More sheet and swallowed the whole "Retirement" row.
  navZIndex: '50',
  navBorderTopWidth: '1px',
  // py-2 16 + h-6 icon 24 + gap-0.5 2 + 11px label at leading-tight 13.75 + 1px
  // border-t. The cell is the same stack without the nav's border.
  navHeight: '56.75px',
  linkHeight: '55.75px',
  itemMinWidth: '0px',
  linkDisplay: 'flex',
  linkFlexDirection: 'column',
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
  // Unchanged from `main` at 1280px, and the assertion that finally has teeth
  // against a stray icon or a dissolved-list regression.
  navHeight: '52px',
  linkHeight: '36px',
  itemMinWidth: 'auto',
  linkDisplay: 'inline-block',
  linkFlexDirection: 'row',
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
