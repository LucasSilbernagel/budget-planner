/**
 * A Paddle Billing webhook, built and signed by the test (story 87.2, F10,
 * decision D3).
 *
 * The signature is written HERE from Paddle's documented scheme, NOT imported
 * from the route (`routes/api/webhooks/paddle.ts`), so a regression in the
 * route's verifier cannot hide behind a shared helper:
 *
 *   `Paddle-Signature: ts=<unix seconds>;h1=<hex HMAC-SHA256 of "<ts>:<raw body>">`
 *
 * keyed by the notification destination's secret
 * (https://developer.paddle.com/webhooks/signature-verification). The secret is
 * `FAKE_PADDLE.webhookSecret`, the obvious fake the `:5176` server is booted
 * with (`playwright.config.ts`).
 */
import { createHmac, randomUUID } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'

/** Sign `rawBody` the way Paddle does, at `ts` (unix seconds). */
function paddleSignature(rawBody: string, secret: string, ts: number): string {
  const h1 = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex')
  return `ts=${ts};h1=${h1}`
}

export interface SubscriptionCreated {
  /** The Paddle customer id (`ctm_…`), stored as `users.paddleId`. */
  customerId: string
  /** The buyer's email, INLINE (story 87.2 K4: keeps the server off the customer API). */
  email: string
  /** The subscribed price (the annual price id, decision D4). */
  priceId: string
}

/**
 * A `subscription.created` for a first-seen customer: status `active`, annual
 * `billing_cycle`, a fresh `event_id` (the route dedupes on it) and the email
 * inline as `data.customer.email`, one of the three inline shapes
 * `resolveBuyerEmail` reads before it would call Paddle's customer API.
 *
 * ⚠️ Real Paddle subscription payloads do NOT carry the email inline: the
 * customer-API path is not exercised by F10 (story 87.2 K4, a recorded
 * fidelity limit; it stays covered by its unit tests).
 */
export function subscriptionCreatedPayload(event: SubscriptionCreated): string {
  const now = new Date().toISOString()
  return JSON.stringify({
    event_id: `evt_e2e_${randomUUID().replace(/-/g, '')}`,
    event_type: 'subscription.created',
    occurred_at: now,
    notification_id: `ntf_e2e_${randomUUID().replace(/-/g, '')}`,
    data: {
      id: `sub_e2e_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      status: 'active',
      customer_id: event.customerId,
      currency_code: 'EUR',
      created_at: now,
      billing_cycle: { interval: 'year', frequency: 1 },
      items: [
        {
          status: 'active',
          quantity: 1,
          price: { id: event.priceId, billing_cycle: { interval: 'year', frequency: 1 } },
        },
      ],
      customer: { email: event.email },
    },
  })
}

/**
 * POST `rawBody` to the app's webhook route with a `Paddle-Signature` made
 * from `secret` and a timestamp of NOW (the route rejects one outside
 * `PADDLE_WEBHOOK_MAX_AGE_SECONDS`).
 */
export async function deliverWebhook(
  request: APIRequestContext,
  rawBody: string,
  secret: string
): Promise<APIResponse> {
  const ts = Math.floor(Date.now() / 1000)
  return request.post('/api/webhooks/paddle', {
    data: rawBody,
    headers: {
      'content-type': 'application/json',
      'paddle-signature': paddleSignature(rawBody, secret, ts),
    },
  })
}
