import { expect, test } from '@playwright/test'
import { accountTrigger, expectSignedInAs, SESSION_SETTLE_MS } from './helpers/account-menu'
import { DB_SERVER_PORT, FAKE_PADDLE } from './helpers/db-harness'
import { signInWithEmailedLink } from './helpers/magic-link'
import { installPaddleStub, STUB_TOTALS } from './helpers/paddle-stub'
import { deliverWebhook, subscriptionCreatedPayload } from './helpers/paddle-webhook'

// Only chromium-db runs `.db.spec.ts`. The webhook creates the account, so premium
// arrives with the sign-in. Paddle.js and Paddle's webhook are faked by the test.

// Real Paddle subscription payloads don't carry the email inline, so the customer-API
// lookup isn't exercised here.

// page.route doesn't see service-worker requests, so block the dev server's SW.
test.use({ serviceWorkers: 'block' })

const ORIGIN = `http://localhost:${DB_SERVER_PORT}`

test('F10: buy Premium on /pricing, the webhook lands, sign in, and Premium is there', async ({
	page,
	context,
}, testInfo) => {
	const attempt = `${Date.now()}r${testInfo.retry}`
	const email = `f10-buyer-${attempt}@example.test`
	const customerId = `ctm_e2e_f10_${attempt}`
	// Holds the page's sync requests until step 9 has read the profiles.
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

	const checkoutConfig = page.waitForResponse(
		(response) => new URL(response.url()).pathname === '/api/paddle/checkout-config'
	)
	await page.goto('/pricing')
	const config = await checkoutConfig
	expect(config.status(), 'step 1: /api/paddle/checkout-config refused the visitor').toBe(200)
	// Positive anchor first, so the absence below can't pass on an unrendered nav.
	await expect(
		page.getByRole('navigation', { name: 'Primary' }).locator('a[href="/income"]').first(),
		'step 1: the primary nav did not render'
	).toBeAttached()
	await expect(
		page.getByRole('navigation', { name: 'Primary' }).locator('a[href="/financial-summary"]'),
		'step 1: the visitor must start on the FREE nav (a control for step 10)'
	).toHaveCount(0)
	// The stub's total, not the static fallback: proves PricePreview answered after
	// hydration. Network-gated, hence the settle budget.
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

	await expect
		.poll(() => stub.checkoutOpens().length, {
			message: 'step 2: Get Premium never called Paddle.Checkout.open',
		})
		.toBe(1)
	// Soft, so a dropped successUrl also shows where the buyer ends up.
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
	await expect(page, 'step 2: the completed checkout never reached /welcome').toHaveURL(
		`${ORIGIN}/welcome`,
		{ timeout: SESSION_SETTLE_MS }
	)
	await expect(
		page.getByRole('heading', { name: /Welcome to Premium/ }),
		'step 2: /welcome did not render'
	).toBeVisible({ timeout: SESSION_SETTLE_MS })

	// Soft: a refused delivery also fails at sign-in, which is what a buyer would meet.
	const delivered = await deliverWebhook(
		page.request,
		subscriptionCreatedPayload({ customerId, email, priceId: FAKE_PADDLE.annualPriceId }),
		FAKE_PADDLE.webhookSecret
	)
	expect
		.soft(delivered.status(), `step 3: the webhook was refused: ${await delivered.text()}`)
		.toBe(200)

	await page.getByRole('link', { name: 'Sign in to your account' }).click()
	await expect(page, 'step 4: /welcome did not lead to the sign-in page').toHaveURL(
		`${ORIGIN}/login`,
		{ timeout: SESSION_SETTLE_MS }
	)

	// "No link" at step 6 means the webhook created no account for this address.
	const { linksFor, before } = await signInWithEmailedLink(page, context, email, {
		firstStep: 5,
		who: 'the new buyer (no account: was the webhook processed?)',
	})

	// Read before the page may sync: the sync pull backfills a missing default profile,
	// which would hide a webhook that made none. `page.request` isn't routed.
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

	await expectSignedInAs(page, email)
	await expect(accountTrigger(page), 'step 10: no account menu').toBeVisible({
		timeout: SESSION_SETTLE_MS,
	})
	await expect(
		page.getByRole('navigation', { name: 'Primary' }).locator('a[href="/financial-summary"]'),
		'step 10: the nav is not the paid nav'
	).toHaveCount(1)
	// Positive anchor, so the absence can't pass on an unrendered page.
	await expect(page.getByText('Track your finances with privacy and control')).toBeVisible()
	await expect(
		page.getByRole('heading', { name: 'Premium Features' }),
		'step 10: the Overview still shows the free upsell'
	).toHaveCount(0)

	expect(stub.paddleRequests, 'step 11: a *.paddle.com request was not the stub').toEqual([
		{ url: 'https://cdn.paddle.com/paddle/v2/paddle.js', answer: 'stub' },
	])
	expect(
		stub.calls.filter((call) => call.method === 'Environment.set').map((call) => call.args[0]),
		'step 11: Paddle.js must run in the sandbox environment'
	).toEqual(['sandbox'])
	expect(
		stub.calls.filter((call) => call.method === 'Initialize').map((call) => call.args[0]),
		'step 11: Paddle.js must be initialized with the fake client token'
	).toEqual([expect.objectContaining({ token: FAKE_PADDLE.clientToken })])
	expect(linksFor() - before, 'the flow sent more than one link').toBe(1)
})
