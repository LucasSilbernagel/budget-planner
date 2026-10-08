import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
	getPaddleConfig,
	assertPaddleProductionConfig,
	fetchPaddleCustomerEmail,
	createDefaultProfileForUser,
	captureError,
	transaction,
	setSpy,
	insertValuesSpy,
	dbHasUser,
} = vi.hoisted(() => ({
	getPaddleConfig: vi.fn(),
	assertPaddleProductionConfig: vi.fn(),
	fetchPaddleCustomerEmail: vi.fn(),
	createDefaultProfileForUser: vi.fn(),
	captureError: vi.fn(),
	transaction: vi.fn(),
	setSpy: vi.fn(),
	insertValuesSpy: vi.fn(),
	dbHasUser: { value: true },
}))

vi.mock('@budget-planner/config', () => ({ getPaddleConfig, assertPaddleProductionConfig }))
vi.mock('@budget-planner/db', () => ({
	// `select` backs the pre-transaction existence check that decides whether email needs resolving.
	db: {
		transaction,
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => Promise.resolve(dbHasUser.value ? [{ id: 'existing-user-id' }] : []),
				}),
			}),
		}),
	},
	currencyEnum: { enumValues: ['NONE', 'USD', 'EUR'] },
}))
vi.mock('@budget-planner/db/src/schema', () => ({
	users: {
		paddleId: 'paddleId',
		id: 'id',
		email: 'email',
		subscriptionStatus: 'subscriptionStatus',
		isDeleted: 'isDeleted',
		entitlementUpdatedAt: 'entitlementUpdatedAt',
		lifetimeTransactionId: 'lifetimeTransactionId',
		lifetimeGrantTotal: 'lifetimeGrantTotal',
		lifetimeRefundedTotal: 'lifetimeRefundedTotal',
	},
	paddleWebhookEvents: { __table: 'paddleWebhookEvents', eventId: 'eventId' },
}))
// `.where()` is a no-op here; the watermark predicate is exercised against PGlite.
vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	or: vi.fn(),
	isNull: vi.fn(),
	lt: vi.fn(),
	sql: Object.assign(
		vi.fn(() => 'sql-fragment'),
		{ join: vi.fn(() => 'sql-fragment') }
	),
}))
vi.mock('@/server/paddle/customer-api', () => ({ fetchPaddleCustomerEmail }))
vi.mock('@/server/functions/profiles', () => ({ createDefaultProfileForUser }))
vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError }))

import { lt } from 'drizzle-orm'
import { POST } from '../paddle'

const SECRET = 'pdl_ntfset_test_secret'
const LIFETIME_PRICE = 'pri_lifetime_99'
const ANNUAL_PRICE = 'pri_annual_39'
const MONTHLY_PRICE = 'pri_monthly_599'

/**
 * Proves routing and payload shape only: drizzle-orm is mocked, so no `.where()` really matches.
 * The setWhere race guard is covered by neither suite (PGlite has one connection).
 */
function makeTx({
	existingStatus = 'free',
	vanishBeforeUpdate = false,
	updateMatches = true,
}: {
	existingStatus?: string | null
	/** The row is read once, then gone before the UPDATE, as if the retention purge committed between. */
	vanishBeforeUpdate?: boolean
	/** False = the row exists but an in-statement guard suppressed the UPDATE. */
	updateMatches?: boolean
} = {}) {
	const rowCount = existingStatus === null ? 0 : 1
	const selectedRow = existingStatus === null ? undefined : { status: existingStatus }
	let reads = 0
	return {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => {
						reads++
						const present = selectedRow && !(vanishBeforeUpdate && reads > 1)
						return Promise.resolve(present ? [selectedRow] : [])
					},
				}),
			}),
		}),
		update: () => ({
			set: (values: unknown) => {
				setSpy(values)
				const matched = rowCount === 1 && updateMatches && !vanishBeforeUpdate
				return {
					where: () =>
						Object.assign(Promise.resolve({ rowCount: matched ? 1 : 0 }), {
							returning: () => Promise.resolve(matched ? [{ id: 'user-id' }] : []),
						}),
				}
			},
		}),
		insert: (table: unknown) => {
			const isEventClaim = (table as { __table?: string })?.__table === 'paddleWebhookEvents'
			return {
				values: (values: unknown) => {
					if (isEventClaim) {
						return {
							onConflictDoNothing: () => ({
								returning: () => Promise.resolve([{ eventId: 'evt_1' }]),
							}),
						}
					}
					insertValuesSpy(values)
					return {
						onConflictDoUpdate: () => ({
							returning: () => Promise.resolve([{ id: 'new-user-id' }]),
						}),
					}
				},
			}
		},
	}
}

function signedRequest(payloadObj: unknown, opts: { ts?: number; secret?: string } = {}): Request {
	const body = JSON.stringify(payloadObj)
	const ts = opts.ts ?? Math.floor(Date.now() / 1000)
	const h1 = crypto
		.createHmac('sha256', opts.secret ?? SECRET)
		.update(`${ts}:${body}`)
		.digest('hex')
	return new Request('https://app.test/api/webhooks/paddle', {
		method: 'POST',
		headers: { 'paddle-signature': `ts=${ts};h1=${h1}`, 'content-type': 'application/json' },
		body,
	})
}

function config(overrides: Record<string, unknown> = {}) {
	return {
		environment: 'sandbox' as const,
		apiKey: 'pdl_sdbx_key',
		clientToken: 'test_client_token',
		webhookSecret: SECRET,
		webhookMaxAgeSeconds: 300,
		apiBaseUrl: 'https://sandbox-api.paddle.com',
		monthlyPriceId: MONTHLY_PRICE,
		annualPriceId: ANNUAL_PRICE,
		lifetimePriceId: LIFETIME_PRICE,
		isConfigured: true,
		...overrides,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	dbHasUser.value = true
	getPaddleConfig.mockReturnValue(config())
	fetchPaddleCustomerEmail.mockResolvedValue(undefined)
	createDefaultProfileForUser.mockResolvedValue({ success: true, data: {} })
	transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
		cb(makeTx({ existingStatus: 'free' }))
	)
})

describe('POST /api/webhooks/paddle — signature verification (AC-4)', () => {
	it('accepts a valid, fresh Billing signature', async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.created',
				data: { customer_id: 'ctm_1', status: 'active', email: 'a@example.com' },
			}),
		})
		expect(res.status).toBe(200)
	})

	it('rejects a tampered h1 — same length as a real HMAC, wrong value (401)', async () => {
		// Full-length wrong h1, so the comparison reaches timingSafeEqual past the length pre-check.
		const body = JSON.stringify({
			event_type: 'subscription.created',
			data: { customer_id: 'ctm_1', status: 'active' },
		})
		const ts = Math.floor(Date.now() / 1000)
		const wrongButRightLength = '0'.repeat(64)
		const req = new Request('https://app.test/api/webhooks/paddle', {
			method: 'POST',
			headers: { 'paddle-signature': `ts=${ts};h1=${wrongButRightLength}` },
			body,
		})
		const res = await POST({ request: req })
		expect(res.status).toBe(401)
		expect(transaction).not.toHaveBeenCalled()
	})

	it('rejects a validly-formed signature computed over a DIFFERENT body', async () => {
		const signedForOtherBody = signedRequest({
			event_type: 'subscription.created',
			data: { customer_id: 'ctm_1', status: 'active' },
		})
		const ts = signedForOtherBody.headers.get('paddle-signature')?.match(/ts=(\d+)/)?.[1]
		const req = new Request('https://app.test/api/webhooks/paddle', {
			method: 'POST',
			headers: {
				'paddle-signature': signedForOtherBody.headers.get('paddle-signature') ?? '',
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				event_type: 'subscription.created',
				data: { customer_id: 'ctm_ATTACKER', status: 'active' },
			}),
		})
		expect(ts).toBeDefined()
		const res = await POST({ request: req })
		expect(res.status).toBe(401)
		expect(transaction).not.toHaveBeenCalled()
	})

	it('rejects a stale timestamp outside the freshness window (401)', async () => {
		const res = await POST({
			request: signedRequest(
				{ event_type: 'subscription.created', data: { customer_id: 'ctm_1', status: 'active' } },
				{ ts: Math.floor(Date.now() / 1000) - 3600 }
			),
		})
		expect(res.status).toBe(401)
	})

	it('accepts when ANY of multiple h1 values matches (Paddle secret rotation)', async () => {
		const body = JSON.stringify({
			event_type: 'subscription.created',
			data: { customer_id: 'ctm_1', status: 'active', email: 'a@example.com' },
		})
		const ts = Math.floor(Date.now() / 1000)
		const good = crypto.createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex')
		const req = new Request('https://app.test/api/webhooks/paddle', {
			method: 'POST',
			// old (wrong) secret first, then the current one — the loop must not stop at the first
			headers: {
				'paddle-signature': `ts=${ts};h1=${'0'.repeat(64)};h1=${good}`,
				'content-type': 'application/json',
			},
			body,
		})
		const res = await POST({ request: req })
		expect(res.status).toBe(200)
	})

	it('rejects a missing signature header (401)', async () => {
		const res = await POST({
			request: new Request('https://app.test/api/webhooks/paddle', {
				method: 'POST',
				body: JSON.stringify({ event_type: 'subscription.created', data: {} }),
			}),
		})
		expect(res.status).toBe(401)
	})
})

describe('POST /api/webhooks/paddle — lifetime purchase (AC-3, story 25-2)', () => {
	it('persists subscriptionStatus="lifetime" for a lifetime line-item transaction', async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_1',
					email: 'buyer@example.com',
					currency_code: 'EUR',
					items: [{ price: { id: LIFETIME_PRICE } }],
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(transaction).toHaveBeenCalledTimes(1)
		// `currency` deliberately absent: billing currency must not overwrite the display currency.
		expect(setSpy).toHaveBeenCalledWith({
			subscriptionStatus: 'lifetime',
			entitlementUpdatedAt: expect.any(Number),
			billingInterval: null,
			accessEndedAt: null,
			retentionNoticeSentAt: null,
			retentionNoticeAttemptedAt: null,
			lifetimeGrantTotal: 9900,
		})
	})

	it('also reads the price from a direct price_id field', async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_2',
					email: 'b@example.com',
					price_id: LIFETIME_PRICE,
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'lifetime' }))
	})

	it('grants when the lifetime item is NOT the first line item (multi-item bundle)', async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_4',
					email: 'c@example.com',
					items: [{ price: { id: ANNUAL_PRICE } }, { price: { id: LIFETIME_PRICE } }],
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'lifetime' }))
	})

	it('trims whitespace on the configured lifetime price id before matching', async () => {
		getPaddleConfig.mockReturnValue(config({ lifetimePriceId: `  ${LIFETIME_PRICE}\n` }))
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_5',
					email: 'd@example.com',
					price_id: LIFETIME_PRICE,
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'lifetime' }))
	})

	it('creates a new user as "lifetime" when none exists yet (insert path)', async () => {
		dbHasUser.value = false
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: null }))
		)
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_new',
					email: 'New@Example.com',
					price_id: LIFETIME_PRICE,
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(insertValuesSpy).toHaveBeenCalledWith(
			expect.objectContaining({ subscriptionStatus: 'lifetime', email: 'new@example.com' })
		)
	})

	it('resolves the buyer email from the Billing customer API when the payload omits it', async () => {
		fetchPaddleCustomerEmail.mockResolvedValue('resolved@example.com')
		dbHasUser.value = false
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: null }))
		)
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_api',
					price_id: LIFETIME_PRICE,
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(fetchPaddleCustomerEmail).toHaveBeenCalledWith('ctm_api')
		expect(insertValuesSpy).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'resolved@example.com' })
		)
	})

	it("does NOT overwrite an existing user's currency when the payload omits currency", async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_6',
					email: 'e@example.com',
					price_id: LIFETIME_PRICE,
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).toHaveBeenCalledWith({
			subscriptionStatus: 'lifetime',
			entitlementUpdatedAt: expect.any(Number),
			billingInterval: null,
			accessEndedAt: null,
			retentionNoticeSentAt: null,
			retentionNoticeAttemptedAt: null,
			lifetimeGrantTotal: 9900,
		})
	})

	it('ignores a transaction for a NON-lifetime price (annual renewal invoice)', async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_1',
					items: [{ price: { id: ANNUAL_PRICE } }],
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(transaction).not.toHaveBeenCalled()
		expect(setSpy).not.toHaveBeenCalled()
	})

	it('fails closed when PADDLE_LIFETIME_PRICE_ID is not configured', async () => {
		getPaddleConfig.mockReturnValue(config({ lifetimePriceId: undefined }))
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_1',
					price_id: LIFETIME_PRICE,
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(transaction).not.toHaveBeenCalled()
	})

	it('returns 500 (Paddle retries) when the grant persists nothing — no silent loss', async () => {
		dbHasUser.value = false
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: null }))
		)
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_noemail',
					price_id: LIFETIME_PRICE,
				},
			}),
		})

		expect(res.status).toBe(500)
		expect(insertValuesSpy).not.toHaveBeenCalled()
		expect(captureError).toHaveBeenCalled()
	})

	it('grants lifetime for an EXISTING subscriber without ever resolving email — the update path needs it for nothing', async () => {
		// Email resolves lazily, only for a new row: the malformed mock proves it via the call count.
		fetchPaddleCustomerEmail.mockResolvedValue('not-an-email')
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_1',
					price_id: LIFETIME_PRICE,
				},
			}),
		})

		expect(res.status).toBe(200)
		// Exact match, not `objectContaining` — proves email is NOT written on
		// the update path, not merely that status is.
		expect(setSpy).toHaveBeenCalledWith({
			subscriptionStatus: 'lifetime',
			entitlementUpdatedAt: expect.any(Number),
			billingInterval: null,
			accessEndedAt: null,
			retentionNoticeSentAt: null,
			retentionNoticeAttemptedAt: null,
			lifetimeGrantTotal: 9900,
		})
		expect(fetchPaddleCustomerEmail).not.toHaveBeenCalled()
	})

	it('still fails closed for a first-seen buyer whose resolved email is malformed', async () => {
		dbHasUser.value = false
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: null }))
		)
		fetchPaddleCustomerEmail.mockResolvedValue('not-an-email')
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_bademail',
					price_id: LIFETIME_PRICE,
				},
			}),
		})

		expect(res.status).toBe(500)
		expect(insertValuesSpy).not.toHaveBeenCalled()
		expect(captureError).toHaveBeenCalled()
	})
})

describe('POST /api/webhooks/paddle — subscription path (regression + no-downgrade)', () => {
	it('activates Premium on subscription.created for an existing user', async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.created',
				data: { customer_id: 'ctm_1', status: 'active', email: 'sub@example.com' },
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'active' }))
	})

	// The subscription path is price-agnostic; only `transaction.completed` keys off the lifetime
	// price, so these pin that a monthly buyer can never get a lifetime grant.

	it('routes a monthly-priced subscription.created down the price-AGNOSTIC subscription path', async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.created',
				data: {
					customer_id: 'ctm_monthly',
					status: 'active',
					email: 'monthly@example.com',
					items: [{ price: { id: MONTHLY_PRICE } }],
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'active' }))
		expect(setSpy).not.toHaveBeenCalledWith(
			expect.objectContaining({ subscriptionStatus: 'lifetime' })
		)
	})

	it('does NOT treat a monthly transaction.completed as a lifetime purchase', async () => {
		// A monthly subscription's first invoice also arrives as `transaction.completed`.
		const res = await POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					// A real positive grand_total is essential: without it the later no-total guard refuses,
					// and the test would pass whether or not the price-id match works.
					details: { totals: { grand_total: '599' } },
					customer_id: 'ctm_monthly',
					items: [{ price: { id: MONTHLY_PRICE } }],
				},
			}),
		})

		expect(res.status).toBe(200)
		// Asserted as "never opened a transaction"; a not-written-as-lifetime check was vacuous.
		expect(transaction).not.toHaveBeenCalled()
		expect(setSpy).not.toHaveBeenCalled()
		expect(insertValuesSpy).not.toHaveBeenCalled()
	})

	it('downgrades on cancellation for any non-lifetime row, monthly included', async () => {
		// The no-downgrade guard protects lifetime rows only; a monthly subscriber who cancels must lose access.
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.canceled',
				data: {
					customer_id: 'ctm_monthly',
					status: 'canceled',
					items: [{ price: { id: MONTHLY_PRICE } }],
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'canceled' }))
	})

	it('maps subscription.updated status=past_due to past_due', async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.updated',
				data: { customer_id: 'ctm_1', status: 'past_due' },
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'past_due' }))
	})

	it('NEVER downgrades a lifetime buyer when their subscription is canceled', async () => {
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: 'lifetime' }))
		)
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.canceled',
				data: { customer_id: 'ctm_lifer', status: 'canceled', email: 'lifer@example.com' },
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).not.toHaveBeenCalled()
		expect(insertValuesSpy).not.toHaveBeenCalled()
	})

	it('returns 500 (Paddle retries) when a first-seen subscriber has no resolvable email', async () => {
		dbHasUser.value = false
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: null }))
		)
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.created',
				data: { customer_id: 'ctm_new_sub', status: 'active' },
			}),
		})

		expect(res.status).toBe(500)
		expect(insertValuesSpy).not.toHaveBeenCalled()
		expect(captureError).toHaveBeenCalled()
	})

	it('updates an EXISTING subscriber without ever resolving email — the update path needs it for nothing', async () => {
		// Email resolves lazily, only for a new row, so a malformed API address can't block a cancel.
		fetchPaddleCustomerEmail.mockResolvedValue('not-an-email')
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.canceled',
				data: { customer_id: 'ctm_1', status: 'canceled' },
			}),
		})

		expect(res.status).toBe(200)
		// Exact match, not `objectContaining` — proves email is NOT written on
		// the update path, not merely that status is.
		expect(setSpy).toHaveBeenCalledWith({
			subscriptionStatus: 'canceled',
			entitlementUpdatedAt: expect.any(Number),
			accessEndedAt: 'sql-fragment',
		})
		expect(fetchPaddleCustomerEmail).not.toHaveBeenCalled()
	})

	it('writes the plan cadence in the SAME update as the status when the payload states one (Story 70.1)', async () => {
		// `toHaveBeenCalledWith` ignores undefined-valued props, so this can't prove an absent cycle
		// omits the key; the db suite proves that.
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.updated',
				data: {
					customer_id: 'ctm_1',
					status: 'active',
					billing_cycle: { interval: 'year', frequency: 1 },
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(setSpy).toHaveBeenCalledTimes(1)
		expect(setSpy).toHaveBeenCalledWith({
			subscriptionStatus: 'active',
			entitlementUpdatedAt: expect.any(Number),
			billingInterval: 'year',
			accessEndedAt: null,
			retentionNoticeSentAt: null,
			retentionNoticeAttemptedAt: null,
		})
	})

	it.each([
		[
			'subscription UPDATE',
			{ event_type: 'subscription.updated', data: { customer_id: 'ctm_1', status: 'active' } },
		],
		[
			'lifetime UPDATE',
			{
				event_type: 'transaction.completed',
				data: {
					id: 'txn_1',
					customer_id: 'ctm_1',
					status: 'completed',
					items: [{ price: { id: LIFETIME_PRICE } }],
					details: { totals: { grand_total: '9900' } },
				},
			},
		],
	])(
		'the %s carries the watermark IN its WHERE, not only as a pre-read (Story 70.1 review)',
		async (_, event) => {
			// Only `entitlementWatermarkGuard` calls `lt`, so its presence shows the UPDATE is guarded in-statement.
			const occurredAt = '2026-09-25T12:00:00.000Z'
			const res = await POST({ request: signedRequest({ ...event, occurred_at: occurredAt }) })

			expect(res.status).toBe(200)
			expect(setSpy).toHaveBeenCalledTimes(1)
			expect(lt).toHaveBeenCalledWith(expect.anything(), Date.parse(occurredAt))
		}
	)

	it('still fails closed for a first-seen subscriber whose resolved email is malformed', async () => {
		dbHasUser.value = false
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: null }))
		)
		fetchPaddleCustomerEmail.mockResolvedValue('not-an-email')
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.created',
				data: { customer_id: 'ctm_bademail_sub', status: 'active' },
			}),
		})

		expect(res.status).toBe(500)
		expect(insertValuesSpy).not.toHaveBeenCalled()
		expect(captureError).toHaveBeenCalled()
	})

	it('returns 500 (Paddle retries) when the subscription transaction throws', async () => {
		transaction.mockRejectedValue(new Error('deadlock'))
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.updated',
				data: { customer_id: 'ctm_1', status: 'canceled', email: 'x@example.com' },
			}),
		})
		expect(res.status).toBe(500)
	})

	it('creates a default profile for a first-seen subscriber (sole account-creation path)', async () => {
		dbHasUser.value = false
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: null }))
		)
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.created',
				data: { customer_id: 'ctm_fresh', status: 'active', email: 'fresh@example.com' },
			}),
		})

		expect(res.status).toBe(200)
		expect(insertValuesSpy).toHaveBeenCalledWith(
			expect.objectContaining({ subscriptionStatus: 'active', email: 'fresh@example.com' })
		)
		expect(createDefaultProfileForUser).toHaveBeenCalledWith('new-user-id')
	})

	it('does NOT create a profile for an existing subscriber (match by customer_id)', async () => {
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.updated',
				data: { customer_id: 'ctm_1', status: 'active' },
			}),
		})

		expect(res.status).toBe(200)
		expect(createDefaultProfileForUser).not.toHaveBeenCalled()
	})

	it('a failed default-profile creation does not fail the webhook (non-fatal)', async () => {
		createDefaultProfileForUser.mockResolvedValue({ success: false, error: 'db down' })
		dbHasUser.value = false
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: null }))
		)
		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.created',
				data: { customer_id: 'ctm_np', status: 'active', email: 'np@example.com' },
			}),
		})

		expect(res.status).toBe(200)
	})
})

describe('Story 73.2, AC-9 — a row that vanishes between read and UPDATE is retried, not dropped', () => {
	// The real interleaving needs two connections; `vanishBeforeUpdate` simulates it.
	function subscriptionActivated() {
		return POST({
			request: signedRequest({
				event_type: 'subscription.activated',
				data: { customer_id: 'ctm_1', status: 'active' },
			}),
		})
	}
	function lifetimeGranted() {
		return POST({
			request: signedRequest({
				event_type: 'transaction.completed',
				data: {
					details: { totals: { grand_total: '9900' } },
					customer_id: 'ctm_1',
					price_id: LIFETIME_PRICE,
				},
			}),
		})
	}

	it('subscription: returns 500 so Paddle retries into the first-seen INSERT path', async () => {
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: 'canceled', vanishBeforeUpdate: true }))
		)

		const res = await subscriptionActivated()

		expect(res.status).toBe(500)
	})

	it('subscription: a guard-suppressed UPDATE on a row that still exists stays a 200 (unchanged)', async () => {
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: 'canceled', updateMatches: false }))
		)

		const res = await subscriptionActivated()

		expect(res.status).toBe(200)
	})

	it('lifetime: returns 500 so Paddle retries the grant', async () => {
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: 'canceled', vanishBeforeUpdate: true }))
		)

		const res = await lifetimeGranted()

		expect(res.status).toBe(500)
	})

	it('subscription: a LAPSED event whose row vanished is NOT retried (review fix) — a retry could only resurrect it', async () => {
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: 'active', vanishBeforeUpdate: true }))
		)

		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.canceled',
				data: { customer_id: 'ctm_1', status: 'canceled' },
			}),
		})

		expect(res.status).toBe(200)
	})

	it('re-key: an adoption target that vanished before the UPDATE returns 500, not a 200 that granted nothing', async () => {
		// First-seen customer (no row by paddleId), whose email matches a lapsed
		// row under another customer — which the purge deletes before the UPDATE.
		dbHasUser.value = false
		fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.com')
		let reads = 0
		const tx = makeTx({ existingStatus: null })
		const adoptionTx = {
			...tx,
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => {
							reads++
							// read 1: by paddleId → none; read 2: by email → the lapsed row.
							return Promise.resolve(
								reads === 2
									? [{ id: 'u-old', paddleId: 'ctm_old', status: 'canceled', isDeleted: false }]
									: []
							)
						},
					}),
				}),
			}),
			update: () => ({
				set: (values: unknown) => {
					setSpy(values)
					return {
						where: () =>
							Object.assign(Promise.resolve({ rowCount: 0 }), {
								returning: () => Promise.resolve([]),
							}),
					}
				},
			}),
		}
		transaction.mockImplementation(async (cb: (t: typeof adoptionTx) => unknown) => cb(adoptionTx))

		const res = await POST({
			request: signedRequest({
				event_type: 'subscription.activated',
				data: { customer_id: 'ctm_new', status: 'active' },
			}),
		})

		expect(res.status).toBe(500)
		expect(insertValuesSpy).not.toHaveBeenCalled()
	})

	it('lifetime: a guard-suppressed UPDATE on a row that still exists stays a 200 (unchanged)', async () => {
		transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
			cb(makeTx({ existingStatus: 'canceled', updateMatches: false }))
		)

		const res = await lifetimeGranted()

		expect(res.status).toBe(200)
	})
})
