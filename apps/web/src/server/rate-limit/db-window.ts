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

/**
 * Bucket namespaces. Keeping these distinct guarantees a subject's usage in one
 * scope can never consume another scope's budget (e.g. a user's sync traffic can
 * never eat into anyone's login budget, and vice-versa).
 */
export type RateLimitScope = 'ip' | 'email' | 'login-verify' | 'paddle-cb' | 'sync'

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
 * Record one attempt for `(scope, subject)` in its current fixed window and
 * report whether it is allowed. Atomic and cross-instance-safe.
 */
export async function checkDbRateLimit(options: DbRateLimitOptions): Promise<RateLimitDecision> {
  const { scope, subject, windowMs, maxAttempts, userId, onDbError } = options
  const now = options.now ?? Date.now()
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
