// Signed here from Paddle's documented scheme, not imported from the route, so a
// verifier regression can't hide behind a shared helper.
import { createHmac, randomUUID } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'

function paddleSignature(rawBody: string, secret: string, ts: number): string {
	const h1 = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex')
	return `ts=${ts};h1=${h1}`
}

export interface SubscriptionCreated {
	customerId: string
	/** Inline, which keeps the server off Paddle's customer API. */
	email: string
	priceId: string
}

// Real Paddle subscription payloads don't carry the email inline, so the
// customer-API path isn't exercised here.
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
