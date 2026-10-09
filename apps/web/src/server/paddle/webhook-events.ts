/**
 * Retries are re-signed, so dedup is by event id and ordering by `occurred_at`. The claim must share
 * the entitlement write's transaction, or a rollback would leave a claim that dismisses the retry.
 */

import type { db } from '@budget-planner/db'
import { paddleWebhookEvents } from '@budget-planner/db/src/schema'
import { logger } from '@/lib/logger'

/** Derived from the client so it can't drift when the query builder changes shape. */
export type WebhookTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type WebhookEventMeta = {
	eventId: string
	eventType: string
	customerId?: string
	occurredAt: number
}

/** `ON CONFLICT DO NOTHING ... RETURNING`: an empty result means a duplicate. */
export async function claimWebhookEvent(tx: WebhookTx, meta: WebhookEventMeta): Promise<boolean> {
	const claimed = await tx
		.insert(paddleWebhookEvents)
		.values({
			eventId: meta.eventId,
			eventType: meta.eventType,
			...(meta.customerId ? { customerId: meta.customerId } : {}),
			occurredAt: meta.occurredAt,
		})
		.onConflictDoNothing()
		.returning({ eventId: paddleWebhookEvents.eventId })

	if (claimed.length === 0) {
		logger.info('Webhook: duplicate delivery ignored', {
			eventId: meta.eventId,
			eventType: meta.eventType,
		})
		return false
	}
	return true
}

/**
 * Strictly newer: paid and completed can share an `occurred_at`, and re-applying could
 * undo a later refund. A NULL watermark always passes.
 */
export function isFresherThanWatermark(
	watermark: number | null | undefined,
	occurredAt: number
): boolean {
	if (watermark === null || watermark === undefined) return true
	return occurredAt > watermark
}

/** Undefined rather than guessing: 0 would drop the event and Date.now() would make a stale retry look newest. */
export function parseOccurredAt(occurredAt?: string): number | undefined {
	if (!occurredAt) return undefined
	const ms = Date.parse(occurredAt)
	return Number.isNaN(ms) ? undefined : ms
}
