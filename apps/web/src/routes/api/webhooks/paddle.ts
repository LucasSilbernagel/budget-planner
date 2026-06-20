/**
 * Paddle Webhooks
 * 
 * TanStack Start Server Function
 * Handles Paddle webhook events for subscription updates
 * 
 * Endpoint: POST /api/webhooks/paddle
 * 
 * Data Sovereignty: Processes webhooks and updates Scaleway PostgreSQL (EU region)
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
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false
  }
  
  // Paddle webhook signature format: v1,{timestamp},{hmac}
  const expectedSignature = `v1,${Date.now()},${crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`
  
  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch {
    return false
  }
}

/**
 * Handle subscription status update from Paddle webhook
 */
async function handleSubscriptionStatusUpdate(
  userId: string,
  subscriptionStatus: string
) {
  // Update user subscription status in database
  await db
    .update(users)
    .set({ subscriptionStatus: subscriptionStatus as any })
    .where(eq(users.paddleId, userId))
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
          
          if (userId && subscriptionStatus) {
            await handleSubscriptionStatusUpdate(userId, subscriptionStatus)
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
