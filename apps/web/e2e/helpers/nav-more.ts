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
 *   Chromium exposes `DisclosureTriangle "More"` with `expanded`. (The AX-tree
 *   reader that used to live here went with story 84.3. What is pinned below
 *   the browser is OUR share of those semantics, not Chromium's derivation:
 *   no hand-rolled ARIA (`GlobalNav.test.tsx` › 'carries no hand-rolled
 *   ARIA') and a `<summary>` that is the `<details>`'s first child
 *   (`GlobalNav.ssr.dom.test.tsx`).)
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

const NAV = 'nav[aria-label="Primary"]'
/** The More trigger: the `<summary>` of the nav's one `<details>`. */
const MORE_SUMMARY = `${NAV} details > summary`
/** The disclosure element itself — its `open` property is the state. */
const MORE_DETAILS = `${NAV} details`

/** Whether the disclosure is open, read from the DOM `open` property. */
async function isMoreOpen(page: Page): Promise<boolean> {
  return page.locator(MORE_DETAILS).evaluate((el) => (el as HTMLDetailsElement).open)
}

/** Click the trigger and wait until the disclosure reports open. */
export async function openMore(page: Page): Promise<void> {
  await page.locator(MORE_SUMMARY).click()
  await expect.poll(() => isMoreOpen(page), 'the More disclosure did not open').toBe(true)
}

/**
 * A long, realistic email. Until story 69.2 it was long enough that the account
 * cluster could not fit beside the row at 640px without truncating. Since 69.2
 * the chrome shows no email (it is only ANNOUNCED, by the status region), so
 * this is now the mocked identity `expectSignedInAs` waits for: distinct from
 * the `:5174` seed's `e2e-paid@example.test`, which is what makes the gate able
 * to tell the two apart.
 */
const LONG_EMAIL = 'alexandra.montgomery-whitfield@example.test'

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
 *
 * ⚠️ Since story 99.1 the NAV follows that answer too: on `:5174` without this
 * mock, the signed-out answer removes the premium nav entries the seed painted.
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
