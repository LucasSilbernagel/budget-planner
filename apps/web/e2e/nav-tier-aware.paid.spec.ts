import { type Page, expect, test } from '@playwright/test'
import { MORE_PANEL, MORE_SUMMARY, NAV } from './helpers/nav-more'
import { PLANNER_STORAGE_KEY } from './helpers/nav-width'

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

// Since story 59.2 the trigger is a `<summary>` and the sheet is its
// `<details>`'s panel — see `helpers/nav-more.ts` for why neither the old
// `${NAV} button` nor `${NAV} > ul > li > ul` finds anything any more.
const MORE_TRIGGER = MORE_SUMMARY
const SHEET = MORE_PANEL
const STORAGE_KEY = PLANNER_STORAGE_KEY

/** The free server, for the negative control. Absolute: this project's baseURL is :5174. */
const FREE_ORIGIN = 'http://localhost:5173'

async function gotoNav(page: Page, url = '/'): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  await expect(page.locator(NAV)).toBeVisible()
}

/**
 * ⚠️ Every `${SHEET} > li` count in this file is DOM PRESENCE too, for the same
 * reason: CSS locators match the rows of a CLOSED `<details>`. They are the
 * right instrument for "the seam rendered the paid list". Reach is proven in
 * `tier-aware-surfaces.paid.spec.ts` and `nav-more-disclosure.paid.spec.ts`.
 */

/**
 * Anchor count in the nav, regardless of which are CSS-hidden at this width.
 *
 * ⚠️ DOM PRESENCE, not reachability. It is a CSS count, so since story 59.2 it
 * also counts the rows inside the CLOSED More `<details>`, at every width. That
 * is the right instrument for "the seam rendered the paid list" and the wrong
 * one for "a user can reach it" — `tier-aware-surfaces.paid.spec.ts` and
 * `nav-more-disclosure.paid.spec.ts` prove reach.
 */
async function anchorCount(page: Page): Promise<number> {
  return page.locator(`${NAV} a`).count()
}

test.describe('the paid nav really is the paid nav', () => {
  // The precondition every other test in this file rests on. If the seam stops
  // working, this fails FIRST and unambiguously, instead of leaving the
  // geometry assertions quietly measuring the free nav (6 anchors since 69.2).
  // Counts since story 69.2, which took Settings out of the nav: 10
  // destinations / 6 sheet rows paid, 6 / 2 free (11 / 7 and 7 / 3 before).
  // Since story 69.3 the DOM anchor count is two higher in both tiers:
  // Balances and Retirement also have a ROW copy (`hidden lg:block`), so 12
  // paid and 8 free. The sheet row counts are unchanged.
  test('the seam delivers an entitled session — 12 DOM anchors, 6 sheet rows', async ({ page }) => {
    await gotoNav(page)

    expect(await anchorCount(page)).toBe(12)
    await expect(page.locator(`${SHEET} > li`)).toHaveCount(6)

    for (const path of ['/forecasting', '/profiles', '/report', '/categories']) {
      await expect(
        page.locator(`${NAV} li[data-nav-path="${path}"]`),
        `${path} missing from the paid nav`
      ).toHaveCount(1)
    }
  })

  // ⚠️ THE NEGATIVE CONTROL. Without it, a seam that silently stopped working
  // would leave every "paid" assertion above passing against the free nav.
  test('the FREE server on :5173 is unaffected — 8 DOM anchors, 2 sheet rows', async ({ page }) => {
    await gotoNav(page, `${FREE_ORIGIN}/`)

    expect(await anchorCount(page)).toBe(8)
    await expect(page.locator(`${SHEET} > li`)).toHaveCount(2)
    for (const path of ['/forecasting', '/profiles', '/report', '/categories']) {
      await expect(
        page.locator(`${NAV} li[data-nav-path="${path}"]`),
        `${path} leaked into the FREE nav`
      ).toHaveCount(0)
    }
  })
})

/**
 * The desktop row for a paid session — ONE row (story 59.2, FR90): five items
 * below `lg`, seven from `lg` since story 69.3.
 *
 * ⚠️⚠️ THIS REPLACES A TWO-ROW RECORD. Until story 59.2 a paying user's eleven
 * anchors wrapped to TWO rows (92px) at every desktop width. 59.1 measured the
 * row as needing 1026.80px against 966px at the cap (DejaVu) — 60.80px short
 * after its own rename, 116.23px before it — and recorded that no spacing
 * change could close it. 59.2 closed it by moving the More destinations out of
 * the row: from 59.2 until 69.3 the row was Overview · Income · Expenses ·
 * Savings · More in BOTH tiers at every width, and the other rows (seven then,
 * six after 69.2) an overlay panel. Since 69.3 that is the row BELOW `lg`.
 *
 * ⚠️ THE ROW'S WIDTHS ARE NOT REPEATED HERE. Below `lg` the free and paid rows
 * are the same five items, so there is one measurement, and it lives in ONE
 * place (the `lg` rows differ by tier; see the 69.3 note below): the
 * record in `nav-responsive-css.spec.ts` ("THE DESKTOP ROW"), produced by
 * `nav-intrinsic-width.measure{,.paid}.spec.ts`. The paid run reproduces the
 * free figures exactly (441.58px DejaVu, re-measured unchanged after story
 * 69.1's chevron), and that spec asserts the paid row
 * fits and never wraps from 640 to 1400px. That covers signed-out AND signed-in
 * clusters; the signed-in one was the review's finding D1, fixed with
 * `sm:shrink-0` on the nav. This docblock keeps only what is PAID-specific.
 *
 * The open panel (1280px, DejaVu): 160px wide (`sm:min-w-[10rem]`), 6 × 36px
 * rows = 226px tall, top at y=48, no horizontal overflow. (Free: 2 rows,
 * 82px.) Both re-measured by story 69.2, which took the Settings row out; they
 * were 262px / 118px. Paid is the tallest panel, so it carries the occlusion sweep in
 * `nav-more-disclosure.paid.spec.ts`.
 *
 * ⚠️ STORY 69.3 (FR110) split the row into TWO BANDS, and the panel with it.
 * MEASURED 2026-09-25, DejaVu (fingerprint 66.72), by the two-band
 * `nav-intrinsic-width.measure.paid.spec.ts`, signed out:
 *   - below `lg` (measured at 1000px): the five-item row, 441.58px; the panel
 *     is the six rows above, 226px tall (5 rows / 190px with the planner off).
 *   - from `lg`: SIX anchors + More, 638.48px (532.72px with the planner off);
 *     the panel is the premium four, 154px tall. 1024px headroom 193.91px
 *     signed out, 217.00px beside a Premium cluster, 185.00px beside the
 *     JavaScript-off Premium cluster with its <noscript> gear. The free table
 *     and the cluster widths are in `nav-responsive-css.spec.ts`.
 *   No wrapping width from 640 to 1400px in either planner state.
 * So the "1280px" panel figure above is now the BELOW-lg panel; at 1280px the
 * panel is 154px. (Free: no panel at all from `lg`.)
 *
 * ⚠️ 58.1's "973" and 59.1's "966" "available" figures are SUPERSEDED, not
 * reconciled. Both were the list's `clientWidth` while the 11-anchor row was
 * saturated. The likeliest reason they differed by 7px is that the account
 * cluster, itself a flex item, took a different width in the two
 * measurements. That is REASONED, not measured: the saturated row no longer
 * exists to measure. Nothing depends on either figure any more, because the
 * row now sizes to its content and the headroom at the cap is hundreds of
 * pixels.
 *
 * ⚠️ Measuring the row again? `flex-wrap: nowrap` ALONE gives a wrong answer
 * (58.1 read 990px, ~93px below the truth), and **the flex items are the `<li>`,
 * not the `<a>`** (59.1 read a two-word label as NARROWER than a one-word one,
 * reproducibly). Run the committed harness; do not write a new one.
 */
test.describe('the paid desktop row (story 59.2)', () => {
  // Story 69.3 (FR110): at `lg` and up the paid row is SEVEN items (Balances and
  // Retirement join it, More stays for the premium four). Five below `lg`.
  test('is ONE row of seven items at 1280px, with no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoNav(page)

    const measured = await page.evaluate((selector) => {
      const list = document.querySelector(`${selector} > ul`) as HTMLElement | null
      if (!list) return null
      // The ROW ITEMS. `list.querySelectorAll('a')` would also count the
      // rows inside the closed More panel, whose tops are not in the row.
      // RENDERED ones only (story 69.3): a `display:none` item's top is 0.
      const items = ([...list.querySelectorAll(':scope > li')] as HTMLElement[]).filter(
        (li) => li.getClientRects().length > 0
      )
      // Distinct top offsets = wrapped row count. Reading `height` alone cannot
      // distinguish one tall row from two short ones.
      const rows = new Set(items.map((li) => Math.round(li.getBoundingClientRect().top)))
      return {
        rowCount: rows.size,
        items: items.length,
        listHeight: Math.round(list.getBoundingClientRect().height),
        listOverflow: list.scrollWidth - list.clientWidth,
        documentOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    }, NAV)

    expect(measured, 'nav list not found').not.toBeNull()
    const m = measured as NonNullable<typeof measured>

    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log('[59.2] 1280px paid row:', JSON.stringify(m))

    // The precondition this is the paid nav, not the free one: 12 anchors in the
    // DOM (10 destinations + the two lg row copies, story 69.3; 11 until story
    // 69.2).
    expect(await anchorCount(page), 'not measuring the paid nav').toBe(12)
    expect(m.items, 'the paid row is not seven items at lg').toBe(7)
    // A PIN at 1, tightened from the pre-59.2 ceiling of 2 — the direction that
    // ceiling's own comment asked for ("a pass at 1 row is an improvement").
    expect(m.rowCount, 'the paid desktop nav wraps').toBe(1)
    // 52px is the one-row desktop nav; 92px was the two-row one.
    expect(m.listHeight, 'the paid desktop nav is not one row tall').toBe(52)
    expect(m.listOverflow, 'the nav list overflows its own box at 1280px').toBeLessThanOrEqual(0)
    expect(m.documentOverflow, 'the document is wider than 1280px').toBeLessThanOrEqual(0)
  })

  // The narrow end of the desktop cascade, where the signed-out fit is
  // tightest (headroom in `nav-responsive-css.spec.ts`'s record).
  for (const width of [640, 700, 760]) {
    test(`the paid row is one row inside a ${width}px viewport, with no overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 })
      await gotoNav(page)

      const m = await page.evaluate((selector) => {
        const list = document.querySelector(`${selector} > ul`) as HTMLElement | null
        if (!list) return null
        // RENDERED items only (story 69.3): see the 1280px test above.
        const items = ([...list.querySelectorAll(':scope > li')] as HTMLElement[]).filter(
          (li) => li.getClientRects().length > 0
        )
        return {
          rows: new Set(items.map((li) => Math.round(li.getBoundingClientRect().top))).size,
          listOverflow: list.scrollWidth - list.clientWidth,
          widestItemRight: Math.max(...items.map((li) => li.getBoundingClientRect().right)),
          innerWidth: globalThis.innerWidth,
          documentOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      }, NAV)

      expect(m).not.toBeNull()
      const r = m as NonNullable<typeof m>
      expect(r.rows, `the paid row wraps at ${width}px`).toBe(1)
      expect(r.listOverflow, `the nav list overflows its box at ${width}px`).toBeLessThanOrEqual(0)
      expect(
        r.widestItemRight,
        `a row item paints past the ${width}px viewport edge`
      ).toBeLessThanOrEqual(r.innerWidth)
      expect(r.documentOverflow, `the document is wider than ${width}px`).toBeLessThanOrEqual(0)
    })
  }
})

/**
 * AC-5 — the "More" sheet at 7 rows (6 since story 69.2 took Settings out; the
 * table below is the 7-row record, and the 6-row one is recorded beneath it).
 *
 * The sheet is `max-sm:absolute`, anchored to the TOP edge of the bar, with a
 * `max-h-[calc(100svh-5rem)]` cap and `overflow-y-auto`. At 2-3 rows none of that
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
 * After story 69.2 (6 rows), MEASURED 2026-09-25 at all four widths:
 *
 *   320-412x640  6       297px      287        580px         48px       0        no
 *
 * i.e. exactly one 48px row shorter, with the last row where it was.
 *
 * So at a normal phone height the 7-row (now 6-row) sheet still fits inside the cap with room
 * to spare — the cap and the scroll path only engage on SHORT viewports, which is
 * why they get their own test below rather than riding along on these.
 *
 * ⚠️ Row height is 48px against a `min-h-[44px]` target, so the 44px floor holds
 * at 6 (formerly 7) rows with 4px of slack — not a coincidence worth relying on if the row
 * padding ever changes.
 */
test.describe('the More sheet at 6 rows (AC-5)', () => {
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

      expect(r.rows, 'not measuring the paid sheet').toBe(6)
      // The cap's whole job: the panel's top edge stays on screen.
      expect(r.sheetTop, 'the sheet has grown off the top of the screen').toBeGreaterThanOrEqual(0)
      expect(r.lastRowBottom, 'the last sheet row paints below the viewport').toBeLessThanOrEqual(
        r.viewportHeight
      )
      expect(r.overflowX, 'the sheet absorbed horizontal overflow').toBeLessThanOrEqual(0)
      // Every row keeps a real 44px touch target at 6 rows, not just at 2.
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
   * 320x400 put the cap at 320px against ~345px of rows. ⚠️ Story 69.2 took a
   * row out (6 rows, ~297px), which FITS under a 320px cap, so this test's own
   * "does not overflow" guard went red there. 320x360 puts the cap at 280px
   * against the 6 rows. The landscape phone
   * case (568x320, cap 240px) is tighter still and is the shape the component's
   * own docblock records as having stranded rows off the TOP of the screen before
   * the cap existed.
   */
  for (const [width, height] of [
    [320, 360],
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
  test('every row of the 6-row sheet stays tappable under the InstallPrompt banner', async ({
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
    expect(p.rows).toHaveLength(6)
    for (const row of p.rows) {
      expect(row.hitsSelf, `"${row.label}" is occluded — a tap there lands elsewhere`).toBe(true)
    }
  })
})

/**
 * Tier and the Retirement preference are independent filters on one list, so the
 * PRODUCT of the two needs its own measurement — 9 anchors, 5 sheet rows (10 and
 * 6 until story 69.2 took Settings out).
 */
test('paid session with the Retirement planner hidden: 9 destinations, 5 rows', async ({
  page,
}) => {
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

  // 9 destinations + the Balances row copy (story 69.3; the Retirement row copy
  // is filtered with its sheet row) = 10 DOM anchors.
  expect(await anchorCount(page)).toBe(10)
  await expect(page.locator(`${SHEET} > li`)).toHaveCount(5)
  await expect(page.locator(`${NAV} li[data-nav-path="/retirement"]`)).toHaveCount(0)
  // The premium four are unaffected by a preference that is not about them.
  await expect(page.locator(`${NAV} li[data-nav-path="/report"]`)).toHaveCount(1)
})
