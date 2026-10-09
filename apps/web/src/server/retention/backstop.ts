/**
 * GitHub disables scheduled workflows after 60 days of repo inactivity, so request traffic
 * also runs the sweep when the heartbeat is stale. Unarmed until a first run completes.
 */

import { db } from '@budget-planner/db/client'
import { jobRuns } from '@budget-planner/db/schema'
import { eq } from 'drizzle-orm'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { createIntervalGate, passIfDue } from '@/server/rate-limit/interval-gate'
import { RETENTION_JOB, runRetentionSweep } from './sweep'

const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** The scheduled run is daily; three missed days means it has stopped. */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000

const gate = createIntervalGate()

/** `'unarmed'` = no run has ever completed, so the backstop waits for the first scheduled one. */
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
