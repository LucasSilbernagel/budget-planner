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

export const NAV = 'nav[aria-label="Primary"]'
/** The More trigger: the `<summary>` of the nav's one `<details>`. */
export const MORE_SUMMARY = `${NAV} details > summary`
/** The disclosure element itself — its `open` property is the state. */
export const MORE_DETAILS = `${NAV} details`
/** The panel list holding the More destinations (the sheet below 640px). */
export const MORE_PANEL = `${NAV} details > ul`

/** Whether the disclosure is open, read from the DOM `open` property. */
export async function isMoreOpen(page: Page): Promise<boolean> {
  return page.locator(MORE_DETAILS).evaluate((el) => (el as HTMLDetailsElement).open)
}

/** Click the trigger and wait until the disclosure reports open. */
export async function openMore(page: Page): Promise<void> {
  await page.locator(MORE_SUMMARY).click()
  await expect.poll(() => isMoreOpen(page), 'the More disclosure did not open').toBe(true)
}

/** The labels of the panel's rows, in DOM order (visibility-agnostic). */
export async function panelLabels(page: Page): Promise<string[]> {
  return page
    .locator(`${MORE_PANEL} > li > a [data-nav-label]`)
    .evaluateAll((spans) => spans.map((s) => s.textContent?.trim() ?? ''))
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
 * A long, realistic email: long enough that the account cluster cannot fit
 * beside the row at 640px without truncating.
 */
export const LONG_EMAIL = 'alexandra.montgomery-whitfield@example.test'

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
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { user: { userId: 'e2e-signed-in', email, subscriptionStatus } } })
  )
}

/**
 * Sweep desktop widths with the page as it is, and return every width where the
 * nav row wraps, the document overflows sideways, or the account cluster paints
 * past the viewport. Empty means the header row holds at every width.
 */
export async function sweepHeaderRow(
  page: Page,
  { from = 640, to = 1400, step = 5 }: { from?: number; to?: number; step?: number } = {}
) {
  const failures: string[] = []
  for (let width = from; width <= to; width += step) {
    await page.setViewportSize({ width, height: 800 })
    const m = await page.evaluate((nav) => {
      const items = [...document.querySelectorAll(`${nav} > ul > li`)]
      const cluster = document.querySelector('[data-auth-indicator]') as HTMLElement
      return {
        rows: new Set(items.map((li) => Math.round(li.getBoundingClientRect().top))).size,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clusterRight: cluster.getBoundingClientRect().right,
        innerWidth: document.documentElement.clientWidth,
      }
    }, NAV)
    if (m.rows !== 1) failures.push(`${width}px: ${m.rows} rows`)
    if (m.docOverflow > 0) failures.push(`${width}px: document overflows by ${m.docOverflow}px`)
    if (m.clusterRight > m.innerWidth + 0.5)
      failures.push(`${width}px: account cluster ends at ${m.clusterRight}`)
  }
  return failures
}
