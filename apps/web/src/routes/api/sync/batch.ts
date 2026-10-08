/**
 * Gated on `hasPaidAccess` (includes past_due), not `hasPremiumFeatures`. The user id
 * comes from the session; ops with another userId are rejected.
 */

import { hasPaidAccess } from '@/lib/premium/access-statuses'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import type { BatchRefusal, BatchSyncRequest } from '@/server/api/sync'
import { processBatchSync } from '@/server/api/sync'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/**
 * Kept below common ingress limits (nginx 1 MiB) so the route's own labelled 413 answers.
 * The ingress must accept bodies larger than 512 KiB.
 */
const MAX_REQUEST_SIZE = 512 * 1024

/**
 * `ownership` is 401 so core keeps the op queued (it may be another account's pending edit);
 * 403 would read as tier-blocked. Keyed on `refusal`, never on error text.
 */
const REFUSAL_STATUS = {
  'invalid-request': 400,
  ownership: 401,
  tier: 403,
  'rate-limit': 429,
} as const satisfies Record<BatchRefusal, number>

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const session = await getCurrentUserSession(request)
  if (!session.success) {
    return json({ success: false, error: session.error ?? 'No user session' }, { status: 401 })
  }
  if (!session.data) {
    return json({ success: false, error: 'No user session' }, { status: 401 })
  }

  if (!hasPaidAccess(session.data.subscriptionStatus)) {
    return json(
      {
        success: false,
        error: 'Premium feature: server sync requires an active paid subscription',
      },
      { status: 403 }
    )
  }

  // `refusal: 'too-large'` tells the client this route refused the op, so it drops it;
  // a proxy's bare 413 says nothing about the op and keeps it queued.
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
    return json(
      { success: false, error: 'Request too large', refusal: 'too-large' },
      { status: 413 }
    )
  }

  let body: BatchSyncRequest
  try {
    body = (await request.json()) as BatchSyncRequest
  } catch (error) {
    return json(
      { success: false, error: `Invalid request body: ${errorMessage(error)}` },
      { status: 400 }
    )
  }

  const result = await processBatchSync(body, {
    id: session.data.userId,
    subscriptionStatus: session.data.subscriptionStatus,
  })

  // Per-operation outcomes stay a 200; only a whole-request refusal gets its own status.
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
