/**
 * Paddle Webhooks
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Handles Paddle webhook events for subscription updates
 *
 * Endpoint: POST /api/webhooks/paddle
 *
 * Data Sovereignty: Processes webhooks and updates DanubeData PostgreSQL (Germany - EU)
 * Security: Verifies webhook signatures to prevent spoofing
 */

import crypto from 'crypto'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { getPaddleConfig } from '@budget-planner/config'
import { currencyEnum, db } from '@budget-planner/db'
import { type Currency, type SubscriptionStatus, users } from '@budget-planner/db/src/schema'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

/**
 * Map Paddle webhook subscription status to our enum
 *
 * @param status - Paddle subscription status string
 * @returns Mapped subscription status
 */
function mapWebhookSubscriptionStatus(status: string): SubscriptionStatus {
  const normalizedStatus = status?.toLowerCase()

  switch (normalizedStatus) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
      return 'past_due'
    case 'canceled':
    case 'cancelled':
      return 'canceled'
    default:
      // Unknown status - default to free
      return 'free'
  }
}

/**
 * Validate email format
 *
 * @param email - Email address to validate
 * @returns True if email is valid
 */
function isValidEmail(email?: string): boolean {
  if (!email || typeof email !== 'string') return false

  // RFC 5321: max 254 characters
  if (email.length > 254) return false

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Verify Paddle webhook signature
 * Prevents unauthorized webhook requests
 *
 * Paddle webhook signature format: v1,{timestamp},{hmac}
 * The HMAC is computed as: hmac_sha256(timestamp + '.' + payload)
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false
  }

  try {
    // Parse signature: v1,{timestamp},{hmac}
    const [version, timestamp, receivedHmac] = signature.split(',')

    if (version !== 'v1' || !timestamp || !receivedHmac) {
      return false
    }

    // Compute expected HMAC: hmac_sha256(timestamp + '.' + payload)
    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex')

    // Use timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(receivedHmac, 'hex'),
      Buffer.from(expectedHmac, 'hex')
    )
  } catch {
    return false
  }
}

/**
 * Map a webhook-supplied currency to our enum, or undefined when none/invalid.
 *
 * Returning undefined (rather than defaulting to 'NONE') lets callers OMIT the
 * currency column on writes so an existing user's saved currency is preserved
 * when a payload carries no currency (transaction events often omit it) — code
 * review 2026-07-20.
 */
function mapProvidedCurrency(currency?: string): Currency | undefined {
  if (!currency) return undefined
  const currencyValues = currencyEnum.enumValues as readonly string[]
  const upper = currency.toUpperCase()
  return currencyValues.includes(upper) ? (upper as Currency) : undefined
}

/**
 * Handle subscription status update from Paddle webhook
 * Updates or creates user subscription status in DanubeData PostgreSQL
 * Uses transaction to prevent race conditions
 *
 * For subscription_created events, this may be the first time we see this user
 * if the OAuth flow didn't complete properly, so we create the user record.
 *
 * NEVER downgrades a `'lifetime'` buyer (story 25-2): a subscription-lifecycle
 * event (e.g. cancelling a redundant annual sub after buying lifetime) must not
 * touch a permanent lifetime entitlement.
 */
async function handleSubscriptionStatusUpdate(
  paddleUserId: string,
  subscriptionStatus: string,
  email?: string,
  currency?: string
): Promise<boolean> {
  // Validate inputs
  if (!paddleUserId || typeof paddleUserId !== 'string') {
    logger.error('Webhook: invalid paddleUserId', { paddleUserId })
    return false
  }

  // Map subscription status to our enum
  const mappedStatus = mapWebhookSubscriptionStatus(subscriptionStatus)

  // Validate email if provided
  if (email && !isValidEmail(email)) {
    logger.warn('Webhook: invalid email for user', { paddleUserId, email })
    return false
  }

  // Only overwrite currency when the payload actually carries one (preserve otherwise).
  const mappedCurrency = mapProvidedCurrency(currency)

  try {
    return await db.transaction(async (tx) => {
      // Look up the current status first so we can (a) protect a lifetime buyer
      // from downgrade and (b) return an honest success/failure to the caller.
      const existing = await tx
        .select({ status: users.subscriptionStatus })
        .from(users)
        .where(eq(users.paddleId, paddleUserId))
        .limit(1)

      if (existing.length > 0) {
        if (existing[0]?.status === 'lifetime') {
          logger.info('Webhook: ignoring subscription event for a lifetime buyer (no downgrade)', {
            paddleUserId,
          })
          return true
        }
        await tx
          .update(users)
          .set({
            subscriptionStatus: mappedStatus,
            ...(mappedCurrency ? { currency: mappedCurrency } : {}),
          })
          .where(eq(users.paddleId, paddleUserId))
        return true
      }

      // No existing user. Create one only if we have an email to key on;
      // otherwise nothing is written — report failure (do NOT log success).
      if (!email) {
        logger.error(
          'Webhook: subscription event for unknown user with no email — nothing written',
          {
            paddleUserId,
          }
        )
        return false
      }
      await tx.insert(users).values({
        paddleId: paddleUserId,
        email,
        subscriptionStatus: mappedStatus,
        ...(mappedCurrency ? { currency: mappedCurrency } : {}),
      })
      logger.info('Webhook: created new user from subscription', { paddleUserId })
      return true
    })
  } catch (error) {
    logger.error('Webhook: failed to update subscription status', { paddleUserId, error })
    return false
  }
}

/**
 * Collect every purchased Paddle price ID from a transaction-event payload.
 *
 * Paddle transaction payloads carry the price either directly (`price_id`) or on
 * line items (`items[].price_id` / `items[].price.id`). We read defensively across
 * those shapes because the integration models a stubbed payload today (story 5-3
 * will finalise the real Paddle Billing shape). Returns ALL candidate ids (not
 * just the first) so the caller can check whether ANY line item is the lifetime
 * price — a lifetime item is not necessarily first when a transaction bundles
 * other lines (code review 2026-07-20).
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
 * A lifetime license arrives as a transaction event (not a `subscription_*`
 * event). We persist `subscriptionStatus = 'lifetime'` — a first-class, permanent
 * entitlement that all premium gates (`forecasting.ts`, `usePremiumAccess.ts`,
 * `auth-indicator.tsx`, `useFinancialCalculations.ts`) treat as access-granting.
 * Because it is a DISTINCT status, no subscription-lifecycle event can ever
 * downgrade a lifetime buyer (see the guard in `handleSubscriptionStatusUpdate`),
 * so the entitlement is truly permanent — even for a user who also once held a
 * cancellable subscription.
 *
 * Returns false when nothing was written (unknown user with no email, or a DB
 * error) so the caller can signal Paddle to retry rather than silently losing a
 * paid entitlement.
 */
async function handleLifetimePurchase(
  paddleUserId: string,
  email?: string,
  currency?: string
): Promise<boolean> {
  if (!paddleUserId || typeof paddleUserId !== 'string') {
    logger.error('Webhook: invalid paddleUserId for lifetime purchase', { paddleUserId })
    return false
  }
  if (email && !isValidEmail(email)) {
    logger.warn('Webhook: invalid email for lifetime buyer', { paddleUserId })
    return false
  }

  const mappedCurrency = mapProvidedCurrency(currency)

  try {
    return await db.transaction(async (tx) => {
      // Update-first: a lifetime purchase upgrades ANY prior status (free / active
      // / canceled) to the terminal 'lifetime' — there is nothing to guard against.
      const result = await tx
        .update(users)
        .set({
          subscriptionStatus: 'lifetime',
          ...(mappedCurrency ? { currency: mappedCurrency } : {}),
        })
        .where(eq(users.paddleId, paddleUserId))

      if (result.rowCount === 0) {
        if (!email) {
          logger.error('Webhook: lifetime purchase for unknown user with no email — cannot grant', {
            paddleUserId,
          })
          return false
        }
        await tx.insert(users).values({
          paddleId: paddleUserId,
          email,
          subscriptionStatus: 'lifetime',
          ...(mappedCurrency ? { currency: mappedCurrency } : {}),
        })
        logger.info('Webhook: created new lifetime user', { paddleUserId })
      }
      return true
    })
  } catch (error) {
    logger.error('Webhook: failed to grant lifetime entitlement', { paddleUserId, error })
    return false
  }
}

/**
 * POST /api/webhooks/paddle
 *
 * Exported standalone (mirroring the callback route) so it is unit-testable
 * without a running server — the Route below simply wires it in.
 */
export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  try {
    const paddleConfig = getPaddleConfig()

    if (!paddleConfig.webhookSecret) {
      return json({ success: false, error: 'Webhook secret not configured' }, { status: 500 })
    }

    // Get signature from header
    const signature = request.headers.get('paddle-signature')

    // Read raw body
    const payload = await request.text()

    // Verify signature
    if (!verifyWebhookSignature(payload, signature, paddleConfig.webhookSecret)) {
      return json({ success: false, error: 'Invalid webhook signature' }, { status: 401 })
    }

    // Parse webhook data
    let data: {
      event_type?: string
      data?: {
        user_id?: string
        customer_id?: string
        status?: string
        email?: string
        currency_code?: string
        currency?: string
        price_id?: string
        items?: Array<{ price_id?: string; price?: { id?: string } }>
      }
    }
    try {
      data = JSON.parse(payload)
    } catch {
      return json({ success: false, error: 'Invalid JSON payload' }, { status: 400 })
    }

    // Handle different webhook event types
    const eventType = data?.event_type

    if (!eventType) {
      logger.error('Webhook: missing event_type')
      return json(
        { success: false, error: 'Missing event_type in webhook payload' },
        { status: 400 }
      )
    }

    switch (eventType) {
      case 'subscription_created':
      case 'subscription_updated':
      case 'subscription_cancelled':
        {
          const userId = data?.data?.user_id
          const subscriptionStatus = data?.data?.status
          const email = data?.data?.email
          const currency = data?.data?.currency_code || data?.data?.currency

          if (!userId) {
            logger.error('Webhook: missing user_id', { eventType })
            break
          }

          if (!subscriptionStatus) {
            logger.error('Webhook: missing status', { eventType, userId })
            break
          }

          await handleSubscriptionStatusUpdate(userId, subscriptionStatus, email, currency)
        }
        break

      case 'transaction.completed':
      case 'transaction_completed':
        {
          // One-time purchases (the €99 lifetime license, story 25-2) arrive
          // as a transaction event, NOT a subscription_* event, so they carry
          // a price ID rather than a subscription status. Grant permanent
          // Premium ONLY when one of the purchased line items matches the
          // configured lifetime price — fail closed otherwise so an annual
          // subscription's renewal invoice (also a transaction.completed) is
          // never mistaken for a lifetime grant.
          const userId = data?.data?.user_id || data?.data?.customer_id
          const email = data?.data?.email
          const currency = data?.data?.currency_code || data?.data?.currency
          // Trim so stray whitespace on the configured value (common from secret
          // managers) can't silently block every lifetime grant.
          const lifetimePriceId = paddleConfig.lifetimePriceId?.trim()

          if (!userId) {
            logger.error('Webhook: missing user_id/customer_id on transaction', { eventType })
            break
          }

          if (!lifetimePriceId) {
            logger.warn(
              'Webhook: transaction.completed but PADDLE_LIFETIME_PRICE_ID is not configured; ignoring',
              { eventType }
            )
            break
          }

          // Match ANY purchased line item against the lifetime price (the lifetime
          // item is not necessarily first when a transaction bundles other lines).
          const matchesLifetime = collectPurchasedPriceIds(data?.data).some(
            (id) => id.trim() === lifetimePriceId
          )
          if (!matchesLifetime) {
            logger.info('Webhook: transaction.completed for a non-lifetime price; ignoring', {
              eventType,
            })
            break
          }

          const granted = await handleLifetimePurchase(userId, email, currency)
          if (!granted) {
            // Nothing was persisted (unknown user w/o email, or a DB error). Return
            // 500 so Paddle retries instead of silently losing a paid entitlement.
            logger.error('Webhook: lifetime grant failed to persist; returning 500 for retry', {
              paddleUserId: userId,
            })
            return json(
              { success: false, error: 'Failed to persist lifetime entitlement' },
              { status: 500 }
            )
          }
          logger.info('Webhook: granted permanent Premium for lifetime purchase', {
            paddleUserId: userId,
          })
        }
        break

      case 'subscription_payment_succeeded':
        // Handle successful payment
        break

      case 'subscription_payment_failed':
        // Handle failed payment
        break

      default:
        logger.info('Webhook: unhandled event', { eventType })
    }

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
