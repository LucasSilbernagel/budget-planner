/** Webhook payloads identify the buyer only by `customer_id`, so a first-seen buyer's email is fetched here. */

import { logger } from '@/lib/logger'
import { getPaddleConfig } from '@budget-planner/config'

interface PaddleCustomerResponse {
  data?: {
    id?: string
    email?: string
    status?: string
  }
}

/** Node's fetch has no default timeout; a hang would stack handlers as Paddle retries. */
const REQUEST_TIMEOUT_MS = 3000

/** Never throws: undefined makes the webhook return 500, so Paddle retries. */
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
    logger.warn('Paddle customer lookup threw', { customerId, error })
    return undefined
  }
}
