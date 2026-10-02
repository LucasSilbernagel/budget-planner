import { expect, test } from '@playwright/test'
import { SESSION_SETTLE_MS, accountTrigger, expectSignedInAs } from './helpers/account-menu'
import { SEEDED_USER } from './helpers/db-harness'
import { signInWithEmailedLink } from './helpers/magic-link'

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
 * broke (story 87.1, AC 3), not as a timeout further on. Steps 1-4 live in
 * `helpers/magic-link.ts` since story 87.2, which F10 (the upgrade) signs in
 * with too; the messages are unchanged.
 */

test('F9: request a magic link, follow it, confirm, and land signed in', async ({
  page,
  context,
}) => {
  const email = SEEDED_USER.email

  // 1-4. Request the link on /login, read it from the outbox, open it, confirm.
  await page.goto('/login')
  const { linksFor, before } = await signInWithEmailedLink(page, context, email, {
    firstStep: 1,
    who: 'the seeded user',
  })

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
  expect(linksFor() - before, 'the flow sent more than one link').toBe(1)
})
