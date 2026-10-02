import { expect, test } from '@playwright/test'
import { SESSION_SETTLE_MS, accountTrigger, expectSignedInAs } from './helpers/account-menu'
import { SEEDED_USER, readOutbox } from './helpers/db-harness'

/**
 * Flow F9: a REAL sign-in, from the email request to a signed-in page
 * (story 87.1, FR141; added to FR137's closed D4 flow list).
 *
 * ⚠️ `.db.spec.ts` is load-bearing: only the `chromium-db` project (:5176)
 * runs this file, and only that server has a database (a migrated PGlite over
 * the wire, `helpers/pglite-server.mjs`) and the mail outbox. Rename it and it
 * runs on the DB-less :5173, where every step fails for a reason that says
 * nothing about sign-in.
 *
 * Nothing is mocked: `/api/auth/login/request` (DB rate limit, user lookup,
 * token insert, send), the emailed link (read from the dev-only outbox, the one
 * seam, because the token is stored hashed and cannot be read back), the
 * confirm interstitial (CSRF double-submit), `verifyMagicLink`, the session
 * cookie and `/api/auth/me` all run for real. Brevo is never called: the
 * server has no `EMAIL_API_KEY`, so the mailer takes its development branch.
 *
 * Each step's assertion names the step, so a break fails AT the step that
 * broke (story 87.1, AC 3), not as a timeout further on.
 */

test('F9: request a magic link, follow it, confirm, and land signed in', async ({
  page,
  context,
}) => {
  const email = SEEDED_USER.email
  const linksFor = () => readOutbox().filter((entry) => entry.to === email)
  const before = linksFor().length

  // 1. Request the link, as a user would.
  await page.goto('/login')
  // Wait for React to claim the server-rendered form: typed before hydration,
  // the value is reset and the submit is lost (MEASURED on the first run of
  // this spec: the field was empty and no request was sent). `__reactEvents`
  // is the interactivity signal `retirement-plan-persistence.spec.ts` uses.
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="email"]')
    return !!input && Object.keys(input).some((key) => key.startsWith('__reactEvents'))
  })
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Check your email' }),
    'step 1: the request form never confirmed the request'
  ).toBeVisible()

  // 2. The email: exactly one new link for this address. The send is
  // fire-and-forget after the response (no enumeration by timing), so poll.
  await expect
    .poll(() => linksFor().length - before, {
      message: 'step 2: no sign-in link reached the mail outbox for the seeded user',
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  const fresh = linksFor().slice(before)
  expect(fresh, 'step 2: the outbox holds exactly one link for this request').toHaveLength(1)
  const link = new URL(fresh[0]?.link ?? '')
  expect(link.pathname, 'step 2: the emailed link is the verify route').toBe(
    '/api/auth/login/verify'
  )

  // 3. Open it: the interstitial names the account and does NOT sign in yet.
  await page.goto(link.toString())
  await expect(
    page.getByText(`You're about to sign in as ${email}.`),
    'step 3: the link did not open the confirm interstitial (token rejected on GET?)'
  ).toBeVisible()
  expect(
    (await context.cookies()).some((cookie) => cookie.name === 'session'),
    'step 3: opening the link must not sign in before the confirm'
  ).toBe(false)

  // 4. Confirm.
  await page.getByRole('button', { name: 'Sign in to this account' }).click()
  await expect(
    page,
    'step 4: confirming did not sign in (redirected to the invalid-or-expired page?)'
  ).toHaveURL(/^https?:\/\/[^/?#]+\/$/)

  // 5. Signed in: the account chrome and the PAID nav, from the real session.
  await expectSignedInAs(page, email)
  await expect(accountTrigger(page), 'step 5: no account menu').toBeVisible({
    timeout: SESSION_SETTLE_MS,
  })
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).locator('a[href="/report"]'),
    'step 5: the nav is not the paid nav'
  ).toHaveCount(1)
  const session = (await context.cookies()).find((cookie) => cookie.name === 'session')
  expect(session, 'step 5: no session cookie').toBeDefined()
  expect(session?.httpOnly, 'step 5: the session cookie must be HttpOnly').toBe(true)

  // 6. The server agrees.
  const me = await page.request.get('/api/auth/me')
  expect(me.status(), 'step 6: /api/auth/me').toBe(200)
  const body = (await me.json()) as { user: { email: string; subscriptionStatus: string } | null }
  expect(body.user?.email, 'step 6: /api/auth/me is not the signed-in user').toBe(email)
  expect(body.user?.subscriptionStatus).toBe('active')

  // Still exactly one link: the flow sent no second email.
  expect(linksFor().length - before, 'the flow sent more than one link').toBe(1)
})
