/**
 * Atomic, DB-backed fixed-window rate limiter (Story SEC-2).
 *
 * The single rate-limit primitive for the whole app. It replaces the former
 * in-memory `sliding-window.ts` (single-instance, per-process `Map`) on the auth
 * paths AND the read-then-write counter that used to live inline in `sync.ts`.
 *
 * Why this shape:
 *  - **Cross-instance safe.** State lives in the shared Postgres `rateLimits`
 *    table, so N Rapids instances share ONE counter per bucket — spreading
 *    requests across instances can no longer multiply the effective limit.
 *  - **Atomic.** The increment is a single `INSERT … ON CONFLICT … DO UPDATE …
 *    RETURNING` statement. Postgres serialises conflicting upserts, so two
 *    concurrent requests can never both read `count = 4` and both write `5`
 *    (the race the old `SELECT` → `UPDATE` allowed). The decision is made on the
 *    value the statement RETURNS, which already includes this attempt.
 *  - **Namespaced.** `scope` keeps an IP bucket, an email bucket and a per-user
 *    sync bucket from ever colliding (see `RateLimitScope`).
 *
 * SECURITY: this is the APP layer. It is correct whether the app runs one
 * instance or many, but authoritative enforcement (e.g. an L7 edge limit) still
 * belongs at the Rapids edge — see deferred-work.md (pairs with 5-2).
 */

import { logger } from '@/lib/logger'
import { db, rateLimits } from '@budget-planner/db'
import { sql } from 'drizzle-orm'
import { createIntervalGate, passIfDue } from './interval-gate'

/**
 * Bucket namespaces. Keeping these distinct guarantees a subject's usage in one
 * scope can never consume another scope's budget (e.g. a user's sync traffic can
 * never eat into anyone's login budget, and vice-versa).
 */
export type RateLimitScope = 'ip' | 'email' | 'login-verify' | 'sync'

export interface RateLimitDecision {
  /** False → the caller should reject (429 / generic throttle). */
  allowed: boolean
  /** Remaining attempts in the current window (never negative). */
  remaining: number
  /** True when the DB path failed and the degrade policy (fallback / fail-closed) was used. */
  degraded?: boolean
}

export interface DbRateLimitOptions {
  /** Bucket namespace (see {@link RateLimitScope}). */
  scope: RateLimitScope
  /** Bucket key within the scope: an IP string, a lowercased email, or a userId. */
  subject: string
  /** Fixed window length in ms. */
  windowMs: number
  /** Max attempts permitted per bucket per window. The (max+1)th is rejected. */
  maxAttempts: number
  /**
   * Owning user — populated ONLY for the `sync` scope so account erasure
   * (account.ts deletes rateLimits by userId) still clears the counter. Omit for
   * IP/email buckets, which have no owning user (column is NULL).
   */
  userId?: string | null
  /** Injectable clock (tests). Defaults to `Date.now()`. */
  now?: number
  /**
   * DB-error degrade policy (AC-6). When provided, it is invoked on a DB failure
   * and its decision is returned (flagged `degraded`) — used by the sync path for
   * a bounded, explicitly-labelled per-instance fallback. When OMITTED the limiter
   * FAILS CLOSED (deny): the default for auth, where a DB outage already blocks the
   * token/session writes the attempt would perform, so denying costs nothing and
   * we never silently allow unlimited attempts.
   */
  onDbError?: (now: number) => RateLimitDecision
}

/**
 * Age at which a window is reclaimable (Story sec-3).
 *
 * MUST exceed the longest configured window or the sweep would delete LIVE
 * buckets and hand the subject a fresh budget. Measured, all four callers:
 * `ip` 60s (`request.ts:31`), `email` **15 min** (`request.ts:33` — the
 * longest), `login-verify` 60s (`verify.ts:47`), `sync` 60s
 * (`sync.ts:372-374`). One hour is a 4x margin over the worst case.
 */
const REAP_CUTOFF_MS = 60 * 60 * 1000

/** At most one sweep per instance per interval — the "bounded schedule". */
const REAP_INTERVAL_MS = 15 * 60 * 1000

/**
 * Max rows one sweep may delete. Bounds how long a concurrent account erasure
 * can be blocked behind this statement's row locks (see the docblock below).
 * Partial progress is fine: the remainder goes on the next sweep.
 */
const REAP_BATCH_LIMIT = 5000

const reapGate = createIntervalGate()

/** Test seam: reset the sweep gate so cases cannot leak state into each other. */
export function __resetReapGateForTests(): void {
  reapGate.lastPassedAt = 0
}

/**
 * Reclaim expired windows. Fire-and-forget, opportunistic, at most once per
 * instance per `REAP_INTERVAL_MS`.
 *
 * WHY IN-REQUEST AND NOT A CRON: `rapids-service.yaml:49` sets
 * `min-scale: "0"`, so under scale-to-zero there is no background process to
 * hang a timer on — only requests exist. Growth is request-driven, so a
 * request-driven sweep is self-proportioning: the table can only grow while
 * traffic flows, and traffic is exactly what fires this.
 *
 * ⚠️ `FOR UPDATE SKIP LOCKED` is load-bearing, not an optimisation. Account
 * erasure deletes `rateLimits` by `userId` inside a multi-statement transaction
 * (`server/api/account.ts:98`), and `sync`-scope rows carry BOTH a `userId` and
 * a `windowStart` — so the two predicates DO select overlapping rows. Without
 * SKIP LOCKED the two deletes could take row locks in different orders and
 * deadlock, and PostgreSQL might pick the ERASURE as the victim: a user-facing,
 * GDPR-adjacent path losing to a janitor. SKIP LOCKED makes this sweep step
 * over any row erasure currently holds instead of waiting on it, so it can
 * never be in a lock cycle. Skipped rows are reclaimed on the next sweep.
 *
 * ⚠️ BUT THE PROTECTION IS ONE-DIRECTIONAL, and saying otherwise would be a
 * false comfort: SKIP LOCKED stops THIS statement waiting. It does not stop
 * erasure waiting on US — `account.ts`'s plain `DELETE ... WHERE userId = $1`
 * still blocks on any row this sweep holds, for as long as the sweep runs, and
 * the pool sets no `statement_timeout` (`packages/db/src/client.ts`). That is
 * why the sweep is CAPPED (`REAP_BATCH_LIMIT`) rather than deleting every
 * eligible row in one unbounded statement: a bounded sweep bounds how long
 * erasure can be made to wait. The cap costs nothing — the 15-minute gate
 * already tolerates partial progress.
 *
 * Never awaited and never throws: a failed or slow sweep must not extend, fail,
 * or reject the rate-limit decision it rides along with.
 */
function maybeReapExpiredWindows(now: number): void {
  if (!passIfDue(reapGate, REAP_INTERVAL_MS, now)) {
    return
  }
  // ⚠️ SERIALIZED AS AN EXPLICIT UTC STRING, NOT A `Date`. A raw `Date` in a
  // `sql` template bypasses drizzle's column encoder and is serialized by `pg`
  // as LOCAL time with an offset (`prepareValue` -> `dateToString`). The column
  // is `timestamp` WITHOUT time zone (`schema.ts:567`), so PostgreSQL discards
  // that offset and compares the local wall-clock number against values the
  // upsert path stored via `toISOString()` (UTC). MEASURED on PGlite with a live
  // 12:00Z bucket and a 1h cutoff: TZ=Europe/Berlin sent `13:00+02:00` and
  // deleted EVERY live bucket; Asia/Tokyo and Australia/Sydney likewise;
  // America/Toronto silently under-deleted. Production runs in Falkenstein (DE),
  // i.e. UTC+1/+2. `.toISOString()` is timezone-independent and matches how the
  // upsert writes the column.
  const cutoff = new Date(now - REAP_CUTOFF_MS).toISOString()
  const onFailure = (error: unknown): void => {
    logger.error('[RateLimit] expired-window sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  try {
    // `Promise.resolve(...)` so a driver that throws SYNCHRONOUSLY is caught by
    // the same path as a rejection, and `void` so nothing awaits it.
    void Promise.resolve(
      db.execute(sql`
        DELETE FROM ${rateLimits}
        WHERE ctid IN (
          SELECT ctid FROM ${rateLimits}
          WHERE ${rateLimits.windowStart} < ${cutoff}
          ORDER BY ${rateLimits.windowStart}
          LIMIT ${REAP_BATCH_LIMIT}
          FOR UPDATE SKIP LOCKED
        )
      `)
    ).catch(onFailure)
  } catch (error) {
    onFailure(error)
  }
}

/**
 * Record one attempt for `(scope, subject)` in its current fixed window and
 * report whether it is allowed. Atomic and cross-instance-safe.
 */
export async function checkDbRateLimit(options: DbRateLimitOptions): Promise<RateLimitDecision> {
  const { scope, subject, windowMs, maxAttempts, userId, onDbError } = options
  const now = options.now ?? Date.now()

  // Self-enforcing invariant. The reaper reclaims anything older than
  // REAP_CUTOFF_MS, so a caller whose window is at least that long would have
  // LIVE buckets swept out from under it and be handed a fresh budget. Checked
  // here rather than trusted to a comment, because the alternative is a test
  // holding its own copy of the limit — a copy asserted against itself.
  if (windowMs >= REAP_CUTOFF_MS) {
    logger.error('[RateLimit] window is longer than the reap cutoff; sweep disabled for safety', {
      scope,
      windowMs,
      reapCutoffMs: REAP_CUTOFF_MS,
    })
  }
  // Fixed-window bucket boundary — every request in the same window maps to one
  // row, which is also the ON CONFLICT key. Flooring (not `now`) is what makes
  // concurrent requests in a window collide on the same row and increment it.
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs)

  try {
    const rows = await db
      .insert(rateLimits)
      .values({
        scope,
        subject,
        userId: userId ?? null,
        requestCount: 1,
        windowStart,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .onConflictDoUpdate({
        target: [rateLimits.scope, rateLimits.subject, rateLimits.windowStart],
        set: {
          requestCount: sql`${rateLimits.requestCount} + 1`,
          updatedAt: new Date(now),
        },
      })
      .returning({ count: rateLimits.requestCount })

    // The RETURNED count is the running total INCLUDING this attempt: the Nth
    // request in the window returns N. Allow while count <= maxAttempts, so
    // exactly maxAttempts pass and the (maxAttempts+1)th is rejected — the same
    // boundary the prior in-memory + sync limiters enforced.
    const count = rows[0]?.count
    if (count === undefined) {
      // `ON CONFLICT DO UPDATE … RETURNING` always yields a row in Postgres, so
      // an empty result is anomalous (driver quirk / trigger / RLS). Treat it as
      // a failure and degrade — never hand out a fresh budget by defaulting to 0.
      logger.error('[RateLimit] atomic upsert returned no row', { scope })
      if (onDbError) {
        return { ...onDbError(now), degraded: true }
      }
      return { allowed: false, remaining: 0, degraded: true }
    }
    // Opportunistic cleanup rides the success path only: during a DB outage the
    // last thing to add is another statement.
    if (windowMs < REAP_CUTOFF_MS) {
      maybeReapExpiredWindows(now)
    }
    return { allowed: count <= maxAttempts, remaining: Math.max(0, maxAttempts - count) }
  } catch (error) {
    const sanitized = error instanceof Error ? error.message : String(error)
    logger.error('[RateLimit] DB error', { scope, error: sanitized })
    if (onDbError) {
      // Bounded per-instance fallback (sync). Explicitly flagged non-cross-instance.
      return { ...onDbError(now), degraded: true }
    }
    // Fail closed (auth default): never silently allow unlimited attempts.
    return { allowed: false, remaining: 0, degraded: true }
  }
}
