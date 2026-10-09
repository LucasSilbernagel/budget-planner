/**
 * The only account-creation path for the paid tier. An email collision with an entitled account
 * is refused (Paddle verifies payment, not email ownership); unentitled rows are re-keyed.
 */

import crypto from 'node:crypto'
import { assertPaddleProductionConfig, getPaddleConfig } from '@budget-planner/config/schema'
import { db } from '@budget-planner/db/client'
import {
	type BillingInterval,
	type Currency,
	currencyEnum,
	loginTokens,
	paddleAdjustments,
	type SubscriptionStatus,
	users,
} from '@budget-planner/db/schema'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { isValidEmail, normalizeEmail } from '@/server/api/auth/email'
import { createDefaultProfileForUser } from '@/server/functions/profiles'
import { fetchPaddleCustomerEmail } from '@/server/paddle/customer-api'
import {
	claimWebhookEvent,
	isFresherThanWatermark,
	parseOccurredAt,
	type WebhookTx,
} from '@/server/paddle/webhook-events'
import {
	insertedAccessEndedAt,
	isEntitledStatus,
	retentionColumnsFor,
} from '@/server/retention/status-classes'

const MAX_WEBHOOK_BODY_SIZE = 1024 * 1024

/** `ok: false` → nothing persisted; the caller returns 500 so Paddle retries. */
type WriteResult = {
	ok: boolean
	createdUserId?: string
	/** Handled by deciding not to write: return 200, since a retry can never change the outcome. */
	terminal?: boolean
}

/** Anything unrecognized, and `paused`, drops to `free`. */
function mapWebhookSubscriptionStatus(status: string): SubscriptionStatus {
	switch (status?.toLowerCase()) {
		case 'active':
		case 'trialing':
			return 'active'
		case 'past_due':
			return 'past_due'
		case 'canceled':
		case 'cancelled':
			return 'canceled'
		default:
			return 'free'
	}
}

/**
 * `null` = a cycle is stated but not one we sell (never guessed into a plan name);
 * `undefined` = none stated, so the update path keeps the stored value.
 */
function mapBillingInterval(
	cycle: PaddleEventData['billing_cycle']
): BillingInterval | null | undefined {
	if (cycle === undefined) return undefined
	// A stated `null` is malformed, not absent: Paddle's `billing_cycle` is required and non-nullable.
	const interval = cycle?.interval
	if (cycle?.frequency === 1 && (interval === 'month' || interval === 'year')) {
		return interval
	}
	logger.warn('Webhook: subscription billing_cycle is not a plan this product sells', {
		interval: cycle?.interval,
		frequency: cycle?.frequency,
	})
	return null
}

/**
 * During a secret rotation Paddle sends multiple `h1` values; accept if any matches.
 * The raw body must be unmodified or the HMAC over `${ts}:${rawBody}` won't match.
 */
function verifyWebhookSignature(
	rawBody: string,
	signatureHeader: string | null,
	secret: string,
	maxAgeSeconds: number
): boolean {
	if (!signatureHeader || !secret) {
		return false
	}

	try {
		let ts: string | undefined
		const h1s: string[] = []
		for (const part of signatureHeader.split(';')) {
			const [key, value] = part.split('=')
			const k = key?.trim()
			const v = value?.trim()
			if (k === 'ts') ts = v
			else if (k === 'h1' && v) h1s.push(v)
		}

		if (!ts || h1s.length === 0 || !/^\d+$/.test(ts) || !h1s.every((h) => /^[0-9a-f]+$/i.test(h))) {
			return false
		}

		// Logged at DEBUG: this runs before the HMAC, so an unauthenticated flood must not
		// amplify into logs or alerts.
		const ageSeconds = Math.abs(Date.now() / 1000 - Number(ts))
		if (ageSeconds > maxAgeSeconds) {
			logger.debug('Webhook: signature timestamp outside freshness window', {
				ageSeconds: Math.round(ageSeconds),
				maxAgeSeconds,
			})
			return false
		}

		const expected = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex')
		const computed = Buffer.from(expected, 'hex')

		return h1s.some((h1) => {
			const received = Buffer.from(h1, 'hex')
			return received.length === computed.length && crypto.timingSafeEqual(received, computed)
		})
	} catch {
		return false
	}
}

/** undefined (not 'NONE') so writes can omit currency and preserve the user's saved one. */
function mapProvidedCurrency(currency?: string): Currency | undefined {
	if (!currency) return undefined
	const currencyValues = currencyEnum.enumValues as readonly string[]
	const upper = currency.toUpperCase()
	return currencyValues.includes(upper) ? (upper as Currency) : undefined
}

/** Thrown only to roll back the transaction when a handler RETURNS `{ok:false}`. */
class WebhookDeliveryFailure extends Error {
	constructor(readonly result: WriteResult) {
		super('Webhook delivery failed; rolling back to release the event claim')
		this.name = 'WebhookDeliveryFailure'
	}
}

/**
 * Carried into the UPDATE's WHERE, not just pre-checked: two concurrent deliveries can both
 * pass a pre-read, and the loser must match no row. Exported for real-DB tests.
 */
export function entitlementWatermarkGuard(customerId: string, occurredAt: number) {
	return and(
		eq(users.paddleId, customerId),
		or(isNull(users.entitlementUpdatedAt), lt(users.entitlementUpdatedAt, occurredAt))
	)
}

type LifetimeGrantFields = {
	lifetimeTransactionId?: string
	lifetimeGrantTotal?: number
}

/** Returns `refused` (terminal 200) when the collision hit a live entitled account. */
async function reconcileEmailCollision(
	tx: WebhookTx,
	params: {
		customerId: string
		normalizedEmail: string
		grantedStatus: SubscriptionStatus
		occurredAt: number
		/** Always written: the adopted row may carry the previous customer's value. */
		billingInterval: BillingInterval | null
		lifetime?: LifetimeGrantFields
	}
): Promise<
	| { kind: 'none' }
	| { kind: 'rekeyed'; userId: string }
	| { kind: 'refused' }
	| { kind: 'vanished' }
> {
	const { customerId, normalizedEmail, grantedStatus, occurredAt, billingInterval, lifetime } =
		params

	const [byEmail] = await tx
		.select({
			id: users.id,
			paddleId: users.paddleId,
			status: users.subscriptionStatus,
			isDeleted: users.isDeleted,
		})
		.from(users)
		.where(eq(users.email, normalizedEmail))
		.limit(1)

	if (!byEmail || byEmail.paddleId === customerId) {
		return { kind: 'none' }
	}

	// `isDeleted` doesn't make an entitled row adoptable: adoption clears it, which would
	// resurrect an erased account for whoever checked out with that address.
	if (isEntitledStatus(byEmail.status)) {
		logger.error(
			'Webhook: email belongs to a live entitled account under a different Paddle customer — refusing to adopt it',
			{ customerId, existingPaddleId: byEmail.paddleId, existingStatus: byEmail.status }
		)
		captureError(new Error('Webhook: refused identity collision on an entitled account'), {
			scope: 'paddle-webhook',
			customerId,
			existingPaddleId: byEmail.paddleId,
			existingStatus: byEmail.status,
		})
		return { kind: 'refused' }
	}

	// Clearing `isDeleted` is part of adoption, or the sync tombstone would hide their own rows.
	const adopted = await tx
		.update(users)
		.set({
			paddleId: customerId,
			subscriptionStatus: grantedStatus,
			isDeleted: false,
			entitlementUpdatedAt: occurredAt,
			...retentionColumnsFor(grantedStatus, occurredAt),
			// Reset: any `emailUpdatedAt` belongs to the previous customer's event stream.
			emailUpdatedAt: null,
			billingInterval,
			...(lifetime ?? {}),
		})
		.where(eq(users.id, byEmail.id))
		.returning({ id: users.id })

	// Read without a lock: if a purge deleted the row since, report `vanished` so the retry inserts.
	if (adopted.length === 0) {
		logger.warn(
			'Webhook: re-key target vanished before the adoption UPDATE — returning 500 for retry',
			{
				customerId,
			}
		)
		return { kind: 'vanished' }
	}

	logger.info('Webhook: re-keyed an unentitled existing account to a new Paddle customer', {
		customerId,
		previousPaddleId: byEmail.paddleId,
		previousStatus: byEmail.status,
	})
	return { kind: 'rekeyed', userId: byEmail.id }
}

/**
 * Called only after an UPDATE returned no row: a missing row means a purge raced the
 * unlocked read (retry); a present one means a guard suppressed the write on purpose.
 */
async function rowVanished(tx: WebhookTx, customerId: string): Promise<boolean> {
	const rows = await tx
		.select({ id: users.id })
		.from(users)
		.where(eq(users.paddleId, customerId))
		.limit(1)
	if (rows.length > 0) {
		return false
	}
	logger.warn('Webhook: user row vanished between read and update — returning 500 for retry', {
		customerId,
	})
	return true
}

/** Never downgrades a `'lifetime'` buyer. Runs in the caller's event-claiming transaction. */
async function handleSubscriptionStatusUpdate(
	tx: WebhookTx,
	params: {
		customerId: string
		subscriptionStatus: string
		/** Pre-resolved OUTSIDE the transaction; undefined when the user exists. */
		email?: string
		occurredAt: number
		currency?: string
		/** From `mapBillingInterval`; `undefined` = the payload did not state one. */
		billingInterval?: BillingInterval | null
	}
): Promise<WriteResult> {
	const { customerId, subscriptionStatus, email, occurredAt, currency, billingInterval } = params

	if (!customerId || typeof customerId !== 'string') {
		logger.error('Webhook: invalid customer_id', { customerId })
		return { ok: false }
	}

	const mappedStatus = mapWebhookSubscriptionStatus(subscriptionStatus)
	const mappedCurrency = mapProvidedCurrency(currency)
	// On an existing row an absent cycle leaves the stored cadence alone.
	const intervalUpdate = billingInterval === undefined ? {} : { billingInterval }

	const existing = await tx
		.select({
			status: users.subscriptionStatus,
			entitlementUpdatedAt: users.entitlementUpdatedAt,
		})
		.from(users)
		.where(eq(users.paddleId, customerId))
		.limit(1)

	if (existing.length > 0) {
		if (existing[0]?.status === 'lifetime') {
			logger.info('Webhook: ignoring subscription event for a lifetime buyer (no downgrade)', {
				customerId,
			})
			return { ok: true }
		}

		// A retry of an older event must not flip entitlement backwards.
		if (!isFresherThanWatermark(existing[0]?.entitlementUpdatedAt, occurredAt)) {
			logger.info('Webhook: ignoring out-of-order subscription event', {
				customerId,
				occurredAt,
				watermark: existing[0]?.entitlementUpdatedAt,
			})
			return { ok: true }
		}

		// `currency` deliberately not written: billing currency is IP-detected and must not
		// overwrite the user's display preference. Insert-only.
		const updated = await tx
			.update(users)
			.set({
				subscriptionStatus: mappedStatus,
				entitlementUpdatedAt: occurredAt,
				...intervalUpdate,
				...retentionColumnsFor(mappedStatus, occurredAt),
			})
			// In-statement guards mirroring the insert path's `setWhere`: watermark and no-downgrade.
			.where(
				and(
					entitlementWatermarkGuard(customerId, occurredAt),
					sql`${users.subscriptionStatus} <> 'lifetime'`
				)
			)
			.returning({ id: users.id })
		// Only an entitled write is worth a retry; a lapsed event for a purged row has nothing to update.
		if (
			updated.length === 0 &&
			isEntitledStatus(mappedStatus) &&
			(await rowVanished(tx, customerId))
		) {
			return { ok: false }
		}
		return { ok: true }
	}

	// An unknown customer with a lapsed status creates nothing: it is the tail of an erased or
	// purged account, and inserting would resurrect it with a fresh clock.
	if (!isEntitledStatus(mappedStatus)) {
		logger.info('Webhook: lapsed-status event for an unknown customer — no account created', {
			customerId,
			mappedStatus,
		})
		return { ok: true, terminal: true }
	}

	// Resolve email only now, so existing subscribers skip the API round trip. Normalize before
	// validating; without a valid email nothing is written (500).
	const normalizedEmail = email ? normalizeEmail(email) : undefined
	if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
		logger.error(
			'Webhook: subscription event for unknown customer with no valid resolvable email — nothing written',
			{ customerId }
		)
		return { ok: false }
	}

	// Resolve collisions before inserting; a concurrent race still raising `users_email_unique`
	// aborts to a 500 and self-heals on retry.
	const collision = await reconcileEmailCollision(tx, {
		customerId,
		normalizedEmail,
		grantedStatus: mappedStatus,
		occurredAt,
		billingInterval: billingInterval ?? null,
	})
	if (collision.kind === 'refused') {
		return { ok: true, terminal: true }
	}
	if (collision.kind === 'vanished') {
		return { ok: false }
	}
	if (collision.kind === 'rekeyed') {
		return { ok: true, createdUserId: collision.userId }
	}

	// ON CONFLICT covers a concurrent insert for the same customer; `setWhere` blocks downgrading
	// a lifetime row and enforces the watermark.
	const inserted = await tx
		.insert(users)
		.values({
			paddleId: customerId,
			email: normalizedEmail,
			subscriptionStatus: mappedStatus,
			entitlementUpdatedAt: occurredAt,
			billingInterval: billingInterval ?? null,
			accessEndedAt: insertedAccessEndedAt(mappedStatus, occurredAt),
			...(mappedCurrency ? { currency: mappedCurrency } : {}),
		})
		.onConflictDoUpdate({
			target: users.paddleId,
			set: {
				subscriptionStatus: mappedStatus,
				entitlementUpdatedAt: occurredAt,
				...intervalUpdate,
				...retentionColumnsFor(mappedStatus, occurredAt),
			},
			setWhere: sql`${users.subscriptionStatus} <> 'lifetime' AND (${users.entitlementUpdatedAt} IS NULL OR ${users.entitlementUpdatedAt} < ${occurredAt})`,
		})
		.returning({ id: users.id })

	const newId = inserted[0]?.id
	logger.info('Webhook: created/updated user from subscription', { customerId })
	// `newId` is absent when `setWhere` suppressed the update; the row then already has its profile.
	return { ok: true, createdUserId: newId }
}

/** All candidate ids: the lifetime item isn't necessarily first in a bundled transaction. */
function collectPurchasedPriceIds(payload?: {
	price_id?: string
	items?: Array<{ price_id?: string; price?: { id?: string } }>
}): string[] {
	const ids: string[] = []
	if (payload?.price_id) ids.push(payload.price_id)
	if (Array.isArray(payload?.items)) {
		for (const item of payload.items) {
			const id = item?.price_id ?? item?.price?.id
			if (id) ids.push(id)
		}
	}
	return ids
}

/** `'lifetime'` is a distinct status, so no subscription-lifecycle event can downgrade it. */
async function handleLifetimePurchase(
	tx: WebhookTx,
	params: {
		customerId: string
		/** Pre-resolved OUTSIDE the transaction; undefined when the user exists. */
		email?: string
		occurredAt: number
		currency?: string
		transactionId?: string
		grandTotal?: number
	}
): Promise<WriteResult> {
	const { customerId, email, occurredAt, currency, transactionId, grandTotal } = params

	if (!customerId || typeof customerId !== 'string') {
		logger.error('Webhook: invalid customer_id for lifetime purchase', { customerId })
		return { ok: false }
	}

	const mappedCurrency = mapProvidedCurrency(currency)
	const lifetimeFields = {
		...(transactionId ? { lifetimeTransactionId: transactionId } : {}),
		...(grandTotal === undefined ? {} : { lifetimeGrantTotal: grandTotal }),
	} satisfies LifetimeGrantFields

	const existing = await tx
		.select({ entitlementUpdatedAt: users.entitlementUpdatedAt })
		.from(users)
		.where(eq(users.paddleId, customerId))
		.limit(1)

	if (existing.length > 0) {
		// Without this, a late retry of the original purchase would re-grant a refunded buyer.
		if (!isFresherThanWatermark(existing[0]?.entitlementUpdatedAt, occurredAt)) {
			logger.info('Webhook: ignoring out-of-order lifetime transaction', {
				customerId,
				occurredAt,
				watermark: existing[0]?.entitlementUpdatedAt,
			})
			return { ok: true, terminal: true }
		}

		// `currency` omitted deliberately: insert-only.
		const updated = await tx
			.update(users)
			.set({
				subscriptionStatus: 'lifetime',
				entitlementUpdatedAt: occurredAt,
				billingInterval: null,
				...lifetimeFields,
				...retentionColumnsFor('lifetime', occurredAt),
			})
			// A lifetime grant upgrades any status, so the watermark is the only in-statement condition.
			.where(entitlementWatermarkGuard(customerId, occurredAt))
			.returning({ id: users.id })
		if (updated.length === 0 && (await rowVanished(tx, customerId))) {
			return { ok: false }
		}
		return { ok: true }
	}

	// Resolve email only now: an existing subscriber's grant never needs it.
	const normalizedEmail = email ? normalizeEmail(email) : undefined
	if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
		logger.error(
			'Webhook: lifetime purchase for unknown customer with no valid resolvable email — cannot grant',
			{ customerId }
		)
		return { ok: false }
	}

	const collision = await reconcileEmailCollision(tx, {
		customerId,
		normalizedEmail,
		grantedStatus: 'lifetime',
		occurredAt,
		billingInterval: null,
		lifetime: lifetimeFields,
	})
	if (collision.kind === 'refused') {
		return { ok: true, terminal: true }
	}
	if (collision.kind === 'vanished') {
		return { ok: false }
	}
	if (collision.kind === 'rekeyed') {
		return { ok: true, createdUserId: collision.userId }
	}

	// ON CONFLICT: a concurrent subscription event may have inserted the row; only the watermark guards.
	const inserted = await tx
		.insert(users)
		.values({
			paddleId: customerId,
			email: normalizedEmail,
			subscriptionStatus: 'lifetime',
			entitlementUpdatedAt: occurredAt,
			billingInterval: null,
			accessEndedAt: insertedAccessEndedAt('lifetime', occurredAt),
			...lifetimeFields,
			...(mappedCurrency ? { currency: mappedCurrency } : {}),
		})
		.onConflictDoUpdate({
			target: users.paddleId,
			set: {
				subscriptionStatus: 'lifetime',
				entitlementUpdatedAt: occurredAt,
				billingInterval: null,
				...lifetimeFields,
				...retentionColumnsFor('lifetime', occurredAt),
			},
			setWhere: sql`${users.entitlementUpdatedAt} IS NULL OR ${users.entitlementUpdatedAt} < ${occurredAt}`,
		})
		.returning({ id: users.id })

	logger.info('Webhook: created/upgraded lifetime user', { customerId })
	return { ok: true, createdUserId: inserted[0]?.id }
}

/**
 * Revokes on a chargeback, or once approved refunds reach the grant total; partial refunds keep
 * access. Deliberately bypasses the lifetime no-downgrade guard.
 */
async function handleAdjustment(
	tx: WebhookTx,
	params: {
		customerId: string
		action: string
		adjustmentId?: string
		adjustmentTotal?: number
		transactionId?: string
		/** Paddle's adjustment `status`: `pending_approval` | `approved` | `rejected` | `reversed`. */
		status?: string
		occurredAt: number
	}
): Promise<WriteResult> {
	const { customerId, action, adjustmentId, adjustmentTotal, transactionId, status, occurredAt } =
		params

	// A refund moves nothing until approved. Checked before the ledger insert and the customer lookup.
	if (action === 'refund' && status !== 'approved') {
		if (status === undefined) {
			// Paddle's schema makes `status` required; a refund without one is
			// malformed. Not acting leaves access in place, so make it visible.
			logger.error('Webhook: refund adjustment carries no status — not applied', {
				customerId,
				adjustmentId,
			})
			captureError(new Error('Webhook: refund adjustment without a status needs manual review'), {
				scope: 'paddle-webhook',
				customerId,
				transactionId,
				adjustmentId,
			})
		} else if (status === 'pending_approval' || status === 'rejected') {
			logger.info('Webhook: refund not approved (yet) — recorded nothing', {
				customerId,
				adjustmentId,
				status,
			})
		} else {
			// Unknown statuses aren't applied and the claim is terminal, so make it visible.
			logger.error('Webhook: refund with an unexpected status — not applied', {
				customerId,
				adjustmentId,
				status,
			})
			captureError(new Error('Webhook: refund with an unexpected status needs manual review'), {
				scope: 'paddle-webhook',
				customerId,
				transactionId,
				adjustmentId,
				status,
			})
		}
		return { ok: true, terminal: true }
	}

	const [existing] = await tx
		.select({
			id: users.id,
			status: users.subscriptionStatus,
			entitlementUpdatedAt: users.entitlementUpdatedAt,
			lifetimeTransactionId: users.lifetimeTransactionId,
			lifetimeGrantTotal: users.lifetimeGrantTotal,
		})
		.from(users)
		.where(eq(users.paddleId, customerId))
		.limit(1)

	if (!existing) {
		// Retryable: an adjustment can arrive before its grant; a 200 here would erase the refund
		// and let the late grant mint Premium for a refunded customer.
		logger.error('Webhook: adjustment for an unknown customer — retrying', { customerId, action })
		return { ok: false }
	}

	// Ledger keyed on adjustment id, so `.created` and `.updated` for one adjustment count once.
	if (adjustmentId && adjustmentTotal !== undefined) {
		await tx
			.insert(paddleAdjustments)
			.values({
				adjustmentId,
				customerId,
				action,
				total: adjustmentTotal,
				...(transactionId ? { transactionId } : {}),
			})
			.onConflictDoNothing()
	}

	if (action === 'chargeback_warning') {
		logger.warn('Webhook: chargeback warning received — access left intact pending the outcome', {
			customerId,
			action,
		})
		captureError(new Error('Webhook: Paddle chargeback warning'), {
			scope: 'paddle-webhook',
			customerId,
			transactionId,
		})
		return { ok: true, terminal: true }
	}

	if (action === 'chargeback_reverse' || action === 'credit_reverse') {
		// Access is not restored automatically; alert so it can be put right by hand.
		logger.warn('Webhook: adjustment reversal received — entitlement NOT restored automatically', {
			customerId,
			action,
		})
		captureError(new Error('Webhook: Paddle adjustment reversal needs manual review'), {
			scope: 'paddle-webhook',
			customerId,
			transactionId,
			action,
		})
		return { ok: true, terminal: true }
	}

	if (action !== 'refund' && action !== 'chargeback') {
		logger.info('Webhook: adjustment action does not affect entitlement', { customerId, action })
		return { ok: true, terminal: true }
	}

	// Both branches require the adjustment to concern the granting purchase. A local so the null
	// check narrows it for the query below.
	const grantTransactionId = existing.lifetimeTransactionId
	const appliesToGrant =
		!!grantTransactionId && !!transactionId && grantTransactionId === transactionId

	if (!grantTransactionId || !appliesToGrant) {
		logger.warn('Webhook: adjustment does not concern the granting transaction — no revocation', {
			customerId,
			action,
			transactionId,
			grantTransactionId: existing.lifetimeTransactionId,
		})
		captureError(new Error('Webhook: adjustment on an unrelated transaction needs manual review'), {
			scope: 'paddle-webhook',
			customerId,
			transactionId,
			action,
		})
		return { ok: true, terminal: true }
	}

	if (existing.lifetimeGrantTotal === null || existing.lifetimeGrantTotal === undefined) {
		// No recorded grant total (normal for subscriptions): can't judge full vs partial, so don't revoke.
		logger.warn('Webhook: adjustment on a grant with no recorded total — no revocation', {
			customerId,
			action,
			adjustmentTotal,
		})
		captureError(new Error('Webhook: adjustment on a grant with no recorded total'), {
			scope: 'paddle-webhook',
			customerId,
			transactionId,
		})
		return { ok: true, terminal: true }
	}

	// Derive the refunded total from the ledger: an in-place counter can't be idempotent against
	// duplicate deliveries.
	const [refunded] = await tx
		.select({ total: sql<number>`COALESCE(SUM(${paddleAdjustments.total}), 0)::bigint` })
		.from(paddleAdjustments)
		.where(
			and(
				eq(paddleAdjustments.customerId, customerId),
				eq(paddleAdjustments.transactionId, grantTransactionId),
				eq(paddleAdjustments.action, 'refund')
			)
		)
	const refundedTotal = Number(refunded?.total ?? 0)

	const revoke = action === 'chargeback' || refundedTotal >= existing.lifetimeGrantTotal

	if (!revoke) {
		logger.info('Webhook: partial refund recorded; access retained', {
			customerId,
			refundedTotal,
			grantTotal: existing.lifetimeGrantTotal,
		})
		return { ok: true, terminal: true }
	}

	if (!isFresherThanWatermark(existing.entitlementUpdatedAt, occurredAt)) {
		// The ledger row above is still committed, so the refund is remembered even
		// though this delivery does not move entitlement.
		logger.info('Webhook: ignoring out-of-order adjustment', {
			customerId,
			occurredAt,
			watermark: existing.entitlementUpdatedAt,
		})
		return { ok: true, terminal: true }
	}

	// `billingInterval` untouched: it remains a true fact about what was bought.
	await tx
		.update(users)
		.set({
			subscriptionStatus: 'canceled',
			entitlementUpdatedAt: occurredAt,
			// A revoked lifetime is a lapse too: the retention clock starts here.
			...retentionColumnsFor('canceled', occurredAt),
		})
		.where(eq(users.id, existing.id))

	logger.warn('Webhook: entitlement REVOKED', {
		customerId,
		action,
		previousStatus: existing.status,
		refundedTotal,
	})
	return { ok: true }
}

/** Carried into every UPDATE, so the loser of a concurrent pair matches no row. */
function emailWatermarkGuard(userId: string, occurredAt: number) {
	return and(
		eq(users.id, userId),
		or(isNull(users.emailUpdatedAt), lt(users.emailUpdatedAt, occurredAt))
	)
}

/** Advance the email watermark without touching the address itself. */
async function stampEmailWatermark(
	tx: WebhookTx,
	userId: string,
	occurredAt: number
): Promise<void> {
	await tx
		.update(users)
		.set({ emailUpdatedAt: occurredAt })
		.where(emailWatermarkGuard(userId, occurredAt))
}

/**
 * A collision refuses unconditionally: both rows already exist, so freeing the address would
 * mean destroying a second user's ledger. `captureError` is the only report of it.
 */
async function handleCustomerEmailChange(
	tx: WebhookTx,
	params: {
		customerId: string
		email?: string
		occurredAt: number
	}
): Promise<WriteResult> {
	const { customerId, email, occurredAt } = params

	// Normalize before validating, so a padded address that is valid once trimmed is accepted.
	const normalizedEmail = email ? normalizeEmail(email) : undefined
	if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
		// Terminal: the address is in the payload, so a retry can never make it valid.
		logger.error('Webhook: customer event carries no usable email; nothing written', {
			customerId,
		})
		// Leaves the account on an address the user may not control, so it needs the same alert.
		captureError(new Error('Webhook: customer email unusable; account left on its old address'), {
			scope: 'paddle-webhook',
			customerId,
		})
		return { ok: true, terminal: true }
	}

	const [ours] = await tx
		.select({
			id: users.id,
			email: users.email,
			emailUpdatedAt: users.emailUpdatedAt,
		})
		.from(users)
		.where(eq(users.paddleId, customerId))
		.limit(1)

	if (!ours) {
		// Not an account-creation path. Accepted loss: a correction arriving before the account exists
		// is dropped; retrying would storm for everyone who never checks out.
		logger.info('Webhook: customer event for a customer we do not know; ignoring', { customerId })
		return { ok: true }
	}

	// A replayed older event must not put a stale address back.
	if (!isFresherThanWatermark(ours.emailUpdatedAt, occurredAt)) {
		logger.info('Webhook: ignoring out-of-order customer event', {
			customerId,
			occurredAt,
			watermark: ours.emailUpdatedAt,
		})
		return { ok: true }
	}

	// Stamp the watermark for every fresher event decided on, including no-ops (the common case),
	// or an older event delivered later is judged fresher than NULL.
	if (ours.email === normalizedEmail) {
		await stampEmailWatermark(tx, ours.id, occurredAt)
		return { ok: true }
	}

	const [collision] = await tx
		.select({
			id: users.id,
			paddleId: users.paddleId,
			status: users.subscriptionStatus,
			isDeleted: users.isDeleted,
		})
		.from(users)
		// `lower(email)`, matching the login predicate: an exact match misses legacy mixed-case rows
		// and would leave two accounts login can't tell apart.
		.where(sql`lower(${users.email}) = ${normalizedEmail}`)
		.limit(1)

	// `collision.id !== ours.id` is load-bearing: our own legacy mixed-case row matches
	// `lower(email)`. `isDeleted` is deliberately not consulted.
	if (collision && collision.id !== ours.id) {
		logger.error(
			'Webhook: refusing to move an account onto an email that belongs to another account',
			{
				customerId,
				collidingPaddleId: collision.paddleId,
				collidingStatus: collision.status,
				collidingIsDeleted: collision.isDeleted,
			}
		)
		captureError(new Error('Webhook: refused customer email change on an address collision'), {
			scope: 'paddle-webhook',
			customerId,
			collidingPaddleId: collision.paddleId,
			collidingStatus: collision.status,
		})
		// Stamp even though refused, or an older intermediate address could be applied afterwards.
		await stampEmailWatermark(tx, ours.id, occurredAt)
		return { ok: true, terminal: true }
	}

	// Never write `entitlementUpdatedAt` here: the streams order independently, and advancing it
	// would drop a legit older-stamped subscription retry. Sessions aren't revoked either.
	await tx
		.update(users)
		.set({ email: normalizedEmail, emailUpdatedAt: occurredAt })
		// Watermark repeated in the UPDATE: concurrent deliveries can both pass the check above.
		.where(emailWatermarkGuard(ours.id, occurredAt))

	// Old-address login tokens are keyed on userId and would still sign in, so revoke them.
	await tx.delete(loginTokens).where(eq(loginTokens.userId, ours.id))

	logger.info('Webhook: account email updated from a Paddle customer event', { customerId })
	return { ok: true }
}

type PaddleEventData = {
	/** Per event family: transaction, adjustment, or (on `customer.*`) the customer id. */
	id?: string
	/** Absent on every `customer.*` event — read `id` there instead. */
	customer_id?: string
	/** On `customer.*` this is the customer record's status, never an entitlement change. */
	status?: string
	currency_code?: string
	billing_cycle?: { interval?: string; frequency?: number } | null
	price_id?: string
	items?: Array<{ price_id?: string; price?: { id?: string } }>
	// Present only when the notification destination includes the customer entity,
	// or on some legacy shapes — used as a fast-path so we can skip the API call.
	email?: string
	customer_email?: string
	customer?: { email?: string }
	// Paddle sends monetary amounts as strings in the currency's lowest unit.
	details?: { totals?: { grand_total?: string; subtotal?: string; discount?: string } }
	discount_id?: string | null
	/** `refund` | `credit` | `chargeback` | `chargeback_warning` | reversals. */
	action?: string
	transaction_id?: string
	totals?: { total?: string }
}

type PaddleEventEnvelope = {
	event_id?: string
	event_type?: string
	occurred_at?: string
	data?: PaddleEventData
}

/** Rejects non-finite values: a NaN compared against a grant total would silently disable revocation. */
function parseLowestUnit(value?: string): number | undefined {
	if (value === undefined || value === null || value === '') return undefined
	const n = Number(value)
	return Number.isFinite(n) ? n : undefined
}

/** Statuses meaning the money was actually collected. */
const COLLECTED_TRANSACTION_STATUSES = ['completed', 'paid'] satisfies readonly string[]

/** `grand_total` alone can't show a full discount: it is computed after customer credit. */
function isFullyDiscounted(data: PaddleEventData): boolean {
	const subtotal = parseLowestUnit(data.details?.totals?.subtotal)
	const discount = parseLowestUnit(data.details?.totals?.discount)
	return (
		!!data.discount_id &&
		subtotal !== undefined &&
		discount !== undefined &&
		subtotal > 0 &&
		discount >= subtotal
	)
}

async function resolveBuyerEmail(data: PaddleEventData): Promise<string | undefined> {
	const inline = data.email ?? data.customer_email ?? data.customer?.email
	if (inline && isValidEmail(normalizeEmail(inline))) {
		return inline
	}
	if (data.customer_id) {
		return fetchPaddleCustomerEmail(data.customer_id)
	}
	return undefined
}

/**
 * Resolved before the transaction: the Paddle HTTP call inside it held a pooled connection and
 * the claim's row lock. Advisory only; handlers re-check inside.
 */
async function resolveEmailForFirstSeenBuyer(
	customerId: string,
	data: PaddleEventData
): Promise<string | undefined> {
	const existing = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.paddleId, customerId))
		.limit(1)
	if (existing.length > 0) return undefined
	return resolveBuyerEmail(data)
}

/** Non-fatal: logged so it can be reconciled without failing the webhook. */
async function ensureDefaultProfile(userId: string | undefined): Promise<void> {
	if (!userId) return
	try {
		const res = await createDefaultProfileForUser(userId)
		if (!res.success) {
			logger.error('Webhook: failed to create default profile for new user', {
				userId,
				error: res.error,
			})
		}
	} catch (error) {
		logger.error('Webhook: default-profile creation threw for new user', { userId, error })
	}
}

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
	try {
		// Fail loudly in production if Billing isn't fully configured — a silent
		// no-op webhook means paying customers get nothing.
		assertPaddleProductionConfig()

		const paddleConfig = getPaddleConfig()

		if (!paddleConfig.webhookSecret) {
			captureError(new Error('Webhook secret not configured'), { scope: 'paddle-webhook' })
			return json({ success: false, error: 'Webhook secret not configured' }, { status: 500 })
		}

		// Size guard before reading the body: the signature check can't stop a huge anonymous POST
		// being buffered.
		const contentLength = request.headers.get('content-length')
		if (contentLength !== null) {
			const parsedLength = Number.parseInt(contentLength, 10)
			// Fail closed on a malformed header: `NaN > MAX` is false and would skip the guard.
			if (Number.isNaN(parsedLength) || parsedLength > MAX_WEBHOOK_BODY_SIZE) {
				logger.warn('Webhook: rejected oversized or malformed content-length', { contentLength })
				return json({ success: false, error: 'Request too large' }, { status: 413 })
			}
		}

		const signature = request.headers.get('paddle-signature')
		const payload = await request.text()

		if (
			!verifyWebhookSignature(
				payload,
				signature,
				paddleConfig.webhookSecret,
				paddleConfig.webhookMaxAgeSeconds
			)
		) {
			return json({ success: false, error: 'Invalid webhook signature' }, { status: 401 })
		}

		let event: PaddleEventEnvelope
		try {
			event = JSON.parse(payload)
		} catch {
			return json({ success: false, error: 'Invalid JSON payload' }, { status: 400 })
		}

		const eventType = event?.event_type
		const data = event?.data ?? {}

		if (!eventType) {
			logger.error('Webhook: missing event_type')
			return json(
				{ success: false, error: 'Missing event_type in webhook payload' },
				{ status: 400 }
			)
		}

		// No `data.id` fallback for `customer.*`: it is the constant customer id and would dedupe every
		// later customer event away. Without an id, process undeduplicated (watermarks still guard).
		const eventId = event.event_id ?? (eventType.startsWith('customer.') ? undefined : data.id)
		const parsedOccurredAt = parseOccurredAt(event.occurred_at)
		if (parsedOccurredAt === undefined) {
			logger.warn('Webhook: event carries no usable occurred_at; falling back to arrival time', {
				eventType,
				eventId,
			})
		}
		const occurredAt = parsedOccurredAt ?? Date.now()

		/** One transaction that also claims the event id, so duplicates no-op and failures release it. */
		const runGuarded = async (
			customerId: string | undefined,
			work: (tx: WebhookTx) => Promise<WriteResult>
		): Promise<WriteResult> => {
			try {
				return await db.transaction(async (tx) => {
					if (eventId) {
						const claimed = await claimWebhookEvent(tx, {
							eventId,
							eventType,
							...(customerId ? { customerId } : {}),
							occurredAt,
						})
						if (!claimed) {
							return { ok: true, terminal: true }
						}
					} else {
						logger.warn('Webhook: delivery has no event id — processing without dedup', {
							eventType,
						})
					}
					const result = await work(tx)
					if (!result.ok) {
						// Only a throw rolls back: a returned `{ok:false}` would commit the claim and the retry would
						// be dismissed as a duplicate. Terminal outcomes deliberately keep their claim.
						throw new WebhookDeliveryFailure(result)
					}
					return result
				})
			} catch (error) {
				if (error instanceof WebhookDeliveryFailure) {
					return error.result
				}
				logger.error('Webhook: transaction failed', { eventType, customerId, error })
				return { ok: false }
			}
		}

		if (eventType.startsWith('subscription.')) {
			const customerId = data.customer_id
			const status = data.status
			const currency = data.currency_code

			if (!customerId) {
				logger.error('Webhook: missing customer_id on subscription event', { eventType })
				return json({ success: true })
			}
			if (!status) {
				logger.error('Webhook: missing status on subscription event', { eventType, customerId })
				return json({ success: true })
			}

			// Outside the transaction by design; a lapsed status never creates a user, so skip it.
			const buyerEmail = isEntitledStatus(mapWebhookSubscriptionStatus(status))
				? await resolveEmailForFirstSeenBuyer(customerId, data)
				: undefined

			const result = await runGuarded(customerId, (tx) =>
				handleSubscriptionStatusUpdate(tx, {
					customerId,
					subscriptionStatus: status,
					...(buyerEmail ? { email: buyerEmail } : {}),
					occurredAt,
					currency,
					billingInterval: mapBillingInterval(data.billing_cycle),
				})
			)
			if (!result.ok) {
				logger.error('Webhook: subscription update failed to persist; returning 500 for retry', {
					customerId,
					eventType,
				})
				captureError(new Error('Webhook: subscription update failed to persist'), {
					scope: 'paddle-webhook',
					customerId,
					eventType,
				})
				return json(
					{ success: false, error: 'Failed to persist subscription status' },
					{ status: 500 }
				)
			}
			await ensureDefaultProfile(result.createdUserId)
			return json({ success: true })
		}

		if (eventType === 'transaction.completed' || eventType === 'transaction.paid') {
			const customerId = data.customer_id
			const currency = data.currency_code
			// Trim so stray whitespace on the configured value can't silently block
			// every lifetime grant.
			const lifetimePriceId = paddleConfig.lifetimePriceId?.trim()

			if (!customerId) {
				logger.error('Webhook: missing customer_id on transaction', { eventType })
				return json({ success: true })
			}
			if (!lifetimePriceId) {
				logger.warn(
					'Webhook: transaction event but PADDLE_LIFETIME_PRICE_ID is not configured; ignoring',
					{ eventType }
				)
				return json({ success: true })
			}

			const matchesLifetime = collectPurchasedPriceIds(data).some(
				(id) => id.trim() === lifetimePriceId
			)
			if (!matchesLifetime) {
				logger.info('Webhook: transaction for a non-lifetime price; ignoring', { eventType })
				return json({ success: true })
			}

			// The price id alone isn't enough: require a collected status and a usable grand total.
			const grandTotal = parseLowestUnit(data.details?.totals?.grand_total)
			if (grandTotal === undefined) {
				// Refuse, don't grant: a NULL grant total would make the entitlement irrevocable.
				logger.error(
					'Webhook: lifetime-priced transaction carries no usable grand_total; refusing to grant',
					{ customerId, grandTotal: data.details?.totals?.grand_total }
				)
				captureError(new Error('Webhook: lifetime transaction with no usable total refused'), {
					scope: 'paddle-webhook',
					customerId,
				})
				return json({ success: true })
			}
			if (data.status && !COLLECTED_TRANSACTION_STATUSES.includes(data.status.toLowerCase())) {
				logger.warn('Webhook: lifetime-priced transaction is not in a collected state; ignoring', {
					customerId,
					status: data.status,
				})
				return json({ success: true })
			}
			// A 100%-coupon checkout grants (recorded total 0, revocable only by hand). A zero total the
			// discount doesn't explain, or any negative total, is refused.
			if (grandTotal < 0 || (grandTotal === 0 && !isFullyDiscounted(data))) {
				logger.warn('Webhook: lifetime-priced transaction collected nothing; refusing to grant', {
					customerId,
					grandTotal,
				})
				captureError(new Error('Webhook: zero-value lifetime transaction refused'), {
					scope: 'paddle-webhook',
					customerId,
				})
				return json({ success: true })
			}

			// Outside the transaction, by design — see `resolveEmailForFirstSeenBuyer`.
			const buyerEmail = await resolveEmailForFirstSeenBuyer(customerId, data)

			const result = await runGuarded(customerId, (tx) =>
				handleLifetimePurchase(tx, {
					customerId,
					...(buyerEmail ? { email: buyerEmail } : {}),
					occurredAt,
					currency,
					...(data.id ? { transactionId: data.id } : {}),
					grandTotal,
				})
			)
			if (!result.ok) {
				logger.error('Webhook: lifetime grant failed to persist; returning 500 for retry', {
					customerId,
				})
				captureError(new Error('Webhook: lifetime grant failed to persist'), {
					scope: 'paddle-webhook',
					customerId,
					eventType,
				})
				return json(
					{ success: false, error: 'Failed to persist lifetime entitlement' },
					{ status: 500 }
				)
			}
			await ensureDefaultProfile(result.createdUserId)
			logger.info('Webhook: granted permanent Premium for lifetime purchase', { customerId })
			return json({ success: true })
		}

		if (eventType === 'adjustment.created' || eventType === 'adjustment.updated') {
			const customerId = data.customer_id
			const action = data.action

			// Absent means absent, not falsy: a `0`/`false` action is wrong-typed and takes the flagged branch.
			if (!customerId || action == null || action === '') {
				logger.error('Webhook: adjustment event missing customer_id or action', { eventType })
				return json({ success: true })
			}

			// A non-string `action` must not throw: it would 500 and retry forever. Flag it, terminal 200.
			if (typeof action !== 'string') {
				logger.error('Webhook: adjustment action is not a string — not applied', {
					customerId,
					adjustmentId: data.id,
					actionType: typeof action,
				})
				captureError(new Error('Webhook: adjustment action is not a string — review'), {
					scope: 'paddle-webhook',
					customerId,
					...(data.id ? { adjustmentId: data.id } : {}),
					...(data.transaction_id ? { transactionId: data.transaction_id } : {}),
				})
				return json({ success: true })
			}

			const adjustmentTotal = parseLowestUnit(data.totals?.total)
			const result = await runGuarded(customerId, (tx) =>
				handleAdjustment(tx, {
					customerId,
					action: action.toLowerCase(),
					// The adjustment id, not the event id: `.created` and `.updated` are separate deliveries.
					...(data.id ? { adjustmentId: data.id } : {}),
					...(adjustmentTotal === undefined ? {} : { adjustmentTotal }),
					...(data.transaction_id ? { transactionId: data.transaction_id } : {}),
					// A non-string status must not throw (a 500 would retry forever);
					// it is treated as missing and flagged by the D-A gate.
					...(typeof data.status === 'string' && data.status.trim()
						? { status: data.status.trim().toLowerCase() }
						: {}),
					occurredAt,
				})
			)
			if (!result.ok) {
				logger.error('Webhook: adjustment failed to persist; returning 500 for retry', {
					customerId,
					eventType,
				})
				captureError(new Error('Webhook: adjustment failed to persist'), {
					scope: 'paddle-webhook',
					customerId,
					eventType,
				})
				return json({ success: false, error: 'Failed to persist adjustment' }, { status: 500 })
			}
			return json({ success: true })
		}

		if (eventType === 'customer.updated') {
			// ⚠️ `data.id`, NOT `data.customer_id` — a `customer.*` payload has no
			// `customer_id` field, so reading one here would be a silent no-op.
			const customerId = data.id

			if (!customerId) {
				logger.error('Webhook: customer event missing data.id', { eventType })
				return json({ success: true })
			}

			const result = await runGuarded(customerId, (tx) =>
				handleCustomerEmailChange(tx, {
					customerId,
					...(data.email ? { email: data.email } : {}),
					occurredAt,
				})
			)

			if (!result.ok) {
				logger.error('Webhook: customer email change failed to persist; returning 500 for retry', {
					customerId,
					eventType,
				})
				captureError(new Error('Webhook: customer email change failed to persist'), {
					scope: 'paddle-webhook',
					customerId,
					eventType,
				})
				return json({ success: false, error: 'Failed to persist email change' }, { status: 500 })
			}
			return json({ success: true })
		}

		// `customer.created` stays unhandled: account creation belongs to the paid paths.
		logger.info('Webhook: unhandled event', { eventType })
		return json({ success: true })
	} catch (error) {
		logger.error('Webhook: unhandled error', { error })
		captureError(error, { scope: 'paddle-webhook' })
		return json({ success: false, error: 'Internal server error' }, { status: 500 })
	}
}

export const Route = createFileRoute('/api/webhooks/paddle')({
	server: {
		handlers: {
			POST,
		},
	},
})
