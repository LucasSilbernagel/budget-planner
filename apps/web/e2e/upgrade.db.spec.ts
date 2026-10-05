import { expect, test } from '@playwright/test'
import { SESSION_SETTLE_MS, accountTrigger, expectSignedInAs } from './helpers/account-menu'
import { DB_SERVER_PORT, FAKE_PADDLE } from './helpers/db-harness'
import { signInWithEmailedLink } from './helpers/magic-link'
import { STUB_TOTALS, installPaddleStub } from './helpers/paddle-stub'
import { deliverWebhook, subscriptionCreatedPayload } from './helpers/paddle-webhook'

/**
 * Flow F10: an upgrade, from `/pricing` to premium access (story 87.2, FR141;
 * added to FR137's closed D4 flow list).
 *
 * The REAL purchase flow of a new buyer (decision D1): checkout is not
 * auth-gated, the Paddle WEBHOOK creates the account, and the buyer then signs
 * in from `/welcome` with the email they paid with. So "premium without a
 * reload" is not a step here: premium arrives with the sign-in.
 *
 * ⚠️ `.db.spec.ts` is load-bearing: only `chromium-db` (:5176) runs it, the
 * only server with a database (the webhook writes `users` and the default
 * profile) and the mail outbox (the sign-in link).
 *
 * What is real and what is not:
 *   - FAKE: Paddle.js (decision D2, `helpers/paddle-stub.ts`: every browser
 *     request to `*.paddle.com` is answered by the test), and Paddle itself
 *     (decision D3: the TEST builds and signs the `subscription.created`, with
 *     `FAKE_PADDLE.webhookSecret`, the obvious fake the server is booted with).
 *   - REAL: `/pricing`, `/api/paddle/checkout-config`, the app's calls into
 *     Paddle.js, `/welcome`, the webhook route (signature, max age, event
 *     claim, user insert, default profile), and the whole F9 sign-in.
 *   - ⚠️ Fidelity limit (story 87.2 K4): the buyer's email is INLINE in the
 *     webhook, which real Paddle subscription payloads do not do, so the
 *     customer-API lookup is not exercised (its unit tests cover it). The
 *     `:5176` server cannot reach Paddle anyway: its outbound HTTP goes to a
 *     closed local proxy port (`playwright.config.ts`).
 *
 * Each step's assertion names the step, so a break fails AT the step that
 * broke (story 87.2, AC 3), not as a timeout further on.
 *
 * Retry-safe (87.1 review: the database and the outbox live for the RUN, not
 * the attempt): every attempt buys as a NEW customer, with its own email,
 * customer id and event id, so a retry never sees an earlier attempt's link,
 * user or claimed event.
 */

// `page.route` does not see a service worker's requests, and the dev server
// registers one: blocked, so every `*.paddle.com` request reaches the stub.
test.use({ serviceWorkers: 'block' })

const ORIGIN = `http://localhost:${DB_SERVER_PORT}`

test('F10: buy Premium on /pricing, the webhook lands, sign in, and Premium is there', async ({
  page,
  context,
}, testInfo) => {
  const attempt = `${Date.now()}r${testInfo.retry}`
  const email = `f10-buyer-${attempt}@example.test`
  const customerId = `ctm_e2e_f10_${attempt}`
  // The page's sync requests wait until step 9 has read the profiles (there).
  let releaseSync: () => void = () => {}
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve
  })
  await page.route('**/api/sync/**', async (route) => {
    await syncGate
    await route.continue()
  })
  const stub = await installPaddleStub(page, {
    [FAKE_PADDLE.monthlyPriceId]: STUB_TOTALS.monthly,
    [FAKE_PADDLE.annualPriceId]: STUB_TOTALS.annual,
    [FAKE_PADDLE.lifetimePriceId]: STUB_TOTALS.lifetime,
  })

  // 1. An anonymous visitor chooses the annual plan on /pricing.
  const checkoutConfig = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/paddle/checkout-config'
  )
  await page.goto('/pricing')
  const config = await checkoutConfig
  expect(config.status(), 'step 1: /api/paddle/checkout-config refused the visitor').toBe(200)
  // Positive anchor first, so the absence below cannot pass on an unrendered nav.
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).locator('a[href="/income"]').first(),
    'step 1: the primary nav did not render'
  ).toBeAttached()
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).locator('a[href="/financial-summary"]'),
    'step 1: the visitor must start on the FREE nav (a control for step 10)'
  ).toHaveCount(0)
  // The stub's localized total, not the static `€39/yr` fallback: proves
  // Paddle.js (the stub) loaded and `PricePreview` answered, and that the
  // component has hydrated (the label is set by an effect).
  // ⚠️ Network-gated, not a rendered fact: config fetch, then the lazy
  // `@paddle/paddle-js` chunk, the script, `PricePreview`, and a re-render. On
  // a cold dev server under concurrent `pnpm gates` that took longer than the
  // default 5 s (MEASURED: failed at 8.8 s with every plan still disabled),
  // hence the `SESSION_SETTLE_MS` budget the other network-gated waits use.
  const annual = page.getByRole('radio', { name: `Annual · ${STUB_TOTALS.annual}` })
  await expect(
    annual,
    'step 1: the annual plan never showed the Paddle.js price (stub not loaded?)'
  ).toBeVisible({ timeout: SESSION_SETTLE_MS })
  await annual.click()
  await expect(annual, 'step 1: the annual plan is not selected').toHaveAttribute(
    'aria-checked',
    'true'
  )
  await page.getByRole('button', { name: 'Get Premium' }).click()

  // 2. The app opened checkout for the annual price, with /welcome as the
  // success URL; the stub then completed it, as a real overlay does.
  await expect
    .poll(() => stub.checkoutOpens().length, {
      message: 'step 2: Get Premium never called Paddle.Checkout.open',
    })
    .toBe(1)
  // Soft: a wrong argument is reported AND the flow goes on, so a dropped
  // `successUrl` also shows where the buyer ends up (AC 3 (iii)).
  const opened = stub.checkoutOpens()[0] ?? {}
  expect
    .soft(opened['items'], 'step 2: checkout must be for the annual price only')
    .toEqual([{ priceId: FAKE_PADDLE.annualPriceId, quantity: 1 }])
  const settings = (opened['settings'] ?? {}) as Record<string, unknown>
  expect
    .soft(String(settings['successUrl']), 'step 2: successUrl must end in /welcome')
    .toMatch(/\/welcome$/)
  expect
    .soft(opened['customer'], 'step 2: an anonymous buyer has no email to pre-fill')
    .toBeUndefined()
  // Page loads on a cold dev server: the same network-gated budget as step 1.
  await expect(page, 'step 2: the completed checkout never reached /welcome').toHaveURL(
    `${ORIGIN}/welcome`,
    { timeout: SESSION_SETTLE_MS }
  )
  await expect(
    page.getByRole('heading', { name: /Welcome to Premium/ }),
    'step 2: /welcome did not render'
  ).toBeVisible({ timeout: SESSION_SETTLE_MS })

  // 3. Paddle's webhook: a signed `subscription.created` for this new customer.
  // `expect.soft`: on a refused delivery the test goes on and ALSO fails at
  // the sign-in (step 5), which is what a buyer would meet (AC 3 (ii)).
  const delivered = await deliverWebhook(
    page.request,
    subscriptionCreatedPayload({ customerId, email, priceId: FAKE_PADDLE.annualPriceId }),
    FAKE_PADDLE.webhookSecret
  )
  expect
    .soft(delivered.status(), `step 3: the webhook was refused: ${await delivered.text()}`)
    .toBe(200)

  // 4. /welcome's sign-in, as the buyer follows it.
  await page.getByRole('link', { name: 'Sign in to your account' }).click()
  await expect(page, 'step 4: /welcome did not lead to the sign-in page').toHaveURL(
    `${ORIGIN}/login`,
    { timeout: SESSION_SETTLE_MS }
  )

  // 5-8. F9's magic-link sign-in, with the email used at checkout. "No link"
  // at step 6 means the webhook created no account for this address.
  const { linksFor, before } = await signInWithEmailedLink(page, context, email, {
    firstStep: 5,
    who: 'the new buyer (no account: was the webhook processed?)',
  })

  // 9. The server agrees: the webhook's user is `active`, with a default
  // profile. Read BEFORE the page may sync: the sync pull also creates a
  // missing default profile (`routes/api/sync/changes.ts`'s backfill), which
  // would hide a webhook that made none. The page's `/api/sync/*` requests are
  // held (see the top) until this step has read `/api/profiles`, so only the
  // WEBHOOK can have made what it finds. (`page.request` is not routed.)
  const me = await page.request.get('/api/auth/me')
  expect(me.status(), 'step 9: /api/auth/me').toBe(200)
  const meBody = (await me.json()) as {
    user: { email: string; subscriptionStatus: string } | null
  }
  expect(meBody.user?.email, 'step 9: /api/auth/me is not the buyer').toBe(email)
  expect(meBody.user?.subscriptionStatus, 'step 9: the buyer is not active').toBe('active')
  const profiles = await page.request.get('/api/profiles')
  expect(profiles.status(), 'step 9: /api/profiles (premium-gated)').toBe(200)
  const profilesBody = (await profiles.json()) as { data: Array<{ isDefault: boolean }> }
  expect(
    profilesBody.data.filter((profile) => profile.isDefault),
    'step 9: the webhook made no default profile for the buyer'
  ).toHaveLength(1)
  releaseSync()

  // 10. Premium: the account chrome, the PAID nav, and the paid Overview.
  await expectSignedInAs(page, email)
  await expect(accountTrigger(page), 'step 10: no account menu').toBeVisible({
    timeout: SESSION_SETTLE_MS,
  })
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).locator('a[href="/financial-summary"]'),
    'step 10: the nav is not the paid nav'
  ).toHaveCount(1)
  // The paid Overview drops the "Premium Features" upsell (F5's claim), next
  // to a positive anchor so the absence cannot pass on an unrendered page.
  await expect(page.getByText('Track your finances with privacy and control')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Premium Features' }),
    'step 10: the Overview still shows the free upsell'
  ).toHaveCount(0)

  // 11. No request left for Paddle (AC 4): the page asked `*.paddle.com` for
  // exactly one thing, the Paddle.js script, and the stub answered it.
  expect(stub.paddleRequests, 'step 11: a *.paddle.com request was not the stub').toEqual([
    { url: 'https://cdn.paddle.com/paddle/v2/paddle.js', answer: 'stub' },
  ])
  expect(
    stub.calls.filter((call) => call.method === 'Environment.set').map((call) => call.args[0]),
    'step 11: Paddle.js must run in the sandbox environment'
  ).toEqual(['sandbox'])
  // The token the browser got is the obvious fake (AC 4), not an ambient one.
  expect(
    stub.calls.filter((call) => call.method === 'Initialize').map((call) => call.args[0]),
    'step 11: Paddle.js must be initialized with the fake client token'
  ).toEqual([expect.objectContaining({ token: FAKE_PADDLE.clientToken })])
  expect(linksFor() - before, 'the flow sent more than one link').toBe(1)
})
