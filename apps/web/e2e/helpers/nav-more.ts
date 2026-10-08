// The More trigger is a native <summary>, which Playwright gives no role, so
// getByRole('button', { name: 'More' }) matches nothing: go through these helpers.

// CSS locators still count anchors inside a CLOSED <details>; role locators and
// toBeVisible() don't.
import { type Page, expect } from '@playwright/test'

const NAV = 'nav[aria-label="Primary"]'
const MORE_SUMMARY = `${NAV} details > summary`
const MORE_DETAILS = `${NAV} details`

async function isMoreOpen(page: Page): Promise<boolean> {
  return page.locator(MORE_DETAILS).evaluate((el) => (el as HTMLDetailsElement).open)
}

export async function openMore(page: Page): Promise<void> {
  await page.locator(MORE_SUMMARY).click()
  await expect.poll(() => isMoreOpen(page), 'the More disclosure did not open').toBe(true)
}

// Distinct from the paid seed's email, so expectSignedInAs can tell the mocked
// identity from the seeded one.
const LONG_EMAIL = 'alexandra.montgomery-whitfield@example.test'

// Delays the stubbed /api/auth/me. CI-only failures here are races, which this
// reproduces locally where a re-run cannot.
const AUTH_DELAY_MS = Number(process.env.E2E_AUTH_DELAY_MS ?? 0)

// The e2e servers have no real session, so without this the post-mount
// /api/auth/me answers signed-out and drops paid nav and gates. Call before goto.
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

// The test flips a flag instead of re-routing inside the logout handler, which
// mutated the route table mid-dispatch.
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
