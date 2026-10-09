/**
 * The purge deletes lapsed rows, so it selects `IN (LAPSED_STATUSES)` positively, never
 * `NOT IN (ENTITLED)`. `free` is lapsed (Paddle `paused` maps to it).
 */

import { type SubscriptionStatus, users } from '@budget-planner/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import { hasPaidAccess, PAID_ACCESS_STATUSES, STATUS_ACCESS } from '@/lib/premium/access-statuses'

export type StatusClass = 'entitled' | 'lapsed'

function classOf(status: SubscriptionStatus): StatusClass {
	return STATUS_ACCESS[status].paidAccess ? 'entitled' : 'lapsed'
}

/** A change to `paidAccess` in the shared access table is a retention change: lapsed rows get deleted. */
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

export const ENTITLED_STATUSES: readonly SubscriptionStatus[] = PAID_ACCESS_STATUSES

/** The purge selects ONLY these. */
export const LAPSED_STATUSES: readonly SubscriptionStatus[] = statusesOfClass('lapsed')

export function isEntitledStatus(status: SubscriptionStatus): boolean {
	return hasPaidAccess(status)
}

export function statusIn(statuses: readonly SubscriptionStatus[]): SQL {
	return sql`${users.subscriptionStatus} IN (${sql.join(
		statuses.map((s) => sql`${s}`),
		sql`, `
	)})`
}

/**
 * Lapsed→lapsed keeps the existing clock, or a still-canceled sub's later events would restart
 * the 12 months. SET expressions see the OLD row, so the CASE reads the pre-write status.
 */
function accessEndedAtFor(newStatus: SubscriptionStatus, occurredAt: number): SQL | null {
	if (isEntitledStatus(newStatus)) {
		return null
	}
	return sql`CASE WHEN ${statusIn(ENTITLED_STATUSES)} THEN ${occurredAt}::bigint ELSE COALESCE(${
		users.accessEndedAt
	}, ${occurredAt}::bigint) END`
}

/** Regaining access clears the notice, so a notice from a previous lapse can't license a later deletion. */
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

export function insertedAccessEndedAt(
	newStatus: SubscriptionStatus,
	occurredAt: number
): number | null {
	return isEntitledStatus(newStatus) ? null : occurredAt
}
