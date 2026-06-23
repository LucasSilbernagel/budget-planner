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

import { getPaddleConfig } from '@budget-planner/config'
import { db } from '@budget-planner/db'
import { users } from '@budget-planner/db/src/schema'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'
import { json } from '@tanstack/start'

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
 * Handle subscription status update from Paddle webhook
 * Updates or creates user subscription status in DanubeData PostgreSQL
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
  try {
    // First, try to update existing user
    const result = await db
      .update(users)
      .set({ subscriptionStatus: subscriptionStatus as any })
      .where(eq(users.paddleId, paddleUserId))
    
    // If no rows were updated, the user doesn't exist yet
    // This can happen if the OAuth flow didn't complete but subscription was created
    if (result.rowCount === 0 && email) {
      // Create the user record with subscription information
      await db.insert(users).values({
        paddleId: paddleUserId,
        email: email,
        subscriptionStatus: subscriptionStatus as any,
        currency: currency || 'NONE',
      })
      console.log(`Created new user ${paddleUserId} from subscription webhook`)
    }
    
    return true
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
      return json(
        { success: false, error: 'Webhook secret not configured' },
        { status: 500 }
      )
    }
    
    // Get signature from header
    const signature = request.headers.get('paddle-signature')
    
    // Read raw body
    const payload = await request.text()
    
    // Verify signature
    if (!verifyWebhookSignature(payload, signature, paddleConfig.webhookSecret)) {
      return json(
        { success: false, error: 'Invalid webhook signature' },
        { status: 401 }
      )
    }
    
    // Parse webhook data
    let data: any
    try {
      data = JSON.parse(payload)
    } catch {
      return json(
        { success: false, error: 'Invalid JSON payload' },
        { status: 400 }
      )
    }
    
    // Handle different webhook event types
    const eventType = data?.event_type
    
    switch (eventType) {
      case 'subscription_created':
      case 'subscription_updated':
      case 'subscription_cancelled':
        {
          const userId = data?.data?.user_id
          const subscriptionStatus = data?.data?.status
          const email = data?.data?.email
          const currency = data?.data?.currency_code || data?.data?.currency
          
          if (userId && subscriptionStatus) {
            await handleSubscriptionStatusUpdate(userId, subscriptionStatus, email, currency)
          }
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
    return json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
