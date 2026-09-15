/**
 * Paddle Billing REST API — subscription cancellation for account erasure.
 *
 * Paddle Billing identifies a subscription by its OWN id (`sub_...`), never by
 * customer id, and the app stores only the customer id (`users.paddleId`).
 * So cancelling on account deletion is a two-step best-effort: list the
 * customer's non-terminal subscriptions, then cancel each one immediately.
 *
 * SERVER-ONLY. Uses the server API key. Never called from the browser.
 * NFR8: MSW intercepts `*.paddle.com` in tests.
 */

import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { getPaddleConfig } from '@budget-planner/config'

/**
 * Request timeout (ms). Node's `fetch` has NO default timeout — see
 * `customer-api.ts`'s identical rationale.
 */
const REQUEST_TIMEOUT_MS = 3000

/**
 * Subscriptions in these statuses are still billing and worth cancelling.
 * `canceled` is Paddle Billing's only terminal status — `paused` is NOT
 * terminal (a paused subscription resumes billing on its own schedule), so
 * omitting it here would let a paused-then-deleted account keep being
 * charged after erasure with no `users` row left for the webhook to act on.
 */
const NON_TERMINAL_STATUSES = ['active', 'trialing', 'past_due', 'paused']

/**
 * Hard cap on pages followed. Paddle Billing paginates list endpoints
 * (default 50/page); a customer with more open subscriptions than this is
 * not a real scenario this app expects, and the cap exists only to make an
 * unexpected `has_more: true` loop forever impossible.
 */
const MAX_PAGES = 20

interface PaddleSubscriptionListResponse {
  data?: Array<{ id?: unknown }>
  meta?: { pagination?: { has_more?: boolean; next?: string } }
}

/** One page of the customer's non-terminal subscriptions. */
async function fetchSubscriptionPage(
  url: string,
  apiKey: string
): Promise<PaddleSubscriptionListResponse | undefined> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    logger.warn('Paddle subscription list failed', { url, status: res.status })
    return undefined
  }
  return (await res.json()) as PaddleSubscriptionListResponse
}

/**
 * Lists every non-terminal subscription id for a customer, following Paddle's
 * pagination (`meta.pagination.next`) up to {@link MAX_PAGES}. Never throws:
 * a failure on any page returns whatever ids were already collected.
 */
async function listActiveSubscriptionIds(customerId: string, apiKey: string, apiBaseUrl: string) {
  const ids: string[] = []
  let url =
    `${apiBaseUrl}/subscriptions?customer_id=${encodeURIComponent(customerId)}` +
    `&status=${encodeURIComponent(NON_TERMINAL_STATUSES.join(','))}`

  for (let page = 0; page < MAX_PAGES; page++) {
    let body: PaddleSubscriptionListResponse | undefined
    try {
      body = await fetchSubscriptionPage(url, apiKey)
    } catch (error) {
      logger.warn('Paddle subscription list threw', { customerId, error })
      break
    }
    if (!body) break

    for (const id of (body.data ?? []).map((s) => s.id)) {
      if (typeof id === 'string' && id.length > 0) {
        ids.push(id)
      }
    }

    const next = body.meta?.pagination?.next
    if (!body.meta?.pagination?.has_more || !next) break
    url = next
  }

  return ids
}

/**
 * Cancels every active/trialing/past_due/paused subscription for a Paddle
 * customer, effective immediately. Best-effort: never throws. Account erasure
 * must never block on billing, so every failure here is logged and swallowed.
 */
export async function cancelActiveSubscriptionsForCustomer(customerId: string): Promise<void> {
  const config = getPaddleConfig()
  if (!config.apiKey) {
    logger.warn('Paddle subscription cancel skipped — no API key configured', { customerId })
    return
  }

  const subscriptionIds = await listActiveSubscriptionIds(
    customerId,
    config.apiKey,
    config.apiBaseUrl
  )

  for (const subscriptionId of subscriptionIds) {
    try {
      const cancelRes = await fetch(
        `${config.apiBaseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ effective_from: 'immediately' }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      )
      if (!cancelRes.ok) {
        // The account row is already gone by the time this can fail (called
        // from account erasure) — there is no state left to retry from, so
        // this is the only signal a deleted-but-still-billed customer gets.
        logger.warn('Paddle subscription cancel failed', {
          customerId,
          subscriptionId,
          status: cancelRes.status,
        })
        captureError(new Error('Paddle subscription cancel failed'), {
          scope: 'paddle-subscription-cancel',
          customerId,
          subscriptionId,
          status: cancelRes.status,
        })
      }
    } catch (error) {
      logger.warn('Paddle subscription cancel threw', { customerId, subscriptionId, error })
      captureError(error, {
        scope: 'paddle-subscription-cancel',
        customerId,
        subscriptionId,
      })
    }
  }
}
