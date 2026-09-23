import { type Page, expect, test } from '@playwright/test'
import { MORE_SUMMARY } from './helpers/nav-more'

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
 *     640px specifically guards the narrow end of the desktop row. Until story
 *     59.2 the row was two lines from 640px to ~857px and `flex-wrap` was what
 *     held it (removing the class was measured at 138px of document overflow at
 *     640px). Since 59.2 the row is five items and fits on one line at 640px,
 *     with only 2.81px to spare under CI fonts (see the record below).
 *     `responsive-320.spec.ts` and `global-nav.spec.ts` sweep 320px only, so
 *     nothing else would see this.
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
 * `<ul>` (the "More" sheet) inside its fifth `<li>`. It was dissolved at
 * >= 640px with `sm:contents` until story 59.2. Since 59.2 it is the panel of
 * that cell's `<details>` at every width. Every helper here is anchored with
 * `:scope >` rather than `nav.querySelector('ul'|'a')`, which returns the first
 * match in DOCUMENT order and would silently start measuring sheet elements if
 * the JSX were reordered. And note that CSS queries match hidden elements: with
 * the sheet closed `nav a` still counts 7 (a closed `<details>` hides its
 * content from role locators and `checkVisibility()`, not from CSS), so any
 * count assertion must distinguish bar from sheet structurally rather than by
 * number.
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
  /**
   * The sheet must be CLOSED on the first frame (story 31.5, AC-9).
   *
   * ⚠️ Since story 59.2 "closed" is the native `<details>` state, so it is read
   * two ways, and computed `display` is NOT one of them. A closed `<details>`
   * leaves its panel's own `display` untouched (`block`). Chromium hides the
   * content through the `::details-content` slot instead, and
   * `checkVisibility()` is what sees that.
   */
  sheetVisible: boolean | null
  detailsOpen: boolean | null
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
    const details = nav.querySelector(':scope > ul > li > details') as HTMLDetailsElement | null
    const sheet = details?.querySelector(':scope > ul') ?? null
    const trigger = details?.querySelector(':scope > summary') ?? null
    return {
      position: globalThis.getComputedStyle(nav).position,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom },
      innerHeight: globalThis.innerHeight,
      sheetVisible: sheet ? sheet.checkVisibility() : null,
      detailsOpen: details ? details.open : null,
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
                const details = nav.querySelector(
                  ':scope > ul > li > details'
                ) as HTMLDetailsElement | null
                const sheet = details?.querySelector(':scope > ul') ?? null
                const trigger = details?.querySelector(':scope > summary') ?? null
                return {
                  position: globalThis.getComputedStyle(nav).position,
                  rect: { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom },
                  innerHeight: globalThis.innerHeight,
                  sheetVisible: sheet ? sheet.checkVisibility() : null,
                  detailsOpen: details ? details.open : null,
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
      // Both reads must be non-null: `null` means the `<details>` was not found,
      // and a missing element must not pass as "closed".
      expect(dcl.sheetVisible, 'the More sheet is not closed on the first painted frame').toBe(
        false
      )
      expect(dcl.detailsOpen, 'the More disclosure is not closed at first paint').toBe(false)

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

  // THE DESKTOP ROW — the single live record of its widths. The paid-tier
  // figures live in `nav-tier-aware.paid.spec.ts`. Since story 59.2 both tiers
  // have the SAME five-item row, so the numbers agree by construction; each
  // file carries its own tier's measurement run.
  //
  //                        row's intrinsic width   single-row from
  //   before 43.2 (DejaVu)        753px                857px
  //   after  43.2 (DejaVu)        815px                920px
  //   after  43.3 (DejaVu)        717px                821px   (stale by 59.1 — see below)
  //   after  59.1 (DejaVu)     661.19px                857px
  //   after  59.2 (DejaVu)     441.58px                640px   (five items: one row everywhere)
  //   after  59.2 (Noto)       425.13px                640px
  //
  // Story 59.2 (FR90) took the More destinations OUT of the desktop row. Until
  // then `sm:contents` dissolved the sheet into it, so every free destination
  // was an item of this row. Now the row is Overview · Income · Expenses ·
  // Savings · More at every width, and the other rows are an overlay panel.
  // Measured by `e2e/nav-intrinsic-width.measure.spec.ts`, which 59.2 re-scoped
  // from "every `nav a`" to the row's five flex items. The old version would
  // have summed the hidden panel anchors and left out the `<summary>`. Run it;
  // do not hand-roll a new one.
  //
  // SIGNED OUT (the "Sign in" + "Upgrade" cluster, which cannot shrink):
  //   viewport   header inner   account cluster   available   headroom (DejaVu)
  //    640px         640            195.61          444.39          2.81px
  //    700px         700            195.61          504.39         62.81px
  //    760px         760            195.61          564.39        122.81px
  //   >= 1152px     1152 (cap)      195.61          956.39        514.81px
  //   (Noto: cluster 189.80, headroom 25.07px at 640px.)
  //
  // SIGNED IN (story 59.2 code review; `/api/auth/me` mocked, long email,
  // Premium pill, DejaVu). Before the fix the row WRAPPED: 3 rows at 640px and
  // 2 up to ~849px. Neither header flex item was barred from shrinking, the
  // nav had the larger basis, and it wrapped while the email's `truncate` never
  // engaged. Now the nav is `sm:shrink-0` and the account strip `sm:min-w-0`, so
  // the EMAIL yields: 50px of it is visible at 640px, 110px at 700, 210px at
  // 800, and all 335px from ~1024px. The row is one line at every width. The
  // signed-in cluster has no fixed width, so it gets no "available" column.
  // Guarded by the signed-in sweeps in `nav-more-disclosure{,.paid}.spec.ts`,
  // every 5px from 640 to 1400px.
  //
  // ⚠️⚠️ SIGNED OUT, THE 640px FIT IS TIGHT: 2.81px under CI fonts. And since
  // the nav is `sm:shrink-0`, an overshoot no longer WRAPS the row. A row label
  // that grows by ~3px makes the DOCUMENT overflow sideways at 640px, because
  // the "Sign in"/"Upgrade" links cannot truncate the way an email can. So
  // `flex-wrap` is INERT at >= 640px now, and it is the no-overflow assertions
  // below (and the signed-out sweep) that catch an overshoot.
  //
  // ⚠️ "available" is `headerInner − accountCluster`, measured directly. It is
  // NOT the list's `clientWidth`: since 59.2 the list sizes to its content,
  // because the nav is not `flex-1` and the header is `justify-between`. See
  // `helpers/nav-width.ts`.
  //
  // ⚠️ The 59.1 row of the table records a finding worth keeping. The THRESHOLD
  // depends on the header this list shares with `AuthIndicator`, not just on the
  // nav. Stories 58.1/58.2 changed that header without re-measuring here, and
  // the 43.3 threshold (821px) had gone stale by ~92px before 59.1 noticed.
  // Intrinsic width is a property of the nav alone; the threshold is not.
  //
  // ⚠️ Every figure above was MEASURED, at a viewport WIDER than the row, on the
  // build under test. Do not carry one forward as an estimate: 43.3 found two
  // further copies of the pre-43.2 "778px" in `GlobalNav.tsx` that had been stale
  // for months. This comment is the single live record for the free row. Do not
  // duplicate it.
  //
  // ⚠️ Note for whoever next measures an intrinsic width: `flex-wrap: nowrap`
  // ALONE lets the items shrink and reports roughly the container width back at
  // you (58.1: 990px, ~93px low), and the flex items are the `<li>`, not the
  // `<a>` (59.1 read a two-word label as NARROWER than a one-word one).
  //
  // Both a document-level AND an element-level check are made: a scroll
  // container between the list and <html> would absorb the former (31.2), while
  // the latter cannot be absorbed.
  for (const width of [640, 700, 760]) {
    test(`the desktop nav row is ONE row inside a ${width}px viewport, with no overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const measured = await page.evaluate((selector) => {
        const list = document.querySelector(`${selector} > ul`)
        if (!list) return null
        // The five ROW ITEMS, deliberately — not `list.querySelectorAll('a')`.
        // Since story 59.2 that query also returns the three anchors inside the
        // closed More panel, which are not in the row, and it skips the More
        // `<summary>`, which is.
        const items = [...list.querySelectorAll(':scope > li')]
        const rights = items.map((li) => li.getBoundingClientRect().right)
        return {
          items: items.length,
          rows: new Set(items.map((li) => Math.round(li.getBoundingClientRect().top))).size,
          listOverflow: list.scrollWidth - list.clientWidth,
          widestItemRight: Math.max(...rights),
          documentOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          innerWidth: globalThis.innerWidth,
          wrap: globalThis.getComputedStyle(list).flexWrap,
        }
      }, NAV)

      expect(measured, 'nav list not found').not.toBeNull()
      const m = measured as NonNullable<typeof measured>
      expect(m.items, 'the desktop row is not five items').toBe(5)
      expect(m.rows, `the desktop nav row wraps at ${width}px`).toBe(1)
      // Inert at >= 640px since the nav became `sm:shrink-0` (see the record
      // above). It stays pinned because the token is still shipped, and the
      // `GlobalNav.tsx` comment records why it was kept rather than removed.
      expect(m.wrap, `the desktop nav row lost \`flex-wrap\` at ${width}px`).toBe('wrap')
      expect(
        m.listOverflow,
        `the nav list overflows its own box at ${width}px`
      ).toBeLessThanOrEqual(0)
      expect(
        m.widestItemRight,
        `a nav item paints past the ${width}px viewport edge`
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
   * with the sheet closed `${NAV} a` still returns all SEVEN anchors — a count
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

    const sheetRows = await read(`${NAV} > ul > li > details > ul > li > a`)
    expect(sheetRows.map((r) => r.label)).toEqual(['Balances', 'Retirement', 'Settings'])

    // The More trigger is not an anchor (a <button> until story 59.2, a
    // <summary> since), so every anchor sweep in this file misses it —
    // including this one before 31.5 added the line below.
    const triggerRadius = await page
      .locator(MORE_SUMMARY)
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
    // Story 61.1 (FR93): the theme follows the device's `prefers-color-scheme`.
    await page.emulateMedia({ colorScheme: theme })
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
 * `rgba(0, 0, 0, 0)` and the three destinations sit on whatever scrolls past.
 */
for (const [theme, expected] of [
  ['light', 'rgb(255, 255, 255)'],
  ['dark', 'rgb(31, 41, 55)'],
] as const) {
  test(`the open More sheet paints an opaque ${theme} background of its own`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    // Story 61.1 (FR93): the theme follows the device's `prefers-color-scheme`.
    await page.emulateMedia({ colorScheme: theme })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.locator(MORE_SUMMARY).click()

    const bg = await page.evaluate(
      (selector) =>
        globalThis.getComputedStyle(document.querySelector(`${selector} > ul > li > details > ul`))
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
    await page.locator(MORE_SUMMARY).click()

    const measured = await page.evaluate((selector) => {
      const nav = document.querySelector(selector)
      const sheet = nav.querySelector(':scope > ul > li > details > ul')
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
    // ⚠️ RE-TUNED by story 43.3's code review, and the retune is the point.
    // These viewports must make the sheet OVERFLOW its `max-h` cap; removing one
    // sheet row shrank the panel ~72px (24px root) and two of the three original
    // combos silently stopped overflowing — `320x400@24` measured 228/228 and
    // `360x320@20` measured 190/190, i.e. the tests went on proving that a sheet
    // which FITS is reachable, under a describe titled "when it CANNOT fit".
    // Nothing went red because `scrollable` was collected and never asserted.
    // Measured after the retune: 228/199, 228/219, 190/179 — all three overflow.
    for (const [w, h, root] of [
      [568, 320, 24],
      [320, 340, 24],
      [360, 280, 20],
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

        await page.locator(MORE_SUMMARY).click()

        const measured = await page.evaluate((selector) => {
          const sheet = document.querySelector(
            `${selector} > ul > li > details > ul`
          ) as HTMLElement
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
        // ⚠️ THE ANTI-VACUITY GUARD. `overflow-y: auto` is satisfied by a panel
        // with nothing to scroll, so without this the whole describe passes on a
        // sheet that fits — which is exactly what happened when 43.3 removed a
        // row. This asserts the fixture still produces the condition it names.
        expect(
          measured.scrollable,
          `the sheet does not overflow at ${w}x${h}@${root}px — this fixture no longer tests the cap`
        ).toBe(true)
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
    await page.locator(MORE_SUMMARY).click()

    const rows = await page.evaluate(
      (selector) =>
        [...document.querySelectorAll(`${selector} > ul > li > details > ul > li > a`)].map((a) => {
          // ⚠️ `lineCount` is NOT decoration, and story 43.2 proved it by mutation.
          // A sheet row is `display: flex` with a wrapping label, so a label too
          // wide for its box WRAPS instead of overflowing: `scrollWidth` never
          // exceeds `clientWidth` and the height only GROWS, which the `>= 44`
          // floor accepts. Measured under a mutation that cut the row's content
          // box to 28px (`max-sm:px-4` -> `px-32`): "Balance Tracking" went to two
          // lines at height 59 and this test stayed GREEN on every assertion it
          // had. So the two guards below cannot see a label that WRAPS — the exact
          // property 43.2's longer label needed verified.
          // ⚠️ KEEP IT, but know its premise is currently dormant: story 59.1
          // renamed "Balance Tracking" -> "Balances", the LAST multi-word sheet
          // label in either tier. Every sheet label is now a single token, and a
          // single token cannot wrap at a space — it can only overflow, which the
          // `overflows` check already catches. So `lineCount` cannot fire for the
          // failure it documents until a multi-word label returns (or CSS adds
          // `overflow-wrap: anywhere` / `word-break`). It still pins one line, and
          // a future sheet label WILL be multi-word again.
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

    expect(rows.map((r) => r.label)).toEqual(['Balances', 'Retirement', 'Settings'])
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
        if (!active?.closest(`${selector} > ul > li > details > ul`)) return null
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
 * The More disclosure is a REAL overlay in the desktop row at 1280px (story
 * 59.2, AC-14).
 *
 * ⚠️ This test REPLACES "the nested sheet list DISSOLVES into the desktop row
 * at 1280px", which asserted the exact opposite: `sm:contents` on the wrapper
 * `<li>` and the nested `<ul>`, and a `display: none` trigger. That dissolve is
 * what put a paid user's eleven anchors on two rows, and removing it is the
 * story. The seam it watched is still the riskiest one in the nav, so the test
 * is rewritten rather than deleted. Its original mutation record: without
 * `sm:contents` the desktop nav went 52px -> 160px with no test red. It is kept
 * as history.
 *
 * Mutation-measured for 59.2 at 1280px (Noto). This test goes RED on every arm:
 *   (a) `sm:contents` re-added to the cell `<li>` AND the panel, on the NEW
 *       source. It does NOT bring back seven flat anchors: the `<details>`
 *       still hides the panel, so the CLOSED row is unchanged (5 items, nav
 *       52px). OPEN, the panel lands in flow: the nav goes 52px -> 160px and
 *       the page 1293px -> 1401px. Red on "the More cell dissolved into the
 *       row".
 *   (b) `sm:absolute` dropped from the panel: the open panel is IN FLOW. Red on
 *       "the desktop panel is not an overlay".
 *   (c) The whole pre-59.2 source: red on "incomplete" (there is no
 *       `<details>` to find).
 *   (d) `sm:contents` on the cell only: red on "the More cell dissolved".
 * ⚠️ The cell check runs BEFORE the row-tops check on purpose. A
 * `display: contents` `<li>` has an empty rect at y=0, so the row-tops check
 * would also go red, but as a measurement artefact, not for the stated reason.
 * Neither (a) nor (b) is visible to `DESKTOP_STYLES` below: a CLOSED panel
 * contributes no height whether it is absolute or not, which is why the
 * open-state half lives here.
 */
test('the More disclosure is a real overlay in the desktop row at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const read = () =>
    page.evaluate((selector) => {
      const nav = document.querySelector(selector) as HTMLElement
      const items = [...nav.querySelectorAll(':scope > ul > li')] as HTMLElement[]
      const cell = items.at(-1) as HTMLElement
      const details = cell.querySelector(':scope > details') as HTMLDetailsElement | null
      const panel = details?.querySelector(':scope > ul') as HTMLElement | null
      const trigger = details?.querySelector(':scope > summary') as HTMLElement | null
      return {
        itemCount: items.length,
        rowTops: [...new Set(items.map((li) => Math.round(li.getBoundingClientRect().top)))],
        cellDisplay: getComputedStyle(cell).display,
        found: details !== null && panel !== null && trigger !== null,
        triggerDisplay: trigger ? getComputedStyle(trigger).display : 'MISSING',
        panelPosition: panel ? getComputedStyle(panel).position : 'MISSING',
        panelVisible: panel ? panel.checkVisibility() : null,
        navHeight: Math.round(nav.getBoundingClientRect().height * 100) / 100,
        bodyHeight: document.body.scrollHeight,
        // Icons are mobile-only elements; a stray one adds 24px to every cell.
        visibleIcons: [...nav.querySelectorAll('svg')].filter((svg) => svg.checkVisibility())
          .length,
      }
    }, NAV)

  const closed = await read()
  expect(closed.found, 'the More <details>/<summary>/<ul> is incomplete').toBe(true)
  expect(closed.itemCount, 'the desktop row is not five items').toBe(5)
  expect(closed.cellDisplay, 'the More cell dissolved into the row').not.toBe('contents')
  expect(closed.rowTops, 'the desktop row wraps').toHaveLength(1)
  expect(closed.triggerDisplay, 'the More trigger is hidden on desktop').not.toBe('none')
  expect(closed.panelVisible, 'the panel is showing while closed').toBe(false)
  expect(closed.visibleIcons, 'an icon is missing `sm:hidden` and reached desktop').toBe(0)
  expect(closed.navHeight, 'the desktop nav height moved — an icon or layout regression').toBe(52)

  await page.locator(MORE_SUMMARY).click()
  const open = await read()
  expect(open.panelVisible, 'the panel did not open').toBe(true)
  expect(open.panelPosition, 'the desktop panel is not an overlay').toBe('absolute')
  expect(open.navHeight, 'opening the panel grew the bar — it is in flow').toBe(closed.navHeight)
  expect(open.bodyHeight, 'opening the panel pushed the page down').toBe(closed.bodyHeight)
  expect(open.visibleIcons, 'a panel-row icon is visible on desktop').toBe(0)
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
      // `sm:contents` took it 52px -> 160px (140 diffs; the pre-59.2 dissolve,
      // now replaced by an overlay panel) — and in BOTH cases
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
  // against a stray icon. ⚠️ Since story 59.2 it is BLIND to the panel: a closed
  // `<details>` contributes no height whether its panel is an overlay or in
  // flow. The open-panel half is "the More disclosure is a real overlay" above.
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
