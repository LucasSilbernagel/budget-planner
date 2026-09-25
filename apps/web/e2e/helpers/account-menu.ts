/**
 * The account menu (story 59.3), located the one way that works.
 *
 * Unlike the nav's More (`nav-more.ts`), this trigger is a real
 * `<button aria-expanded>` (decision D1), so role locators DO find it, and its
 * panel exists in the DOM only while open. `aria-controls` is the link
 * between the two. The id comes from React's `useId()`, whose characters are
 * not valid in a bare `#id` selector, hence `[id="…"]`.
 *
 * ⚠️ The e2e servers have no real session. Call `mockSignedIn()`
 * (`nav-more.ts`) BEFORE `page.goto`, or there is no trigger to find: on the
 * free server the SSR seed is signed-out, and on the `:5174` paid seam the
 * post-mount `/api/auth/me` resolves signed-out and unmounts the trigger the
 * seed painted.
 */
import { type Locator, type Page, expect } from '@playwright/test'

/**
 * How long to wait for the cluster to reflect the MOCKED session.
 *
 * ⚠️ Not a style choice. Every assertion about the cluster is really an
 * assertion about the post-mount `fetch('/api/auth/me')` in
 * `auth-indicator.tsx` having resolved AND re-rendered. That is hydration plus
 * a round trip, and on a loaded CI runner it does not reliably finish inside
 * Playwright's default 5s `expect` timeout: CI run 35782927398 failed
 * `account-menu.paid.spec.ts:115` on both attempts with "13 × locator resolved
 * to 0 elements", and left four more account-menu tests flaky. The default is
 * right for a rendered fact; it is wrong for a network-gated one.
 */
export const SESSION_SETTLE_MS = 15_000

export function accountTrigger(page: Page): Locator {
  return page.getByRole('button', { name: 'Account menu', exact: true })
}

/**
 * Wait until the cluster shows the MOCKED identity, not a seeded one.
 *
 * ⚠️ On the `:5174` paid server the SSR seed paints a complete, authenticated
 * cluster — with the SEED's email — in the first frame, so `accountTrigger`
 * being visible proves nothing about whether `mockSignedIn()` has landed. A
 * test that measures the email without this gate measures whichever identity
 * won the race. That is how CI run 35782927398 failed, and had the two emails
 * been similar enough it would have passed while measuring the wrong one.
 *
 * ⚠️ RE-POINTED by story 69.2. The trigger no longer shows the email (it is
 * `[avatar initial][chevron]`), so the identity is read from the ONE place the
 * cluster still carries it: the `sr-only` copy in the labelled `role="status"`
 * region, which is what a screen reader hears. `toContainText` reads
 * `textContent`, so `sr-only` is no obstacle. Do NOT gate on the trigger being
 * visible instead: on `:5174` it is visible in the first frame with the SEED's
 * identity, which is the race this helper exists to close.
 */
export async function expectSignedInAs(page: Page, email: string): Promise<void> {
  await expect(
    page.getByRole('status', { name: /account status/i }),
    `the mocked session never reached the account cluster: still not announcing ${email}`
  ).toContainText(email, { timeout: SESSION_SETTLE_MS })
}

/**
 * The panel the trigger controls.
 *
 * While CLOSED there is no panel and no `aria-controls` (it would be a dangling
 * IDREF), so this returns a locator that matches nothing — `toHaveCount(0)`
 * then means "closed", which is what callers assert. It is not an error state.
 */
export async function accountPanel(page: Page): Promise<Locator> {
  const id = await accountTrigger(page).getAttribute('aria-controls')
  return id === null ? page.locator('[data-account-panel-absent]') : page.locator(`[id="${id}"]`)
}

/**
 * Open the menu. ONE click by default — a retry would hide a swallowed first
 * click, which is a defect this suite should catch.
 *
 * ⚠️ `acrossHydration` is for the `:5174` PAID server only, where the SSR seed
 * paints the trigger in the first frame, so a click can land BEFORE hydration,
 * when no handler is attached and nothing happens. That window is accepted by
 * design: signing out needs JavaScript however the panel opens (decision D1),
 * and a pre-hydration click on a `<button>` simply does nothing, rather than
 * desyncing `open` from state the way `<details>` would have (story 59.2). On
 * the free server the trigger only appears AFTER the client session fetch, so
 * hydration has already happened and no retry is warranted — review caught this
 * helper retrying there too.
 */
export async function openAccountMenu(
  page: Page,
  { acrossHydration = false }: { acrossHydration?: boolean } = {}
): Promise<Locator> {
  if (acrossHydration) {
    await expect(async () => {
      await accountTrigger(page).click()
      await expect(accountTrigger(page)).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 })
    }).toPass({ timeout: 15000 })
  } else {
    await accountTrigger(page).click()
    await expect(accountTrigger(page), 'the first click did not open the menu').toHaveAttribute(
      'aria-expanded',
      'true'
    )
  }
  const panel = await accountPanel(page)
  await expect(panel).toBeVisible()
  return panel
}

/**
 * Whether anything paints over the open panel. `toBeVisible()` cannot see
 * occlusion, so this asks the browser what is actually on top at three points
 * (left, centre, right) of each child of the panel, the way 59.2's More sweep
 * does. Returns a description of every miss; empty means unoccluded.
 */
export async function panelOcclusion(panel: Locator): Promise<string[]> {
  return panel.evaluate((el) => {
    const misses: string[] = []
    for (const child of [...el.children] as HTMLElement[]) {
      if (child.tagName === 'HR') continue
      const r = child.getBoundingClientRect()
      for (const x of [r.left + 4, r.left + r.width / 2, r.right - 4]) {
        const y = r.top + r.height / 2
        const hit = document.elementFromPoint(x, y)
        if (!hit || !el.contains(hit)) {
          misses.push(
            `${child.tagName} at (${Math.round(x)},${Math.round(y)}) is under ${
              hit?.tagName ?? 'nothing'
            }.${(hit as HTMLElement | null)?.className ?? ''}`
          )
        }
      }
    }
    return misses
  })
}
