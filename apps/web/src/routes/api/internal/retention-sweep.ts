/**
 * Runs synchronously (per-run caps keep it under the 60s request timeout) so a failure
 * fails the workflow. Fails closed (503) when the token is unset or short.
 */

import crypto from 'crypto'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { runRetentionSweep } from '@/server/retention/sweep'
import { getRetentionSweepToken } from '@budget-planner/config'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

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
