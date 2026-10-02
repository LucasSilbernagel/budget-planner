/**
 * The magic-link sign-in, driven as a user does it, for the `chromium-db`
 * flows: F9 (`sign-in.db.spec.ts`, story 87.1) and F10 (`upgrade.db.spec.ts`,
 * story 87.2, whose new buyer signs in through `/welcome`'s "Sign in"). ONE
 * implementation, so the two flows cannot drift apart (story 87.2 trap: "do
 * not write a second").
 *
 * Starts on `/login` (the caller navigates there its own way) and ends right
 * after the confirm POST redirected to `/`. Each assertion names its step,
 * numbered from `firstStep`, so a break fails AT the step that broke (87.1
 * AC 3, 87.2 AC 3). F9 passes `firstStep: 1`, which keeps its messages exactly
 * as 87.1 recorded them.
 */
import { type BrowserContext, type Page, expect } from '@playwright/test'
import { SESSION_SETTLE_MS } from './account-menu'
import { readOutbox } from './db-harness'

export interface SignInResult {
  /** How many outbox links this address has, read now. */
  linksFor: () => number
  /** How many links this address had before the request. */
  before: number
}

export async function signInWithEmailedLink(
  page: Page,
  context: BrowserContext,
  email: string,
  { firstStep, who }: { firstStep: number; who: string }
): Promise<SignInResult> {
  const step = (offset: number) => `step ${firstStep + offset}`
  const linksFor = () => readOutbox().filter((entry) => entry.to === email).length
  const before = linksFor()

  // 1. Request the link, as a user would.
  // Wait for React to claim the server-rendered form: typed before hydration,
  // the value is reset and the submit is lost (MEASURED on the first run of
  // F9: the field was empty and no request was sent). `__reactEvents` is the
  // interactivity signal `retirement-plan-persistence.spec.ts` uses.
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="email"]')
    return !!input && Object.keys(input).some((key) => key.startsWith('__reactEvents'))
  })
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Check your email' }),
    `${step(0)}: the request form never confirmed the request`
  ).toBeVisible()

  // 2. The email: exactly one new link for this address. The send is
  // fire-and-forget after the response (no enumeration by timing), so poll.
  await expect
    .poll(() => linksFor() - before, {
      message: `${step(1)}: no sign-in link reached the mail outbox for ${who}`,
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  const fresh = readOutbox()
    .filter((entry) => entry.to === email)
    .slice(before)
  expect(fresh, `${step(1)}: the outbox holds exactly one link for this request`).toHaveLength(1)
  const link = new URL(fresh[0]?.link ?? '')
  expect(link.pathname, `${step(1)}: the emailed link is the verify route`).toBe(
    '/api/auth/login/verify'
  )

  // 3. Open it: the interstitial names the account and does NOT sign in yet.
  // Steps 3-4 are page loads on a possibly cold dev server (F10 measured a
  // network-gated wait at 8.8 s under concurrent gates): the settle budget.
  await page.goto(link.toString())
  await expect(
    page.getByText(`You're about to sign in as ${email}.`),
    `${step(2)}: the link did not open the confirm interstitial (token rejected on GET?)`
  ).toBeVisible({ timeout: SESSION_SETTLE_MS })
  expect(
    (await context.cookies()).some((cookie) => cookie.name === 'session'),
    `${step(2)}: opening the link must not sign in before the confirm`
  ).toBe(false)

  // 4. Confirm.
  await page.getByRole('button', { name: 'Sign in to this account' }).click()
  await expect(
    page,
    `${step(3)}: confirming did not sign in (redirected to the invalid-or-expired page?)`
  ).toHaveURL(/^https?:\/\/[^/?#]+\/$/, { timeout: SESSION_SETTLE_MS })

  return { linksFor, before }
}
