/**
 * Shared Postgres counter, so N instances share one bucket. A single upsert … RETURNING
 * makes the increment atomic; the decision uses the returned count.
 */

import { db, rateLimits } from '@budget-planner/db'
import { sql } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import { maybeRunRetentionBackstop } from '@/server/retention/backstop'
import { createIntervalGate, passIfDue } from './interval-gate'

/** Distinct scopes so one scope's usage never consumes another's budget. */
type RateLimitScope = 'ip' | 'email' | 'login-verify' | 'sync'

export type RateLimitDecision = {
	allowed: boolean
	remaining: number
	degraded?: boolean
}

export type DbRateLimitOptions = {
	scope: RateLimitScope
	/** An IP string, a lowercased email, or a userId. */
	subject: string
	windowMs: number
	/** The (max+1)th attempt is rejected. */
	maxAttempts: number
	/** Only for the `sync` scope, so account erasure (which deletes by userId) clears the counter. */
	userId?: string | null
	now?: number
	/**
	 * Called on a DB failure and its decision returned as `degraded`. When omitted the limiter
	 * fails closed: for auth a DB outage already blocks the writes the attempt would make.
	 */
	onDbError?: (now: number) => RateLimitDecision
}

/** Must exceed the longest configured window (15 min) or the sweep deletes live buckets. */
const REAP_CUTOFF_MS = 60 * 60 * 1000

const REAP_INTERVAL_MS = 15 * 60 * 1000

/** Bounds how long a concurrent account erasure can be blocked behind the sweep's row locks. */
const REAP_BATCH_LIMIT = 5000

const reapGate = createIntervalGate()

export function __resetReapGateForTests(): void {
	reapGate.lastPassedAt = 0
}

/**
 * In-request, not cron: scale-to-zero leaves no background process. SKIP LOCKED avoids deadlock
 * with erasure's deletes; the batch cap bounds how long erasure can wait on us. Never throws.
 */
function maybeReapExpiredWindows(now: number): void {
	if (!passIfDue(reapGate, REAP_INTERVAL_MS, now)) {
		return
	}
	// An explicit UTC string, not a Date: pg serializes a Date as local time with an offset,
	// which the timestamp-without-tz column discards (deleting live buckets east of UTC).
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

export async function checkDbRateLimit(options: DbRateLimitOptions): Promise<RateLimitDecision> {
	const { scope, subject, windowMs, maxAttempts, userId, onDbError } = options
	const now = options.now ?? Date.now()

	// The reaper reclaims anything older than REAP_CUTOFF_MS, so a longer window would
	// lose live buckets. Checked at runtime rather than by a copied constant.
	if (windowMs >= REAP_CUTOFF_MS) {
		logger.error('[RateLimit] window is longer than the reap cutoff; sweep disabled for safety', {
			scope,
			windowMs,
			reapCutoffMs: REAP_CUTOFF_MS,
		})
	}
	// Flooring makes concurrent requests in a window collide on one row (the ON CONFLICT key).
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

		// The returned count includes this attempt, so exactly maxAttempts pass.
		const count = rows[0]?.count
		if (count === undefined) {
			// ON CONFLICT DO UPDATE … RETURNING always yields a row, so an empty result is a
			// failure; never hand out a fresh budget by defaulting to 0.
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
		// The retention sweep's in-app backstop rides the same success path.
		maybeRunRetentionBackstop(now)
		return { allowed: count <= maxAttempts, remaining: Math.max(0, maxAttempts - count) }
	} catch (error) {
		const sanitized = error instanceof Error ? error.message : String(error)
		logger.error('[RateLimit] DB error', { scope, error: sanitized })
		if (onDbError) {
			// Bounded per-instance fallback (sync). Explicitly flagged non-cross-instance.
			return { ...onDbError(now), degraded: true }
		}
		return { allowed: false, remaining: 0, degraded: true }
	}
}
