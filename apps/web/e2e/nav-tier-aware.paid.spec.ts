import { type Page, expect, test } from '@playwright/test'

/**
 * The tier-aware nav, measured on a REAL paid session (story 58.1, AC-5/AC-6).
 *
 * ## Why this file is named `.paid.spec.ts`
 *
 * Tier is a SERVER-side fact: `GlobalNav` reads it from the SSR session seed, so
 * no amount of browser-side setup can produce a paid nav. `playwright.config.ts`
 * therefore runs two dev servers — the default one on :5173 with no override, and
 * a second on :5174 booted with `E2E_SESSION_SEED` set to an entitled session via
 * the dev-only seam in `server/api/auth/session-seed.ts`. The `chromium-paid`
 * project matches `*.paid.spec.ts` and points `baseURL` at :5174.
 *
 * ⚠️ Rename this file and it silently runs against the FREE server, where the nav
 * has 7 anchors — and several assertions below would still pass. The negative
 * control at the bottom exists precisely so that misconfiguration cannot hide.
 *
 * ## What this file proves, and what it does not
 *
 * It proves the CSS and layout survive 11 anchors / 7 sheet rows. It does NOT
 * prove the component picks the right destinations for the right tier — that is
 * jsdom's job in `components/layout/__tests__/GlobalNav.test.tsx`, which asserts
 * the list contents, order, hrefs and fail-closed arms. Neither half covers the
 * other; do not cite one as evidence for the other.
 *
 * ⚠️ Every width below is font-dependent. CI resolves `system-ui` to DejaVu Sans;
 * this repo's dev boxes resolve the narrower Noto Sans. Reproduce with
 * `FONTCONFIG_FILE` before trusting any number measured locally.
 */

const NAV = 'nav[aria-label="Primary"]'
const MORE_TRIGGER = `${NAV} button`
const SHEET = `${NAV} > ul > li > ul`
const STORAGE_KEY = 'budget-planner-planner-visibility-v1'

/** The free server, for the negative control. Absolute: this project's baseURL is :5174. */
const FREE_ORIGIN = 'http://localhost:5173'

async function gotoNav(page: Page, url = '/'): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  await expect(page.locator(NAV)).toBeVisible()
}

/** Anchor count in the nav, regardless of which are CSS-hidden at this width. */
async function anchorCount(page: Page): Promise<number> {
  return page.locator(`${NAV} a`).count()
}

test.describe('the paid nav really is the paid nav', () => {
  // The precondition every other test in this file rests on. If the seam stops
  // working, this fails FIRST and unambiguously, instead of leaving the
  // geometry assertions quietly measuring a 7-anchor row.
  test('the seam delivers an entitled session — 11 anchors, 7 sheet rows', async ({ page }) => {
    await gotoNav(page)

    expect(await anchorCount(page)).toBe(11)
    await expect(page.locator(`${SHEET} > li`)).toHaveCount(7)

    for (const path of ['/forecasting', '/profiles', '/report', '/categories']) {
      await expect(
        page.locator(`${NAV} li[data-nav-path="${path}"]`),
        `${path} missing from the paid nav`
      ).toHaveCount(1)
    }
  })

  // ⚠️ THE NEGATIVE CONTROL. Without it, a seam that silently stopped working
  // would leave every "paid" assertion above passing against the free nav.
  test('the FREE server on :5173 is unaffected — still 7 anchors, 3 sheet rows', async ({
    page,
  }) => {
    await gotoNav(page, `${FREE_ORIGIN}/`)

    expect(await anchorCount(page)).toBe(7)
    await expect(page.locator(`${SHEET} > li`)).toHaveCount(3)
    for (const path of ['/forecasting', '/profiles', '/report', '/categories']) {
      await expect(
        page.locator(`${NAV} li[data-nav-path="${path}"]`),
        `${path} leaked into the FREE nav`
      ).toHaveCount(0)
    }
  })
})

/**
 * AC-6 — the desktop row at 11 anchors.
 *
 * ⚠️⚠️ MEASURED FINDING (story 58.1, re-measured by story 59.1, under CI fonts):
 * **the paid row has NO single-row width. It is two rows at every desktop
 * viewport.** Story 59.1 shortened one label and that is STILL true.
 *
 *   viewport   rows  list clientWidth (59.1, DejaVu)
 *   1024px      2         846px
 *   1152px      2         966px
 *   1280px      2         966px
 *   1440–2400   2         966px   (saturated)
 *
 * TRUE intrinsic width, measured at a 2400px viewport with `flex-wrap: nowrap`,
 * `flex-shrink: 0` ON THE `<li>` (see the trap below) AND the `max-w-6xl` cap
 * lifted. Both labels are measured in ONE page session, swapping only the
 * `/balance` label's text node, so the arms share viewport, fonts, tier and
 * hydration. (Controlled, not identical: the "before" arm is a text-node swap on
 * the post-change build, not the pre-change build. What actually validates it is
 * the agreement with 58.1's independent figures, noted below.)
 *
 *                       anchors+gaps   + list px-4   = total needed   available   short by   rows
 *   DejaVu/CI  before      1050.23px       32px         1082.23px       966px     116.23px     2
 *   DejaVu/CI  AFTER        994.80px       32px         1026.80px       966px      60.80px     2
 *   Noto/dev   before      1004.75px       32px         1036.75px       965px      71.75px     2
 *   Noto/dev   AFTER        952.31px       32px          984.31px       965px      19.31px     2
 *
 * (The "anchors+gaps" column is kept because the record elsewhere quotes the gap
 * both ways — 1082.23 vs 966 INCLUDING the list's `px-4`, or 1050.23 vs 934
 * excluding it. Same shortfall; say which you mean.)
 *
 * So 59.1's rename ("Balance Tracking" -> "Balances") is worth a measured
 * **55.43px under CI fonts** (52.44px on Noto) — real, reproducible, and **NOT
 * enough**: 60.80px of shortfall remain and the row is still two rows at every
 * width. Closing it is story 59.2's job, not this rename's.
 *
 * ⚠️ Every figure above is 59.1's own measurement, INCLUDING the 846px at 1024px
 * that happens to equal 58.1's — it was re-measured, not carried forward.
 *
 * ⚠️ 58.1 recorded available as 973px where 59.1 measures **966px**, and the
 * 60.80px shortfall DOES depend on which you use (against 973 it would be 53.80).
 * So this is a live 7px uncertainty, not a rounding note — do not repeat 59.1's
 * first framing of it as "nothing depends on it". What is known: the delta
 * appears ONLY in the saturated rows (>= 1152px), while 1024px matches 58.1
 * exactly. That points at the capped header the list shares with `AuthIndicator`,
 * not at harness noise. 59.2 inherits this; resolve it there if the exact figure
 * matters, and quote 966px until then.
 *
 * ⚠️ `flex-wrap: nowrap` ALONE gives a WRONG answer here, and the first pass of
 * this measurement fell for it: the header is capped at `sm:max-w-6xl`, so with
 * shrink still enabled the anchors simply compress and the measurement reports
 * roughly the container's own width back at you (it read 990px — an artifact
 * ~93px below the truth, which made the shortfall look like a trivial 17px).
 * Disable shrink and lift the cap, or do not trust the number. This is the same
 * trap `nav-responsive-css.spec.ts` warns about for the 7-anchor row.
 *
 * ⚠️⚠️ AND THE SHARPER FORM OF IT, which cost story 59.1 three wrong runs:
 * **the flex ITEMS are the `<li>`, not the `<a>`.** `flex-shrink: 0` applied to
 * the anchors alone leaves every `<li>` free to compress, so a TWO-WORD label
 * WRAPS and then measures as its longest word. "Balance Tracking" read **58.3px**
 * that way — NARROWER than "Balances" at 63.14px — i.e. the harness reported that
 * shortening the label made the row WIDER, reproducibly and with zero drift
 * across an A/B/A cycle. A stable, repeatable number is not a correct one. Kill
 * shrink on the `li` (and pin `white-space: nowrap` on `[data-nav-label]`).
 *
 * The reason it never resolves is structural, not a matter of finding a wider
 * screen: `__root.tsx` caps the header row at `sm:max-w-6xl` (1152px) and shares
 * it with `AuthIndicator`, so the nav list saturates at **966px** of available
 * width. Widening the viewport past 1152px changes nothing.
 *
 * So the 7-anchor row's "single-row threshold" column (821px viewport, recorded in
 * `nav-responsive-css.spec.ts`) has no 11-anchor counterpart. Do not go looking
 * for one; it does not exist at any width.
 *
 * Consequence, accepted when this shipped: a paying user's desktop nav is 92px
 * tall instead of 52px, on every page. It is legible, overflows nothing and every
 * clearance guard passes — but it is a visible change and it was a decision, not
 * an oversight.
 *
 * ⚠️ A future story tempted to "reclaim" the single row should know the gap is
 * **60.80px under CI fonts after 59.1** (116.23px before it), not a rounding
 * error. The ten `gap-1` gutters are 40px in total and `px-4` is 32px, so
 * trimming spacing cannot close it — only shorter labels, fewer destinations, or
 * raising the `max-w-6xl` cap could, and the last of those moves every page's
 * content column. 59.1 took the "shorter labels" option as far as one label goes
 * and it was not enough. The row budget below is therefore a CEILING of 2, not a
 * pin at 2: it catches a third row without pretending one row is within reach.
 *
 * ⚠️ Every figure above was measured, not converted — the DejaVu ones under
 * `FONTCONFIG_FILE`, with a positive control confirming the override actually
 * reached Chromium. 59.1's control: the string **"Balance Tracking"** rendered in
 * an offscreen span at `500 14px system-ui` measures **118.58px under DejaVu vs
 * 110.84px under Noto**, and the whole-row totals differ accordingly (1082.23 vs
 * 1036.75 before the rename). Without that control a silently-ignored font
 * override is indistinguishable from a working one.
 *
 * ⚠️ The strongest check on these numbers is not repetition, it is AGREEMENT
 * BETWEEN INDEPENDENT PROBES. Two hold here: the span control's 118.58 − 63.14 =
 * 55.44 matches the whole-row saving of 55.43; and the harness reproduces 58.1's
 * separately-recorded totals (1082.23 vs 1083, 1036.75 vs 1037). 59.1's broken
 * harness passed neither, while being perfectly repeatable.
 *
 * ⚠️ THE HARNESS IS IN THE TREE: `e2e/nav-intrinsic-width.measure.paid.spec.ts`
 * (and `.measure.spec.ts` for the free row), sharing `e2e/helpers/nav-width.ts`.
 * Re-run those rather than writing a fourth one-off — 58.1's and 59.1's were both
 * deleted after recording, which is why 59.1 rebuilt the method wrong.
 */
test.describe('desktop cascade at 11 anchors (AC-6)', () => {
  // ⚠️ Titled for what it MEASURES. An earlier title said "reports the intrinsic
  // width" — it does not: the intrinsic figure in the docblock came from a
  // separate one-off harness (nowrap + `flex-shrink: 0` + cap lifted) that is not
  // encoded here, so that number has no regression guard and the title implied it
  // did.
  test('wraps to at most two rows at 1280px, with no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoNav(page)

    const measured = await page.evaluate((selector) => {
      const list = document.querySelector(`${selector} > ul`) as HTMLElement | null
      if (!list) return null
      const anchors = [...list.querySelectorAll('a')]
      // Distinct top offsets = wrapped row count. Reading `height` alone cannot
      // distinguish one tall row from two short ones.
      const rows = new Set(anchors.map((a) => Math.round(a.getBoundingClientRect().top)))
      return {
        rowCount: rows.size,
        listHeight: Math.round(list.getBoundingClientRect().height),
        anchors: anchors.length,
        listOverflow: list.scrollWidth - list.clientWidth,
        documentOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wrap: globalThis.getComputedStyle(list).flexWrap,
      }
    }, NAV)

    expect(measured, 'nav list not found').not.toBeNull()
    const m = measured as NonNullable<typeof measured>

    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log('[58.1 AC-6] 1280px paid row:', JSON.stringify(m))

    expect(m.anchors, 'not measuring the paid nav').toBe(11)
    expect(m.wrap, 'flex-wrap is no longer containing the row').toBe('wrap')
    // A CEILING, not a pin. Two rows is the measured, accepted state; three would
    // be a real degradation of every page's header. If a future change closes the
    // 60.80px gap (116.23px before story 59.1 shortened one label) and this drops
    // to one row, update the table above — a pass at 1 row is an improvement,
    // not a failure.
    expect(m.rowCount, 'the paid desktop nav has grown past two rows').toBeLessThanOrEqual(2)
    // Two-sided: the row must not overflow its own box, and the document must
    // not gain a horizontal scrollbar because of it.
    expect(m.listOverflow, 'the nav list overflows its own box at 1280px').toBeLessThanOrEqual(0)
    expect(m.documentOverflow, 'the document is wider than 1280px').toBeLessThanOrEqual(0)
  })

  // The existing wrap guard's premise, re-checked at the new anchor count: four
  // more anchors must not turn wrapping into overflow at the narrow end of the
  // desktop cascade.
  for (const width of [640, 700, 760]) {
    test(`the paid row still wraps inside a ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 })
      await gotoNav(page)

      const m = await page.evaluate((selector) => {
        const list = document.querySelector(`${selector} > ul`) as HTMLElement | null
        if (!list) return null
        const rights = [...list.querySelectorAll('a')].map((a) => a.getBoundingClientRect().right)
        return {
          listOverflow: list.scrollWidth - list.clientWidth,
          widestLinkRight: Math.max(...rights),
          innerWidth: globalThis.innerWidth,
          documentOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      }, NAV)

      expect(m).not.toBeNull()
      const r = m as NonNullable<typeof m>
      expect(r.listOverflow, `the nav list overflows its box at ${width}px`).toBeLessThanOrEqual(0)
      expect(
        r.widestLinkRight,
        `a nav link paints past the ${width}px viewport edge`
      ).toBeLessThanOrEqual(r.innerWidth)
      expect(r.documentOverflow, `the document is wider than ${width}px`).toBeLessThanOrEqual(0)
    })
  }
})

/**
 * AC-5 — the "More" sheet at 7 rows.
 *
 * The sheet is `max-sm:absolute`, anchored to the TOP edge of the bar, with a
 * `max-h-[calc(100svh-5rem)]` cap and `overflow-y-auto`. At 3 rows none of that
 * was load-bearing; at 7 it can be. The failure mode the cap prevents is the
 * panel growing off the TOP of the screen — out of flow, so page scrolling cannot
 * reach it, and `toBeVisible()` passes on it anyway.
 *
 * MEASURED at 7 rows, on the real paid nav, 640px-tall viewports (the figures the
 * assertions below are derived from — recorded here rather than left in test
 * stdout, where nobody reads them):
 *
 *   viewport  rows  sheet height  top   last row bottom  min row  overflowX  scrolls
 *   320x640    7       345px      239        580px         48px       0        no
 *   360x640    7       345px      239        580px         48px       0        no
 *   390x640    7       345px      239        580px         48px       0        no
 *   412x640    7       345px      239        580px         48px       0        no
 *
 * So at a normal phone height the 7-row sheet still fits inside the cap with room
 * to spare — the cap and the scroll path only engage on SHORT viewports, which is
 * why they get their own test below rather than riding along on these.
 *
 * ⚠️ Row height is 48px against a `min-h-[44px]` target, so the 44px floor holds
 * at 7 rows with 4px of slack — not a coincidence worth relying on if the row
 * padding ever changes.
 */
test.describe('the More sheet at 7 rows (AC-5)', () => {
  for (const width of [320, 360, 390, 412]) {
    test(`every row is on-screen and reachable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 })
      await gotoNav(page)
      await page.locator(MORE_TRIGGER).click()

      const m = await page.evaluate(
        (sel) => {
          const sheet = document.querySelector(sel.sheet) as HTMLElement | null
          if (!sheet) return null
          const rows = [...sheet.querySelectorAll(':scope > li > a')] as HTMLElement[]
          const box = sheet.getBoundingClientRect()
          return {
            rows: rows.length,
            sheetTop: Math.round(box.top),
            sheetHeight: Math.round(box.height),
            scrollable: sheet.scrollHeight > sheet.clientHeight,
            // Horizontal absorption: `overflow-y-auto` makes this a scroll
            // container on BOTH axes, so an over-wide label would be swallowed
            // silently rather than overflowing visibly.
            overflowX: sheet.scrollWidth - sheet.clientWidth,
            // The LAST row is the one the cap strands if it is wrong.
            lastRowBottom: Math.round(rows[rows.length - 1].getBoundingClientRect().bottom),
            minRowHeight: Math.min(
              ...rows.map((r) => Math.round(r.getBoundingClientRect().height))
            ),
            viewportHeight: globalThis.innerHeight,
          }
        },
        { sheet: SHEET }
      )

      expect(m).not.toBeNull()
      const r = m as NonNullable<typeof m>

      // eslint-disable-next-line no-console -- the measurement IS the deliverable
      console.log(`[58.1 AC-5] ${width}px sheet:`, JSON.stringify(r))

      expect(r.rows, 'not measuring the paid sheet').toBe(7)
      // The cap's whole job: the panel's top edge stays on screen.
      expect(r.sheetTop, 'the sheet has grown off the top of the screen').toBeGreaterThanOrEqual(0)
      expect(r.lastRowBottom, 'the last sheet row paints below the viewport').toBeLessThanOrEqual(
        r.viewportHeight
      )
      expect(r.overflowX, 'the sheet absorbed horizontal overflow').toBeLessThanOrEqual(0)
      // Every row keeps a real 44px touch target at 7 rows, not just at 3.
      expect(r.minRowHeight, 'a sheet row fell below the 44px target').toBeGreaterThanOrEqual(44)
    })
  }

  /**
   * The case the cap and `overflow-y-auto` actually exist for.
   *
   * ⚠️ This test used to run at 320x480 and was VACUOUS — code review caught it.
   * There the cap is `100svh - 5rem` = 400px and the 7-row sheet measures 345px,
   * so it fits, `scrollIntoViewIfNeeded()` is a no-op and `toBeInViewport()` is
   * trivially true. Deleting `max-h-[…]` and `overflow-y-auto` from the sheet
   * left it green. A test for a scroll container has to pick a viewport where the
   * content genuinely overflows, and then assert that it scrolled.
   *
   * 320x400 puts the cap at 320px against ~345px of rows. The landscape phone
   * case (568x320, cap 240px) is tighter still and is the shape the component's
   * own docblock records as having stranded rows off the TOP of the screen before
   * the cap existed.
   */
  for (const [width, height] of [
    [320, 400],
    [568, 320],
  ]) {
    test(`scrolls rather than stranding rows at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await gotoNav(page)
      await page.locator(MORE_TRIGGER).click()

      const sheet = page.locator(SHEET)
      const rows = sheet.locator(':scope > li > a')

      const m = await sheet.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        top: Math.round(el.getBoundingClientRect().top),
        overflowY: globalThis.getComputedStyle(el).overflowY,
      }))

      // eslint-disable-next-line no-console -- the measurement IS the deliverable
      console.log(`[58.1 AC-5] ${width}x${height} sheet:`, JSON.stringify(m))

      // THE PRECONDITION. Without it the rest passes on a sheet that never
      // overflowed, which is exactly how this test was vacuous before.
      expect(
        m.scrollHeight,
        `the sheet does not overflow at ${width}x${height} — this test proves nothing here, pick a shorter viewport`
      ).toBeGreaterThan(m.clientHeight)
      expect(m.overflowY, 'the sheet is not a scroll container').toBe('auto')
      // The cap's job: the panel's top edge stays on screen instead of growing
      // off the top, where page scrolling cannot reach it.
      expect(m.top, 'the sheet has grown off the top of the screen').toBeGreaterThanOrEqual(0)

      // And with real overflow, both ends are still reachable BY SCROLLING.
      const first = rows.first()
      const last = rows.last()
      await last.scrollIntoViewIfNeeded()
      await expect(last).toBeInViewport()
      await first.scrollIntoViewIfNeeded()
      await expect(first).toBeInViewport()
    })
  }

  /**
   * AC-5's third limb: the bar/sheet/`InstallPrompt` z-index coupling, re-measured
   * at SEVEN rows.
   *
   * ⚠️ Why this could not be inherited. `global-nav.spec.ts:459` already proves
   * every sheet row stays tappable underneath the PWA install banner — but it
   * runs in the `chromium` project, against the THREE-row free sheet. Citing it
   * for the paid sheet would be a true measurement of an adjacent claim: the
   * 7-row sheet is roughly twice as tall and overlaps far more of the banner.
   * `toBeVisible()` and geometry assertions are both blind to occlusion, so the
   * probe has to be `elementFromPoint` per row.
   */
  test('every row of the 7-row sheet stays tappable under the InstallPrompt banner', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await gotoNav(page)

    // ⚠️ Fire the REAL `beforeinstallprompt` so the REAL `InstallPrompt` renders,
    // exactly as `global-nav.spec.ts` does. A hand-built stand-in appended to
    // `document.body` is not equivalent and this test failed against one: the
    // nav and the banner are BOTH `z-50`, so the tie is broken by DOM order, and
    // `__root.tsx` renders `<InstallPrompt/>` (`:195`) BEFORE `<GlobalNav/>`
    // (`:266`) precisely so the nav wins it. Appending to `body` puts the
    // stand-in after the nav and inverts that — manufacturing an occlusion the
    // real app does not have.
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt') as Event & {
        prompt?: () => Promise<void>
        userChoice?: Promise<{ outcome: string; platform: string }>
      }
      event.prompt = async () => {}
      event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' })
      globalThis.dispatchEvent(event)
    })
    await expect(page.getByRole('region', { name: /install/i })).toBeVisible()

    await page.locator(MORE_TRIGGER).click()

    const probe = await page.evaluate((sel) => {
      const sheet = document.querySelector(sel) as HTMLElement | null
      const bannerEl = document.querySelector('section[aria-label*="Install"]')
      if (!sheet || !bannerEl) return null
      const b = bannerEl.getBoundingClientRect()
      const s = sheet.getBoundingClientRect()
      return {
        // Anti-vacuity: at 7 rows the sheet is far taller than at 3, but if the
        // two do not actually overlap this proves nothing and must be re-tuned
        // rather than left green.
        overlaps: s.top < b.bottom && b.top < s.bottom,
        rows: [...sheet.querySelectorAll(':scope > li > a')].map((a) => {
          const r = a.getBoundingClientRect()
          const hit = document.elementFromPoint(
            Math.round(r.x + r.width / 2),
            Math.round(r.y + r.height / 2)
          )
          return { label: a.textContent?.trim() ?? '', hitsSelf: a.contains(hit) || a === hit }
        }),
      }
    }, SHEET)

    expect(probe, 'nav/sheet/banner not all present').not.toBeNull()
    const p = probe as NonNullable<typeof probe>
    expect(p.overlaps, 'sheet and banner do not overlap — this test proves nothing here').toBe(true)
    expect(p.rows).toHaveLength(7)
    for (const row of p.rows) {
      expect(row.hitsSelf, `"${row.label}" is occluded — a tap there lands elsewhere`).toBe(true)
    }
  })
})

/**
 * Tier and the Retirement preference are independent filters on one list, so the
 * PRODUCT of the two needs its own measurement — 10 anchors, 6 sheet rows.
 */
test('paid session with the Retirement planner hidden: 10 anchors, 6 rows', async ({ page }) => {
  await page.addInitScript(
    ({ key }) => {
      localStorage.setItem(
        key,
        JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
      )
    },
    { key: STORAGE_KEY }
  )
  await page.setViewportSize({ width: 1280, height: 720 })
  await gotoNav(page)

  expect(await anchorCount(page)).toBe(10)
  await expect(page.locator(`${SHEET} > li`)).toHaveCount(6)
  await expect(page.locator(`${NAV} li[data-nav-path="/retirement"]`)).toHaveCount(0)
  // The premium four are unaffected by a preference that is not about them.
  await expect(page.locator(`${NAV} li[data-nav-path="/report"]`)).toHaveCount(1)
})
