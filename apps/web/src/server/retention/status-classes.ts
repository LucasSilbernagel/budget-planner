/**
 * Entitled vs lapsed — the ONE classification the retention purge reads
 * (Story 73.2, AC-5).
 *
 * Every `subscriptionStatus` value is classified exactly once, in a
 * `Record<SubscriptionStatus, …>`: adding a sixth enum value is a `tsc` error
 * here until someone decides which side it falls on. It can never drift
 * silently into either list — which matters, because the purge DELETES rows
 * whose status is lapsed. A value that fell into `LAPSED_STATUSES` by accident
 * would delete a paying customer's data.
 *
 * ⚠️ The purge predicate is written POSITIVELY — `IN (LAPSED_STATUSES)` — never
 * as `NOT IN (ENTITLED_STATUSES)`.
 *
 * `free` is lapsed: Paddle's `paused` and any unrecognised status map to it
 * (`routes/api/webhooks/paddle.ts`, `mapWebhookSubscriptionStatus`), and a
 * paused subscriber has no access. The privacy policy says so.
 *
 * Since Story 78.3 the classification is DERIVED from the one table in
 * `lib/premium/access-statuses.ts` (entitled ⇔ paid access), which every other
 * paid-access gate — sync, checkout, the account-deletion notice, webhook
 * adoption — also imports. The six hand-rolled copies Story 73.2 recorded as
 * five (D3) are gone. It lives there, not here, because this module imports
 * drizzle and the db schema at runtime and client components need the answer too.
 */

import { PAID_ACCESS_STATUSES, STATUS_ACCESS, hasPaidAccess } from '@/lib/premium/access-statuses'
import { type SubscriptionStatus, users } from '@budget-planner/db/src/schema'
import { type SQL, sql } from 'drizzle-orm'

export type StatusClass = 'entitled' | 'lapsed'

function classOf(status: SubscriptionStatus): StatusClass {
  return STATUS_ACCESS[status].paidAccess ? 'entitled' : 'lapsed'
}

/**
 * Every status, keyed here as well as in `STATUS_ACCESS`: both are
 * `Record<SubscriptionStatus, …>`, so a new enum value is a `tsc` error in each
 * until it is added — the purge can never inherit a status nobody looked at.
 *
 * ⚠️ The CLASSIFICATION is not independent: each value is `classOf(status)`,
 * i.e. `STATUS_ACCESS[status].paidAccess`. A change to `paidAccess` in
 * `lib/premium/access-statuses.ts` IS a retention change — e.g. narrowing
 * `past_due` there would make those rows lapsed, and the purge DELETES lapsed
 * data. `__tests__/status-classes.test.ts` pins the entitled set by value so
 * such an edit fails here, loudly, before it can ship.
 */
export const STATUS_CLASS = {
  free: classOf('free'),
  active: classOf('active'),
  past_due: classOf('past_due'),
  canceled: classOf('canceled'),
  lifetime: classOf('lifetime'),
} satisfies Record<SubscriptionStatus, StatusClass>

function statusesOfClass(cls: StatusClass): readonly SubscriptionStatus[] {
  return (Object.keys(STATUS_CLASS) as SubscriptionStatus[]).filter(
    (status) => STATUS_CLASS[status] === cls
  )
}

/** Statuses that mean the account currently HAS paid access — `PAID_ACCESS_STATUSES`. */
export const ENTITLED_STATUSES: readonly SubscriptionStatus[] = PAID_ACCESS_STATUSES

/** Statuses that mean Premium access has ended. The purge selects ONLY these. */
export const LAPSED_STATUSES: readonly SubscriptionStatus[] = statusesOfClass('lapsed')

/** Same answer as `hasPaidAccess` (a membership test — never a keyed lookup). */
export function isEntitledStatus(status: SubscriptionStatus): boolean {
  return hasPaidAccess(status)
}

/** `"subscriptionStatus" IN (<statuses>)` against the row being read or written. */
export function statusIn(statuses: readonly SubscriptionStatus[]): SQL {
  return sql`${users.subscriptionStatus} IN (${sql.join(
    statuses.map((s) => sql`${s}`),
    sql`, `
  )})`
}

/**
 * The `accessEndedAt` value for a write that sets the status to `newStatus`
 * (Story 73.2, D4). Used in every `users` write that sets `subscriptionStatus`,
 * IN THE SAME STATEMENT, so the clock can never disagree with the status.
 *
 *  - entitled → `null` (access continues; no clock).
 *  - lapsed, and the row was entitled → `occurredAt` (access ended now).
 *  - lapsed, and the row was already lapsed → KEEP the existing value, or
 *    `occurredAt` if there is none (a row that has never been entitled).
 *
 * ⚠️ The KEEP arm is the reason this column exists. `entitlementUpdatedAt`
 * advances on EVERY later `subscription.*` event, so a still-`canceled`
 * subscription emitting `subscription.updated` would restart the 12 months,
 * and some rows would never come due.
 *
 * In an UPDATE (and in `ON CONFLICT DO UPDATE`), PostgreSQL evaluates every SET
 * expression against the OLD row, so `subscriptionStatus` in the CASE is the
 * status BEFORE this write even though the same statement also sets it.
 */
export function accessEndedAtFor(newStatus: SubscriptionStatus, occurredAt: number): SQL | null {
  if (isEntitledStatus(newStatus)) {
    return null
  }
  return sql`CASE WHEN ${statusIn(ENTITLED_STATUSES)} THEN ${occurredAt}::bigint ELSE COALESCE(${
    users.accessEndedAt
  }, ${occurredAt}::bigint) END`
}

/**
 * The columns every status-setting UPDATE must carry alongside the status: the
 * clock (above), and — on regaining access — a cleared retention notice and
 * notice attempt, so a notice sent during a previous lapse can never license
 * deleting a later one.
 */
export function retentionColumnsFor(
  newStatus: SubscriptionStatus,
  occurredAt: number
): {
  accessEndedAt: SQL | null
  retentionNoticeSentAt?: null
  retentionNoticeAttemptedAt?: null
} {
  const accessEndedAt = accessEndedAtFor(newStatus, occurredAt)
  return isEntitledStatus(newStatus)
    ? { accessEndedAt, retentionNoticeSentAt: null, retentionNoticeAttemptedAt: null }
    : { accessEndedAt }
}

/** The `accessEndedAt` for a freshly INSERTED row (there is no prior status). */
export function insertedAccessEndedAt(
  newStatus: SubscriptionStatus,
  occurredAt: number
): number | null {
  return isEntitledStatus(newStatus) ? null : occurredAt
}
