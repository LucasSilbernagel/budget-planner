/**
 * Paddle webhook delivery bookkeeping (Story 5-19, AC-2).
 *
 * Two orthogonal defences against Paddle's retry behaviour, neither of which
 * the signature check provides:
 *
 *  1. **Dedup** — `claimWebhookEvent` inserts the delivery's event id and
 *     reports whether THIS call won the insert. A duplicate delivery loses and
 *     the caller does nothing. Signature freshness never filtered retries:
 *     Paddle re-signs each retry with a fresh `ts`, so a retry is
 *     indistinguishable from a first delivery by signature alone.
 *
 *  2. **Ordering** — `isFresherThanWatermark` compares the event's own
 *     `occurred_at` against the watermark stored on the user. Arrival order is
 *     exactly what cannot be trusted: a `subscription.updated{active}` that
 *     500s and is retried minutes later, AFTER `subscription.canceled` has been
 *     processed, would otherwise silently re-grant Premium to a cancelled user.
 *
 * ⚠️ THE CLAIM MUST SHARE THE ENTITLEMENT WRITE'S TRANSACTION. Committing a
 * claim independently of the work it guards would turn every transient failure
 * into permanent data loss: the claim would stand, the retry would be dismissed
 * as a duplicate, and the entitlement would never be granted. Passing `tx` in
 * (rather than reaching for the module-level `db`) is what makes a rollback
 * release the claim, so the retry is processed normally. A concurrent duplicate
 * blocks on the uncommitted row and then reads the committed outcome — which is
 * the correct behaviour in both directions.
 */

import { logger } from '@/lib/logger'
import type { db } from '@budget-planner/db'
import { paddleWebhookEvents } from '@budget-planner/db/src/schema'

/**
 * The transaction handle `db.transaction` hands its callback, derived from the
 * client itself rather than hand-written — a structural stand-in would drift
 * silently the first time the query builder changes shape.
 */
export type WebhookTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface WebhookEventMeta {
  /** Paddle's `event_id` (`evt_...`), falling back to `data.id`. */
  eventId: string
  eventType: string
  customerId?: string
  /** `occurred_at` as epoch ms — the ordering key. */
  occurredAt: number
}

/**
 * Record this delivery, returning `true` when it is the FIRST time we have seen
 * the event id and `false` when it is a duplicate the caller must ignore.
 *
 * `ON CONFLICT DO NOTHING ... RETURNING` is the whole mechanism: an empty
 * `returning` means the row already existed.
 */
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
 * Whether an event may change entitlement, given the watermark already stored
 * for that user.
 *
 * STRICTLY newer. Equal timestamps are rejected deliberately: Paddle emits both
 * `transaction.paid` and `transaction.completed` for one purchase, and when
 * they share an `occurred_at` the second carries no new information — applying
 * it again is at best a no-op and at worst re-applies a state a refund has
 * since corrected.
 *
 * A NULL watermark (no billing event processed yet) always passes.
 */
export function isFresherThanWatermark(
  watermark: number | null | undefined,
  occurredAt: number
): boolean {
  if (watermark === null || watermark === undefined) return true
  return occurredAt > watermark
}

/**
 * Parse Paddle's ISO-8601 `occurred_at` into epoch ms.
 *
 * Returns `undefined` rather than guessing when the field is missing or
 * unparseable — callers substitute arrival time and log, because an event with
 * no usable timestamp must not silently adopt `0` (which would make it older
 * than everything and be dropped) or `Date.now()` deep inside a comparison
 * (which would make a stale retry look like the newest event).
 */
export function parseOccurredAt(occurredAt?: string): number | undefined {
  if (!occurredAt) return undefined
  const ms = Date.parse(occurredAt)
  return Number.isNaN(ms) ? undefined : ms
}
