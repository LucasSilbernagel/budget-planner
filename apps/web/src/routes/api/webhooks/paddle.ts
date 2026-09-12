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
 */

import crypto from 'crypto'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { normalizeEmail } from '@/server/api/auth/email'
import { createDefaultProfileForUser } from '@/server/functions/profiles'
import { fetchPaddleCustomerEmail } from '@/server/paddle/customer-api'
import { checkWebhookIp } from '@/server/paddle/webhook-ip-allowlist'
import { assertPaddleProductionConfig, getPaddleConfig } from '@budget-planner/config'
import { currencyEnum, db } from '@budget-planner/db'
import { type Currency, type SubscriptionStatus, users } from '@budget-planner/db/src/schema'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { eq, sql } from 'drizzle-orm'

/** RFC 5321 max email length. */
const EMAIL_MAX_LENGTH = 254
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

/** Validate email format (shape + RFC 5321 length). Run on the NORMALIZED value. */
function isValidEmail(email?: string): boolean {
  if (!email || typeof email !== 'string') return false
  if (email.length > EMAIL_MAX_LENGTH) return false
  return EMAIL_REGEX.test(email)
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
 * Handle a subscription status update from a Paddle Billing `subscription.*`
 * event. Updates or creates the user keyed by `customer_id` (stored in
 * `users.paddleId`). Uses a transaction to prevent race conditions.
 *
 * NEVER downgrades a `'lifetime'` buyer (story 25-2): a subscription-lifecycle
 * event (e.g. cancelling a redundant annual sub after buying lifetime) must not
 * touch a permanent lifetime entitlement.
 */
async function handleSubscriptionStatusUpdate(
  customerId: string,
  subscriptionStatus: string,
  email?: string,
  currency?: string
): Promise<WriteResult> {
  if (!customerId || typeof customerId !== 'string') {
    logger.error('Webhook: invalid customer_id', { customerId })
    return { ok: false }
  }

  const mappedStatus = mapWebhookSubscriptionStatus(subscriptionStatus)

  // Normalize BEFORE validating (email.ts contract) so a whitespace-padded or
  // 255–256-char address that is valid once trimmed is not spuriously rejected.
  const normalizedEmail = email ? normalizeEmail(email) : undefined
  if (normalizedEmail && !isValidEmail(normalizedEmail)) {
    logger.warn('Webhook: invalid email for customer', { customerId })
    return { ok: false }
  }

  const mappedCurrency = mapProvidedCurrency(currency)

  try {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select({ status: users.subscriptionStatus })
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
        await tx
          .update(users)
          .set({
            subscriptionStatus: mappedStatus,
            ...(mappedCurrency ? { currency: mappedCurrency } : {}),
          })
          .where(eq(users.paddleId, customerId))
        return { ok: true }
      }

      // No existing user. Create one only if we have an email to key on;
      // otherwise nothing is written — report failure so the caller returns 500.
      if (!normalizedEmail) {
        logger.error(
          'Webhook: subscription event for unknown customer with no resolvable email — nothing written',
          { customerId }
        )
        return { ok: false }
      }

      // ON CONFLICT closes the race where a concurrent `transaction.completed`
      // for the same new customer inserts the row between our SELECT and INSERT.
      // The `setWhere` keeps a just-created 'lifetime' row from being downgraded.
      const inserted = await tx
        .insert(users)
        .values({
          paddleId: customerId,
          email: normalizedEmail,
          subscriptionStatus: mappedStatus,
          ...(mappedCurrency ? { currency: mappedCurrency } : {}),
        })
        .onConflictDoUpdate({
          target: users.paddleId,
          set: {
            subscriptionStatus: mappedStatus,
            ...(mappedCurrency ? { currency: mappedCurrency } : {}),
          },
          setWhere: sql`${users.subscriptionStatus} <> 'lifetime'`,
        })
        .returning({ id: users.id })

      const newId = inserted[0]?.id
      logger.info('Webhook: created/updated user from subscription', { customerId })
      // `newId` is present whether we inserted or updated-on-conflict; only the
      // insert case needs a default profile, but createDefaultProfileForUser is
      // idempotent so calling it on the conflict case is harmless.
      return { ok: true, createdUserId: newId }
    })
  } catch (error) {
    logger.error('Webhook: failed to update subscription status', { customerId, error })
    return { ok: false }
  }
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
  customerId: string,
  email?: string,
  currency?: string
): Promise<WriteResult> {
  if (!customerId || typeof customerId !== 'string') {
    logger.error('Webhook: invalid customer_id for lifetime purchase', { customerId })
    return { ok: false }
  }

  const normalizedEmail = email ? normalizeEmail(email) : undefined
  if (normalizedEmail && !isValidEmail(normalizedEmail)) {
    logger.warn('Webhook: invalid email for lifetime buyer', { customerId })
    return { ok: false }
  }

  const mappedCurrency = mapProvidedCurrency(currency)

  try {
    return await db.transaction(async (tx) => {
      const result = await tx
        .update(users)
        .set({
          subscriptionStatus: 'lifetime',
          ...(mappedCurrency ? { currency: mappedCurrency } : {}),
        })
        .where(eq(users.paddleId, customerId))

      if (result.rowCount !== 0) {
        return { ok: true }
      }

      if (!normalizedEmail) {
        logger.error(
          'Webhook: lifetime purchase for unknown customer with no resolvable email — cannot grant',
          { customerId }
        )
        return { ok: false }
      }

      // ON CONFLICT: a concurrent subscription event may have inserted the row
      // after our UPDATE missed. A lifetime grant upgrades ANY prior status.
      const inserted = await tx
        .insert(users)
        .values({
          paddleId: customerId,
          email: normalizedEmail,
          subscriptionStatus: 'lifetime',
          ...(mappedCurrency ? { currency: mappedCurrency } : {}),
        })
        .onConflictDoUpdate({
          target: users.paddleId,
          set: {
            subscriptionStatus: 'lifetime',
            ...(mappedCurrency ? { currency: mappedCurrency } : {}),
          },
        })
        .returning({ id: users.id })

      logger.info('Webhook: created/upgraded lifetime user', { customerId })
      return { ok: true, createdUserId: inserted[0]?.id }
    })
  } catch (error) {
    logger.error('Webhook: failed to grant lifetime entitlement', { customerId, error })
    return { ok: false }
  }
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
}

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
      return json({ success: false, error: 'Webhook secret not configured' }, { status: 500 })
    }

    // Defense-in-depth alongside the signature check below: reject requests
    // from outside Paddle's published sending ranges. Always LOGGED so the
    // derived ip/allowed values can be confirmed against real deliveries
    // before flipping PADDLE_WEBHOOK_ENFORCE_IP_ALLOWLIST=true — see
    // checkWebhookIp's docblock for why this defaults to observe-only.
    const ipCheck = await checkWebhookIp(request)
    if (!ipCheck.allowed) {
      logger.warn('Webhook: request IP not in Paddle allowlist', ipCheck)
      if (ipCheck.enforced) {
        return json({ success: false, error: 'Request IP not allowed' }, { status: 403 })
      }
    } else if (ipCheck.enforced) {
      logger.debug('Webhook: request IP allowed', ipCheck)
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

    let event: { event_type?: string; data?: PaddleEventData }
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

      const email = await resolveBuyerEmail(data)
      const result = await handleSubscriptionStatusUpdate(customerId, status, email, currency)
      if (!result.ok) {
        // Nothing persisted (email unresolvable for a first-seen buyer, or a DB
        // error). Return 500 so Paddle retries rather than silently dropping a
        // paid subscriber / a lapse that should have removed access.
        logger.error('Webhook: subscription update failed to persist; returning 500 for retry', {
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

      const email = await resolveBuyerEmail(data)
      const result = await handleLifetimePurchase(customerId, email, currency)
      if (!result.ok) {
        logger.error('Webhook: lifetime grant failed to persist; returning 500 for retry', {
          customerId,
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
