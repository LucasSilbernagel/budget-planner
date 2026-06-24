/**
 * Paddle Webhooks
 *
 * TanStack Start Server Function
 * Handles Paddle webhook events for subscription updates
 *
 * Endpoint: POST /api/webhooks/paddle
 *
 * Data Sovereignty: Processes webhooks and updates DanubeData PostgreSQL (Germany - EU)
 * Security: Verifies webhook signatures to prevent spoofing
 */

import crypto from 'crypto'
import { getPaddleConfig } from '@budget-planner/config'
import { currencyEnum, db } from '@budget-planner/db'
import { type Currency, type SubscriptionStatus, users } from '@budget-planner/db/src/schema'
import { json } from '@tanstack/start'
import { eq } from 'drizzle-orm'

/**
 * Verify Paddle webhook signature
 * Prevents unauthorized webhook requests
 *
 * Paddle webhook signature format: v1,{timestamp},{hmac}
 * The HMAC is computed as: hmac_sha256(timestamp + '.' + payload)
 */
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
 * Handle subscription status update from Paddle webhook
 * Updates or creates user subscription status in DanubeData PostgreSQL
 * Uses transaction to prevent race conditions
 *
 * For subscription_created events, this may be the first time we see this user
 * if the OAuth flow didn't complete properly, so we create the user record.
 */
async function handleSubscriptionStatusUpdate(
  paddleUserId: string,
  subscriptionStatus: string,
  email?: string,
  currency?: string
): Promise<boolean> {
  // Validate inputs
  if (!paddleUserId || typeof paddleUserId !== 'string') {
    console.error(`Invalid paddleUserId in webhook: ${paddleUserId}`)
    return false
  }

  // Map subscription status to our enum
  const mappedStatus = mapWebhookSubscriptionStatus(subscriptionStatus)

  // Validate email if provided
  if (email && !isValidEmail(email)) {
    console.error(`Invalid email in webhook for user ${paddleUserId}: ${email}`)
    return false
  }

  // Validate and map currency if provided
  // Currency must be one of the enum values
  const currencyValues = currencyEnum.enumValues as readonly string[]
  const mappedCurrency: Currency =
    currency && currencyValues.includes(currency.toUpperCase())
      ? (currency.toUpperCase() as Currency)
      : 'NONE'

  try {
    // Use transaction to prevent race conditions between update and insert
    return await db.transaction(async (tx) => {
      // First, try to update existing user
      const result = await tx
        .update(users)
        .set({
          subscriptionStatus: mappedStatus,
          currency: mappedCurrency,
        })
        .where(eq(users.paddleId, paddleUserId))

      // If no rows were updated, the user doesn't exist yet
      // This can happen if the OAuth flow didn't complete but subscription was created
      if (result.rowCount === 0 && email) {
        // Create the user record with subscription information
        await tx.insert(users).values({
          paddleId: paddleUserId,
          email: email,
          subscriptionStatus: mappedStatus,
          currency: mappedCurrency,
        })
        console.log(`Created new user ${paddleUserId} from subscription webhook`)
      }

      return true
    })
  } catch (error) {
    console.error(`Failed to update subscription status for user ${paddleUserId}:`, error)
    return false
  }
}

/**
 * Main webhook handler
 */
export async function POST(request: Request) {
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
    let data: any
    try {
      data = JSON.parse(payload)
    } catch {
      return json({ success: false, error: 'Invalid JSON payload' }, { status: 400 })
    }

    // Handle different webhook event types
    const eventType = data?.event_type

    if (!eventType) {
      console.error('Paddle webhook: missing event_type')
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
            console.error(`Paddle webhook ${eventType}: missing user_id`)
            break
          }

          if (!subscriptionStatus) {
            console.error(`Paddle webhook ${eventType}: missing status for user ${userId}`)
            break
          }

          await handleSubscriptionStatusUpdate(userId, subscriptionStatus, email, currency)
        }
        break

      case 'subscription_payment_succeeded':
        // Handle successful payment
        break

      case 'subscription_payment_failed':
        // Handle failed payment
        break

      default:
        console.log(`Unhandled Paddle webhook event: ${eventType}`)
    }

    return json({ success: true })
  } catch (error) {
    console.error('Paddle webhook error:', error)
    return json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
