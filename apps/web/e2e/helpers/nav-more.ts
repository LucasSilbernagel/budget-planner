/**
 * The nav's "More" disclosure, located the ONE way that works (story 59.2).
 *
 * Since 59.2 the trigger is a native `<summary>` inside a `<details>`, at every
 * width. Every spec that touches it goes through this file rather than
 * re-deriving a selector, because the obvious selectors are all WRONG now, and
 * each one fails differently. All three were measured at 59.2's context time.
 *
 * - `getByRole('button', { name: 'More' })` matches NOTHING. Playwright 1.61.1's
 *   implicit-role map has `DETAILS → group` and no entry for `SUMMARY`, so the
 *   trigger has no role as far as Playwright is concerned. That holds open or
 *   closed, with JavaScript on or off. The real accessibility tree is fine:
 *   Chromium exposes `DisclosureTriangle "More"` with `expanded`. Read that
 *   through `moreExpandedInAxTree` below when the SEMANTICS are the claim.
 * - `aria-expanded` / `aria-controls` are gone. The platform supplies the
 *   expanded state natively, and the story forbids re-adding them by hand.
 * - The old structural path `nav > ul > li > ul` misses the panel, because a
 *   `<details>` now sits between the `<li>` and the `<ul>`.
 *
 * ⚠️ CSS locators (`locator('nav a')`, `.count()`, `querySelectorAll`) still
 * count anchors inside a CLOSED `<details>`. Role locators and `toBeVisible()`
 * do not. A count proves the rows are in the DOM. It does not prove a user can
 * reach them.
 */
import { type Page, expect } from '@playwright/test'
import { sweepWidths } from './nav-width'

export const NAV = 'nav[aria-label="Primary"]'
/** The More trigger: the `<summary>` of the nav's one `<details>`. */
export const MORE_SUMMARY = `${NAV} details > summary`
/** The disclosure element itself — its `open` property is the state. */
export const MORE_DETAILS = `${NAV} details`
/** The panel list holding the More destinations (the sheet below 640px). */
export const MORE_PANEL = `${NAV} details > ul`

/**
 * The desktop disclosure chevron inside the More trigger (story 69.1, FR108).
 *
 * Located by its marker, never by `svg`: the trigger also holds `MoreIcon`,
 * which is `sm:hidden`, so an `svg` query would find the WRONG glyph at desktop
 * and report it hidden.
 */
export const MORE_CHEVRON = `${MORE_SUMMARY} [data-disclosure-chevron]`

/** What a test needs to know about the More chevron, read in one pass. */
export interface ChevronState {
  /** How many chevrons the trigger holds. 0 means the cue does not exist. */
  count: number
  /** `checkVisibility()` — false for `display:none`, which a count cannot see. */
  visible: boolean
  width: number
  height: number
  /** The computed `transform`, verbatim (`none`, or a `matrix(...)`). */
  transform: string | null
  /**
   * The matrix's `a` component, rounded to 2dp: 1 unrotated, -1 at 180deg.
   * `none` reads as 1. ⚠️ Read it through `expect.poll`: the chevron carries
   * `transition-transform`, so a read mid-transition returns an interpolated
   * matrix, not the end state.
   */
  a: number | null
  /** The trigger's height, so a line box grown by an inline SVG is visible. */
  triggerHeight: number
}

export async function readChevron(page: Page): Promise<ChevronState> {
  return page.evaluate(
    ([summarySel, chevronSel]) => {
      const summary = document.querySelector(summarySel)
      const chevrons = [...document.querySelectorAll(chevronSel)]
      const el = chevrons[0] as SVGElement | undefined
      const triggerHeight = summary?.getBoundingClientRect().height ?? 0
      if (!el) {
        return {
          count: 0,
          visible: false,
          width: 0,
          height: 0,
          transform: null,
          a: null,
          triggerHeight,
        }
      }
      const rect = el.getBoundingClientRect()
      const transform = getComputedStyle(el).transform
      let a = 1
      if (transform && transform !== 'none') {
        const m = /matrix\(([^)]+)\)/.exec(transform)
        a = m ? Number(m[1].split(',')[0]) : Number.NaN
      }
      return {
        count: chevrons.length,
        visible: el.checkVisibility(),
        width: rect.width,
        height: rect.height,
        transform,
        a: Math.round(a * 100) / 100,
        triggerHeight,
      }
    },
    [MORE_SUMMARY, MORE_CHEVRON] as const
  )
}

/** Whether the disclosure is open, read from the DOM `open` property. */
export async function isMoreOpen(page: Page): Promise<boolean> {
  return page.locator(MORE_DETAILS).evaluate((el) => (el as HTMLDetailsElement).open)
}

/** Click the trigger and wait until the disclosure reports open. */
export async function openMore(page: Page): Promise<void> {
  await page.locator(MORE_SUMMARY).click()
  await expect.poll(() => isMoreOpen(page), 'the More disclosure did not open').toBe(true)
}

/**
 * The labels of the panel's RENDERED rows, in DOM order.
 *
 * ⚠️ Was visibility-agnostic until story 69.3. Since then the Balances and
 * Retirement rows are `display:none` in the panel at `lg` (their copies are on
 * the row), so an unfiltered read would list rows no user can see. The filter
 * is the `<li>`'s OWN computed `display`, deliberately not its rects: that
 * reads the width rule and nothing else, so rows of a CLOSED panel are still
 * returned, whatever mechanism the browser uses to hide a closed `<details>`.
 * Tests that care about open vs closed must still check that separately.
 */
export async function panelLabels(page: Page): Promise<string[]> {
  return page
    .locator(`${MORE_PANEL} > li > a [data-nav-label]`)
    .evaluateAll((spans) =>
      spans
        .filter((s) => getComputedStyle(s.closest('li') as HTMLElement).display !== 'none')
        .map((s) => s.textContent?.trim() ?? '')
    )
}

/**
 * The trigger's expanded state as the REAL accessibility tree reports it.
 *
 * Reads Chromium's AX tree over CDP, because neither Playwright's role engine
 * nor an attribute read can see it: the summary carries no `aria-expanded`, and
 * Playwright gives it no role. Returns `null` if no `DisclosureTriangle "More"`
 * node exists OR it exposes no `expanded` state, so neither can pass silently.
 */
export async function moreExpandedInAxTree(page: Page): Promise<boolean | null> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes: {
        ignored?: boolean
        role?: { value?: string }
        name?: { value?: string }
        properties?: { name: string; value: { value?: unknown } }[]
      }[]
    }
    const trigger = nodes.find(
      (n) => !n.ignored && n.role?.value === 'DisclosureTriangle' && n.name?.value === 'More'
    )
    if (!trigger) return null
    // ⚠️ A node that exposes NO expanded state is `null` too, not `false`.
    // Otherwise a closed-state `toBe(false)` would pass on a node that has lost
    // its disclosure semantics entirely (story 59.2 code review).
    const expanded = trigger.properties?.find((p) => p.name === 'expanded')
    if (!expanded || typeof expanded.value.value !== 'boolean') return null
    return expanded.value.value
  } finally {
    await cdp.detach()
  }
}

/**
 * A long, realistic email. Until story 69.2 it was long enough that the account
 * cluster could not fit beside the row at 640px without truncating. Since 69.2
 * the chrome shows no email (it is only ANNOUNCED, by the status region), so
 * this is now the mocked identity `expectSignedInAs` waits for: distinct from
 * the `:5174` seed's `e2e-paid@example.test`, which is what makes the gate able
 * to tell the two apart.
 */
export const LONG_EMAIL = 'alexandra.montgomery-whitfield@example.test'

/**
 * Hold the stubbed `/api/auth/me` for this many ms before fulfilling it.
 *
 * Defaults to 0, so it changes nothing unless asked for. It exists because a
 * CI-only failure in this area is a RACE, and re-running locally cannot
 * reproduce a race — delaying the stubbed fetch can. Measured with it, on
 * `account-menu.paid.spec.ts` at 8000:
 *
 *   before this file's fixes: 2 failed, 5 passed
 *   after:                    7 passed
 *
 * The 2 failures were the same assertion CI run 35782927398 failed on.
 *
 *   E2E_AUTH_DELAY_MS=8000 pnpm --filter web test:e2e e2e/account-menu.paid.spec.ts
 */
const AUTH_DELAY_MS = Number(process.env.E2E_AUTH_DELAY_MS ?? 0)

/**
 * Render a SIGNED-IN account cluster (story 59.2 code review).
 *
 * The e2e servers have no real session, so `AuthIndicator`'s post-mount
 * `fetch('/api/auth/me')` resolves signed-OUT on both servers, even on the
 * `:5174` paid seam, whose SSR seed is authenticated. Every nav width measured
 * before this helper existed was therefore measured beside a "Sign in" cluster.
 * That missed that a signed-in cluster (avatar + email + Premium pill) wrapped
 * the desktop row to 2-3 rows at 640-849px. Call BEFORE `page.goto`.
 */
export async function mockSignedIn(
  page: Page,
  {
    email = LONG_EMAIL,
    subscriptionStatus = 'active',
  }: { email?: string; subscriptionStatus?: string } = {}
) {
  await page.route('**/api/auth/me', async (route) => {
    if (AUTH_DELAY_MS > 0) await new Promise((r) => setTimeout(r, AUTH_DELAY_MS))
    await route.fulfill({ json: { user: { userId: 'e2e-signed-in', email, subscriptionStatus } } })
  })
}

/**
 * A mocked session that a test can END mid-run, for sign-out flows.
 *
 * ⚠️ Why this exists rather than re-routing inside the logout handler: the two
 * sign-out tests used to call `page.unroute()` + `page.route()` from INSIDE the
 * logout route handler, i.e. they mutated the route table while a click was
 * awaiting that very dispatch. In CI run 35782927398 the free-server sign-out
 * click then hung for the full 30s test timeout, having already resolved the
 * button as "visible, enabled and stable".
 *
 * ⚠️ That hang is NOT proven to be caused by the re-routing — a red run
 * localises a failure, it does not explain one. This returns a flag the
 * handler flips instead, which removes the re-entrancy as a variable without
 * claiming it was the culprit.
 */
export async function mockSessionThatCanEnd(
  page: Page,
  {
    email = LONG_EMAIL,
    subscriptionStatus = 'active',
  }: { email?: string; subscriptionStatus?: string } = {}
): Promise<{ signedOut: boolean }> {
  const session = { signedOut: false }
  await page.route('**/api/auth/me', async (route) => {
    if (AUTH_DELAY_MS > 0) await new Promise((r) => setTimeout(r, AUTH_DELAY_MS))
    await route.fulfill({
      json: {
        user: session.signedOut ? null : { userId: 'e2e-signed-in', email, subscriptionStatus },
      },
    })
  })
  return session
}

/**
 * Sweep desktop widths with the page as it is, and return every width where the
 * nav row wraps, the document overflows sideways, the account cluster paints
 * past the viewport, or (since story 69.3) the account cluster wraps to a line
 * of its own. Empty means the header row holds at every width.
 */
export async function sweepHeaderRow(
  page: Page,
  { from = 640, to = 1400, step = 5 }: { from?: number; to?: number; step?: number } = {}
) {
  const failures: string[] = []
  // ⚠️ The cluster is mounted by the post-mount session fetch, not by the SSR
  // HTML on the free server. Without this gate the FIRST `page.evaluate` below
  // could deref a null `[data-auth-indicator]` and die with a TypeError that
  // says nothing about the header row — which is exactly what
  // `account-menu.paid.spec.ts:209` did in CI run 35782927398.
  await page.locator('[data-auth-indicator]').waitFor({ state: 'attached', timeout: 15_000 })
  for (const width of sweepWidths(from, to, step)) {
    await page.setViewportSize({ width, height: 800 })
    const m = await page.evaluate((nav) => {
      // Rendered items only (story 69.3): a `display:none` `<li>` has top 0 and
      // would read as a phantom second row. See `helpers/nav-width.ts`.
      const items = [...document.querySelectorAll(`${nav} > ul > li`)].filter(
        (li) => li.getClientRects().length > 0
      )
      const cluster = document.querySelector('[data-auth-indicator]')
      return {
        rows: new Set(items.map((li) => Math.round(li.getBoundingClientRect().top))).size,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // `null` is reported as a failure below, never dereferenced: the
        // cluster can unmount mid-sweep if the session flips.
        clusterRight: cluster ? cluster.getBoundingClientRect().right : null,
        // Story 69.3 (decision D4): the HEADER row now wraps (`sm:flex-wrap`),
        // so a cluster that no longer fits beside the nav drops to a line of
        // its own instead of overflowing. Nothing above would see that: the
        // nav's own items stay one row and the document does not overflow. The
        // cluster starting at or below the nav list's bottom edge is the wrap.
        // ⚠️ This helper reports it as a FAILURE, always. It is meant for the
        // DEFAULT root font, where a wrap is a regression. At an enlarged root
        // font a wrap is the intended D4 behaviour, so enlarged-font tests use
        // `sweepForOverlap` instead, which does not check wrapping.
        clusterWrapped: cluster
          ? cluster.getBoundingClientRect().top >=
            (document.querySelector(`${nav} > ul`) as HTMLElement).getBoundingClientRect().bottom -
              1
          : false,
        innerWidth: document.documentElement.clientWidth,
      }
    }, NAV)
    if (m.rows !== 1) failures.push(`${width}px: ${m.rows} rows`)
    if (m.clusterRight === null) failures.push(`${width}px: no account cluster in the document`)
    if (m.docOverflow > 0) failures.push(`${width}px: document overflows by ${m.docOverflow}px`)
    if (m.clusterWrapped)
      failures.push(`${width}px: the account cluster wrapped to a second header line`)
    if (m.clusterRight !== null && m.clusterRight > m.innerWidth + 0.5)
      failures.push(`${width}px: account cluster ends at ${m.clusterRight}`)
  }
  return failures
}

/** The labels of the row's RENDERED items, in order (anchors and the More trigger). */
export async function rowLabels(page: Page): Promise<string[]> {
  return page
    .locator(`${NAV} > ul > li`)
    .evaluateAll((lis) =>
      lis
        .filter((li) => li.getClientRects().length > 0)
        .map(
          (li) =>
            li
              .querySelector(
                ':scope > a [data-nav-label], :scope > details > summary [data-nav-label]'
              )
              ?.textContent?.trim() ?? '?'
        )
    )
}

/** The More trigger's computed background: green-50 is the active treatment. */
export async function moreBackground(page: Page): Promise<string> {
  // Park the pointer off the nav, so `hover:` cannot be what is measured.
  await page.mouse.move(1, 700)
  const bg = await page.evaluate((sel) => {
    const summary = document.querySelector(sel) as HTMLElement | null
    // A missing OR unrendered trigger is an error, never a colour: returning
    // null made every "More is NOT active" assertion pass with no More on
    // screen at all (story 69.3 code review).
    return summary?.checkVisibility() ? getComputedStyle(summary).backgroundColor : null
  }, MORE_SUMMARY)
  if (bg === null) throw new Error('moreBackground: the More trigger is not rendered')
  return bg
}

/** `bg-green-50`, the active treatment (`GlobalNav.tsx` `ACTIVE_CLASS`). */
export const ACTIVE_BG = 'rgb(240, 253, 244)'

/** `hover:bg-gray-100`, the nav's hover treatment. */
export const HOVER_BG = 'rgb(243, 244, 246)'

/**
 * Set the root font before first paint AND after load (see
 * `nav-responsive-css.spec.ts`), then PROVE it took: a script or re-render
 * resetting `<html>`'s size would otherwise leave the sweep at 16px, where the
 * layout was already clean (story 69.3 code review).
 */
export async function withRootFont(page: Page, px: number, path = '/') {
  await page.addInitScript((size) => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${size}px`
    })
  }, px)
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = `${size}px`
  }, px)
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
    'the enlarged root font did not take effect'
  ).toBe(`${px}px`)
}

/** Every width in the sweep where the cluster covers or overlaps the nav. */
export async function sweepForOverlap(page: Page, { from = 640, to = 1400, step = 5 } = {}) {
  const failures: string[] = []
  await page.locator('[data-auth-indicator]').waitFor({ state: 'attached', timeout: 15_000 })
  for (const width of sweepWidths(from, to, step)) {
    await page.setViewportSize({ width, height: 800 })
    const m = await page.evaluate((navSel) => {
      const nav = document.querySelector(navSel) as HTMLElement
      const list = nav.querySelector(':scope > ul') as HTMLElement
      const cluster = document.querySelector('[data-auth-indicator]') as HTMLElement | null
      const rendered = [...list.querySelectorAll(':scope > li')].filter(
        (li) => li.getClientRects().length > 0
      )
      const targets: { name: string; el: Element }[] = []
      const chevron = nav.querySelector('details > summary [data-disclosure-chevron]')
      if (chevron && chevron.getClientRects().length > 0)
        targets.push({ name: 'More chevron', el: chevron })
      const last = rendered.at(-1)
      const lastControl = last?.querySelector(':scope > a, :scope > details > summary')
      if (lastControl) targets.push({ name: 'last row item', el: lastControl })
      // And the last ANCHOR, which is not the last item whenever More renders
      // (on the paid row it is Retirement, beside More). Code review of 69.3.
      const anchors = rendered.map((li) => li.querySelector(':scope > a')).filter((a) => a !== null)
      const lastAnchor = anchors.at(-1)
      if (lastAnchor && lastAnchor !== lastControl)
        targets.push({ name: 'last row anchor', el: lastAnchor })
      const hits = targets.map(({ name, el }) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { name, inside: hit !== null && nav.contains(hit) }
      })
      // The cluster's PAINTED extent: the union of its descendants' rects, not
      // its own box. Measured at 69.3's RED run: with `sm:min-w-0` the box
      // shrinks and its content overflows it, so the box never intersected the
      // nav while a press on the chevron hit the cluster. Only the content can.
      let overlap = 0
      if (cluster) {
        const a = list.getBoundingClientRect()
        const parts = [...cluster.querySelectorAll('*')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
        for (const b of parts) {
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (w > 0.5 && h > 0.5) overlap = Math.max(overlap, Math.round(w * 100) / 100)
        }
      }
      return {
        clusterPresent: cluster !== null,
        hits,
        targetCount: targets.length,
        overlap,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    }, NAV)
    // Anti-vacuity (story 69.3 code review): with no cluster there is nothing
    // that could overlap, so "no overlap" would be true for the wrong reason.
    // `sweepHeaderRow` above already guards the same way.
    if (!m.clusterPresent) failures.push(`${width}px: no account cluster in the document`)
    if (m.targetCount === 0) failures.push(`${width}px: nothing to hit-test`)
    for (const h of m.hits)
      if (!h.inside) failures.push(`${width}px: a press on the ${h.name} lands outside the nav`)
    if (m.overlap > 0)
      failures.push(`${width}px: the cluster overlaps the nav list by ${m.overlap}px`)
    if (m.docOverflow > 0) failures.push(`${width}px: document overflows by ${m.docOverflow}px`)
  }
  return failures
}
