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
 * - The premium gate is the SAME `hasPaidAccess` as pull (active|past_due|
 *   lifetime; one definition since Story 78.3), NOT the premium-features gate
 *   (`hasPremiumFeatures`, which excludes past_due).
 *   ⚠️ `lifetime` was missing from the old hand-copied list until Story 30.4a;
 *   since 78.3 there is no list here to drift.
 * - The authoritative user id comes from the SESSION, and `processBatchSync`
 *   additionally rejects any operation whose `userId` does not match it. A
 *   client-supplied userId is never trusted.
 */

import { hasPaidAccess } from '@/lib/premium/access-statuses'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import type { BatchRefusal, BatchSyncRequest } from '@/server/api/sync'
import { processBatchSync } from '@/server/api/sync'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/**
 * Body-size guard (DoS guard). 512 KiB, NOT the legacy server function's 1 MiB
 * (code review of story 79.3, decision — Lucas, 2026-09-29): the route's OWN 413
 * carries `refusal: 'too-large'`, which is what lets the client drop an oversize
 * op. An ingress in front with a limit at or below this one answers 413 first,
 * with no refusal, and the op stays queued for ever. nginx's default
 * `client_max_body_size` is exactly 1 MiB, so the route stays well under it.
 * ⚠️ DEPLOY PRECONDITION: the ingress must accept bodies larger than 512 KiB.
 * A legitimate op is a few KB (every declared string is capped at ≤500 chars);
 * only an unbounded undeclared key can come near this.
 */
const MAX_REQUEST_SIZE = 512 * 1024

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

  // 2) Paid-access gate — the same `hasPaidAccess` as the PULL path (active|past_due|lifetime),
  //    not the premium-features gate (which excludes past_due).
  if (!hasPaidAccess(session.data.subscriptionStatus)) {
    return json(
      {
        success: false,
        error: 'Premium feature: server sync requires an active paid subscription',
      },
      { status: 403 }
    )
  }

  // 3) Body-size guard (before reading the body).
  //
  // ⚠️ `refusal: 'too-large'` is the PROOF that the sync route itself refused the
  // request (story 79.3, D1). `sendSyncOperation` maps a 413 carrying it to 422,
  // which core drops: the client sends ONE operation per request, so the same op
  // is over the limit on every replay and would otherwise stay queued for ever. A
  // 413 WITHOUT it (a proxy or ingress with its own smaller limit) proves nothing
  // about the op and stays queued. It is NOT a `BatchRefusal`: `processBatchSync`
  // never sees an oversize body. ⚠️ If the client ever batches several ops per
  // request, the client's proven-413 mapping must go, together with the
  // `invalid-request` one (see `processBatchSync`'s validation comment).
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
    return json(
      { success: false, error: 'Request too large', refusal: 'too-large' },
      { status: 413 }
    )
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
