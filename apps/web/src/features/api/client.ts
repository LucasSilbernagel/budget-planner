/**
 * API client for the sync server routes (`/api/sync/*`).
 *
 * Goes over HTTP rather than importing the server functions, which would pull
 * `@budget-planner/db` (server-only) into the client bundle.
 */

import type { ProcessOperationResult, ServerChange, SyncOperation } from '@budget-planner/core/sync'

/**
 * Pulls server-side entity changes since a cursor via HTTP (Story 4-18).
 *
 * Goes over HTTP to the served GET /api/sync/changes route. It MUST NOT import the server function
 * directly — that transitively imports `@budget-planner/db` (server-only) and
 * would pull DB code into the client bundle (the exact 3-4 defect 5-12 fixed).
 *
 * Wired into the core SynchronizationService as `config.fetchServerChanges`. It
 * fails loud on a non-OK / unsuccessful response so a 401/403/500 surfaces as a
 * pull error rather than masquerading as "no remote changes".
 *
 * @param since - Pull cursor (Unix ms epoch); `null` requests a full snapshot.
 * @param limit - Max changes to request (server caps this).
 * @param profileId - Active profile id, scoping profile-scoped entity reads.
 */
export async function fetchServerChanges(
  since: number | null,
  limit = 100,
  profileId?: string
): Promise<ServerChange[]> {
  return (await fetchServerChangesWithMeta(since, limit, profileId)).changes
}

/**
 * {@link fetchServerChanges}, plus the envelope's `profileIds`: every live
 * profile the user owns on the server (`undefined` when the server could not
 * read it). The pulled `userProfile` changes are a capped delta and cannot tell
 * the client which profiles are MISSING server-side; this list can.
 */
export async function fetchServerChangesWithMeta(
  since: number | null,
  limit = 100,
  profileId?: string
): Promise<{ changes: ServerChange[]; profileIds: string[] | undefined }> {
  const params = new URLSearchParams()
  if (since !== null) {
    params.set('since', String(since))
  }
  params.set('limit', String(limit))

  const headers: Record<string, string> = {}
  if (profileId) {
    headers['x-profile-id'] = profileId
  }

  const response = await fetch(`/api/sync/changes?${params.toString()}`, {
    method: 'GET',
    headers,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to fetch server changes')
  }

  const result: {
    success: boolean
    changes?: ServerChange[]
    profileIds?: unknown
    error?: string
  } = await response.json()

  if (!result.success) {
    throw new Error(result.error || 'Failed to fetch server changes')
  }

  const profileIds =
    Array.isArray(result.profileIds) && result.profileIds.every((id) => typeof id === 'string')
      ? (result.profileIds as string[])
      : undefined
  return { changes: result.changes ?? [], profileIds }
}

/**
 * The subset of BatchSyncResponse the client transport needs. Declared locally so
 * this client module never imports the server sync module (which transitively
 * imports `@budget-planner/db`) — the same isolation `fetchServerChanges` keeps.
 */
interface BatchSyncResponseLite {
  success: boolean
  processedCount: number
  failedCount: number
  conflictCount: number
  error?: string
  /**
   * Operations refused PERMANENTLY (story 75.1). Mirrors `BatchSyncResponse.rejections`
   * in `server/api/sync.ts`; declared here rather than imported so this client
   * module never pulls the server sync module (and `@budget-planner/db`) in.
   */
  rejections?: { operationId: string; reason: string }[]
  /**
   * A refusal of the WHOLE request, set by `processBatchSync` (story 75.1) and
   * mapped to the HTTP status by the route. Only `'invalid-request'` is permanent.
   * The route's own 413 also carries one, `'too-large'` (story 79.3), which is
   * permanent too; `processBatchSync` never sets that one.
   */
  refusal?: string
}

/**
 * HTTP statuses core treats as PERMANENT (`PERMANENT_REJECT_STATUS_CODES` in
 * `packages/core/src/sync/synchronization.ts`) — mirrored here, not imported,
 * because core does not export it. An op answered with one of these LEAVES THE
 * QUEUE, and since story 75.2 a refused create is also removed from the device.
 */
const PERMANENT_HTTP_STATUSES: ReadonlySet<number> = new Set([400, 404, 409, 422])

/**
 * Pushes a single sync operation to the server via HTTP (Story 5-15).
 *
 * This is the PUSH counterpart to {@link fetchServerChanges}. It is wired into the
 * core SynchronizationService as `config.processOperation`, replacing the old
 * direct import of the `processSyncOperation` server function (which dragged
 * server/DB code into the client graph — the 5-12 hazard). It MUST NOT import the
 * server sync module directly.
 *
 * Maps the served {@link BatchSyncResponseLite} envelope to the core's
 * {@link ProcessOperationResult}, and classifies transport failures so the queue
 * retries only transient ones:
 * - network error / 5xx / 429 → `retryable: true` (back off and try again)
 * - 4xx (auth/validation) → `retryable: false` (do not hammer a permanent reject)
 *
 * The service sends operations one at a time, so the batch always wraps exactly
 * one operation (preserving the previous per-operation transport contract).
 *
 * ⚠️⚠️ LOAD-BEARING (story 75.1): the server refuses an invalid request as a
 * whole, with a PERMANENT status (400) that makes core drop the op. That drops the right op only because a request carries exactly one. Batching
 * several ops per request here would make one bad op take its valid neighbours
 * down with it — see the matching comment in `processBatchSync`.
 */
export async function sendSyncOperation(operation: SyncOperation): Promise<ProcessOperationResult> {
  let response: Response
  try {
    response = await fetch('/api/sync/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operations: [operation],
        clientTimestamp: Date.now(),
        deviceId: operation.deviceId,
      }),
    })
  } catch (error) {
    // Network/connectivity failure — always retryable.
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
      retryable: true,
    }
  }

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: string
      refusal?: string
    }
    // ⚠️⚠️ A permanent status is passed on ONLY when the body proves the SYNC
    // SERVER itself refused the request (code review 75.2, decision D1 — Lucas,
    // 2026-09-28). A 404 from a proxy or CDN, a stale PWA tab calling a renamed
    // route, or the route's own bad-JSON 400 (which carries no `refusal`) is
    // NOT a verdict on the operation — and a permanent status would drop it from
    // the queue and, for a create, DELETE the only copy from this device (75.2's
    // revert). Without that proof the status is withheld: `retryable: false`
    // with no status code is the unclassified bucket, which core keeps queued.
    const serverRefused = errorData.refusal === 'invalid-request'
    const withheld = PERMANENT_HTTP_STATUSES.has(response.status) && !serverRefused
    // Story 79.3 (D1): the same rule for a 413. The sync route stamps its OWN size
    // refusal with `refusal: 'too-large'`; since this function posts exactly ONE
    // op per request, that refusal names this op on every replay. It becomes 422
    // (the per-op "sync server refused it" status, in core's allow-list), so the
    // op leaves the queue. Any other 413 (a proxy, CDN or ingress) keeps
    // `statusCode: 413`, which core keeps queued. ⚠️ Core's allow-list is left
    // without 413 on purpose: a 413 names the REQUEST, and only this one-op
    // premise makes it a verdict on the op. If this function ever batches, remove
    // this mapping together with the `invalid-request` one.
    if (response.status === 413 && errorData.refusal === 'too-large') {
      return {
        success: false,
        error: errorData.error || 'Request too large',
        retryable: false,
        statusCode: 422,
      }
    }
    return {
      success: false,
      error: errorData.error || `Sync request failed (${response.status})`,
      // 429 (rate limit) and 5xx are transient; other 4xx are not retried.
      retryable: response.status === 429 || response.status >= 500,
      ...(withheld ? {} : { statusCode: response.status }),
    }
  }

  const result = (await response.json().catch(() => null)) as BatchSyncResponseLite | null
  if (!result) {
    return { success: false, error: 'Malformed sync response', retryable: true }
  }

  // Success: at least one operation was processed.
  if (result.success && result.processedCount >= 1) {
    return { success: true }
  }
  // Conflict: the server rejected the op because of a competing state (the queue
  // routes these into the conflict bucket, not the failed bucket).
  if (result.conflictCount > 0) {
    return { success: false, conflict: true }
  }
  // A PERMANENT refusal (story 75.1): the server named this op as one it can never
  // accept. `statusCode: 422` is in core's PERMANENT_REJECT_STATUS_CODES, so the op
  // is removed from the queue instead of being replayed until the circuit breaker
  // stops all sync. The reason is a closed server-side set, never driver text.
  const rejection = result.rejections?.find((r) => r.operationId === operation.id)
  if (result.failedCount > 0 && rejection) {
    return {
      success: false,
      error: `Refused by the server (${rejection.reason})`,
      retryable: false,
      statusCode: 422,
    }
  }
  // Any OTHER server-side failure carries no proof of permanence: non-retryable
  // with no status code, which core deliberately KEEPS QUEUED (a transient DB
  // error or an ordering-dependent constraint can clear on replay).
  if (result.failedCount > 0) {
    return { success: false, error: result.error || 'Operation failed on server', retryable: false }
  }
  // Fallback: a 200 envelope that matched none of the above (e.g. success:true but
  // processedCount:0) must NOT be treated as applied — doing so would drop the op
  // from the queue as "synced" with nothing persisted server-side (silent loss).
  // Treat it as a transient failure so the queue retries instead.
  return {
    success: false,
    error: result.error || 'Unexpected sync response (nothing processed)',
    retryable: true,
  }
}

/**
 * Generic API error class
 */
export class ApiError extends Error {
  constructor(
    public override readonly message: string,
    public readonly statusCode?: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
