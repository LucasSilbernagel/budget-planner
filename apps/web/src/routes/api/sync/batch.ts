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
 *   active|past_due|lifetime), NOT the calculations gate (active-only).
 *   ⚠️ `lifetime` added by Story 30.4a AC-8; comment corrected by its code
 *   review, which found this and changes.ts still naming the old two-value set.
 * - The authoritative user id comes from the SESSION, and `processBatchSync`
 *   additionally rejects any operation whose `userId` does not match it. A
 *   client-supplied userId is never trusted.
 */

import { getCurrentUserSession } from '@/server/api/auth/paddle'
import type { BatchRefusal, BatchSyncRequest } from '@/server/api/sync'
import { PAID_SYNC_STATUSES, processBatchSync } from '@/server/api/sync'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/** Mirror the body-size guard the legacy server function applied (DoS guard). */
const MAX_REQUEST_SIZE = 1024 * 1024 // 1MB

/**
 * HTTP status for a request-level refusal (story 75.1).
 *
 * `invalid-request` (400) is in core's `PERMANENT_REJECT_STATUS_CODES`, so the op
 * is DROPPED rather than replayed until the circuit breaker stops all sync.
 *
 * `ownership` is 401, which core files as auth-blocked and KEEPS QUEUED. It is
 * deliberately neither a permanent status (the op can be another account's
 * genuine pending edit, pushed by a tab whose session changed in another tab —
 * dropping it deletes that account's edits) nor 403 (core files a 403 as
 * tier-blocked and tells the user their plan excludes sync). `tier` and
 * `rate-limit` keep their existing semantics.
 *
 * ⚠️ Keyed on the `refusal` discriminant, never on the `error` text — rewording a
 * message must not silently change a status. (Before 75.1 the 429 arm
 * string-matched `'Rate limit exceeded'`.)
 */
const REFUSAL_STATUS = {
  'invalid-request': 400,
  ownership: 401,
  tier: 403,
  'rate-limit': 429,
} as const satisfies Record<BatchRefusal, number>

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  // 1) Resolve and authenticate the session (cookie is HMAC-signed + DB-authoritative).
  const session = await getCurrentUserSession(request)
  if (!session.success) {
    return json({ success: false, error: session.error ?? 'No user session' }, { status: 401 })
  }
  if (!session.data) {
    return json({ success: false, error: 'No user session' }, { status: 401 })
  }

  // 2) Premium gate — match the PULL path (active|past_due|lifetime), not calculations.
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

  // 5) Process. processBatchSync owns validation, per-op ownership enforcement,
  // the shared per-user rate limit (review D3), conflict detection and the DB
  // writes. We pass the SESSION user id mapped to `id` (never a client-supplied
  // one).
  const result = await processBatchSync(body, {
    id: session.data.userId,
    subscriptionStatus: session.data.subscriptionStatus,
  })

  // The BatchSyncResponse body carries per-operation success/conflict/failure —
  // including per-operation PERMANENT refusals in `rejections` — which the client
  // transport (sendSyncOperation) maps to a ProcessOperationResult. Per-operation
  // outcomes stay a 200: a batch can mix them, and an HTTP status is batch-level.
  // Only a refusal of the WHOLE request gets its own status (see REFUSAL_STATUS).
  const status = result.refusal ? REFUSAL_STATUS[result.refusal] : 200
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
