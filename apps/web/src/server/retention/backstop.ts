/**
 * In-app backstop for the retention sweep (Story 73.2, D1).
 *
 * The PRIMARY trigger is `.github/workflows/retention-sweep.yml`, daily. But
 * GitHub disables scheduled workflows in a public repository after 60 days
 * without repository activity, and nothing announces it in the app. On its own
 * the schedule would therefore stop silently after two quiet months — and the
 * privacy policy's deletion promise with it.
 *
 * So request traffic also checks the sweep's heartbeat (`jobRuns.lastCompletedAt`)
 * and runs the sweep itself when the last COMPLETED run is more than
 * `STALE_AFTER_MS` old. The two cannot double-run: every sweep claims the
 * `jobRuns` lease first.
 *
 * ⚠️ WHAT THE BACKSTOP DOES NOT GUARANTEE (code review 73.2). It needs traffic
 * — no rate-limited request, no backstop — and it runs after the response, where
 * scale-to-zero can cut it short. It is a fallback for a schedule that has
 * STOPPED, not an equal second trigger.
 *
 * ⚠️ UNARMED UNTIL A FIRST RUN COMPLETES. A NULL heartbeat means "never run",
 * NOT "overdue": the first real sweep must come from the workflow, AFTER the
 * runbook's dry run (`.github/DEPLOY_RUNBOOK.md` §9). Arming on NULL fired a
 * real sweep on the first request after deploy — before the dry run, with no
 * token configured, and in every dev database.
 *
 * Rides `checkDbRateLimit`'s success path, exactly like the expired-window
 * reaper (`rate-limit/db-window.ts`): gated to at most once per
 * `CHECK_INTERVAL_MS` per instance, never awaited, never throws.
 */

import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { createIntervalGate, passIfDue } from '@/server/rate-limit/interval-gate'
import { db } from '@budget-planner/db'
import { jobRuns } from '@budget-planner/db/src/schema'
import { eq } from 'drizzle-orm'
import { RETENTION_JOB, runRetentionSweep } from './sweep'

/** At most one heartbeat check per instance per hour. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** The scheduled run is daily; three missed days means it has stopped. */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000

const gate = createIntervalGate()

/** Test seam: reset the per-instance gate. */
export function __resetRetentionBackstopGateForTests(): void {
  gate.lastPassedAt = 0
}

/**
 * Run the sweep when the heartbeat is stale. Awaitable, for tests and for the
 * fire-and-forget wrapper below. `'fresh'` = nothing to do; `'unarmed'` = no
 * run has ever completed, so the backstop waits for the first scheduled one.
 */
export async function runRetentionBackstopIfStale(
  now: number
): Promise<'fresh' | 'unarmed' | 'ran'> {
  const [job] = await db
    .select({ lastCompletedAt: jobRuns.lastCompletedAt })
    .from(jobRuns)
    .where(eq(jobRuns.name, RETENTION_JOB))
  const last = job?.lastCompletedAt ?? null
  if (last === null) {
    return 'unarmed'
  }
  if (now - last < STALE_AFTER_MS) {
    return 'fresh'
  }
  logger.warn('[Retention] scheduled sweep is overdue — running the in-app backstop', {
    lastCompletedAt: last,
  })
  await runRetentionSweep({ now })
  return 'ran'
}

/** Fire-and-forget hook for request paths. Never awaited, never throws. */
export function maybeRunRetentionBackstop(now: number): void {
  if (!passIfDue(gate, CHECK_INTERVAL_MS, now)) {
    return
  }
  const onFailure = (error: unknown): void => {
    logger.error('[Retention] backstop sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    captureError(error instanceof Error ? error : new Error(String(error)), {
      scope: 'retention-backstop',
    })
  }
  try {
    void runRetentionBackstopIfStale(now).catch(onFailure)
  } catch (error) {
    onFailure(error)
  }
}
