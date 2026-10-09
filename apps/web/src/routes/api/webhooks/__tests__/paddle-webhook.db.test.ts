// @vitest-environment node
// Real PostgreSQL (PGlite): the sibling suite mocks drizzle-orm, so its `.where()`s are no-ops.
// Not covered even here: the setWhere race guard, which needs two connections.

import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))
const {
	getPaddleConfig,
	assertPaddleProductionConfig,
	fetchPaddleCustomerEmail,
	captureError,
	sendMagicLinkEmail,
	cancelActiveSubscriptionsForCustomer,
} = vi.hoisted(() => ({
	getPaddleConfig: vi.fn(),
	assertPaddleProductionConfig: vi.fn(),
	fetchPaddleCustomerEmail: vi.fn(),
	captureError: vi.fn(),
	sendMagicLinkEmail: vi.fn(),
	// deleteUserAccount's best-effort Paddle cancel would fetch the live API.
	cancelActiveSubscriptionsForCustomer: vi.fn(),
}))

vi.mock('@budget-planner/db/client', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		get db() {
			return holder.db
		},
	}
})
vi.mock('@budget-planner/config/schema', () => ({
	getPaddleConfig,
	assertPaddleProductionConfig,
	getSessionSecret: () => 'story-70-1-session-secret-at-least-32-chars',
	getSiteUrl: () => 'https://app.test',
}))
vi.mock('@/server/paddle/customer-api', () => ({ fetchPaddleCustomerEmail }))
vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError }))
vi.mock('@/server/email/mailer', () => ({ sendMagicLinkEmail }))
vi.mock('@/server/paddle/subscription-api', () => ({ cancelActiveSubscriptionsForCustomer }))
// Left live, the retention backstop would start a sweep on PGlite's one connection
// mid-test, possibly inside the test's own transaction.
vi.mock('@/server/retention/backstop', () => ({ maybeRunRetentionBackstop: vi.fn() }))

import {
	loginTokens,
	paddleAdjustments,
	paddleWebhookEvents,
	rateLimits,
	userProfiles,
	users,
} from '@budget-planner/db/schema'
import { and, eq } from 'drizzle-orm'
import { planLabel } from '@/lib/account/plan-label'
import { logger } from '@/lib/logger'
import { EMAIL_LIMIT, POST as requestLinkPOST } from '@/routes/api/auth/login/request'
import { deleteUserAccount } from '@/server/api/account'
import { normalizeEmail } from '@/server/api/auth/email'
import { requestMagicLink } from '@/server/api/auth/magic-link'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { signSession } from '@/server/api/auth/session'
import { createDefaultProfileForUser } from '@/server/functions/profiles'
import { checkDbRateLimit } from '@/server/rate-limit/db-window'
import { entitlementWatermarkGuard, POST } from '../paddle'

const MIGRATIONS = new URL('../../../../../../../packages/db/migrations/', import.meta.url)

const SECRET = 'pdl_ntfset_test_secret'
const LIFETIME_PRICE = 'pri_lifetime_99'
const ANNUAL_PRICE = 'pri_annual_39'
const LIFETIME_TOTAL = '9900'

let pg: PGlite
let db: ReturnType<typeof drizzle>
let eventCounter = 0

function nextEventId(): string {
	eventCounter++
	return `evt_${eventCounter}`
}

const BASE_TIME = Date.parse('2026-09-16T12:00:00.000Z')
function at(minutesFromBase: number): string {
	return new Date(BASE_TIME + minutesFromBase * 60_000).toISOString()
}

function signedRequest(payloadObj: unknown): Request {
	const body = JSON.stringify(payloadObj)
	const ts = Math.floor(Date.now() / 1000)
	const h1 = crypto.createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex')
	return new Request('https://app.test/api/webhooks/paddle', {
		method: 'POST',
		headers: { 'paddle-signature': `ts=${ts};h1=${h1}`, 'content-type': 'application/json' },
		body,
	})
}

function post(event: {
	event_type: string
	occurred_at?: string
	event_id?: string
	data: Record<string, unknown>
}) {
	return POST({
		request: signedRequest({
			event_id: event.event_id ?? nextEventId(),
			occurred_at: event.occurred_at ?? at(0),
			event_type: event.event_type,
			data: event.data,
		}),
	})
}

function subscriptionEvent(overrides: Record<string, unknown> = {}) {
	return {
		event_type: 'subscription.updated',
		data: { customer_id: 'ctm_1', status: 'active', ...overrides },
	}
}

function lifetimeEvent(overrides: Record<string, unknown> = {}) {
	return {
		event_type: 'transaction.completed',
		data: {
			id: 'txn_lifetime_1',
			customer_id: 'ctm_1',
			status: 'completed',
			items: [{ price: { id: LIFETIME_PRICE } }],
			details: { totals: { grand_total: LIFETIME_TOTAL } },
			...overrides,
		},
	}
}

function adjustmentEvent(overrides: Record<string, unknown> = {}) {
	return {
		event_type: 'adjustment.created',
		data: {
			id: 'adj_1',
			customer_id: 'ctm_1',
			action: 'refund',
			transaction_id: 'txn_lifetime_1',
			status: 'approved',
			totals: { total: LIFETIME_TOTAL },
			...overrides,
		},
	}
}

async function seedUser(overrides: Record<string, unknown> = {}) {
	const [row] = await db
		.insert(users)
		.values({
			email: 'buyer@example.test',
			paddleId: 'ctm_1',
			subscriptionStatus: 'free',
			...overrides,
		} as never)
		.returning()
	return row
}

function readUser(paddleId: string) {
	return db.select().from(users).where(eq(users.paddleId, paddleId))
}

beforeAll(async () => {
	pg = new PGlite()
	const journal = JSON.parse(
		readFileSync(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS)), 'utf8')
	) as { entries: { idx: number; tag: string }[] }
	for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
		const sql = readFileSync(fileURLToPath(new URL(`${entry.tag}.sql`, MIGRATIONS)), 'utf8')
		for (const statement of sql.split('--> statement-breakpoint')) {
			if (statement.trim()) await pg.exec(statement)
		}
	}
	db = drizzle(pg)
	holder.db = db
}, 60_000)

afterAll(async () => {
	await pg?.close()
})

beforeEach(async () => {
	vi.clearAllMocks()
	getPaddleConfig.mockReturnValue({
		environment: 'sandbox' as const,
		apiKey: 'pdl_sdbx_key',
		clientToken: 'test_client_token',
		webhookSecret: SECRET,
		webhookMaxAgeSeconds: 300,
		apiBaseUrl: 'https://sandbox-api.paddle.com',
		annualPriceId: ANNUAL_PRICE,
		lifetimePriceId: LIFETIME_PRICE,
		isConfigured: true,
	})
	fetchPaddleCustomerEmail.mockResolvedValue(undefined)
	await db.delete(userProfiles)
	await db.delete(paddleWebhookEvents)
	await db.delete(paddleAdjustments)
	// Before `users`: `loginTokens.userId` references it.
	await db.delete(loginTokens)
	// Before `users`: `sync`-scope rows reference `users.id`.
	await db.delete(rateLimits)
	await db.delete(users)
})

describe('webhook against real PostgreSQL — the guarantees the mocked suite cannot prove', () => {
	it('matches the UPDATE by customer_id, touching only that user', async () => {
		await seedUser({ paddleId: 'ctm_1', email: 'one@example.test' })
		await seedUser({ paddleId: 'ctm_2', email: 'two@example.test' })

		const res = await post(subscriptionEvent({ customer_id: 'ctm_1', status: 'active' }))
		expect(res.status).toBe(200)

		const [target] = await readUser('ctm_1')
		const [bystander] = await readUser('ctm_2')
		expect(target.subscriptionStatus).toBe('active')
		expect(bystander.subscriptionStatus).toBe('free')
	})

	it('NEVER downgrades a lifetime buyer on a subscription event', async () => {
		await seedUser({ subscriptionStatus: 'lifetime' })

		const res = await post(subscriptionEvent({ status: 'canceled' }))

		expect(res.status).toBe(200)
		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('lifetime')
	})
})

describe('idempotency and ordering', () => {
	it('ignores a duplicate delivery of the same event id', async () => {
		await seedUser({ subscriptionStatus: 'free' })
		const eventId = 'evt_duplicate'

		const first = await post({
			...subscriptionEvent({ status: 'active' }),
			event_id: eventId,
			occurred_at: at(1),
		})
		expect(first.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('active')

		// The SAME event id, but carrying a contradictory payload. If dedup were
		// absent this would be applied and the status would flip.
		const replay = await post({
			event_type: 'subscription.canceled',
			data: { customer_id: 'ctm_1', status: 'canceled' },
			event_id: eventId,
			occurred_at: at(2),
		})

		expect(replay.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('active')
		const logged = await db.select().from(paddleWebhookEvents)
		expect(logged).toHaveLength(1)
	})

	it('a LATE retry of an older event does not overwrite a newer entitlement state', async () => {
		// A retried older `updated {active}` landing after `canceled` must not re-grant Premium.
		await seedUser({ subscriptionStatus: 'active' })

		const cancel = await post({
			event_type: 'subscription.canceled',
			data: { customer_id: 'ctm_1', status: 'canceled' },
			occurred_at: at(10),
		})
		expect(cancel.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')

		// A DIFFERENT event id (so dedup cannot be what saves us) carrying an
		// OLDER occurred_at.
		const lateRetry = await post(subscriptionEvent({ status: 'active' }))
		expect(lateRetry.status).toBe(200)

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('canceled')
	})

	it('a late retry of the ORIGINAL purchase does not re-grant lifetime after a refund', async () => {
		// A refunded buyer whose original `transaction.completed` is retried must not regain lifetime.
		await seedUser({ subscriptionStatus: 'free' })

		await post({ ...lifetimeEvent({}), event_id: 'evt_grant', occurred_at: at(1) })
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')

		await post({
			...adjustmentEvent({ action: 'chargeback' }),
			event_id: 'evt_chargeback',
			occurred_at: at(5),
		})
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')

		// Paddle retries the original grant — new delivery id, ORIGINAL timestamp.
		const lateRetry = await post({
			...lifetimeEvent({}),
			event_id: 'evt_grant_retry',
			occurred_at: at(1),
		})

		expect(lateRetry.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
	})

	it('applies events that genuinely are newer', async () => {
		await seedUser({ subscriptionStatus: 'free' })

		await post(subscriptionEvent({ status: 'active' }))
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('active')

		await post({
			event_type: 'subscription.canceled',
			data: { customer_id: 'ctm_1', status: 'canceled' },
			occurred_at: at(5),
		})
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
	})
})

describe('identity reconciliation', () => {
	it('RE-KEYS an unentitled existing account to the new Paddle customer', async () => {
		await seedUser({ paddleId: 'ctm_old', email: 'buyer@example.test', subscriptionStatus: 'free' })
		fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

		const res = await post(subscriptionEvent({ customer_id: 'ctm_new', status: 'active' }))

		expect(res.status).toBe(200)
		const [row] = await readUser('ctm_new')
		expect(row.subscriptionStatus).toBe('active')
		expect(row.email).toBe('buyer@example.test')
		const all = await db.select().from(users)
		expect(all).toHaveLength(1)
	})

	it('REFUSES to adopt an entitled account, with a terminal 200 rather than a 500 retry storm', async () => {
		// Refused deliberately: Paddle verifies payment, not email ownership, so adopting here would
		// let a checkout take over someone else's account.
		await seedUser({
			paddleId: 'ctm_victim',
			email: 'buyer@example.test',
			subscriptionStatus: 'active',
		})
		fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

		const res = await post(subscriptionEvent({ customer_id: 'ctm_attacker', status: 'active' }))

		// Terminal: Paddle must STOP retrying.
		expect(res.status).toBe(200)
		const [victim] = await readUser('ctm_victim')
		expect(victim.subscriptionStatus).toBe('active')
		expect(victim.email).toBe('buyer@example.test')
		expect(await readUser('ctm_attacker')).toHaveLength(0)
		expect(captureError).toHaveBeenCalled()
	})

	it('refuses to adopt a LIFETIME account too', async () => {
		await seedUser({
			paddleId: 'ctm_victim',
			email: 'buyer@example.test',
			subscriptionStatus: 'lifetime',
		})
		fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

		const res = await post(lifetimeEvent({ customer_id: 'ctm_attacker' }))

		expect(res.status).toBe(200)
		expect((await readUser('ctm_victim'))[0].subscriptionStatus).toBe('lifetime')
		expect(await readUser('ctm_attacker')).toHaveLength(0)
	})
})

describe('refunds, chargebacks and disputes', () => {
	async function grantLifetime() {
		await seedUser({ subscriptionStatus: 'free' })
		await post(lifetimeEvent({}))
		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('lifetime')
		expect(row.lifetimeGrantTotal).toBe(9900)
		return row
	}

	it('a FULL refund revokes the lifetime grant', async () => {
		await grantLifetime()

		const res = await post({
			...adjustmentEvent({ totals: { total: '9900' } }),
			occurred_at: at(5),
		})

		expect(res.status).toBe(200)
		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('canceled')
	})

	it('a refund with NO status is not applied, and is flagged for review', async () => {
		// Paddle's schema makes `status` required; a refund without one is
		// malformed. It must not revoke silently NOR vanish silently.
		await grantLifetime()

		const res = await post({
			...adjustmentEvent({ status: undefined, totals: { total: '9900' } }),
			occurred_at: at(5),
		})

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
		expect(await db.select().from(paddleAdjustments)).toHaveLength(0)
		expect(captureError).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('without a status') }),
			expect.objectContaining({ customerId: 'ctm_1', adjustmentId: 'adj_1' })
		)

		// The status-less delivery is terminal, but it must not block the approved
		// delivery of the same adjustment (its own event id) from applying.
		await post({ ...adjustmentEvent(), event_type: 'adjustment.updated', occurred_at: at(6) })
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
		expect(await db.select().from(paddleAdjustments)).toHaveLength(1)
	})

	it('a refund whose status is not a string is treated as missing: 200, not applied, flagged', async () => {
		await grantLifetime()

		const res = await post({
			...adjustmentEvent({ status: 7, totals: { total: '9900' } }),
			occurred_at: at(5),
		})

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
		expect(captureError).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('without a status') }),
			expect.anything()
		)
	})

	it.each([7, 0, false])(
		'an adjustment whose action is not a string (%s): 200, not applied, flagged',
		async (action) => {
			await grantLifetime()

			const res = await post({
				...adjustmentEvent({ action, totals: { total: '9900' } }),
				occurred_at: at(5),
			})

			expect(res.status).toBe(200)
			expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
			expect(await db.select().from(paddleAdjustments)).toHaveLength(0)
			expect(captureError).toHaveBeenCalledWith(
				expect.objectContaining({ message: expect.stringContaining('action is not a string') }),
				expect.objectContaining({ customerId: 'ctm_1', adjustmentId: 'adj_1' })
			)
		}
	)

	it('a refund with an UNEXPECTED status (e.g. `reversed`) is not applied, and is flagged', async () => {
		await grantLifetime()

		const res = await post({
			...adjustmentEvent({ status: 'reversed', totals: { total: '9900' } }),
			occurred_at: at(5),
		})

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
		expect(await db.select().from(paddleAdjustments)).toHaveLength(0)
		expect(captureError).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('unexpected status') }),
			expect.objectContaining({ adjustmentId: 'adj_1', status: 'reversed' })
		)
	})

	it('a pending_approval refund is NOT flagged: pending is the normal first state', async () => {
		await grantLifetime()
		await post({
			...adjustmentEvent({ status: 'pending_approval', totals: { total: '9900' } }),
			occurred_at: at(5),
		})
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
		expect(captureError).not.toHaveBeenCalled()
	})

	it('the approval gate is refund-only: a CHARGEBACK with no status still revokes', async () => {
		// Pins D-A's scope: the gate must never swallow a chargeback.
		await grantLifetime()

		const res = await post({
			...adjustmentEvent({ action: 'chargeback', status: undefined, totals: { total: '1' } }),
			occurred_at: at(5),
		})

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
	})

	it('a PARTIAL refund does NOT revoke access', async () => {
		await grantLifetime()

		const res = await post({ ...adjustmentEvent({ totals: { total: '500' } }), occurred_at: at(5) })

		expect(res.status).toBe(200)
		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('lifetime')
		const ledger = await db.select().from(paddleAdjustments)
		expect(ledger).toHaveLength(1)
		expect(ledger[0].total).toBe(500)
	})

	it('partial refunds that ADD UP to the full price do revoke', async () => {
		await grantLifetime()

		await post({
			...adjustmentEvent({ id: 'adj_a', totals: { total: '5000' } }),
			occurred_at: at(5),
		})
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')

		await post({
			...adjustmentEvent({ id: 'adj_b', totals: { total: '4900' } }),
			occurred_at: at(6),
		})

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('canceled')
	})

	it('a CHARGEBACK revokes regardless of amount', async () => {
		await grantLifetime()

		const res = await post({
			...adjustmentEvent({ action: 'chargeback', totals: { total: '1' } }),
			occurred_at: at(5),
		})

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
	})

	it('a chargeback_warning ALERTS but leaves access intact', async () => {
		// Deliberate: a dispute that is later won then needs no restore path.
		await grantLifetime()

		const res = await post({
			...adjustmentEvent({ action: 'chargeback_warning' }),
			occurred_at: at(5),
		})

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
		expect(captureError).toHaveBeenCalled()
	})

	it('a credit adjustment changes nothing', async () => {
		await grantLifetime()

		await post({ ...adjustmentEvent({ action: 'credit' }), occurred_at: at(5) })

		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
	})

	it('revocation PIERCES the no-downgrade guard that used to block it', async () => {
		// Subscription paths refuse to move a lifetime row, so prove revocation still lands on one.
		await grantLifetime()
		await post({ ...adjustmentEvent({ action: 'chargeback' }), occurred_at: at(5) })
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
	})
})

describe('exactly one default profile', () => {
	it('THE DATABASE refuses a second default profile — the one-default guarantee', async () => {
		// Inserts directly, bypassing the app, so it fails only if the partial unique index is absent.
		const user = await seedUser({ subscriptionStatus: 'lifetime' })
		await db
			.insert(userProfiles)
			.values({ userId: user.id, name: 'Main Profile', isDefault: true } as never)

		await expect(
			db
				.insert(userProfiles)
				.values({ userId: user.id, name: 'Second Default', isDefault: true } as never)
		).rejects.toThrow()
	})

	it('two deliveries for one new buyer leave exactly ONE default profile', async () => {
		// PGlite serializes these, so this is a shape check only; the unique index test above
		// is the real concurrency guarantee.
		fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

		await Promise.all([
			post({ ...lifetimeEvent({}), event_id: 'evt_paid', occurred_at: at(1) }),
			post({
				...lifetimeEvent({}),
				event_type: 'transaction.paid',
				event_id: 'evt_completed',
				occurred_at: at(2),
			}),
		])

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('lifetime')

		const profiles = await db.select().from(userProfiles).where(eq(userProfiles.userId, row.id))
		expect(profiles).toHaveLength(1)
		expect(profiles[0].isDefault).toBe(true)
	})

	it('createDefaultProfileForUser provisions exactly one profile, and is idempotent', async () => {
		const user = await seedUser({ subscriptionStatus: 'lifetime' })

		const first = await createDefaultProfileForUser(user.id)
		expect(first.success).toBe(true)
		const second = await createDefaultProfileForUser(user.id)
		expect(second.success).toBe(true)

		const profiles = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.id))
		expect(profiles).toHaveLength(1)
		expect(profiles[0].isDefault).toBe(true)
		expect(second.data?.id).toBe(profiles[0].id)
	})

	it('the race-loser read-back never returns a tombstoned profile', async () => {
		// The partial index excludes tombstones, so the race-loser read-back must too,
		// or a soft-deleted default is handed back as the live one.
		const user = await seedUser({ subscriptionStatus: 'lifetime' })
		await db.insert(userProfiles).values({
			userId: user.id,
			name: 'Tombstoned Default',
			isDefault: true,
			isDeleted: true,
		} as never)

		const result = await createDefaultProfileForUser(user.id)

		expect(result.success).toBe(true)
		expect(result.data?.isDeleted).not.toBe(true)
		expect(result.data?.name).toBe('Main Profile')
	})

	it('a tombstoned default does not block creating a new one', async () => {
		const user = await seedUser({ subscriptionStatus: 'lifetime' })
		await db.insert(userProfiles).values({
			userId: user.id,
			name: 'Old Main',
			isDefault: true,
			isDeleted: true,
		} as never)

		await expect(
			db
				.insert(userProfiles)
				.values({ userId: user.id, name: 'New Main', isDefault: true } as never)
		).resolves.toBeDefined()
	})
})

describe('lower-severity correctness', () => {
	it('does NOT overwrite a chosen display currency with the billing currency on renewal', async () => {
		// `users.currency` is a display preference; Paddle's `currency_code` is the IP-detected
		// billing currency and must not overwrite it.
		await seedUser({ subscriptionStatus: 'active', currency: 'EUR' })

		await post(subscriptionEvent({ status: 'active', currency_code: 'USD' }))

		expect((await readUser('ctm_1'))[0].currency).toBe('EUR')
	})

	it('DOES set the currency when first creating the user', async () => {
		fetchPaddleCustomerEmail.mockResolvedValue('new@example.test')

		await post(
			subscriptionEvent({ customer_id: 'ctm_new', status: 'active', currency_code: 'USD' })
		)

		expect((await readUser('ctm_new'))[0].currency).toBe('USD')
	})

	it('refuses to grant lifetime on a ZERO-VALUE transaction with NO discount', async () => {
		// A zero total nothing explains (a misconfigured price) must not mint a permanent entitlement.
		await seedUser({ subscriptionStatus: 'free' })

		const res = await post(lifetimeEvent({ details: { totals: { grand_total: '0' } } }))

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('free')
	})

	it('GRANTS lifetime on a 100%-coupon transaction, recording a revocable total of 0', async () => {
		await seedUser({ subscriptionStatus: 'free' })

		const res = await post(
			lifetimeEvent({
				discount_id: 'dsc_full',
				details: { totals: { grand_total: '0', subtotal: '9900', discount: '9900' } },
			})
		)

		expect(res.status).toBe(200)
		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('lifetime')
		expect(row.lifetimeTransactionId).toBe('txn_lifetime_1')
		expect(row.lifetimeGrantTotal).toBe(0)
	})

	it('a chargeback adjustment on a coupon grant takes the revoke path (code-path guard only)', async () => {
		// Not a real-world scenario (a €0 transaction can't be charged back); pins that a 0 total
		// doesn't break `handleAdjustment`.
		await seedUser({ subscriptionStatus: 'free' })
		await post({
			...lifetimeEvent({
				discount_id: 'dsc_full',
				details: { totals: { grand_total: '0', subtotal: '9900', discount: '9900' } },
			}),
			occurred_at: at(0),
		})

		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')

		await post({ ...adjustmentEvent({ action: 'chargeback' }), occurred_at: at(5) })

		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
	})

	it.each([
		// `grand_total` is computed AFTER customer credit: a 10% coupon with the
		// rest paid from credit also reads 0, but the coupon did not pay for it.
		[
			'refuses a zero total when the discount did NOT cover the subtotal (credit top-up)',
			{
				overrides: {
					discount_id: 'dsc_ten_percent',
					details: { totals: { grand_total: '0', subtotal: '9900', discount: '990' } },
				},
			},
		],
		[
			'refuses a €0 PRICE that merely carries a discount (misconfigured price)',
			{
				overrides: {
					discount_id: 'dsc_any',
					details: { totals: { grand_total: '0', subtotal: '0', discount: '0' } },
				},
			},
		],
		[
			'refuses a coupon grant whose payload states no subtotal/discount (cannot prove coverage)',
			{
				overrides: { discount_id: 'dsc_full', details: { totals: { grand_total: '0' } } },
			},
		],
		[
			'refuses a NEGATIVE total even when a discount is present',
			{
				overrides: {
					discount_id: 'dsc_full',
					details: { totals: { grand_total: '-100', subtotal: '9900', discount: '9900' } },
				},
			},
		],
	])('%s', async (_title, { overrides }) => {
		await seedUser({ subscriptionStatus: 'free' })

		await post(lifetimeEvent(overrides))

		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('free')
	})

	it('refuses to grant lifetime on a transaction that is not in a collected state', async () => {
		await seedUser({ subscriptionStatus: 'free' })

		const res = await post(lifetimeEvent({ status: 'canceled' }))

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('free')
	})

	it('records the transaction id and total on a real grant', async () => {
		await seedUser({ subscriptionStatus: 'free' })

		await post(lifetimeEvent({}))

		const [row] = await readUser('ctm_1')
		expect(row.lifetimeTransactionId).toBe('txn_lifetime_1')
		expect(row.lifetimeGrantTotal).toBe(9900)
	})
})

describe('retry, duplicate adjustments and unrelated chargebacks', () => {
	it('a delivery that FAILS releases its event claim, so the retry still grants', async () => {
		// A handled failure returns {ok:false} rather than throwing; the claim must still roll back
		// or Paddle's retry is dismissed as a duplicate.
		fetchPaddleCustomerEmail.mockResolvedValue(undefined) // Paddle API blip

		const first = await post({ ...lifetimeEvent({}), event_id: 'evt_grant', occurred_at: at(1) })
		expect(first.status).toBe(500)
		expect(await db.select().from(paddleWebhookEvents)).toHaveLength(0)
		expect(await db.select().from(users)).toHaveLength(0)

		fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test') // recovered
		const retry = await post({ ...lifetimeEvent({}), event_id: 'evt_grant', occurred_at: at(1) })

		expect(retry.status).toBe(200)
		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('lifetime')
	})

	it('a genuinely duplicate delivery still keeps its claim', async () => {
		await seedUser({ subscriptionStatus: 'free' })
		await post({
			...subscriptionEvent({ status: 'active' }),
			event_id: 'evt_d',
			occurred_at: at(1),
		})
		expect(await db.select().from(paddleWebhookEvents)).toHaveLength(1)

		await post({
			event_type: 'subscription.canceled',
			data: { customer_id: 'ctm_1', status: 'canceled' },
			event_id: 'evt_d',
			occurred_at: at(2),
		})

		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('active')
		expect(await db.select().from(paddleWebhookEvents)).toHaveLength(1)
	})

	it('`adjustment.created` + `adjustment.updated` for ONE adjustment count ONCE', async () => {
		// Two deliveries, two event ids, one adjustment: delivery dedup doesn't collapse them,
		// so the ledger must.
		await seedUser({ subscriptionStatus: 'free' })
		await post({ ...lifetimeEvent({}), event_id: 'evt_g', occurred_at: at(1) })

		await post({
			...adjustmentEvent({ id: 'adj_same', totals: { total: '5000' } }),
			event_id: 'evt_adj_created',
			occurred_at: at(5),
		})
		await post({
			event_type: 'adjustment.updated',
			data: {
				id: 'adj_same',
				customer_id: 'ctm_1',
				action: 'refund',
				status: 'approved',
				transaction_id: 'txn_lifetime_1',
				totals: { total: '5000' },
			},
			event_id: 'evt_adj_updated',
			occurred_at: at(6),
		})

		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
		expect(await db.select().from(paddleAdjustments)).toHaveLength(1)
	})

	it('a chargeback on an UNRELATED transaction does not revoke the grant', async () => {
		// Revoke only when the chargeback concerns the granting
		// transaction; anything else alerts for manual judgement.
		await seedUser({ subscriptionStatus: 'free' })
		await post({ ...lifetimeEvent({}), event_id: 'evt_g2', occurred_at: at(1) })

		const res = await post({
			...adjustmentEvent({
				id: 'adj_other',
				action: 'chargeback',
				transaction_id: 'txn_some_annual_invoice',
				totals: { total: '100' },
			}),
			occurred_at: at(5),
		})

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
		expect(captureError).toHaveBeenCalled()
	})

	it('an adjustment for an unknown customer RETRIES rather than being swallowed', async () => {
		// A terminal 200 would erase the refund, and the later grant would then mint Premium.
		const res = await post({
			...adjustmentEvent({ customer_id: 'ctm_unknown' }),
			occurred_at: at(5),
		})

		expect(res.status).toBe(500)
		expect(await db.select().from(paddleWebhookEvents)).toHaveLength(0)
	})

	it('refuses to grant lifetime when the transaction carries NO usable total', async () => {
		// A NULL grant total makes every refund path unjudgeable, so the entitlement would be irrevocable.
		await seedUser({ subscriptionStatus: 'free' })

		const res = await post(lifetimeEvent({ details: { totals: {} } }))

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('free')
	})

	it('a re-purchase does not inherit the previous grant refunds', async () => {
		// The ledger is keyed per transaction, so an old refund can't count against a new purchase.
		await seedUser({ subscriptionStatus: 'free' })
		await post({ ...lifetimeEvent({}), event_id: 'evt_g3', occurred_at: at(1) })
		await post({
			...adjustmentEvent({ id: 'adj_full', totals: { total: '9900' } }),
			occurred_at: at(2),
		})
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')

		await post({
			...lifetimeEvent({ id: 'txn_lifetime_2' }),
			event_id: 'evt_g4',
			occurred_at: at(10),
		})
		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')

		await post({
			...adjustmentEvent({
				id: 'adj_small',
				transaction_id: 'txn_lifetime_2',
				totals: { total: '100' },
			}),
			occurred_at: at(11),
		})

		expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
	})
})

/**
 * A collision refuses unconditionally: both rows already exist, so freeing the address
 * would destroy a second ledger. Ordering uses the separate `emailUpdatedAt` watermark.
 */
describe('customer.updated moves the login email', () => {
	function customerUpdatedEvent(overrides: Record<string, unknown> = {}) {
		return {
			event_type: 'customer.updated',
			data: {
				// The customer id is `data.id` here; `customer.*` payloads have no `data.customer_id`.
				id: 'ctm_1',
				name: 'Jo Brown-Anderson',
				email: 'new@example.test',
				locale: 'en',
				status: 'active',
				marketing_consent: false,
				...overrides,
			},
		}
	}

	it('moves users.email to the new address and stamps emailUpdatedAt', async () => {
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

		const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		expect(res.status).toBe(200)
		const [row] = await readUser('ctm_1')
		expect(row.email).toBe('new@example.test')
		expect(row.emailUpdatedAt).toBe(BASE_TIME + 5 * 60_000)
	})

	it('moves ONLY that user, leaving every bystander untouched', async () => {
		// Two users, so a missing row predicate on the UPDATE (rewriting every email) goes red.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
		await seedUser({ paddleId: 'ctm_2', email: 'bystander@example.test' })

		const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].email).toBe('new@example.test')
		const [bystander] = await readUser('ctm_2')
		expect(bystander.email).toBe('bystander@example.test')
		expect(bystander.emailUpdatedAt).toBeNull()
	})

	it('normalizes the incoming address before storing it', async () => {
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

		// `normalizeEmail` runs before `isValidEmail`, so padded mixed case is accepted and stored canonically.
		await post({
			...customerUpdatedEvent({ email: '  NEW@Example.TEST  ' }),
			occurred_at: at(5),
		})

		expect((await readUser('ctm_1'))[0].email).toBe('new@example.test')
	})

	it('closes the lockout: a magic link works at the NEW address and NOT the old', async () => {
		// `requestMagicLink` silently no-ops on a miss, so drive it to prove the user can still get in.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
		await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		await requestMagicLink('new@example.test', 'https://app.test')
		expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1)
		expect(sendMagicLinkEmail.mock.calls[0][0]).toBe('new@example.test')

		sendMagicLinkEmail.mockClear()
		await requestMagicLink('old@example.test', 'https://app.test')
		expect(sendMagicLinkEmail).not.toHaveBeenCalled()
	})

	it('REFUSES when the address belongs to an ENTITLED account', async () => {
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
		await seedUser({
			paddleId: 'ctm_other',
			email: 'new@example.test',
			subscriptionStatus: 'lifetime',
		})

		const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		// Terminal 200: the decision will never change on its own, so a 500 would
		// be a retry storm.
		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
		expect((await readUser('ctm_other'))[0].email).toBe('new@example.test')
		expect(captureError).toHaveBeenCalled()
	})

	it('REFUSES when the address belongs to a FREE account too — the refusal is unconditional', async () => {
		// Refusal must hold whatever the other row's status: an unentitled row isn't adoptable here.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
		await seedUser({
			paddleId: 'ctm_other',
			email: 'new@example.test',
			subscriptionStatus: 'free',
		})

		const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
		expect((await readUser('ctm_other'))[0].email).toBe('new@example.test')
		expect(captureError).toHaveBeenCalled()
	})

	it('REFUSES when the colliding row is soft-deleted — the tombstone is not a licence', async () => {
		// Built directly: no code path sets `users.isDeleted`, but readers filter on it.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
		await seedUser({ paddleId: 'ctm_other', email: 'new@example.test', isDeleted: true })

		const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
		expect(captureError).toHaveBeenCalled()
	})

	it('a repeat of an address we already hold is not read as a collision', async () => {
		// The already-equal early return fires before the collision lookup; this proves only that return.
		await seedUser({ paddleId: 'ctm_1', email: 'new@example.test' })

		const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].email).toBe('new@example.test')
		expect(captureError).not.toHaveBeenCalled()
	})

	it('ignores a replayed OLDER event arriving after a newer one', async () => {
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

		// B (newer) is delivered first, then A (older) is retried afterwards —
		// arrival order is exactly what cannot be trusted.
		await post({
			...customerUpdatedEvent({ email: 'b@example.test' }),
			event_id: 'evt_b',
			occurred_at: at(20),
		})
		await post({
			...customerUpdatedEvent({ email: 'a@example.test' }),
			event_id: 'evt_a',
			occurred_at: at(10),
		})

		expect((await readUser('ctm_1'))[0].email).toBe('b@example.test')
	})

	it('rejects an equal timestamp, matching the strictly-newer contract', async () => {
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

		await post({
			...customerUpdatedEvent({ email: 'first@example.test' }),
			event_id: 'evt_1',
			occurred_at: at(10),
		})
		await post({
			...customerUpdatedEvent({ email: 'second@example.test' }),
			event_id: 'evt_2',
			occurred_at: at(10),
		})

		expect((await readUser('ctm_1'))[0].email).toBe('first@example.test')
	})

	it('⚠️ does NOT advance entitlementUpdatedAt, so a later billing event still applies', async () => {
		// Writing `entitlementUpdatedAt` here would make an older-stamped subscription retry look stale
		// and drop it, silently losing the entitlement.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test', subscriptionStatus: 'free' })

		await post({ ...customerUpdatedEvent(), event_id: 'evt_email', occurred_at: at(50) })

		const [afterEmail] = await readUser('ctm_1')
		expect(afterEmail.email).toBe('new@example.test')
		expect(afterEmail.emailUpdatedAt).toBe(BASE_TIME + 50 * 60_000)
		expect(afterEmail.entitlementUpdatedAt).toBeNull()

		await post({
			...subscriptionEvent({ customer_id: 'ctm_1', status: 'active' }),
			event_id: 'evt_sub',
			occurred_at: at(10),
		})

		const [afterSub] = await readUser('ctm_1')
		expect(afterSub.subscriptionStatus).toBe('active')
		expect(afterSub.email).toBe('new@example.test')
	})

	it('dismisses a duplicate delivery through the existing claim', async () => {
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

		await post({
			...customerUpdatedEvent({ email: 'first@example.test' }),
			event_id: 'evt_same',
			occurred_at: at(10),
		})
		// Same event id, later timestamp, different address: if the claim were not
		// doing the work, the watermark would let this through.
		await post({
			...customerUpdatedEvent({ email: 'second@example.test' }),
			event_id: 'evt_same',
			occurred_at: at(20),
		})

		expect((await readUser('ctm_1'))[0].email).toBe('first@example.test')
		const claims = await db.select().from(paddleWebhookEvents)
		expect(claims).toHaveLength(1)
	})

	it('leaves the address alone but STILL ADVANCES the watermark', async () => {
		// A no-op event must still stamp `emailUpdatedAt`, or an older event delivered afterwards
		// is judged fresher than NULL.
		await seedUser({ paddleId: 'ctm_1', email: 'new@example.test' })

		const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		expect(res.status).toBe(200)
		const [row] = await readUser('ctm_1')
		expect(row.email).toBe('new@example.test')
		expect(row.emailUpdatedAt).toBe(BASE_TIME + 5 * 60_000)
	})

	it('⚠️ REGRESSION: a no-op event must not let a later OLDER event resurrect a dead address', async () => {
		// History t=10 b@, t=15 a@, t=20 name-only; delivered 20, 15, 10. Unstamped no-ops would let
		// t=10 win and strand the account on an address Paddle abandoned.
		await seedUser({ paddleId: 'ctm_1', email: 'a@example.test' })

		await post({
			...customerUpdatedEvent({ email: 'a@example.test', name: 'Renamed' }),
			event_id: 'evt_t20',
			occurred_at: at(20),
		})
		await post({
			...customerUpdatedEvent({ email: 'a@example.test' }),
			event_id: 'evt_t15',
			occurred_at: at(15),
		})
		await post({
			...customerUpdatedEvent({ email: 'b@example.test' }),
			event_id: 'evt_t10',
			occurred_at: at(10),
		})

		const [row] = await readUser('ctm_1')
		expect(row.email).toBe('a@example.test')
		expect(row.emailUpdatedAt).toBe(BASE_TIME + 20 * 60_000)
	})

	it('normalizes a LEGACY mixed-case row of our own instead of refusing it', async () => {
		// Our own legacy mixed-case row matches the `lower(email)` lookup, so the
		// `collision.id !== ours.id` conjunct is what stops a self-refusal.
		await seedUser({ paddleId: 'ctm_1', email: 'New@Example.test' })

		const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].email).toBe('new@example.test')
		expect(captureError).not.toHaveBeenCalled()
	})

	it('REFUSES a collision with another account stored in a DIFFERENT CASE', async () => {
		// An exact `eq(email)` misses a mixed-case collision; the unique index is case-sensitive, so two
		// rows would differ only by case and login would pick one arbitrarily.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
		await seedUser({ paddleId: 'ctm_other', email: 'New@Example.test' })

		const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		expect(res.status).toBe(200)
		expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
		expect((await readUser('ctm_other'))[0].email).toBe('New@Example.test')
		expect(captureError).toHaveBeenCalled()
	})

	it('invalidates pending magic links when the address moves', async () => {
		// Login tokens are keyed on userId, so a link minted for the old mailbox would still sign in.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
		await requestMagicLink('old@example.test', 'https://app.test')
		expect(await db.select().from(loginTokens)).toHaveLength(1)

		await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

		expect(await db.select().from(loginTokens)).toHaveLength(0)
	})

	it('stamps the watermark even when it REFUSES, so an older address cannot follow', async () => {
		// A refused newer event must still stamp, or an older intermediate address is applied afterwards.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
		await seedUser({ paddleId: 'ctm_other', email: 'taken@example.test' })

		await post({
			...customerUpdatedEvent({ email: 'taken@example.test' }),
			event_id: 'evt_refused',
			occurred_at: at(20),
		})
		expect((await readUser('ctm_1'))[0].emailUpdatedAt).toBe(BASE_TIME + 20 * 60_000)

		await post({
			...customerUpdatedEvent({ email: 'older@example.test' }),
			event_id: 'evt_older',
			occurred_at: at(10),
		})

		expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
	})

	it('does not create an account for a customer we have never seen', async () => {
		// Only subscription and transaction paths create accounts; a `customer.*` event must never mint a user.
		const res = await post({
			...customerUpdatedEvent({ id: 'ctm_unknown' }),
			occurred_at: at(5),
		})

		expect(res.status).toBe(200)
		expect(await db.select().from(users)).toHaveLength(0)
	})

	it('does not read an archived customer as an entitlement change', async () => {
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test', subscriptionStatus: 'active' })

		await post({
			...customerUpdatedEvent({ status: 'archived' }),
			occurred_at: at(5),
		})

		const [row] = await readUser('ctm_1')
		expect(row.email).toBe('new@example.test')
		expect(row.subscriptionStatus).toBe('active')
	})

	it('does not poison dedup when the envelope carries no event_id', async () => {
		// On `customer.*`, the `data.id` fallback is the constant customer id; claiming it as the event
		// id would dismiss every later customer event as a duplicate.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

		const first = await POST({
			request: signedRequest({
				occurred_at: at(10),
				event_type: 'customer.updated',
				data: { id: 'ctm_1', email: 'first@example.test', status: 'active' },
			}),
		})
		expect(first.status).toBe(200)
		expect((await readUser('ctm_1'))[0].email).toBe('first@example.test')

		const second = await POST({
			request: signedRequest({
				occurred_at: at(20),
				event_type: 'customer.updated',
				data: { id: 'ctm_1', email: 'second@example.test', status: 'active' },
			}),
		})
		expect(second.status).toBe(200)
		// The one that matters: a SECOND idless customer event is still processed.
		expect((await readUser('ctm_1'))[0].email).toBe('second@example.test')
	})

	it('answers 200, not a 500, when the address is unusable', async () => {
		// Proves 200 not 500: retrying an identical payload can never make it valid.
		await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

		const unusable = ['', 'not-an-email', `${'a'.repeat(250)}@example.test`]
		for (const [i, email] of unusable.entries()) {
			const res = await post({
				event_type: 'customer.updated',
				event_id: `evt_bad_${i}`,
				occurred_at: at(5 + i),
				data: { id: 'ctm_1', status: 'active', email },
			})
			expect(res.status).toBe(200)
			expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
		}

		// ... and with the field absent entirely.
		const missing = await post({
			event_type: 'customer.updated',
			event_id: 'evt_bad_missing',
			occurred_at: at(9),
			data: { id: 'ctm_1', status: 'active' },
		})
		expect(missing.status).toBe(200)
		expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
	})
})

describe('Settings names the plan the user bought', () => {
	/** The top-level `billing_cycle` is the contract; the item-level one is present as a decoy. */
	function subscriptionCreated(
		customerId: string,
		email: string,
		cycle: { interval: string; frequency: number } | undefined
	) {
		return {
			event_type: 'subscription.created',
			data: {
				id: `sub_${customerId}`,
				customer_id: customerId,
				status: 'active',
				email,
				currency_code: 'EUR',
				...(cycle ? { billing_cycle: cycle } : {}),
				items: [
					{
						status: 'active',
						quantity: 1,
						recurring: true,
						price: {
							id: cycle?.interval === 'year' ? ANNUAL_PRICE : 'pri_monthly_599',
							...(cycle ? { billing_cycle: cycle } : {}),
						},
					},
				],
			},
		}
	}

	async function sessionFor(paddleId: string) {
		const [row] = await readUser(paddleId)
		const token = signSession({ userId: row.id, paddleId: row.paddleId, email: row.email })
		const result = await getCurrentUserSession(
			new Request('https://app.test/api/auth/me', {
				headers: { cookie: `session=${encodeURIComponent(token)}` },
			})
		)
		if (!result.success || !result.data) throw new Error('session did not resolve')
		return result.data
	}

	function labelOf(session: Awaited<ReturnType<typeof sessionFor>>): string {
		// Widened view so this still runs against a server that predates the field.
		const { billingInterval } = session as { billingInterval?: 'month' | 'year' | null }
		return planLabel(session.subscriptionStatus, billingInterval)
	}

	it('a monthly and an annual subscriber render DIFFERENT labels, end to end', async () => {
		await post({
			...subscriptionCreated('ctm_monthly', 'monthly@example.test', {
				interval: 'month',
				frequency: 1,
			}),
			occurred_at: at(1),
		})
		await post({
			...subscriptionCreated('ctm_annual', 'annual@example.test', {
				interval: 'year',
				frequency: 1,
			}),
			occurred_at: at(1),
		})

		const monthly = labelOf(await sessionFor('ctm_monthly'))
		const annual = labelOf(await sessionFor('ctm_annual'))

		expect({ monthly, annual }).toEqual({ monthly: 'Monthly Plan', annual: 'Annual Plan' })
	})

	const MONTH = { interval: 'month', frequency: 1 }
	const YEAR = { interval: 'year', frequency: 1 }

	it('drops a STALE event whole: an older monthly event cannot overwrite a newer annual one', async () => {
		await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(10) })
		// Paddle retries and reorders; this older delivery arrives second.
		await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', MONTH), occurred_at: at(5) })

		const [row] = await readUser('ctm_1')
		expect(row.billingInterval).toBe('year')
		expect(row.entitlementUpdatedAt).toBe(BASE_TIME + 10 * 60_000)
	})

	it('follows a plan SWITCH: monthly then a newer annual event ends annual', async () => {
		await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', MONTH), occurred_at: at(0) })
		await post({
			event_type: 'subscription.updated',
			data: { customer_id: 'ctm_1', status: 'active', billing_cycle: YEAR },
			occurred_at: at(10),
		})

		expect((await readUser('ctm_1'))[0].billingInterval).toBe('year')
	})

	it('leaves the stored cadence alone when an event states NO billing_cycle (absent ≠ changed)', async () => {
		await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
		// `subscriptionEvent()` carries no billing_cycle.
		await post({ ...subscriptionEvent({ status: 'past_due' }), occurred_at: at(5) })

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('past_due')
		expect(row.billingInterval).toBe('year')
	})

	it('records a cadence this product does not sell as NULL, never a guessed plan', async () => {
		await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
		// Twelve months is a year in duration, but it is not a plan we sell.
		await post({
			event_type: 'subscription.updated',
			data: {
				customer_id: 'ctm_1',
				status: 'active',
				billing_cycle: { interval: 'month', frequency: 12 },
			},
			occurred_at: at(5),
		})

		const [row] = await readUser('ctm_1')
		expect(row.billingInterval).toBeNull()
		expect(planLabel(row.subscriptionStatus, row.billingInterval)).toBe('Active')
	})

	// These pin the outcome, not the INSERT's `?? null` (the column has no default, so removing
	// it stays green).
	it('stores NULL for a first-seen subscriber whose payload states no cycle', async () => {
		await post({
			...subscriptionCreated('ctm_1', 'buyer@example.test', undefined),
			occurred_at: at(0),
		})

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('active')
		expect(row.billingInterval).toBeNull()
	})

	it('stores NULL, not a guess, for a first-seen subscriber on a cadence we do not sell', async () => {
		await post({
			...subscriptionCreated('ctm_1', 'buyer@example.test', { interval: 'month', frequency: 12 }),
			occurred_at: at(0),
		})

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('active')
		expect(row.billingInterval).toBeNull()
	})

	it.each([
		['an explicit null', null],
		['an upper-case interval', { interval: 'YEAR', frequency: 1 }],
	])('treats %s billing_cycle as MALFORMED (null), not absent', async (_, cycle) => {
		await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
		await post({
			event_type: 'subscription.updated',
			data: { customer_id: 'ctm_1', status: 'active', billing_cycle: cycle },
			occurred_at: at(5),
		})

		// Absent would have PRESERVED 'year'; malformed degrades to "Active".
		expect((await readUser('ctm_1'))[0].billingInterval).toBeNull()
	})

	describe('entitlementWatermarkGuard — the in-statement ordering predicate', () => {
		// The route can't reach this race on one connection, so drive the predicate directly.
		async function guardedUpdate(occurredAtMinutes: number) {
			const occurredAt = BASE_TIME + occurredAtMinutes * 60_000
			return db
				.update(users)
				.set({ billingInterval: 'month', entitlementUpdatedAt: occurredAt })
				.where(entitlementWatermarkGuard('ctm_1', occurredAt))
				.returning({ id: users.id })
		}

		it('matches NO row for an event older than the stored watermark', async () => {
			await seedUser({ billingInterval: 'year', entitlementUpdatedAt: BASE_TIME + 10 * 60_000 })

			expect(await guardedUpdate(5)).toHaveLength(0)
			const [row] = await readUser('ctm_1')
			expect(row.billingInterval).toBe('year')
			expect(row.entitlementUpdatedAt).toBe(BASE_TIME + 10 * 60_000)
		})

		it('matches NO row for an event at EXACTLY the watermark (strictly newer only)', async () => {
			await seedUser({ billingInterval: 'year', entitlementUpdatedAt: BASE_TIME + 10 * 60_000 })
			expect(await guardedUpdate(10)).toHaveLength(0)
		})

		it('matches the row for a newer event, and when no watermark is set yet', async () => {
			await seedUser({ billingInterval: 'year', entitlementUpdatedAt: BASE_TIME + 10 * 60_000 })
			expect(await guardedUpdate(15)).toHaveLength(1)
			expect((await readUser('ctm_1'))[0].billingInterval).toBe('month')

			await seedUser({ paddleId: 'ctm_2', email: 'other@example.test' })
			const fresh = await db
				.update(users)
				.set({ billingInterval: 'year' })
				.where(entitlementWatermarkGuard('ctm_2', BASE_TIME))
				.returning({ id: users.id })
			expect(fresh).toHaveLength(1)
		})

		it('matches ONLY the named customer', async () => {
			await seedUser({ paddleId: 'ctm_2', email: 'other@example.test', billingInterval: 'year' })
			await seedUser({ billingInterval: 'year' })

			expect(await guardedUpdate(5)).toHaveLength(1)
			expect((await readUser('ctm_2'))[0].billingInterval).toBe('year')
		})
	})

	it("writes the cadence for ONLY the event's customer, leaving a bystander untouched", async () => {
		await seedUser({
			paddleId: 'ctm_2',
			email: 'bystander@example.test',
			subscriptionStatus: 'active',
			billingInterval: 'month',
		})
		await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
		await post({
			event_type: 'subscription.updated',
			data: { customer_id: 'ctm_1', status: 'active', billing_cycle: YEAR },
			occurred_at: at(5),
		})

		expect((await readUser('ctm_2'))[0].billingInterval).toBe('month')
	})

	it('a lifetime grant clears a previous subscription cadence and labels as Lifetime Plan', async () => {
		await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
		await post({ ...lifetimeEvent(), occurred_at: at(5) })

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('lifetime')
		expect(row.billingInterval).toBeNull()
		expect(labelOf(await sessionFor('ctm_1'))).toBe('Lifetime Plan')
	})

	it('a subscription event for a LIFETIME buyer writes nothing, cadence included', async () => {
		await seedUser({ subscriptionStatus: 'lifetime', entitlementUpdatedAt: BASE_TIME })
		await post({
			event_type: 'subscription.updated',
			data: { customer_id: 'ctm_1', status: 'active', billing_cycle: YEAR },
			occurred_at: at(10),
		})

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('lifetime')
		expect(row.billingInterval).toBeNull()
	})

	describe('re-key (reconcileEmailCollision) — the path that gets forgotten', () => {
		async function seedLapsedAnnual() {
			// A lapsed annual subscriber under an OLD Paddle customer id.
			await seedUser({
				paddleId: 'ctm_old',
				email: 'returning@example.test',
				subscriptionStatus: 'canceled',
				billingInterval: 'year',
				entitlementUpdatedAt: BASE_TIME,
			})
		}

		it("writes the NEW customer's cadence onto the adopted row", async () => {
			await seedLapsedAnnual()
			await post({
				...subscriptionCreated('ctm_new', 'returning@example.test', MONTH),
				occurred_at: at(10),
			})

			const [row] = await readUser('ctm_new')
			expect(row.email).toBe('returning@example.test')
			expect(row.subscriptionStatus).toBe('active')
			expect(row.billingInterval).toBe('month')
			expect(labelOf(await sessionFor('ctm_new'))).toBe('Monthly Plan')
		})

		it("clears the PREVIOUS customer's cadence when the new payload states none", async () => {
			await seedLapsedAnnual()
			await post({
				...subscriptionCreated('ctm_new', 'returning@example.test', undefined),
				occurred_at: at(10),
			})

			const [row] = await readUser('ctm_new')
			expect(row.subscriptionStatus).toBe('active')
			// NOT 'year' — that belonged to ctm_old's subscription, and would show a
			// monthly re-subscriber "Annual Plan".
			expect(row.billingInterval).toBeNull()
			expect(labelOf(await sessionFor('ctm_new'))).toBe('Active')
		})

		it('clears it on a lifetime re-key too', async () => {
			await seedLapsedAnnual()
			await post({
				...lifetimeEvent({ customer_id: 'ctm_new', email: 'returning@example.test' }),
				occurred_at: at(10),
			})

			const [row] = await readUser('ctm_new')
			expect(row.subscriptionStatus).toBe('lifetime')
			expect(row.billingInterval).toBeNull()
		})
	})
})

describe('erase then repurchase at the same address', () => {
	const ADDRESS = 'returning@example.test'

	beforeEach(() => {
		fetchPaddleCustomerEmail.mockResolvedValue(ADDRESS)
		cancelActiveSubscriptionsForCustomer.mockResolvedValue(undefined)
		sendMagicLinkEmail.mockResolvedValue(undefined)
	})

	async function eraseThroughTheRealDeletion(paddleId: string) {
		const [row] = await readUser(paddleId)
		const token = signSession({ userId: row.id, paddleId: row.paddleId, email: row.email })
		const result = await deleteUserAccount(
			new Request('https://app.test/api/account', {
				method: 'DELETE',
				headers: { cookie: `session=${encodeURIComponent(token)}` },
			})
		)
		expect(result.success).toBe(true)
		expect(await readUser(paddleId)).toHaveLength(0)
	}

	/** A lifetime checkout paid in full by a 100% coupon, as in production. */
	function fullyDiscountedLifetime(overrides: Record<string, unknown> = {}) {
		return lifetimeEvent({
			id: 'txn_coupon_2',
			discount_id: 'dsc_full_coupon',
			details: { totals: { grand_total: '0', subtotal: '9900', discount: '9900' } },
			...overrides,
		})
	}

	/** A link is minted AND it belongs to the re-bought row, not a leftover one. */
	async function expectLinkSentTo(address: string, paddleId: string) {
		const outcome = await requestMagicLink(address, 'https://app.test')
		expect(outcome.branch).toBe('sent')
		const [bought] = await readUser(paddleId)
		expect(outcome.branch === 'sent' && outcome.userId).toBe(bought?.id)
		expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1)
		expect(sendMagicLinkEmail.mock.calls[0][0]).toBe(address)
	}

	describe('the production case: a 100%-coupon lifetime repurchase (the cause, Task 1)', () => {
		it('same customer id — a link is minted for the re-bought account', async () => {
			await post({ ...lifetimeEvent({}), occurred_at: at(0) })
			await eraseThroughTheRealDeletion('ctm_1')

			const res = await post({ ...fullyDiscountedLifetime(), occurred_at: at(60) })
			expect(res.status).toBe(200)

			await expectLinkSentTo(ADDRESS, 'ctm_1')
			const [row] = await readUser('ctm_1')
			expect(row.subscriptionStatus).toBe('lifetime')
		})

		it('new customer id — a link is minted for the re-bought account', async () => {
			await post({ ...lifetimeEvent({}), occurred_at: at(0) })
			await eraseThroughTheRealDeletion('ctm_1')

			await post({ ...fullyDiscountedLifetime({ customer_id: 'ctm_2' }), occurred_at: at(60) })

			await expectLinkSentTo(ADDRESS, 'ctm_2')
			const [row] = await readUser('ctm_2')
			expect(row.subscriptionStatus).toBe('lifetime')
		})
	})

	describe('a re-created account gets a NEW users.id', () => {
		// The client tells accounts' local rows apart by `userId` alone, so a re-created account must
		// not get its old id back.
		it('same customer id', async () => {
			await post({ ...lifetimeEvent({}), occurred_at: at(0) })
			const [erased] = await readUser('ctm_1')
			await eraseThroughTheRealDeletion('ctm_1')

			await post({ ...lifetimeEvent({ id: 'txn_paid_2' }), occurred_at: at(60) })

			const [recreated] = await readUser('ctm_1')
			expect(recreated.email).toBe(erased.email)
			expect(recreated.id).not.toBe(erased.id)
		})

		it('new customer id', async () => {
			await post({ ...lifetimeEvent({}), occurred_at: at(0) })
			const [erased] = await readUser('ctm_1')
			await eraseThroughTheRealDeletion('ctm_1')

			await post({
				...lifetimeEvent({ id: 'txn_paid_2', customer_id: 'ctm_2' }),
				occurred_at: at(60),
			})

			const [recreated] = await readUser('ctm_2')
			expect(recreated.email).toBe(erased.email)
			expect(recreated.id).not.toBe(erased.id)
		})
	})

	describe('regression guards — these never reproduced in-app', () => {
		it('paid lifetime repurchase, same customer id', async () => {
			await post({ ...lifetimeEvent({}), occurred_at: at(0) })
			await eraseThroughTheRealDeletion('ctm_1')

			await post({ ...lifetimeEvent({ id: 'txn_paid_2' }), occurred_at: at(60) })

			await expectLinkSentTo(ADDRESS, 'ctm_1')
		})

		it('subscription: erase, post-erasure subscription.canceled, repurchase with the SAME id', async () => {
			await post({ ...subscriptionEvent({ status: 'active' }), occurred_at: at(0) })
			await eraseThroughTheRealDeletion('ctm_1')
			// Paddle's own cancellation of the erased subscription.
			await post({
				event_type: 'subscription.canceled',
				occurred_at: at(1),
				data: { customer_id: 'ctm_1', status: 'canceled' },
			})

			await post({ ...subscriptionEvent({ status: 'active' }), occurred_at: at(60) })

			await expectLinkSentTo(ADDRESS, 'ctm_1')
		})

		it('subscription: erase, post-erasure subscription.canceled, repurchase with a NEW id', async () => {
			await post({ ...subscriptionEvent({ status: 'active' }), occurred_at: at(0) })
			await eraseThroughTheRealDeletion('ctm_1')
			await post({
				event_type: 'subscription.canceled',
				occurred_at: at(1),
				data: { customer_id: 'ctm_1', status: 'canceled' },
			})

			await post({
				...subscriptionEvent({ customer_id: 'ctm_2', status: 'active' }),
				occurred_at: at(60),
			})

			await expectLinkSentTo(ADDRESS, 'ctm_2')
		})
	})
})

describe('erasure clears the email-scoped throttle', () => {
	// What a user types into the sign-in form, and what the throttle keys on.
	const TYPED = 'returning@example.test'
	// Legacy mixed-case row: the only shape where keying on raw vs normalized email differs.
	const STORED = 'Returning@Example.Test'
	const PADDLE_ID = 'ctm_legacy'

	// Mid-way through the current 15-min window, so every call lands in one bucket the reaper
	// can't touch.
	const NOW =
		Math.floor(Date.now() / EMAIL_LIMIT.windowMs) * EMAIL_LIMIT.windowMs + EMAIL_LIMIT.windowMs / 2

	function attempt() {
		return checkDbRateLimit({
			scope: 'email',
			subject: normalizeEmail(TYPED),
			now: NOW,
			...EMAIL_LIMIT,
		})
	}

	function emailBuckets() {
		return db
			.select()
			.from(rateLimits)
			.where(and(eq(rateLimits.scope, 'email'), eq(rateLimits.subject, normalizeEmail(TYPED))))
	}

	async function exhaustTheThrottle() {
		for (let i = 0; i < EMAIL_LIMIT.maxAttempts; i++) {
			expect((await attempt()).allowed).toBe(true)
		}
		// The (max+1)th is refused — the state a user is in after mashing "resend".
		expect((await attempt()).allowed).toBe(false)
		expect(await emailBuckets()).toHaveLength(1)
	}

	async function eraseThroughTheRealDeletion() {
		const [row] = await readUser(PADDLE_ID)
		const token = signSession({ userId: row.id, paddleId: row.paddleId, email: row.email })
		const result = await deleteUserAccount(
			new Request('https://app.test/api/account', {
				method: 'DELETE',
				headers: { cookie: `session=${encodeURIComponent(token)}` },
			})
		)
		expect(result.success).toBe(true)
		expect(await readUser(PADDLE_ID)).toHaveLength(0)
	}

	beforeEach(() => {
		cancelActiveSubscriptionsForCustomer.mockResolvedValue(undefined)
		sendMagicLinkEmail.mockResolvedValue(undefined)
	})

	it('deletes the bucket with the account, so the next attempt is ALLOWED', async () => {
		await seedUser({ email: STORED, paddleId: PADDLE_ID, subscriptionStatus: 'lifetime' })
		await exhaustTheThrottle()

		await eraseThroughTheRealDeletion()

		// Row-level first: the surviving bucket is the mechanism, not just its symptom below.
		expect(await emailBuckets()).toEqual([])
		expect((await attempt()).allowed).toBe(true)
	})

	it('leaves every OTHER address and scope alone', async () => {
		await seedUser({ email: STORED, paddleId: PADDLE_ID, subscriptionStatus: 'lifetime' })
		await exhaustTheThrottle()
		const bystander = { scope: 'email' as const, subject: 'someone-else@example.test' }
		const ip = { scope: 'ip' as const, subject: '203.0.113.7' }
		// Synthetic: makes the `scope = 'email'` conjunct load-bearing.
		const sameSubjectOtherScope = {
			scope: 'login-verify' as const,
			subject: normalizeEmail(TYPED),
		}
		for (const bucket of [bystander, ip, sameSubjectOtherScope]) {
			await checkDbRateLimit({ ...bucket, now: NOW, ...EMAIL_LIMIT })
		}

		await eraseThroughTheRealDeletion()

		const left = await db.select().from(rateLimits)
		expect(left.map((r) => [r.scope, r.subject]).sort()).toEqual([
			['email', 'someone-else@example.test'],
			['ip', '203.0.113.7'],
			['login-verify', normalizeEmail(TYPED)],
		])
	})

	it('end to end: throttled, erased, repurchased — the sign-in route sends the link', async () => {
		fetchPaddleCustomerEmail.mockResolvedValue(TYPED)
		await seedUser({ email: STORED, paddleId: PADDLE_ID, subscriptionStatus: 'lifetime' })
		await exhaustTheThrottle()
		await eraseThroughTheRealDeletion()
		await post({ ...lifetimeEvent({ customer_id: 'ctm_new' }), occurred_at: at(60) })
		vi.mocked(logger.info).mockClear()

		// The route reads `Date.now()` for its bucket; pin it to the exhausted
		// window for this one request only.
		const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW)
		try {
			const res = await requestLinkPOST({
				request: new Request('https://app.test/api/auth/login/request', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email: TYPED }),
				}),
			})
			expect(await res.json()).toEqual({ success: true })
		} finally {
			clock.mockRestore()
		}

		expect(logger.info).not.toHaveBeenCalledWith('Magic-link request outcome', {
			branch: 'throttled',
			scope: 'email',
		})
		await vi.waitFor(() => expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1))
		expect(sendMagicLinkEmail.mock.calls[0][0]).toBe(TYPED)
	})
})

describe('the retention clock moves with the status, in the same statement', () => {
	const ms = (minutesFromBase: number) => Date.parse(at(minutesFromBase))

	it('starts the clock when an entitled subscription is canceled', async () => {
		await seedUser({ subscriptionStatus: 'active' })

		await post({
			event_type: 'subscription.canceled',
			data: { customer_id: 'ctm_1', status: 'canceled' },
			occurred_at: at(10),
		})

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('canceled')
		expect(row.accessEndedAt).toBe(ms(10))
	})

	it('does NOT restart the clock on a later event that leaves the row lapsed (why the column exists)', async () => {
		// `entitlementUpdatedAt` advances here; reading it as the lapse date would restart the 12 months.
		await seedUser({ subscriptionStatus: 'active' })
		await post({
			event_type: 'subscription.canceled',
			data: { customer_id: 'ctm_1', status: 'canceled' },
			occurred_at: at(10),
		})

		await post({ ...subscriptionEvent({ status: 'canceled' }), occurred_at: at(500) })

		const [row] = await readUser('ctm_1')
		expect(row.entitlementUpdatedAt).toBe(ms(500))
		expect(row.accessEndedAt).toBe(ms(10))
	})

	it('clears the clock AND any retention notice when access is regained', async () => {
		await seedUser({
			subscriptionStatus: 'canceled',
			accessEndedAt: ms(-1000),
			retentionNoticeSentAt: ms(-10),
		})

		await post({ ...subscriptionEvent({ status: 'active' }), occurred_at: at(10) })

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('active')
		expect(row.accessEndedAt).toBeNull()
		expect(row.retentionNoticeSentAt).toBeNull()
	})

	it('a lapsed-to-lapsed event keeps the retention notice (it belongs to the same lapse)', async () => {
		await seedUser({
			subscriptionStatus: 'canceled',
			accessEndedAt: ms(-1000),
			retentionNoticeSentAt: ms(-10),
		})

		await post({ ...subscriptionEvent({ status: 'canceled' }), occurred_at: at(10) })

		const [row] = await readUser('ctm_1')
		expect(row.accessEndedAt).toBe(ms(-1000))
		expect(row.retentionNoticeSentAt).toBe(ms(-10))
	})

	it('starts the clock when a subscription is PAUSED (paused maps to free: no access)', async () => {
		await seedUser({ subscriptionStatus: 'active' })

		await post({ ...subscriptionEvent({ status: 'paused' }), occurred_at: at(10) })

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('free')
		expect(row.accessEndedAt).toBe(ms(10))
	})

	it('starts the clock when a lifetime grant is revoked by a full refund', async () => {
		await seedUser({ subscriptionStatus: 'free' })
		await post(lifetimeEvent({}))
		expect((await readUser('ctm_1'))[0].accessEndedAt).toBeNull()

		await post({ ...adjustmentEvent({ totals: { total: '9900' } }), occurred_at: at(5) })

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('canceled')
		expect(row.accessEndedAt).toBe(ms(5))
	})

	it('a lifetime grant clears a running clock and notice', async () => {
		await seedUser({
			subscriptionStatus: 'canceled',
			accessEndedAt: ms(-1000),
			retentionNoticeSentAt: ms(-10),
		})

		await post({ ...lifetimeEvent({}), occurred_at: at(10) })

		const [row] = await readUser('ctm_1')
		expect(row.subscriptionStatus).toBe('lifetime')
		expect(row.accessEndedAt).toBeNull()
		expect(row.retentionNoticeSentAt).toBeNull()
	})

	it('a first-seen customer with a LAPSED status creates no account', async () => {
		// Must not insert a `canceled` row: that resurrected erased or purged accounts.
		fetchPaddleCustomerEmail.mockResolvedValue('never-paid@example.test')

		const res = await post({
			event_type: 'subscription.canceled',
			data: { customer_id: 'ctm_new', status: 'canceled' },
			occurred_at: at(10),
		})

		expect(res.status).toBe(200)
		expect(await readUser('ctm_new')).toEqual([])
		expect(await db.select().from(userProfiles)).toEqual([])
		// Nothing to insert, so no customer-API round trip either.
		expect(fetchPaddleCustomerEmail).not.toHaveBeenCalled()
	})

	it('a first-seen PAUSED customer creates no account either', async () => {
		fetchPaddleCustomerEmail.mockResolvedValue('paused@example.test')

		const res = await post({ ...subscriptionEvent({ customer_id: 'ctm_new', status: 'paused' }) })

		expect(res.status).toBe(200)
		expect(await readUser('ctm_new')).toEqual([])
	})

	it('erasure is NOT undone by Paddle’s own cancellation webhook (closes 74.1’s resurrection defect)', async () => {
		// Erase, then Paddle delivers the `subscription.canceled` that erasure's own cancel triggered.
		const user = await seedUser({
			paddleId: 'ctm_erased',
			email: 'erased@example.test',
			subscriptionStatus: 'active',
		})
		await db.delete(users).where(eq(users.id, user.id))
		fetchPaddleCustomerEmail.mockResolvedValue('erased@example.test')

		const res = await post({
			event_type: 'subscription.canceled',
			data: { customer_id: 'ctm_erased', status: 'canceled' },
			occurred_at: at(10),
		})

		expect(res.status).toBe(200)
		expect(await db.select().from(users).where(eq(users.email, 'erased@example.test'))).toEqual([])
	})

	it('a first-seen ACTIVE customer has no clock', async () => {
		fetchPaddleCustomerEmail.mockResolvedValue('new@example.test')

		await post({
			...subscriptionEvent({ customer_id: 'ctm_new', status: 'active' }),
			occurred_at: at(10),
		})

		const [row] = await readUser('ctm_new')
		expect(row.accessEndedAt).toBeNull()
	})

	it('a re-key to an entitled status clears the adopted row’s clock and notice', async () => {
		await seedUser({
			paddleId: 'ctm_old',
			subscriptionStatus: 'canceled',
			accessEndedAt: ms(-1000),
			retentionNoticeSentAt: ms(-10),
		})
		fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

		await post({
			...subscriptionEvent({ customer_id: 'ctm_new', status: 'active' }),
			occurred_at: at(10),
		})

		const [row] = await readUser('ctm_new')
		expect(row.subscriptionStatus).toBe('active')
		expect(row.accessEndedAt).toBeNull()
		expect(row.retentionNoticeSentAt).toBeNull()
	})

	it('a LAPSED event for a new customer does not adopt a lapsed row, and leaves its clock alone', async () => {
		await seedUser({
			paddleId: 'ctm_old',
			subscriptionStatus: 'canceled',
			accessEndedAt: ms(-1000),
		})
		fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

		await post({
			event_type: 'subscription.canceled',
			data: { customer_id: 'ctm_new', status: 'canceled' },
			occurred_at: at(10),
		})

		expect(await readUser('ctm_new')).toEqual([])
		const [row] = await readUser('ctm_old')
		expect(row.accessEndedAt).toBe(ms(-1000))
	})
})
