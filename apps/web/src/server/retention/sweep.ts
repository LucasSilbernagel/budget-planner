/**
 * Retention sweep — enforces the privacy policy's retention period for lapsed
 * accounts (Story 73.2).
 *
 * The policy (`content/legal/privacy.md`, "How long we keep your data") is the
 * ONE home of the period and the notice lead time (73.1, D4). The constants
 * below implement it; change them only together with that page.
 *
 * Three phases per run, bounded by a batch cap AND a wall-clock budget so a run
 * stays inside Rapids' 60-second request timeout (`rapids-service.yaml`,
 * `timeoutSeconds`) and well inside the 10-minute lease:
 *
 *  0. CLOCK — a lapsed row with NO `accessEndedAt` gets `now` (errs late). The
 *     one known producer is the window between migrate and deploy, where the
 *     OLD image writes a lapse without the column; left alone, such a row
 *     would never come due.
 *  1. NOTICE — each lapsed row whose deletion is at most `NOTICE_LEAD` away,
 *     and which has no notice for THIS lapse, is emailed. Send FIRST, then
 *     stamp: a crash in between re-sends tomorrow, which is harmless, whereas
 *     stamp-then-send could record a notice that never left. Candidates are
 *     taken never-attempted first, then oldest ATTEMPT first, so an address
 *     Brevo keeps refusing rotates to the back instead of blocking the queue.
 *  2. PURGE — each lapsed row past `accessEndedAt + 12 months` whose notice is
 *     at least `NOTICE_LEAD` old is erased through `eraseAccountRows`, the same
 *     function account erasure uses. Deletion can therefore come LATE (a
 *     notice sent late pushes it back), but never early and NEVER UNANNOUNCED:
 *     a row whose notice never succeeds is never deleted (Lucas, 2026-09-28).
 *     Each failed attempt is a red scheduled run and a `[Retention]` error.
 *
 * ⚠️ SCOPED POSITIVELY. Every predicate reads `subscriptionStatus IN
 * (LAPSED_STATUSES)` — never `NOT IN (ENTITLED)` — from the one classification
 * in `status-classes.ts`. A lifetime, active or past_due row cannot match.
 *
 * ⚠️ LOCKING (AC-6). Candidates are chosen by a plain read; then EACH purge is
 * its own transaction that re-selects the row with the full eligibility
 * predicate `FOR UPDATE SKIP LOCKED` before erasing. So:
 *   - the purge never waits on an erasure (or a webhook) holding the row — it
 *     steps over it and the row is picked up on a later run;
 *   - a row that regained access between the read and the purge no longer
 *     matches the predicate under the lock, and survives;
 *   - erasure and the purge both lock `users` FIRST (`eraseAccountRows`), so
 *     they cannot form a lock cycle. One-directional, as in `db-window.ts`: an
 *     erasure CAN wait on a purge already holding that user's row, for as long
 *     as that one user's rows take to delete.
 * The webhook side of the same race is closed in `routes/api/webhooks/paddle.ts`
 * (`rowVanished`, and the re-key `vanished` result).
 *
 * ⚠️ NO PADDLE CALL. The purge must not cancel anything in Paddle. And a later
 * lapsed Paddle event for a purged customer creates nothing: the webhook
 * refuses to insert a lapsed status for an unknown customer.
 *
 * ⚠️ TIME. `now` is injected as epoch ms and reaches SQL only as
 * `to_timestamp(ms / 1000.0)`, never as a raw `Date` (the timezone trap
 * measured in `rate-limit/db-window.ts`). The 12 months are CALENDAR months,
 * computed in UTC: `365 days` would delete a day early across a leap year.
 * The run budget alone uses the real clock — it bounds real elapsed time.
 *
 * Single-flight: every run first claims the `jobRuns` lease; a run that finds
 * it held reports `skipped` and does nothing. Every run that reaches its end
 * advances `lastCompletedAt` (failures or not) — the backstop reads it to tell
 * a stopped schedule from one refused address.
 */

import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { eraseAccountRows } from '@/server/api/account'
import { formatDeletionDate, sendRetentionNoticeEmail } from '@/server/email/mailer'
import { db } from '@budget-planner/db'
import { jobRuns, users } from '@budget-planner/db/src/schema'
import { type SQL, and, asc, count, eq, sql } from 'drizzle-orm'
import { LAPSED_STATUSES, statusIn } from './status-classes'

/** The retention period, in calendar months. Mirrors `privacy.md`. */
const RETENTION_MONTHS = 12

/** How far ahead of deletion the one warning email goes (D2). Mirrors `privacy.md`. */
const NOTICE_LEAD_MS = 30 * 24 * 60 * 60 * 1000

/** Per-run caps. The remainder goes on the next run. */
const NOTICE_BATCH_LIMIT = 50
const PURGE_BATCH_LIMIT = 50

/**
 * Real elapsed time after which a run starts no further account. Well under
 * Rapids' 60s request timeout: one Brevo call is itself capped at 10s
 * (`BREVO_TIMEOUT_MS`), so the worst overrun is one call past this budget.
 */
const RUN_BUDGET_MS = 40_000

/** The `jobRuns.name` this job claims. Seeded by migration 0024. */
export const RETENTION_JOB = 'retention-sweep'

/** How long a claimed lease blocks other runs if this one dies mid-way. */
const LEASE_MS = 10 * 60 * 1000

export interface RetentionSweepResult {
  /** Set when another run held the lease; nothing else was done. */
  skipped?: 'lease-held'
  dryRun: boolean
  /** Lapsed rows that had no clock and were given `now` (phase 0). */
  clocksStarted: number
  /** ALL rows due a notice now — not capped by the batch limit. */
  noticesDue: number
  noticesSent: number
  noticeFailures: number
  /** ALL rows due deletion now — not capped by the batch limit. */
  purgesDue: number
  purged: number
  /** Candidates that no longer matched under the lock (regained access, or held by an erasure). */
  purgesSkipped: number
  purgeFailures: number
  /** True when the run budget stopped the run early; the rest goes next run. */
  truncated: boolean
}

export interface RetentionSweepOptions {
  now: number
  dryRun?: boolean
  noticeLimit?: number
  purgeLimit?: number
  /** Real elapsed-time budget; defaults to {@link RUN_BUDGET_MS}. */
  runBudgetMs?: number
  /**
   * TEST SEAM ONLY. Runs between choosing a purge candidate and locking it —
   * where a concurrent re-entitlement or erasure would land. A test uses it to
   * SIMULATE that interleaving; PGlite's single connection cannot produce it.
   */
  beforePurgeLock?: (userId: string) => Promise<void>
}

/** `ms` epoch → a UTC wall-clock `timestamp`, the frame all date maths runs in. */
function utc(msExpr: SQL | number): SQL {
  return sql`(to_timestamp((${msExpr})::double precision / 1000.0) AT TIME ZONE 'UTC')`
}

/** `accessEndedAt + 12 calendar months`, as a UTC `timestamp`. */
function retentionDeadline(): SQL {
  return sql`(${utc(sql`${users.accessEndedAt}`)} + make_interval(months => ${RETENTION_MONTHS}))`
}

/** Lapsed, with a clock. The base every retention predicate builds on. */
function lapsedWithClock(): SQL {
  return sql`${statusIn(LAPSED_STATUSES)} AND ${users.accessEndedAt} IS NOT NULL`
}

/** A notice has been accepted for THIS lapse (not a previous one). */
function noticedThisLapse(): SQL {
  return sql`${users.retentionNoticeSentAt} IS NOT NULL AND ${users.retentionNoticeSentAt} >= ${users.accessEndedAt}`
}

/** Due for the warning: deletion is at most NOTICE_LEAD away, and no notice yet. */
function dueForNotice(now: number): SQL {
  return sql`${lapsedWithClock()}
    AND ${retentionDeadline()} - make_interval(secs => ${NOTICE_LEAD_MS / 1000}) <= ${utc(now)}
    AND NOT (${noticedThisLapse()})`
}

/** Due for deletion: the period has run AND the notice is at least NOTICE_LEAD old. */
function dueForPurge(now: number): SQL {
  return sql`${lapsedWithClock()}
    AND ${retentionDeadline()} <= ${utc(now)}
    AND ${noticedThisLapse()}
    AND ${users.retentionNoticeSentAt} <= ${now - NOTICE_LEAD_MS}::bigint`
}

/** Lapsed but with no clock: phase 0's target. */
function lapsedWithoutClock(): SQL {
  return sql`${statusIn(LAPSED_STATUSES)} AND ${users.accessEndedAt} IS NULL`
}

async function countWhere(predicate: SQL): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users).where(predicate)
  return Number(row?.n ?? 0)
}

/** Claim the single-flight lease. False = another run holds it. Self-seeding. */
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

/** Release OUR lease (never another run's), and record completion when the run reached its end. */
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

  // Every row returned here has its deadline at most NOTICE_LEAD away, and the
  // purge needs the notice to be NOTICE_LEAD old — so the earliest deletion is
  // always NOTICE_LEAD from now.
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

/**
 * Run one retention sweep. Never throws for a per-account failure — those are
 * counted — but DOES throw if the database is unreachable, so the caller (the
 * route) reports 500.
 */
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

  // A dry run writes nothing, so it needs no lease and records no completion.
  // Its counts are TOTALS, not the first batch, so an operator can see the
  // real backlog before the first real run.
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
