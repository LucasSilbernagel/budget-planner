/**
 * Paddle Billing Webhooks
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Endpoint: POST /api/webhooks/paddle
 *
 * Handles Paddle Billing subscription + transaction events and updates the
 * DB-authoritative `users.subscriptionStatus`. This is the ONLY account-creation
 * path for the paid tier (ADR-003): a first-seen `customer_id` is inserted here
 * (and given a default profile); the magic-link login (Story 5-16) only
 * re-authenticates existing users.
 *
 * Data Sovereignty: processes webhooks and updates DanubeData PostgreSQL (Germany - EU).
 * Security: verifies the `Paddle-Signature` header (HMAC-SHA256 over `ts:rawBody`)
 * and enforces a timestamp-freshness window to reject replays.
 *
 * ─── Story 5-19: retry, refund and identity correctness ─────────────────────
 *
 * Every entitlement-changing path below runs inside ONE transaction that also
 * claims the delivery's event id (`server/paddle/webhook-events.ts`), so a
 * duplicate delivery is a no-op and a rolled-back failure releases its claim for
 * the retry. Each such path additionally requires the event's own `occurred_at`
 * to be strictly newer than the user's `entitlementUpdatedAt` watermark —
 * arrival order is not trustworthy, and a late retry must not flip entitlement
 * backwards.
 *
 * **Identity reconciliation (AC-3), the policy this handler implements.** A
 * first-seen `customer_id` whose resolved email already belongs to a DIFFERENT
 * `paddleId` used to violate `users_email_unique`, 500, and retry-storm forever.
 * The rule, decided by the product owner on 2026-09-16:
 *
 *   - the colliding row is soft-deleted, `free`, or `canceled` → RE-KEY it to
 *     the new `customer_id` and grant. This is the genuine re-subscribe (and
 *     sandbox→production cutover) case.
 *   - the colliding row is ENTITLED (`active`, `past_due`, `lifetime`) → refuse:
 *     log, `captureError`, and return a TERMINAL 200 so Paddle stops retrying.
 *     Reconciled by hand.
 *
 * The asymmetry is deliberate: Paddle verifies payment, not email ownership, so
 * auto-adopting an entitled account would let a €39 checkout using someone
 * else's address take that account over.
 */

import crypto from 'crypto'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { isValidEmail, normalizeEmail } from '@/server/api/auth/email'
import { createDefaultProfileForUser } from '@/server/functions/profiles'
import { fetchPaddleCustomerEmail } from '@/server/paddle/customer-api'
import {
  type WebhookTx,
  claimWebhookEvent,
  isFresherThanWatermark,
  parseOccurredAt,
} from '@/server/paddle/webhook-events'
import { assertPaddleProductionConfig, getPaddleConfig } from '@budget-planner/config'
import { currencyEnum, db } from '@budget-planner/db'
import {
  type Currency,
  type SubscriptionStatus,
  paddleAdjustments,
  users,
} from '@budget-planner/db/src/schema'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { and, eq, sql } from 'drizzle-orm'

/** Mirror the body-size guard `routes/api/sync/batch.ts` applies (DoS guard). */
const MAX_WEBHOOK_BODY_SIZE = 1024 * 1024 // 1MB

/**
 * Outcome of a webhook DB write.
 *  - `ok: false` → nothing was persisted; the caller must return HTTP 500 so
 *    Paddle retries rather than silently losing a paid entitlement.
 *  - `createdUserId` → a NEW `users` row was inserted; the caller creates its
 *    default profile AFTER the transaction commits (a first-seen buyer would
 *    otherwise hit "Profile ID required" on every paid-tier read).
 */
interface WriteResult {
  ok: boolean
  createdUserId?: string
  /**
   * `true` → the event was HANDLED by deciding not to write (Story 5-19): an
   * identity collision on a live entitled account, a stale out-of-order retry,
   * or a refund that does not meet the revocation bar. Distinct from `ok:
   * false`: there is nothing to retry, so the caller returns 200 and Paddle
   * stops. Returning 500 for these would be a retry storm over a decision that
   * will never change on its own.
   */
  terminal?: boolean
}

/**
 * Map a Paddle Billing subscription status to our enum.
 *
 * Billing statuses: `active`, `trialing`, `past_due`, `paused`, `canceled`.
 * Anything unrecognized (or a `paused` subscription) drops to `free` — no access.
 */
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
 * Verify the Paddle Billing webhook signature.
 *
 * Header: `Paddle-Signature: ts=<unix>;h1=<hex>` — during a secret rotation
 * Paddle sends MULTIPLE `h1` values (`ts=…;h1=<old>;h1=<new>`), so we collect
 * every `h1` and accept if ANY of them matches.
 * Signed payload: `` `${ts}:${rawBody}` `` — the raw body MUST be unmodified
 * (no re-serialization / whitespace changes) or the HMAC won't match.
 * Algorithm: HMAC-SHA256 with the notification-destination secret.
 * Replay protection: reject when `ts` is older than `maxAgeSeconds` (or set in
 * the future beyond the same tolerance — clock skew both ways).
 *
 * [Source: https://developer.paddle.com/webhooks/signature-verification]
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
    // Parse `ts=...;h1=...;h1=...` (order-independent, tolerant of extra parts).
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

    // Freshness: reject a stale (replayed) or wildly future timestamp. Logged at
    // DEBUG, not WARN — this check runs BEFORE the HMAC, so an unauthenticated
    // flood of `ts=0` requests must not become a log/alert amplification vector
    // (matches the posture in `server/rate-limit/client-ip.ts`).
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

/**
 * Map a webhook-supplied currency to our enum, or undefined when none/invalid.
 *
 * Returning undefined (rather than defaulting to 'NONE') lets callers OMIT the
 * currency column on writes so an existing user's saved currency is preserved
 * when a payload carries no currency (transaction events often omit it).
 */
function mapProvidedCurrency(currency?: string): Currency | undefined {
  if (!currency) return undefined
  const currencyValues = currencyEnum.enumValues as readonly string[]
  const upper = currency.toUpperCase()
  return currencyValues.includes(upper) ? (upper as Currency) : undefined
}

/**
 * Thrown to abort a webhook transaction when a handler reports failure by
 * RETURNING `{ok:false}` rather than throwing.
 *
 * It carries the original result so the caller can return it unchanged — the
 * throw is purely a transaction-control mechanism, not an error condition the
 * caller needs to interpret. See the rationale at the throw site in
 * `runGuarded`.
 */
class WebhookDeliveryFailure extends Error {
  constructor(readonly result: WriteResult) {
    super('Webhook delivery failed; rolling back to release the event claim')
    this.name = 'WebhookDeliveryFailure'
  }
}

/** Statuses that mean the account currently HAS paid access. */
const ENTITLED_STATUSES: readonly string[] = ['active', 'past_due', 'lifetime']

/** Extra columns a lifetime grant records alongside the status. */
interface LifetimeGrantFields {
  lifetimeTransactionId?: string
  lifetimeGrantTotal?: number
}

/**
 * Apply the AC-3 identity rule to a first-seen `customer_id` whose resolved
 * email already belongs to a different `paddleId`. See the module docblock for
 * the policy and why it is asymmetric.
 *
 * Returns `none` when there is no collision (the caller inserts normally),
 * `rekeyed` when the existing row was adopted, and `refused` when the collision
 * hit a live, entitled account — which the caller reports as a TERMINAL 200.
 */
async function reconcileEmailCollision(
  tx: WebhookTx,
  params: {
    customerId: string
    normalizedEmail: string
    grantedStatus: SubscriptionStatus
    occurredAt: number
    lifetime?: LifetimeGrantFields
  }
): Promise<{ kind: 'none' } | { kind: 'rekeyed'; userId: string } | { kind: 'refused' }> {
  const { customerId, normalizedEmail, grantedStatus, occurredAt, lifetime } = params

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

  // ⚠️ `isDeleted` does NOT make an entitled row adoptable. An earlier version
  // read `!byEmail.isDeleted && ENTITLED…`, so a soft-deleted row was adoptable
  // WHATEVER its status — and adoption clears `isDeleted`, which would
  // resurrect an erased account and re-key it to whoever checked out with that
  // address. Entitlement is the refusal test; the tombstone is not a licence.
  if (ENTITLED_STATUSES.includes(byEmail.status)) {
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

  // Adoptable: soft-deleted, `free` or `canceled`. Clearing `isDeleted` is part
  // of the adoption — they are paying again, and leaving the sync tombstone set
  // would hide every row they own from their own device.
  await tx
    .update(users)
    .set({
      paddleId: customerId,
      subscriptionStatus: grantedStatus,
      isDeleted: false,
      entitlementUpdatedAt: occurredAt,
      ...(lifetime ?? {}),
    })
    .where(eq(users.id, byEmail.id))

  logger.info('Webhook: re-keyed an unentitled existing account to a new Paddle customer', {
    customerId,
    previousPaddleId: byEmail.paddleId,
    previousStatus: byEmail.status,
  })
  return { kind: 'rekeyed', userId: byEmail.id }
}

/**
 * Handle a subscription status update from a Paddle Billing `subscription.*`
 * event. Updates or creates the user keyed by `customer_id` (stored in
 * `users.paddleId`).
 *
 * NEVER downgrades a `'lifetime'` buyer (story 25-2): a subscription-lifecycle
 * event (e.g. cancelling a redundant annual sub after buying lifetime) must not
 * touch a permanent lifetime entitlement.
 *
 * Runs in the CALLER's transaction — the one that also claimed the event id, so
 * that a rollback releases the claim (Story 5-19; see `webhook-events.ts`).
 */
async function handleSubscriptionStatusUpdate(
  tx: WebhookTx,
  params: {
    customerId: string
    subscriptionStatus: string
    /** Pre-resolved OUTSIDE the transaction; undefined when the user exists. */
    email?: string
    occurredAt: number
    currency?: string
  }
): Promise<WriteResult> {
  const { customerId, subscriptionStatus, email, occurredAt, currency } = params

  if (!customerId || typeof customerId !== 'string') {
    logger.error('Webhook: invalid customer_id', { customerId })
    return { ok: false }
  }

  const mappedStatus = mapWebhookSubscriptionStatus(subscriptionStatus)
  const mappedCurrency = mapProvidedCurrency(currency)

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

    // Ordering guard (AC-2). A retry of an OLDER event arriving after a newer
    // one must not flip entitlement backwards.
    if (!isFresherThanWatermark(existing[0]?.entitlementUpdatedAt, occurredAt)) {
      logger.info('Webhook: ignoring out-of-order subscription event', {
        customerId,
        occurredAt,
        watermark: existing[0]?.entitlementUpdatedAt,
      })
      return { ok: true }
    }

    // `currency` is deliberately NOT written here (AC-8). Paddle's
    // `currency_code` is the BILLING currency, IP-detected at checkout, while
    // `users.currency` is a display preference that seeds new profiles — a
    // renewal paid from another country must not silently flip the user's
    // chosen currency. It is insert-only, below.
    await tx
      .update(users)
      .set({ subscriptionStatus: mappedStatus, entitlementUpdatedAt: occurredAt })
      .where(eq(users.paddleId, customerId))
    return { ok: true }
  }

  // No existing user. Resolve the email ONLY now — every existing
  // subscriber's status update (by far the common case) must not pay for
  // a customer-API round trip whose result the update path never uses.
  // Normalize BEFORE validating (email.ts contract) so a whitespace-padded
  // or 255–256-char address that is valid once trimmed is not spuriously
  // rejected. Create the user only if we have a VALID email to key on;
  // otherwise nothing is written — report failure so the caller returns 500.
  const normalizedEmail = email ? normalizeEmail(email) : undefined
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    logger.error(
      'Webhook: subscription event for unknown customer with no valid resolvable email — nothing written',
      { customerId }
    )
    return { ok: false }
  }

  // AC-3: resolve an email collision BEFORE inserting, so the common case never
  // raises `users_email_unique` at all. A genuine concurrent race can still
  // raise it; that aborts the transaction, the caller returns 500, and the
  // retry takes this branch with the row now committed — self-healing in one
  // retry rather than the indefinite loop this replaces.
  const collision = await reconcileEmailCollision(tx, {
    customerId,
    normalizedEmail,
    grantedStatus: mappedStatus,
    occurredAt,
  })
  if (collision.kind === 'refused') {
    return { ok: true, terminal: true }
  }
  if (collision.kind === 'rekeyed') {
    return { ok: true, createdUserId: collision.userId }
  }

  // ON CONFLICT closes the race where a concurrent `transaction.completed`
  // for the same new customer inserts the row between our SELECT and INSERT.
  // The `setWhere` keeps a just-created 'lifetime' row from being downgraded,
  // and enforces the ordering watermark on that same racing path.
  const inserted = await tx
    .insert(users)
    .values({
      paddleId: customerId,
      email: normalizedEmail,
      subscriptionStatus: mappedStatus,
      entitlementUpdatedAt: occurredAt,
      ...(mappedCurrency ? { currency: mappedCurrency } : {}),
    })
    .onConflictDoUpdate({
      target: users.paddleId,
      set: { subscriptionStatus: mappedStatus, entitlementUpdatedAt: occurredAt },
      setWhere: sql`${users.subscriptionStatus} <> 'lifetime' AND (${users.entitlementUpdatedAt} IS NULL OR ${users.entitlementUpdatedAt} < ${occurredAt})`,
    })
    .returning({ id: users.id })

  const newId = inserted[0]?.id
  logger.info('Webhook: created/updated user from subscription', { customerId })
  // `newId` is present when we INSERTED, and when the conflict-update actually
  // fired. It is absent when `setWhere` suppressed the update (a lifetime row,
  // or a staler event) — in which case the row already exists and already has
  // its profile, so skipping is correct. `createDefaultProfileForUser` is
  // idempotent, so calling it on the conflict case is harmless.
  return { ok: true, createdUserId: newId }
}

/**
 * Collect every purchased Paddle price ID from a transaction-event payload.
 *
 * Paddle Billing transaction payloads carry prices on line items as
 * `items[].price.id`; a direct `price_id` is also read defensively.
 * Returns ALL candidate ids so the caller can check whether ANY line item is
 * the lifetime price — a lifetime item is not necessarily first when a
 * transaction bundles other lines.
 */
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

/**
 * Handle a one-time lifetime purchase (story 25-2).
 *
 * A lifetime license arrives as a `transaction.completed` event (not a
 * `subscription.*` event). We persist `subscriptionStatus = 'lifetime'` — a
 * first-class, permanent entitlement that all premium gates treat as
 * access-granting. Because it is a DISTINCT status, no subscription-lifecycle
 * event can ever downgrade a lifetime buyer.
 *
 * `ok: false` when nothing was written (unknown customer with no email, or a DB
 * error) so the caller returns HTTP 500 and Paddle retries.
 */
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
  const lifetimeFields: LifetimeGrantFields = {
    ...(transactionId ? { lifetimeTransactionId: transactionId } : {}),
    ...(grandTotal === undefined ? {} : { lifetimeGrantTotal: grandTotal }),
  }

  const existing = await tx
    .select({ entitlementUpdatedAt: users.entitlementUpdatedAt })
    .from(users)
    .where(eq(users.paddleId, customerId))
    .limit(1)

  if (existing.length > 0) {
    // Ordering guard (AC-2). Gating the GRANT matters now that AC-1 can revoke
    // one: without it, a late retry of the original purchase event would
    // silently re-grant lifetime to a buyer who has since been refunded.
    if (!isFresherThanWatermark(existing[0]?.entitlementUpdatedAt, occurredAt)) {
      logger.info('Webhook: ignoring out-of-order lifetime transaction', {
        customerId,
        occurredAt,
        watermark: existing[0]?.entitlementUpdatedAt,
      })
      return { ok: true, terminal: true }
    }

    // `currency` omitted deliberately — insert-only (AC-8), as above.
    await tx
      .update(users)
      .set({
        subscriptionStatus: 'lifetime',
        entitlementUpdatedAt: occurredAt,
        ...lifetimeFields,
      })
      .where(eq(users.paddleId, customerId))
    return { ok: true }
  }

  // No existing row to upgrade. Resolve the email ONLY now — an existing
  // subscriber's grant (the UPDATE above) never needs it, so every
  // renewal/upgrade must not pay for a customer-API round trip it
  // discards. Validity is checked here too, right before the insert.
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
    lifetime: lifetimeFields,
  })
  if (collision.kind === 'refused') {
    return { ok: true, terminal: true }
  }
  if (collision.kind === 'rekeyed') {
    return { ok: true, createdUserId: collision.userId }
  }

  // ON CONFLICT: a concurrent subscription event may have inserted the row
  // after our SELECT missed. A lifetime grant upgrades ANY prior status, so
  // the only guard on this path is the ordering watermark.
  const inserted = await tx
    .insert(users)
    .values({
      paddleId: customerId,
      email: normalizedEmail,
      subscriptionStatus: 'lifetime',
      entitlementUpdatedAt: occurredAt,
      ...lifetimeFields,
      ...(mappedCurrency ? { currency: mappedCurrency } : {}),
    })
    .onConflictDoUpdate({
      target: users.paddleId,
      set: {
        subscriptionStatus: 'lifetime',
        entitlementUpdatedAt: occurredAt,
        ...lifetimeFields,
      },
      setWhere: sql`${users.entitlementUpdatedAt} IS NULL OR ${users.entitlementUpdatedAt} < ${occurredAt}`,
    })
    .returning({ id: users.id })

  logger.info('Webhook: created/upgraded lifetime user', { customerId })
  return { ok: true, createdUserId: inserted[0]?.id }
}

/**
 * Handle a Paddle `adjustment.*` event — refunds, credits and chargebacks
 * (Story 5-19, AC-1). Before this, every one of them fell through to
 * "unhandled event" + 200, so a buyer who charged back the €99 kept permanent
 * Premium and no code path could take it away.
 *
 * The revocation policy (product owner, 2026-09-16):
 *
 *   - `chargeback`            → revoke. Unambiguous: the money is gone.
 *   - `refund`, cumulative amount ≥ the recorded grant total → revoke.
 *   - `refund`, still short of the grant total → KEEP access. A goodwill
 *     partial refund must not destroy a €99 entitlement.
 *   - `chargeback_warning`    → alert only. A dispute that is later won then
 *     needs no restore path, which is the whole reason not to revoke here.
 *   - anything else (`credit`, reversals) → no entitlement change.
 *
 * This path deliberately PIERCES the `<> 'lifetime'` no-downgrade guard: that
 * guard exists to stop a subscription-lifecycle event from touching a lifetime
 * buyer, and it was the reason a refund could never be corrected.
 */
async function handleAdjustment(
  tx: WebhookTx,
  params: {
    customerId: string
    action: string
    /** Paddle's adjustment id — the identity of the money movement. */
    adjustmentId?: string
    adjustmentTotal?: number
    transactionId?: string
    occurredAt: number
  }
): Promise<WriteResult> {
  const { customerId, action, adjustmentId, adjustmentTotal, transactionId, occurredAt } = params

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
    // ⚠️ RETRYABLE, not terminal. An adjustment can legitimately arrive before
    // the grant that creates the user row — Paddle reorders, and a grant whose
    // delivery failed may still be in its retry backoff. Swallowing this with a
    // 200 erased the refund permanently: the grant would then land, pass the
    // watermark (no row ⇒ no watermark) and mint permanent Premium for a
    // customer who has already been refunded.
    logger.error('Webhook: adjustment for an unknown customer — retrying', { customerId, action })
    return { ok: false }
  }

  // Record the adjustment BEFORE interpreting it. The ledger is keyed on the
  // adjustment id, so `adjustment.created` and `adjustment.updated` for the
  // SAME adjustment — two deliveries, two event ids, which delivery-level dedup
  // does not collapse — contribute exactly once.
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
    // A dispute we WON, or a reversed credit. Access is not restored
    // automatically: restoring an entitlement is granting one, and AC-1 never
    // specified that behaviour. Alert so it can be put right by hand.
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

  // Does this adjustment concern the purchase that granted the entitlement?
  // ⚠️ Consulted by BOTH branches below. An earlier draft consulted it only for
  // refunds, so a €1 chargeback on an unrelated old invoice revoked a €99
  // lifetime grant (code review, product decision D2).
  // Bound to a local so the null-check below NARROWS it for the query further
  // down — reading the property again there would widen it back to `string|null`.
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
    // No recorded grant total, so full-vs-partial cannot be judged. This is the
    // normal state for a SUBSCRIPTION (only the lifetime path records a total):
    // an annual subscriber's access ends via `subscription.canceled`, which is
    // the entitlement signal for that plan — see decision D4. Refusing to guess
    // rather than revoking a €99 entitlement over what may be a €5 refund.
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

  // DERIVE the refunded total by summing the ledger for the granting
  // transaction. Never an in-place increment: a counter cannot be made
  // idempotent against duplicate deliveries, and it survived across grants, so
  // a re-purchase inherited the previous grant's refunds.
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

  await tx
    .update(users)
    .set({ subscriptionStatus: 'canceled', entitlementUpdatedAt: occurredAt })
    .where(eq(users.id, existing.id))

  logger.warn('Webhook: entitlement REVOKED', {
    customerId,
    action,
    previousStatus: existing.status,
    refundedTotal,
  })
  return { ok: true }
}

/** The `data` object of a Paddle Billing webhook event (the fields we read). */
interface PaddleEventData {
  id?: string
  customer_id?: string
  status?: string
  currency_code?: string
  price_id?: string
  items?: Array<{ price_id?: string; price?: { id?: string } }>
  // Present only when the notification destination includes the customer entity,
  // or on some legacy shapes — used as a fast-path so we can skip the API call.
  email?: string
  customer_email?: string
  customer?: { email?: string }
  // --- transaction events (Story 5-19, AC-8) ---
  // Paddle sends monetary amounts as STRINGS in the currency's lowest unit.
  details?: { totals?: { grand_total?: string } }
  // --- adjustment events (Story 5-19, AC-1) ---
  /** `refund` | `credit` | `chargeback` | `chargeback_warning` | reversals. */
  action?: string
  transaction_id?: string
  totals?: { total?: string }
}

/** The webhook envelope around {@link PaddleEventData}. */
interface PaddleEventEnvelope {
  event_id?: string
  event_type?: string
  occurred_at?: string
  data?: PaddleEventData
}

/**
 * Paddle sends money as a STRING in the currency's lowest unit ("9900"). Parse
 * to a number, rejecting anything non-finite — a NaN silently compared against
 * a grant total would make every comparison false and quietly disable AC-1's
 * revocation rather than failing visibly.
 */
function parseLowestUnit(value?: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Transaction statuses that represent money actually collected. A lifetime
 * grant requires one of these AND a positive total (AC-8): a 100%-discount,
 * zero-value or non-collecting transaction carrying the lifetime price must not
 * mint a permanent €99 entitlement.
 */
const COLLECTED_TRANSACTION_STATUSES: readonly string[] = ['completed', 'paid']

/** Prefer an email already in the payload; otherwise resolve it via the API. */
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
 * Resolve the buyer's email BEFORE any transaction is opened, and only when it
 * could actually be needed.
 *
 * ⚠️ The resolution is a Paddle HTTP round trip. Doing it inside the webhook
 * transaction pinned a pooled connection AND — since the event claim is now
 * taken first — an uncommitted row lock on `paddleWebhookEvents` for the whole
 * call, with concurrent duplicate deliveries blocking on that lock. A Paddle
 * API stall therefore became a database-connection outage. Now the transaction
 * contains only DB work.
 *
 * The pre-check keeps the laziness that matters: an existing subscriber's
 * status update (by far the common case) still never pays for the round trip.
 * It is advisory only — both handlers re-check inside the transaction, and the
 * insert path reports failure if it turns out to need an email it was not
 * given, which retries.
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

/**
 * Create the default profile for a newly-inserted user, AFTER its transaction
 * has committed. Non-fatal: a paid user with no profile still authenticates,
 * they just can't use profile-scoped reads until one exists — logging the
 * failure lets it be reconciled without failing the webhook.
 */
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

/**
 * POST /api/webhooks/paddle
 *
 * Exported standalone so it is unit-testable without a running server — the
 * Route below simply wires it in.
 */
export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  try {
    // Fail loudly in production if Billing isn't fully configured — a silent
    // no-op webhook means paying customers get nothing.
    assertPaddleProductionConfig()

    const paddleConfig = getPaddleConfig()

    if (!paddleConfig.webhookSecret) {
      // A permanently broken deployment retried forever with nothing raised
      // beyond a log line deserves the same alerting the other 500 paths get.
      captureError(new Error('Webhook secret not configured'), { scope: 'paddle-webhook' })
      return json({ success: false, error: 'Webhook secret not configured' }, { status: 500 })
    }

    // Body-size guard, BEFORE reading the body — the signature check is
    // useless as a DoS guard if an arbitrarily large anonymous POST is
    // buffered first. Mirrors `routes/api/sync/batch.ts`.
    const contentLength = request.headers.get('content-length')
    if (contentLength !== null) {
      const parsedLength = Number.parseInt(contentLength, 10)
      // Fail closed on a malformed header too (`NaN > MAX_WEBHOOK_BODY_SIZE`
      // is `false`, which would otherwise silently skip the guard) — the
      // exact DoS vector this check exists to close.
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

    // The delivery's identity and its ordering key (Story 5-19, AC-2).
    // `event_id` is the envelope's own id; `data.id` is the fallback for
    // payload shapes that omit it. With NEITHER, the delivery cannot be
    // deduplicated — process it anyway and say so loudly: dropping a real paid
    // event is a worse failure than processing one twice, and every handler
    // below is still guarded by the ordering watermark.
    const eventId = event.event_id ?? data.id
    const parsedOccurredAt = parseOccurredAt(event.occurred_at)
    if (parsedOccurredAt === undefined) {
      logger.warn('Webhook: event carries no usable occurred_at; falling back to arrival time', {
        eventType,
        eventId,
      })
    }
    const occurredAt = parsedOccurredAt ?? Date.now()

    /**
     * Run one entitlement-changing handler inside a single transaction that
     * ALSO claims the event id, so that a duplicate delivery does nothing and a
     * failure releases the claim for the retry (see `webhook-events.ts`).
     */
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
            // ⚠️ THE CLAIM MUST NOT SURVIVE A FAILED DELIVERY, AND ONLY A THROW
            // ROLLS IT BACK. Every handled failure in this file reports by
            // RETURNING `{ok:false}`, and a transaction callback that returns
            // normally COMMITS — so an earlier version of this code committed
            // the event claim, returned 500 for Paddle to retry, and then
            // dismissed that retry as a duplicate. Measured against real
            // PostgreSQL: claim rows 1, retry 200, users 0 — the buyer paid and
            // never got an account. Throwing aborts the transaction, which
            // releases the claim along with any partial write, so the retry is
            // processed normally. `terminal: true` outcomes are decisions, not
            // failures, and deliberately DO keep their claim.
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

    // --- Subscription lifecycle -------------------------------------------------
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

      // Outside the transaction, by design — see `resolveEmailForFirstSeenBuyer`.
      const buyerEmail = await resolveEmailForFirstSeenBuyer(customerId, data)

      const result = await runGuarded(customerId, (tx) =>
        handleSubscriptionStatusUpdate(tx, {
          customerId,
          subscriptionStatus: status,
          ...(buyerEmail ? { email: buyerEmail } : {}),
          occurredAt,
          currency,
        })
      )
      if (!result.ok) {
        // Nothing persisted (email unresolvable for a first-seen buyer, or a DB
        // error). Return 500 so Paddle retries rather than silently dropping a
        // paid subscriber / a lapse that should have removed access.
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

    // --- One-time transaction (the €99 lifetime license, story 25-2) ----------
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

      // AC-8: the price id alone is not enough. Require a status that means the
      // money was actually collected AND a positive grand total, so a
      // 100%-discount or otherwise non-collecting transaction cannot grant a
      // permanent, previously irrevocable entitlement.
      const grandTotal = parseLowestUnit(data.details?.totals?.grand_total)
      if (grandTotal === undefined) {
        // ⚠️ REFUSE, do not grant. An earlier version only rejected `<= 0` and
        // so skipped this check entirely when the total was absent or
        // unparseable — granting lifetime with a NULL `lifetimeGrantTotal`,
        // which every refund path then treats as unjudgeable. The result was a
        // permanent, IRREVOCABLE entitlement: exactly what AC-1 exists to
        // prevent. A grant we cannot later revoke must not be minted.
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
      if (grandTotal <= 0) {
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

    // --- Refunds, credits and chargebacks (Story 5-19, AC-1) ------------------
    if (eventType === 'adjustment.created' || eventType === 'adjustment.updated') {
      const customerId = data.customer_id
      const action = data.action

      if (!customerId || !action) {
        logger.error('Webhook: adjustment event missing customer_id or action', { eventType })
        return json({ success: true })
      }

      const adjustmentTotal = parseLowestUnit(data.totals?.total)
      const result = await runGuarded(customerId, (tx) =>
        handleAdjustment(tx, {
          customerId,
          action: action.toLowerCase(),
          // `data.id` here is the ADJUSTMENT id, which is the identity of the
          // money movement — distinct from the delivery's `event_id`, because
          // Paddle sends `adjustment.created` and `adjustment.updated` for one
          // adjustment as two separately-identified deliveries.
          ...(data.id ? { adjustmentId: data.id } : {}),
          ...(adjustmentTotal === undefined ? {} : { adjustmentTotal }),
          ...(data.transaction_id ? { transactionId: data.transaction_id } : {}),
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
