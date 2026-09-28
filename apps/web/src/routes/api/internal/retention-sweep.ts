/**
 * POST /api/internal/retention-sweep — run the retention sweep (Story 73.2).
 *
 * Called daily by `.github/workflows/retention-sweep.yml`. Runs the sweep
 * SYNCHRONOUSLY (per-run caps keep it inside Rapids' 60s request timeout) and
 * returns its counts, so a failure is a red workflow run rather than a log line
 * nobody reads.
 *
 *  - `Authorization: Bearer <RETENTION_SWEEP_TOKEN>`, compared in constant time.
 *  - Token unset or too short → 503, nothing runs (FAILS CLOSED).
 *  - Wrong or missing header → 401, nothing runs.
 *  - `?dryRun=1` → counts only; writes nothing and sends nothing.
 *  - Any notice or purge failure → 500 with the counts, so `curl -f` fails.
 *  - Another run holding the lease → 200 `{ skipped: 'lease-held' }`.
 *
 * The response carries counts only — never an address or an id.
 */

import crypto from 'crypto'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { runRetentionSweep } from '@/server/retention/sweep'
import { getRetentionSweepToken } from '@budget-planner/config'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/** Constant-time compare; length-guarded so `timingSafeEqual` never throws. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const token = getRetentionSweepToken()
  if (!token) {
    logger.error('[Retention] RETENTION_SWEEP_TOKEN is not set (or too short) — refusing to run')
    return json({ success: false, error: 'Retention sweep is not configured' }, { status: 503 })
  }

  const header = request.headers.get('authorization') ?? ''
  if (!safeEqual(header, `Bearer ${token}`)) {
    return json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'
  try {
    const result = await runRetentionSweep({ now: Date.now(), dryRun })
    const failed = result.noticeFailures > 0 || result.purgeFailures > 0
    return json({ success: !failed, ...result }, { status: failed ? 500 : 200 })
  } catch (error) {
    logger.error('[Retention] sweep aborted', {
      error: error instanceof Error ? error.message : String(error),
    })
    captureError(error instanceof Error ? error : new Error(String(error)), {
      scope: 'retention-sweep',
    })
    return json({ success: false, error: 'Retention sweep failed' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/internal/retention-sweep')({
  server: {
    handlers: {
      POST,
    },
  },
})
