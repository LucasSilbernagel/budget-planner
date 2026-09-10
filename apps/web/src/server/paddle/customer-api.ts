/**
 * Paddle Billing REST API — the small slice the webhook needs.
 *
 * Billing `subscription.*` and `transaction.*` webhook payloads identify the
 * buyer only by `customer_id` (`ctm_...`) — the email is NOT in the event body.
 * Account creation for a first-seen buyer needs it, so we resolve it here via
 * `GET /customers/{id}`.
 *
 * SERVER-ONLY. Uses the server API key. Never called from the browser.
 * NFR8: MSW intercepts `*.paddle.com` in tests.
 */

import { logger } from '@/lib/logger'
import { getPaddleConfig } from '@budget-planner/config'

/** Shape of the bits of `GET /customers/{id}` we read. */
interface PaddleCustomerResponse {
  data?: {
    id?: string
    email?: string
    status?: string
  }
}

/**
 * Request timeout (ms). Node's `fetch` has NO default timeout, so a hung Paddle
 * API connection would otherwise block the webhook handler indefinitely while
 * Paddle's own ~5s delivery timeout elapses and it retries, stacking handlers.
 */
const REQUEST_TIMEOUT_MS = 3000

/**
 * Resolve a Paddle customer's email, or `undefined` on any failure
 * (unconfigured, network error, non-2xx, missing field).
 *
 * The webhook handlers already treat a missing email as "cannot create a
 * first-seen user" and signal Paddle to retry (HTTP 500), so returning
 * `undefined` here is a safe, self-healing outcome — never throws.
 */
export async function fetchPaddleCustomerEmail(customerId: string): Promise<string | undefined> {
  const config = getPaddleConfig()
  if (!config.apiKey) {
    logger.warn('Paddle customer lookup skipped — no API key configured', { customerId })
    return undefined
  }
  if (!customerId || typeof customerId !== 'string') {
    return undefined
  }

  try {
    const res = await fetch(`${config.apiBaseUrl}/customers/${encodeURIComponent(customerId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      logger.warn('Paddle customer lookup failed', { customerId, status: res.status })
      return undefined
    }

    const body = (await res.json()) as PaddleCustomerResponse
    const email = body.data?.email
    return typeof email === 'string' && email.length > 0 ? email : undefined
  } catch (error) {
    // Includes the TimeoutError from AbortSignal.timeout — treated the same as any
    // other failure: return undefined so the webhook's first-seen-buyer path
    // returns 500 and Paddle retries.
    logger.warn('Paddle customer lookup threw', { customerId, error })
    return undefined
  }
}
