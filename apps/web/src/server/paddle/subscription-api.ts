/** Paddle cancels by subscription id but the app stores only the customer id: list, then cancel each. */

import { getPaddleConfig } from '@budget-planner/config'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'

/** Node's fetch has no default timeout. */
const REQUEST_TIMEOUT_MS = 3000

/** `paused` is not terminal (it resumes billing), so it must be cancelled too. */
const NON_TERMINAL_STATUSES = ['active', 'trialing', 'past_due', 'paused']

/** Only exists to make an unexpected endless `has_more: true` loop impossible. */
const MAX_PAGES = 20

interface PaddleSubscriptionListResponse {
	data?: Array<{ id?: unknown }>
	meta?: { pagination?: { has_more?: boolean; next?: string } }
}

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

/** Never throws: a failure on any page returns the ids already collected. */
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

/** Best-effort, never throws: account erasure must never block on billing. */
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
				// The account row is already gone, so this log is the only signal of a
				// deleted-but-still-billed customer.
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
