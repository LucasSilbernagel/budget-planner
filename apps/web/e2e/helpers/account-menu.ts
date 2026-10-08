// No e2e server has a real session: call mockSignedIn() before page.goto, or the
// post-mount /api/auth/me answers signed-out and unmounts the trigger.
import { type Locator, type Page, expect } from '@playwright/test'

// Network-gated: hydration plus the mocked /api/auth/me round trip can exceed the
// 5s default on a loaded CI runner.
export const SESSION_SETTLE_MS = 15_000

export function accountTrigger(page: Page): Locator {
  return page.getByRole('button', { name: 'Account menu', exact: true })
}

// The paid seed paints a signed-in cluster with the SEED's identity, so a visible
// trigger proves nothing; wait for the mocked email in the sr-only status text.
export async function expectSignedInAs(page: Page, email: string): Promise<void> {
  await expect(
    page.getByRole('status', { name: /account status/i }),
    `the mocked session never reached the account cluster: still not announcing ${email}`
  ).toContainText(email, { timeout: SESSION_SETTLE_MS })
}

// Closed has no aria-controls, so this matches nothing. `[id=]` because useId
// output isn't a valid #id selector.
async function accountPanel(page: Page): Promise<Locator> {
  const id = await accountTrigger(page).getAttribute('aria-controls')
  return id === null ? page.locator('[data-account-panel-absent]') : page.locator(`[id="${id}"]`)
}

// One click by default: a retry would hide a swallowed click. acrossHydration is for
// the paid seed, whose trigger is painted before hydration attaches handlers.
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
