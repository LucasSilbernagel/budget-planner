/**
 * Sync Changes Pull Route (Story 4-18)
 *
 * TanStack Start server route (file-route `server.handlers`).
 * Serves the server → client delta of entity changes for multi-device sync.
 *
 * Endpoint: GET /api/sync/changes?since=<ms-epoch>&limit=<n>
 *
 * - Auth + premium gate are enforced SERVER-SIDE from the HMAC-signed,
 *   DB-authoritative session cookie (Story 5-7). 401 = no session,
 *   403 = authenticated but not a paid sync tier, 200 = ok.
 * - The premium gate uses the SAME statuses as the sync PUSH path
 *   (`PAID_SYNC_STATUSES` = active|past_due|lifetime), NOT the calculations gate
 *   (active-only): pull must be reachable wherever push is.
 *   ⚠️ `lifetime` added by Story 30.4a AC-8; comment corrected by its code review.
 * - The delta is strictly scoped to the SESSION user id (and active profile for
 *   profile-scoped entities). A client-supplied userId is never trusted.
 */

import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { PAID_SYNC_STATUSES, checkRateLimit, getSyncChanges } from '@/server/api/sync'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/** Default page size when the client does not specify `limit`. */
const DEFAULT_PULL_LIMIT = 100

export const GET = async ({ request }: { request: Request }): Promise<Response> => {
  // 1) Resolve and authenticate the session (cookie is HMAC-signed + DB-authoritative).
  const session = await getCurrentUserSession(request)
  if (!session.success) {
    return json({ success: false, error: session.error ?? 'No user session' }, { status: 401 })
  }
  if (!session.data) {
    return json({ success: false, error: 'No user session' }, { status: 401 })
  }

  // 2) Premium gate — match the PUSH path (active|past_due|lifetime), not calculations.
  if (!PAID_SYNC_STATUSES.includes(session.data.subscriptionStatus)) {
    return json(
      {
        success: false,
        error: 'Premium feature: server sync requires an active paid subscription',
      },
      { status: 403 }
    )
  }

  // 2b) Rate limit — shares the per-user budget with push (review D3). A runaway
  // poll loop or an abusive client gets 429 instead of unbounded table scans.
  const rateLimit = await checkRateLimit(session.data.userId)
  if (!rateLimit.allowed) {
    return json({ success: false, error: 'Rate limit exceeded' }, { status: 429 })
  }

  // 3) Parse query params (defensively — bad input is a 400, not a 500).
  const url = new URL(request.url)

  const sinceParam = url.searchParams.get('since')
  let since: number | null = null
  if (sinceParam !== null && sinceParam !== '') {
    const parsed = Number(sinceParam)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return json({ success: false, error: 'Invalid "since" parameter' }, { status: 400 })
    }
    since = parsed
  }

  const limitParam = url.searchParams.get('limit')
  let limit = DEFAULT_PULL_LIMIT
  if (limitParam !== null && limitParam !== '') {
    const parsedLimit = Number(limitParam)
    if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
      limit = Math.floor(parsedLimit)
    }
  }

  // Active profile travels in a header (mirrors financialData.ts), scoping the
  // profile-scoped entity reads. Optional — absent = all profiles for the user.
  const profileId = request.headers.get('x-profile-id') || undefined

  // 4) Fetch the delta, strictly scoped to the SESSION user id.
  try {
    const changes = await getSyncChanges(session.data.userId, since, limit, profileId)
    // `changes.length > 0` already guarantees the element, but
    // `noUncheckedIndexedAccess` cannot see through the ternary; read it once and
    // narrow so the fallback stays explicit.
    const newestChange = changes[changes.length - 1]
    const lastPullTimestamp = newestChange ? newestChange.updatedAt : since
    return json({ success: true, changes, lastPullTimestamp })
  } catch (error) {
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch sync changes',
      },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/sync/changes')({
  server: {
    handlers: {
      GET,
    },
  },
})
