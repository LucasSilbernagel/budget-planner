/**
 * Sync Batch Push Route (Story 5-15)
 *
 * TanStack Start server route (file-route `server.handlers`).
 * Accepts a batch of client sync operations and persists them to DanubeData
 * Postgres — the server → client counterpart of this is GET /api/sync/changes.
 *
 * Endpoint: POST /api/sync/batch
 *
 * WHY THIS ROUTE EXISTS: before 5-15 the push transport was a DIRECT client
 * import of `processSyncOperation` (server/functions/sync.ts), which transitively
 * pulls `@budget-planner/db` into the client bundle — the exact hazard 5-12 fixed
 * for calculations and 4-18 fixed for pull. This route moves push over HTTP so the
 * client never imports server/DB code; the client transport is
 * `sendSyncOperation` in features/api/client.ts.
 *
 * - Auth + premium gate are enforced SERVER-SIDE from the HMAC-signed,
 *   DB-authoritative session cookie (Story 5-7). 401 = no session,
 *   403 = authenticated but not a paid sync tier.
 * - The premium gate uses the SAME statuses as pull (`PAID_SYNC_STATUSES` =
 *   active|past_due), NOT the calculations gate (active-only).
 * - The authoritative user id comes from the SESSION, and `processBatchSync`
 *   additionally rejects any operation whose `userId` does not match it. A
 *   client-supplied userId is never trusted.
 */

import { getCurrentUserSession } from '@/server/api/auth/paddle'
import type { BatchSyncRequest } from '@/server/api/sync'
import { PAID_SYNC_STATUSES, processBatchSync } from '@/server/api/sync'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/** Mirror the body-size guard the legacy server function applied (DoS guard). */
const MAX_REQUEST_SIZE = 1024 * 1024 // 1MB

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  // 1) Resolve and authenticate the session (cookie is HMAC-signed + DB-authoritative).
  const session = await getCurrentUserSession(request)
  if (!session.success) {
    return json({ success: false, error: session.error ?? 'No user session' }, { status: 401 })
  }
  if (!session.data) {
    return json({ success: false, error: 'No user session' }, { status: 401 })
  }

  // 2) Premium gate — match the PULL path (active|past_due), not calculations.
  if (!PAID_SYNC_STATUSES.includes(session.data.subscriptionStatus)) {
    return json(
      {
        success: false,
        error: 'Premium feature: server sync requires an active paid subscription',
      },
      { status: 403 }
    )
  }

  // 3) Body-size guard (before reading the body).
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
    return json({ success: false, error: 'Request too large' }, { status: 413 })
  }

  // 4) Parse the body (bad JSON is a 400, not a 500).
  let body: BatchSyncRequest
  try {
    body = (await request.json()) as BatchSyncRequest
  } catch (error) {
    return json(
      { success: false, error: `Invalid request body: ${errorMessage(error)}` },
      { status: 400 }
    )
  }

  // Client IP + UA for the audit log. x-forwarded-for can be spoofed; used for
  // audit only, never for authorization.
  const forwardedFor = request.headers.get('x-forwarded-for') || ''
  const ipAddress = forwardedFor.split(',').pop()?.trim() || ''
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) || ''

  // 5) Process. processBatchSync owns validation, per-op ownership enforcement,
  // the shared per-user rate limit (review D3), conflict detection, the DB writes
  // and audit logging. We pass the SESSION user id mapped to `id` (never a
  // client-supplied one).
  const result = await processBatchSync(
    body,
    { id: session.data.userId, subscriptionStatus: session.data.subscriptionStatus },
    ipAddress,
    userAgent
  )

  // The BatchSyncResponse body carries per-operation success/conflict/failure,
  // which the client transport (sendSyncOperation) maps to a ProcessOperationResult.
  // Surface the rate-limit rejection as a real 429 so the client classifies it as
  // retryable rather than a permanent failure; everything else is a 200 envelope.
  const status = result.error === 'Rate limit exceeded' ? 429 : 200
  return json(result, { status })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const Route = createFileRoute('/api/sync/batch')({
  server: {
    handlers: {
      POST,
    },
  },
})
