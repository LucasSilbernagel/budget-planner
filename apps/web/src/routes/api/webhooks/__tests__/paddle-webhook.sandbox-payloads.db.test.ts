// @vitest-environment node
// Fixtures are POSTed as raw bytes and signed over those bytes, so JSON formatting can't matter.

import crypto from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))
const lookup = vi.hoisted(() => ({
	useReal: false,
	stub: null as unknown as (customerId: string) => Promise<string | undefined>,
}))
const { getPaddleConfig, assertPaddleProductionConfig, captureError } = vi.hoisted(() => ({
	getPaddleConfig: vi.fn(),
	assertPaddleProductionConfig: vi.fn(),
	captureError: vi.fn(),
}))

vi.mock('@budget-planner/db', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		get db() {
			return holder.db
		},
	}
})
vi.mock('@budget-planner/config', () => ({
	getPaddleConfig,
	assertPaddleProductionConfig,
	getSessionSecret: () => 'story-94-1-session-secret-at-least-32-chars',
	getSiteUrl: () => 'https://app.test',
}))
vi.mock('@/server/paddle/customer-api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/server/paddle/customer-api')>()
	return {
		fetchPaddleCustomerEmail: (customerId: string) =>
			lookup.useReal ? actual.fetchPaddleCustomerEmail(customerId) : lookup.stub(customerId),
	}
})
vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError }))
vi.mock('@/server/email/mailer', () => ({ sendMagicLinkEmail: vi.fn() }))
vi.mock('@/server/paddle/subscription-api', () => ({
	cancelActiveSubscriptionsForCustomer: vi.fn(),
}))
vi.mock('@/server/retention/backstop', () => ({ maybeRunRetentionBackstop: vi.fn() }))

import {
	loginTokens,
	paddleAdjustments,
	paddleWebhookEvents,
	rateLimits,
	userProfiles,
	users,
} from '@budget-planner/db'
import { and, eq, sql } from 'drizzle-orm'
import { POST } from '../paddle'

const MIGRATIONS = new URL('../../../../../../../packages/db/migrations/', import.meta.url)
const FIXTURES = new URL('fixtures/paddle-sandbox/', import.meta.url)

const SECRET = 'pdl_ntfset_test_secret'
const SANDBOX_ANNUAL_PRICE = 'pri_01m292p4a2eb5653a5aqwfz35k'
const SANDBOX_LIFETIME_PRICE = 'pri_01m292p4qkt0xa4d6zb89pjr7p'
const SANDBOX_API = 'https://sandbox-api.paddle.com'

let pg: PGlite
let db: ReturnType<typeof drizzle>

function readFixture(name: string): string {
	return readFileSync(fileURLToPath(new URL(name, FIXTURES)), 'utf8')
}

function fixtureNames(): string[] {
	return readdirSync(fileURLToPath(FIXTURES)).sort()
}

function postRaw(raw: string) {
	const ts = Math.floor(Date.now() / 1000)
	const h1 = crypto.createHmac('sha256', SECRET).update(`${ts}:${raw}`).digest('hex')
	return POST({
		request: new Request('https://app.test/api/webhooks/paddle', {
			method: 'POST',
			headers: { 'paddle-signature': `ts=${ts};h1=${h1}`, 'content-type': 'application/json' },
			body: raw,
		}),
	})
}

function replay(name: string) {
	return postRaw(readFixture(name))
}

function stubCustomerApi(responses: Record<string, string>) {
	lookup.useReal = true
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = String(input instanceof Request ? input.url : input)
		const id = url.startsWith(`${SANDBOX_API}/customers/`)
			? decodeURIComponent(url.slice(`${SANDBOX_API}/customers/`.length))
			: undefined
		if (id && responses[id] !== undefined) {
			return new Response(responses[id], {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		}
		throw new Error(`unexpected fetch in test: ${url}`)
	})
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
	vi.restoreAllMocks()
	vi.clearAllMocks()
	lookup.useReal = false
	lookup.stub = async () => undefined
	getPaddleConfig.mockReturnValue({
		environment: 'sandbox' as const,
		apiKey: 'pdl_sdbx_test_key',
		clientToken: 'test_client_token',
		webhookSecret: SECRET,
		webhookMaxAgeSeconds: 300,
		apiBaseUrl: SANDBOX_API,
		annualPriceId: SANDBOX_ANNUAL_PRICE,
		lifetimePriceId: SANDBOX_LIFETIME_PRICE,
		isConfigured: true,
	})
	await db.delete(userProfiles)
	await db.delete(paddleWebhookEvents)
	await db.delete(paddleAdjustments)
	await db.delete(loginTokens)
	await db.delete(rateLimits)
	await db.delete(users)
})

const CTM_A = 'ctm_01m44c2mpyd87z8cn3z5ptw691'
const CTM_B = 'ctm_01m44c4g2vdv7cyd2bctn0gj71'
const CTM_S = 'ctm_01m44c50kqx272q8c72dyfyyza'
const TXN_A = 'txn_01m44c3wqdqvd4ggy3keknh520'
const TXN_B = 'txn_01m44c4g550vkv6bmm6q1a4bpk'
const ADJ_A = 'adj_01m44c65481qmqhtnnd0sder0r'
const ADJ_B = 'adj_01m44c658ga1gc94ehpa3x6rdt'
const ADJ_S = 'adj_01m44c65f16jyy453vfv9qnswz'

const F = {
	paidA: '01-transaction.paid-lifetime-A.json',
	completedA: '02-transaction.completed-lifetime-A.json',
	paidB: '03-transaction.paid-lifetime-B.json',
	completedB: '04-transaction.completed-lifetime-B.json',
	paidS: '05-transaction.paid-annual-S.json',
	subCreatedS: '06-subscription.created-annual-S.json',
	subActivatedS: '06a-subscription.activated-annual-S.json',
	completedS: '07-transaction.completed-annual-S.json',
	adjCreatedA: '08-adjustment.created-full-refund-A.json',
	adjCreatedB: '09-adjustment.created-partial-refund-B.json',
	adjCreatedS: '10-adjustment.created-refund-annual-S.json',
	customerUpdatedS: '11-customer.updated-S.json',
	subCanceledS: '12-subscription.canceled-annual-S.json',
	subUpdatedCanceledS: '12a-subscription.updated-canceled-annual-S.json',
	subUpdatedActiveS: '13-subscription.updated-active-annual-S.sim.json',
	subPastDueS: '14-subscription.past_due-annual-S.sim.json',
	adjUpdatedA: '15-adjustment.updated-full-refund-A.json',
	adjUpdatedB: '16-adjustment.updated-partial-refund-B.json',
	adjUpdatedS: '17-adjustment.updated-refund-annual-S.json',
	adjRejectedA: '90-adjustment.updated-full-refund-A.REJECTED.derived.json',
} as const

interface Envelope {
	event_id: string
	event_type?: string
	occurred_at: string
	data: Record<string, unknown>
}

function parsed(name: string): Envelope {
	return JSON.parse(readFixture(name)) as Envelope
}

/** Paddle's microsecond `occurred_at` truncated to ms, as the handler stores it. */
function occurredMs(name: string): number {
	return Date.parse(parsed(name).occurred_at)
}

function realLookup() {
	return stubCustomerApi({
		[CTM_A]: readFixture('customer-A.json'),
		[CTM_B]: readFixture('customer-B.json'),
		[CTM_S]: readFixture('customer-S.json'),
	})
}

async function expectOk(name: string) {
	const res = await replay(name)
	expect(res.status, `${name} → HTTP ${res.status}`).toBe(200)
}

function ledgerFor(customerId: string) {
	return db.select().from(paddleAdjustments).where(eq(paddleAdjustments.customerId, customerId))
}

async function refundedSum(customerId: string, transactionId: string): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`COALESCE(SUM(${paddleAdjustments.total}), 0)::bigint` })
		.from(paddleAdjustments)
		.where(
			and(
				eq(paddleAdjustments.customerId, customerId),
				eq(paddleAdjustments.transactionId, transactionId),
				eq(paddleAdjustments.action, 'refund')
			)
		)
	return Number(row?.total ?? 0)
}

async function grantLifetime(paid: string, completed: string) {
	realLookup()
	await expectOk(paid)
	await expectOk(completed)
}

describe('AC 4 — Paddle sandbox payloads through the real handler, outcomes read back', () => {
	it('annual subscription.created for a first-seen buyer: active, yearly, one profile, email from the REAL lookup', async () => {
		const fetchSpy = realLookup()
		await expectOk(F.subCreatedS)

		const [row] = await readUser(CTM_S)
		expect(row.subscriptionStatus).toBe('active')
		expect(row.billingInterval).toBe('year')
		// The customer response was captured after the email change, so it carries the new address.
		expect(row.email).toBe(parsed('customer-S.json').data.email)
		expect(row.email).toBe('bp-94-1-s-new@example.test')
		const profiles = await db.select().from(userProfiles).where(eq(userProfiles.userId, row.id))
		expect(profiles).toHaveLength(1)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(String(fetchSpy.mock.calls[0][0])).toBe(`${SANDBOX_API}/customers/${CTM_S}`)
	})

	it('annual transaction.paid / .completed change nothing (non-lifetime price, 200)', async () => {
		await expectOk(F.paidS)
		await expectOk(F.completedS)
		expect(await db.select().from(users)).toHaveLength(0)

		realLookup()
		await expectOk(F.subCreatedS)
		const [before] = await readUser(CTM_S)
		// Clear the claim table so these are processed afresh, not just deduped.
		await db.delete(paddleWebhookEvents)
		await expectOk(F.paidS)
		await expectOk(F.completedS)
		const [after] = await readUser(CTM_S)
		expect(after.subscriptionStatus).toBe('active')
		expect(after.lifetimeTransactionId).toBeNull()
		expect(after.lifetimeGrantTotal).toBeNull()
		expect(after.entitlementUpdatedAt).toBe(before.entitlementUpdatedAt)
	})

	it('lifetime transaction.paid then .completed: lifetime, granting txn id, grand_total recorded', async () => {
		await grantLifetime(F.paidA, F.completedA)
		const [row] = await readUser(CTM_A)
		expect(row.subscriptionStatus).toBe('lifetime')
		expect(row.lifetimeTransactionId).toBe(TXN_A)
		const totals = (parsed(F.completedA).data.details as { totals: { grand_total: string } }).totals
		expect(row.lifetimeGrantTotal).toBe(Number(totals.grand_total))
		expect(row.lifetimeGrantTotal).toBe(11187)
		expect(row.email).toBe('bp-94-1-a@example.test')
	})

	it('FULL refund on lifetime A: created (pending_approval) keeps access; updated (approved) revokes', async () => {
		await grantLifetime(F.paidA, F.completedA)

		await expectOk(F.adjCreatedA)
		expect((await readUser(CTM_A))[0].subscriptionStatus).toBe('lifetime')
		expect(await ledgerFor(CTM_A)).toHaveLength(0)

		await expectOk(F.adjUpdatedA)
		const [row] = await readUser(CTM_A)
		expect(row.subscriptionStatus).toBe('canceled')
		expect(row.entitlementUpdatedAt).toBe(occurredMs(F.adjUpdatedA))
		expect(row.accessEndedAt).toBe(occurredMs(F.adjUpdatedA))
		const ledger = await ledgerFor(CTM_A)
		expect(ledger.map((r) => r.adjustmentId)).toEqual([ADJ_A])
		expect(await refundedSum(CTM_A, TXN_A)).toBe(11187)
	})

	it('PARTIAL refund on lifetime B: lifetime retained, one ledger row, refunded sum = the partial amount', async () => {
		await grantLifetime(F.paidB, F.completedB)
		await expectOk(F.adjCreatedB)
		await expectOk(F.adjUpdatedB)

		expect((await readUser(CTM_B))[0].subscriptionStatus).toBe('lifetime')
		const ledger = await ledgerFor(CTM_B)
		expect(ledger.map((r) => r.adjustmentId)).toEqual([ADJ_B])
		expect(await refundedSum(CTM_B, TXN_B)).toBe(1000)
	})

	it('refund on the annual subscription transaction: access retained, flagged for manual review', async () => {
		realLookup()
		await expectOk(F.subCreatedS)
		await expectOk(F.adjCreatedS)
		await expectOk(F.adjUpdatedS)

		expect((await readUser(CTM_S))[0].subscriptionStatus).toBe('active')
		expect(captureError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('adjustment on an unrelated transaction'),
			}),
			expect.objectContaining({ customerId: CTM_S })
		)
		expect((await ledgerFor(CTM_S)).map((r) => r.adjustmentId)).toEqual([ADJ_S])
	})

	it('customer.updated: new email, emailUpdatedAt stamped, entitlement untouched, pending links deleted', async () => {
		const [seeded] = await db
			.insert(users)
			.values({
				email: 'bp-94-1-s@example.test',
				paddleId: CTM_S,
				subscriptionStatus: 'active',
				entitlementUpdatedAt: 1,
			} as never)
			.returning()
		await db.insert(loginTokens).values({
			userId: seeded.id,
			tokenHash: 'a'.repeat(64),
			expiresAt: new Date(Date.now() + 10 * 60_000),
		} as never)

		await expectOk(F.customerUpdatedS)

		const [row] = await readUser(CTM_S)
		expect(row.email).toBe('bp-94-1-s-new@example.test')
		expect(row.emailUpdatedAt).toBe(occurredMs(F.customerUpdatedS))
		expect(row.entitlementUpdatedAt).toBe(1)
		expect(row.subscriptionStatus).toBe('active')
		expect(await db.select().from(loginTokens)).toHaveLength(0)
	})

	it('past_due subscription event (simulation): past_due', async () => {
		realLookup()
		await expectOk(F.subCreatedS)
		await expectOk(F.subPastDueS)
		const [row] = await readUser(CTM_S)
		expect(row.subscriptionStatus).toBe('past_due')
		expect(row.entitlementUpdatedAt).toBe(occurredMs(F.subPastDueS))
	})

	it('subscription.updated{active} (simulation) restores a past_due row to active', async () => {
		await db.insert(users).values({
			email: 'bp-94-1-s-new@example.test',
			paddleId: CTM_S,
			subscriptionStatus: 'past_due',
			entitlementUpdatedAt: occurredMs(F.subCreatedS),
		} as never)
		await expectOk(F.subUpdatedActiveS)
		expect((await readUser(CTM_S))[0].subscriptionStatus).toBe('active')
	})

	it('subscription.canceled: canceled, accessEndedAt set', async () => {
		realLookup()
		await expectOk(F.subCreatedS)
		await expectOk(F.subCanceledS)
		const [row] = await readUser(CTM_S)
		expect(row.subscriptionStatus).toBe('canceled')
		expect(row.accessEndedAt).toBe(occurredMs(F.subCanceledS))
	})

	it('subscription.activated (real) for a first-seen buyer: active, yearly, email from the REAL lookup', async () => {
		// Paddle sends `.activated` alongside `.created` with the same occurred_at; either alone must grant.
		realLookup()
		await expectOk(F.subActivatedS)
		const [row] = await readUser(CTM_S)
		expect(row.subscriptionStatus).toBe('active')
		expect(row.billingInterval).toBe('year')
		expect(row.email).toBe('bp-94-1-s-new@example.test')
		expect(row.entitlementUpdatedAt).toBe(occurredMs(F.subActivatedS))
	})

	it('the real subscription.updated{canceled} after subscription.created: canceled, accessEndedAt set', async () => {
		// The real `.updated` that accompanies a cancel, delivered without its `.canceled` twin.
		realLookup()
		await expectOk(F.subCreatedS)
		await expectOk(F.subUpdatedCanceledS)
		const [row] = await readUser(CTM_S)
		expect(row.subscriptionStatus).toBe('canceled')
		expect(row.accessEndedAt).toBe(occurredMs(F.subUpdatedCanceledS))
	})

	it('every subscription fixture against a LIFETIME row leaves it lifetime', async () => {
		await db.insert(users).values({
			email: 'bp-94-1-s-new@example.test',
			paddleId: CTM_S,
			subscriptionStatus: 'lifetime',
			lifetimeTransactionId: 'txn_some_lifetime',
			lifetimeGrantTotal: 11187,
			entitlementUpdatedAt: 1,
		} as never)
		for (const name of [
			F.subCreatedS,
			F.subActivatedS,
			F.subUpdatedActiveS,
			F.subPastDueS,
			F.subCanceledS,
			F.subUpdatedCanceledS,
		]) {
			await expectOk(name)
			expect((await readUser(CTM_S))[0].subscriptionStatus, name).toBe('lifetime')
		}
	})
})

describe('AC 5 — the hazards 5-19 fixed, on the real payloads (re-delivered, never edited)', () => {
	it('(a) the same delivery twice: the second is a 200 no-op, one claim row', async () => {
		realLookup()
		await expectOk(F.subCreatedS)
		const [before] = await readUser(CTM_S)
		await expectOk(F.subCreatedS)
		expect((await readUser(CTM_S))[0]).toEqual(before)
		const claims = await db
			.select()
			.from(paddleWebhookEvents)
			.where(eq(paddleWebhookEvents.eventId, parsed(F.subCreatedS).event_id))
		expect(claims).toHaveLength(1)
		expect(await db.select().from(users)).toHaveLength(1)
		expect(await db.select().from(userProfiles)).toHaveLength(1)
	})

	it('(b) the real subscription.created arriving AFTER the real subscription.canceled stays canceled', async () => {
		await db.insert(users).values({
			email: 'bp-94-1-s-new@example.test',
			paddleId: CTM_S,
			subscriptionStatus: 'active',
			entitlementUpdatedAt: Date.parse('2026-10-04T21:00:00Z'),
		} as never)
		await expectOk(F.subCanceledS)
		await expectOk(F.subCreatedS)
		expect((await readUser(CTM_S))[0].subscriptionStatus).toBe('canceled')
	})

	it('(c) the real created + updated pair for one partial refund counts once and never crosses the bar', async () => {
		// Redelivered with its claim cleared so it reaches the ledger's onConflictDoNothing
		// instead of being stopped by delivery dedup.
		await grantLifetime(F.paidB, F.completedB)
		await expectOk(F.adjCreatedB)
		await expectOk(F.adjUpdatedB)
		await db.delete(paddleWebhookEvents)
		await expectOk(F.adjUpdatedB)
		expect(await ledgerFor(CTM_B)).toHaveLength(1)
		expect(await refundedSum(CTM_B, TXN_B)).toBe(1000)
		expect((await readUser(CTM_B))[0].subscriptionStatus).toBe('lifetime')
	})

	it('(d) a late lifetime transaction delivery after the full-refund revocation does not re-grant', async () => {
		realLookup()
		await expectOk(F.completedA)
		expect((await readUser(CTM_A))[0].subscriptionStatus).toBe('lifetime')
		await expectOk(F.adjCreatedA)
		await expectOk(F.adjUpdatedA)
		expect((await readUser(CTM_A))[0].subscriptionStatus).toBe('canceled')
		// `.paid` arrives last, carrying its earlier occurred_at: no re-grant.
		await expectOk(F.paidA)
		expect((await readUser(CTM_A))[0].subscriptionStatus).toBe('canceled')
		// Claim cleared so the watermark, not delivery dedup, is what refuses it.
		await db.delete(paddleWebhookEvents)
		await expectOk(F.completedA)
		expect((await readUser(CTM_A))[0].subscriptionStatus).toBe('canceled')
	})

	it('(e) a failed first-seen lookup releases the claim; the redelivery grants', async () => {
		lookup.useReal = true
		const failing = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response('{}', { status: 503 }))
		const res = await replay(F.subCreatedS)
		expect(res.status).toBe(500)
		expect(failing).toHaveBeenCalledTimes(1)
		expect(await db.select().from(paddleWebhookEvents)).toHaveLength(0)
		expect(await db.select().from(users)).toHaveLength(0)

		failing.mockRestore()
		realLookup()
		await expectOk(F.subCreatedS)
		expect((await readUser(CTM_S))[0].subscriptionStatus).toBe('active')
	})
})

describe('AC 7 — refund approval status, settled on the real payload (D-A: revoke only when approved)', () => {
	it('Paddle created every refund pending_approval and approved it later', () => {
		for (const name of [F.adjCreatedA, F.adjCreatedB, F.adjCreatedS]) {
			expect(parsed(name).data.status, name).toBe('pending_approval')
		}
		for (const name of [F.adjUpdatedA, F.adjUpdatedB, F.adjUpdatedS]) {
			expect(parsed(name).data.status, name).toBe('approved')
		}
	})

	it('a pending_approval FULL refund neither revokes nor counts', async () => {
		await grantLifetime(F.paidA, F.completedA)
		await expectOk(F.adjCreatedA)
		expect((await readUser(CTM_A))[0].subscriptionStatus).toBe('lifetime')
		expect(await refundedSum(CTM_A, TXN_A)).toBe(0)
	})

	it('a REJECTED full refund (derived fixture: status changed only) neither revokes nor counts', async () => {
		await grantLifetime(F.paidA, F.completedA)
		await expectOk(F.adjCreatedA)
		await expectOk(F.adjRejectedA)
		expect((await readUser(CTM_A))[0].subscriptionStatus).toBe('lifetime')
		expect(await ledgerFor(CTM_A)).toHaveLength(0)
	})
})

describe('AC 2 / AC 3 — fixture coverage and scrub guards', () => {
	it('AC 3: no fixture carries a real address, an API key, a destination secret or a client token', () => {
		const names = fixtureNames()
		expect(names.length).toBeGreaterThan(20)
		for (const name of names) {
			const text = readFixture(name)
			for (const address of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) {
				expect(address.endsWith('@example.test'), `${name}: ${address}`).toBe(true)
			}
			expect(text, name).not.toMatch(/\bpdl_/)
			expect(text, name).not.toContain('endpoint_secret_key')
			expect(text, name).not.toMatch(/\btest_[0-9a-f]{20,}/)
		}
	})

	it('AC 2: every handled branch has a fixture, or is listed NOT CAPTURED in the manifest', () => {
		const events = fixtureNames()
			.filter((n) => n.endsWith('.json') && !n.startsWith('customer-') && !n.includes('.derived.'))
			.map((n) => parsed(n))
		const has = (pred: (e: Envelope) => boolean) => events.some(pred)
		const priceIds = (e: Envelope) =>
			((e.data.items as Array<{ price?: { id?: string } }> | undefined) ?? []).map(
				(i) => i.price?.id
			)

		expect(has((e) => e.event_type === 'subscription.created')).toBe(true)
		expect(has((e) => e.event_type === 'subscription.updated' && e.data.status === 'active')).toBe(
			true
		)
		expect(
			has((e) => !!e.event_type?.startsWith('subscription.') && e.data.status === 'past_due')
		).toBe(true)
		expect(has((e) => e.event_type === 'subscription.canceled')).toBe(true)
		for (const t of ['transaction.paid', 'transaction.completed']) {
			expect(
				has((e) => e.event_type === t && priceIds(e).includes(SANDBOX_ANNUAL_PRICE)),
				t
			).toBe(true)
			expect(
				has((e) => e.event_type === t && priceIds(e).includes(SANDBOX_LIFETIME_PRICE)),
				t
			).toBe(true)
		}
		for (const t of ['adjustment.created', 'adjustment.updated']) {
			expect(
				has((e) => e.event_type === t && e.data.type === 'full'),
				`${t} full`
			).toBe(true)
			expect(
				has((e) => e.event_type === t && e.data.type === 'partial' && !e.data.subscription_id),
				`${t} partial lifetime`
			).toBe(true)
			expect(
				has((e) => e.event_type === t && !!e.data.subscription_id),
				`${t} subscription`
			).toBe(true)
		}
		expect(has((e) => e.event_type === 'customer.updated')).toBe(true)
		for (const b of ['A', 'B', 'S']) expect(fixtureNames()).toContain(`customer-${b}.json`)

		const manifest = readFileSync(fileURLToPath(new URL('MANIFEST.md', FIXTURES)), 'utf8')
		for (const action of [
			'chargeback',
			'chargeback_warning',
			'chargeback_reverse',
			'credit_reverse',
		]) {
			expect(manifest, action).toMatch(new RegExp(`\`${action}\`[^\\n]*NOT CAPTURED`))
		}
	})
})
