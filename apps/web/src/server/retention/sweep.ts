/**
 * The notice is sent before it is stamped (a crash re-sends rather than recording an unsent notice), and a row
 * whose notice never succeeds is never deleted. Each purge re-checks eligibility under FOR UPDATE SKIP LOCKED.
 */

import { db } from '@budget-planner/db'
import { jobRuns, users } from '@budget-planner/db/src/schema'
import { and, asc, count, eq, type SQL, sql } from 'drizzle-orm'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { eraseAccountRows } from '@/server/api/account'
import { formatDeletionDate, sendRetentionNoticeEmail } from '@/server/email/mailer'
import { LAPSED_STATUSES, statusIn } from './status-classes'

/** Mirrors the privacy policy; change them together. */
const RETENTION_MONTHS = 12

/** How far ahead of deletion the one warning email goes. Mirrors the privacy policy. */
const NOTICE_LEAD_MS = 30 * 24 * 60 * 60 * 1000

const NOTICE_BATCH_LIMIT = 50
const PURGE_BATCH_LIMIT = 50

/** Under Rapids' 60s request timeout; one Brevo call is capped at 10s, so the worst overrun is one call. */
const RUN_BUDGET_MS = 40_000

export const RETENTION_JOB = 'retention-sweep'

const LEASE_MS = 10 * 60 * 1000

export interface RetentionSweepResult {
	skipped?: 'lease-held'
	dryRun: boolean
	clocksStarted: number
	/** ALL rows due a notice now, not capped by the batch limit. */
	noticesDue: number
	noticesSent: number
	noticeFailures: number
	/** ALL rows due deletion now, not capped by the batch limit. */
	purgesDue: number
	purged: number
	/** Candidates that no longer matched under the lock (regained access, or held by an erasure). */
	purgesSkipped: number
	purgeFailures: number
	truncated: boolean
}

export interface RetentionSweepOptions {
	now: number
	dryRun?: boolean
	noticeLimit?: number
	purgeLimit?: number
	runBudgetMs?: number
	/** Test seam: simulates an interleaving PGlite's single connection cannot produce. */
	beforePurgeLock?: (userId: string) => Promise<void>
}

/** Epoch ms reaches SQL only via to_timestamp, never as a raw Date (pg's local-time trap). */
function utc(msExpr: SQL | number): SQL {
	return sql`(to_timestamp((${msExpr})::double precision / 1000.0) AT TIME ZONE 'UTC')`
}

/** Calendar months in UTC: `365 days` would delete a day early across a leap year. */
function retentionDeadline(): SQL {
	return sql`(${utc(sql`${users.accessEndedAt}`)} + make_interval(months => ${RETENTION_MONTHS}))`
}

function lapsedWithClock(): SQL {
	return sql`${statusIn(LAPSED_STATUSES)} AND ${users.accessEndedAt} IS NOT NULL`
}

/** A notice has been accepted for THIS lapse (not a previous one). */
function noticedThisLapse(): SQL {
	return sql`${users.retentionNoticeSentAt} IS NOT NULL AND ${users.retentionNoticeSentAt} >= ${users.accessEndedAt}`
}

function dueForNotice(now: number): SQL {
	return sql`${lapsedWithClock()}
    AND ${retentionDeadline()} - make_interval(secs => ${NOTICE_LEAD_MS / 1000}) <= ${utc(now)}
    AND NOT (${noticedThisLapse()})`
}

function dueForPurge(now: number): SQL {
	return sql`${lapsedWithClock()}
    AND ${retentionDeadline()} <= ${utc(now)}
    AND ${noticedThisLapse()}
    AND ${users.retentionNoticeSentAt} <= ${now - NOTICE_LEAD_MS}::bigint`
}

function lapsedWithoutClock(): SQL {
	return sql`${statusIn(LAPSED_STATUSES)} AND ${users.accessEndedAt} IS NULL`
}

async function countWhere(predicate: SQL): Promise<number> {
	const [row] = await db.select({ n: count() }).from(users).where(predicate)
	return Number(row?.n ?? 0)
}

async function claimLease(now: number): Promise<number | null> {
	const leaseUntil = now + LEASE_MS
	const rows = await db
		.insert(jobRuns)
		.values({ name: RETENTION_JOB, leaseUntil })
		.onConflictDoUpdate({
			target: jobRuns.name,
			set: { leaseUntil },
			setWhere: sql`${jobRuns.leaseUntil} IS NULL OR ${jobRuns.leaseUntil} < ${now}::bigint`,
		})
		.returning({ name: jobRuns.name })
	return rows.length > 0 ? leaseUntil : null
}

async function releaseLease(leaseUntil: number, now: number, completed: boolean): Promise<void> {
	await db
		.update(jobRuns)
		.set({ leaseUntil: null, ...(completed ? { lastCompletedAt: now } : {}) })
		.where(and(eq(jobRuns.name, RETENTION_JOB), eq(jobRuns.leaseUntil, leaseUntil)))
}

function reportFailure(message: string, error: unknown, phase: 'notice' | 'purge'): void {
	logger.error(message, { error, phase })
	captureError(error instanceof Error ? error : new Error(String(error)), {
		scope: 'retention-sweep',
		phase,
	})
}

async function startMissingClocks(now: number, result: RetentionSweepResult): Promise<void> {
	const started = await db
		.update(users)
		.set({ accessEndedAt: now })
		.where(lapsedWithoutClock())
		.returning({ id: users.id })
	result.clocksStarted = started.length
	if (started.length > 0) {
		logger.warn('[Retention] lapsed rows had no clock; started it now', { count: started.length })
	}
}

async function runNotices(
	now: number,
	limit: number,
	overBudget: () => boolean,
	result: RetentionSweepResult
): Promise<void> {
	const due = await db
		.select({ id: users.id, email: users.email, accessEndedAt: users.accessEndedAt })
		.from(users)
		.where(dueForNotice(now))
		// Never-attempted first, then oldest attempt: a refused address rotates
		// to the back of the queue instead of starving everyone behind it.
		.orderBy(sql`${users.retentionNoticeAttemptedAt} ASC NULLS FIRST`, asc(users.accessEndedAt))
		.limit(limit)

	// The purge needs a NOTICE_LEAD-old notice, so the earliest deletion is always
	// NOTICE_LEAD from now.
	const deletionDate = formatDeletionDate(now + NOTICE_LEAD_MS)

	for (const row of due) {
		if (overBudget()) {
			result.truncated = true
			return
		}
		// Guarded: only this row, only while it is still in the SAME lapse.
		const sameLapse = and(
			eq(users.id, row.id),
			eq(users.accessEndedAt, row.accessEndedAt as number),
			statusIn(LAPSED_STATUSES)
		)
		await db.update(users).set({ retentionNoticeAttemptedAt: now }).where(sameLapse)
		try {
			await sendRetentionNoticeEmail(row.email, { deletionDate })
		} catch (error) {
			result.noticeFailures++
			reportFailure('[Retention] notice send failed', error, 'notice')
			continue
		}
		try {
			const stamped = await db
				.update(users)
				.set({ retentionNoticeSentAt: now })
				.where(sameLapse)
				.returning({ id: users.id })
			if (stamped.length > 0) {
				result.noticesSent++
			} else {
				// Regained access (or lapsed afresh) between the read and the stamp.
				logger.info('[Retention] notice sent, but the row left this lapse before it was recorded')
			}
		} catch (error) {
			result.noticeFailures++
			reportFailure('[Retention] notice sent but not recorded; it will be re-sent', error, 'notice')
		}
	}
}

async function runPurges(
	options: RetentionSweepOptions,
	limit: number,
	overBudget: () => boolean,
	result: RetentionSweepResult
): Promise<void> {
	const { now, beforePurgeLock } = options
	const due = await db
		.select({ id: users.id })
		.from(users)
		.where(dueForPurge(now))
		.orderBy(asc(users.accessEndedAt))
		.limit(limit)

	for (const { id } of due) {
		if (overBudget()) {
			result.truncated = true
			return
		}
		try {
			await beforePurgeLock?.(id)
			const erased = await db.transaction(async (tx) => {
				const [locked] = await tx
					.select({ id: users.id, email: users.email })
					.from(users)
					.where(and(eq(users.id, id), dueForPurge(now)))
					.for('update', { skipLocked: true })
				if (!locked) {
					return false
				}
				await eraseAccountRows(tx, { userId: locked.id, email: locked.email })
				return true
			})
			if (erased) {
				result.purged++
			} else {
				result.purgesSkipped++
			}
		} catch (error) {
			result.purgeFailures++
			reportFailure('[Retention] purge failed for one account', error, 'purge')
		}
	}
}

/** Per-account failures are counted; an unreachable database throws so the route reports 500. */
export async function runRetentionSweep(
	options: RetentionSweepOptions
): Promise<RetentionSweepResult> {
	const dryRun = options.dryRun ?? false
	const result: RetentionSweepResult = {
		dryRun,
		clocksStarted: 0,
		noticesDue: 0,
		noticesSent: 0,
		noticeFailures: 0,
		purgesDue: 0,
		purged: 0,
		purgesSkipped: 0,
		purgeFailures: 0,
		truncated: false,
	}

	// A dry run writes nothing, so it needs no lease. Its counts are totals, so an
	// operator sees the real backlog.
	if (dryRun) {
		result.clocksStarted = await countWhere(lapsedWithoutClock())
		result.noticesDue = await countWhere(dueForNotice(options.now))
		result.purgesDue = await countWhere(dueForPurge(options.now))
		return result
	}

	const lease = await claimLease(options.now)
	if (lease === null) {
		logger.info('[Retention] another sweep holds the lease — skipping')
		return { ...result, skipped: 'lease-held' }
	}

	const startedAt = Date.now()
	const budget = options.runBudgetMs ?? RUN_BUDGET_MS
	const overBudget = () => Date.now() - startedAt >= budget

	let completed = false
	try {
		await startMissingClocks(options.now, result)
		result.noticesDue = await countWhere(dueForNotice(options.now))
		await runNotices(options.now, options.noticeLimit ?? NOTICE_BATCH_LIMIT, overBudget, result)
		result.purgesDue = await countWhere(dueForPurge(options.now))
		await runPurges(options, options.purgeLimit ?? PURGE_BATCH_LIMIT, overBudget, result)
		completed = true
	} finally {
		await releaseLease(lease, options.now, completed)
	}

	logger.info('[Retention] sweep finished', { ...result })
	return result
}
