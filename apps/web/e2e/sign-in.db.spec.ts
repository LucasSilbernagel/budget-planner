import { expect, test } from '@playwright/test'
import { SESSION_SETTLE_MS, accountTrigger, expectSignedInAs } from './helpers/account-menu'
import { SEEDED_USER } from './helpers/db-harness'
import { signInWithEmailedLink } from './helpers/magic-link'

// Only chromium-db (:5176) runs `.db.spec.ts`: it alone has a database and the mail
// outbox. Nothing is mocked; the link is read from the dev-only outbox.

test('F9: request a magic link, follow it, confirm, and land signed in', async ({
  page,
  context,
}) => {
  const email = SEEDED_USER.email

  await page.goto('/login')
  const { linksFor, before } = await signInWithEmailedLink(page, context, email, {
    firstStep: 1,
    who: 'the seeded user',
  })

  await expectSignedInAs(page, email)
  await expect(accountTrigger(page), 'step 5: no account menu').toBeVisible({
    timeout: SESSION_SETTLE_MS,
  })
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).locator('a[href="/financial-summary"]'),
    'step 5: the nav is not the paid nav'
  ).toHaveCount(1)
  const session = (await context.cookies()).find((cookie) => cookie.name === 'session')
  expect(session, 'step 5: no session cookie').toBeDefined()
  expect(session?.httpOnly, 'step 5: the session cookie must be HttpOnly').toBe(true)

  const me = await page.request.get('/api/auth/me')
  expect(me.status(), 'step 6: /api/auth/me').toBe(200)
  const body = (await me.json()) as { user: { email: string; subscriptionStatus: string } | null }
  expect(body.user?.email, 'step 6: /api/auth/me is not the signed-in user').toBe(email)
  expect(body.user?.subscriptionStatus).toBe('active')

  expect(linksFor() - before, 'the flow sent more than one link').toBe(1)
})
