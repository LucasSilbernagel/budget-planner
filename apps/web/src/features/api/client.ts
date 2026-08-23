/**
 * API Client for Server Functions
 *
 * Client-side wrapper for calling TanStack Start Server Functions.
 * Provides type-safe API calls for financial calculations.
 *
 * Architecture: TanStack Start Server Functions with type-safe client
 */

// Note: In TanStack Start, Server Functions can be called directly from the client
// using the generated types. However, we create this wrapper for better organization
// and to handle errors consistently.

import type {
  CompoundingInput,
  RetirementInput,
  RetirementResult,
  YearlyProjection,
} from '@budget-planner/core'
import type { ProcessOperationResult, ServerChange, SyncOperation } from '@budget-planner/core/sync'
import type {
  AggregationInput,
  AggregationResult,
  FinancialApiResult,
  NetWorthProjectionInput,
  NetWorthProjectionResult,
} from '../../server/functions/financial'

/**
 * Calls the retirement calculation Server Function via HTTP
 * Uses the new TanStack Start Server Functions with authentication
 */
export async function calculateRetirement(input: RetirementInput): Promise<RetirementResult> {
  const response = await fetch('/api/calculations/retirement', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to calculate retirement requirement')
  }

  const result: FinancialApiResult<RetirementResult> = await response.json()

  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate retirement requirement')
  }

  if (result.data === undefined) {
    throw new Error('Invalid response: retirement calculation data is undefined')
  }

  return result.data
}

/**
 * Calls the safe withdrawal calculation Server Function via HTTP
 * Uses the new TanStack Start Server Functions with authentication
 */
export async function calculateSafeWithdrawal(
  assets: number,
  annualReturnRate: number
): Promise<number> {
  const response = await fetch('/api/calculations/withdrawal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ assets, annualReturnRate }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to calculate safe withdrawal')
  }

  const result: FinancialApiResult<number> = await response.json()

  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate safe withdrawal')
  }

  if (result.data === undefined) {
    throw new Error('Invalid response: safe withdrawal data is undefined')
  }

  return result.data
}

/**
 * Calls the compounding projection Server Function via HTTP
 * Uses the new TanStack Start Server Functions with authentication
 */
export async function calculateProjection(input: CompoundingInput): Promise<YearlyProjection[]> {
  const response = await fetch('/api/calculations/projection', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to calculate projection')
  }

  const result: FinancialApiResult<YearlyProjection[]> = await response.json()

  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate projection')
  }

  if (result.data === undefined) {
    throw new Error('Invalid response: projection data is undefined')
  }

  return result.data
}

/**
 * Calls the net worth projection Server Function
 */
export async function calculateNetWorth(
  input: NetWorthProjectionInput
): Promise<NetWorthProjectionResult> {
  // Served by the POST /api/calculations/net-worth route (story 5-12), which
  // invokes netWorthProjection from ../../server/functions/financial under the
  // TanStack Start runtime with the auth/premium gate enforced server-side.
  const response = await fetch('/api/calculations/net-worth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to calculate net worth projection')
  }

  const result: FinancialApiResult<NetWorthProjectionResult> = await response.json()

  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate net worth projection')
  }

  if (result.data === undefined) {
    throw new Error('Invalid response: net worth projection data is undefined')
  }

  return result.data
}

/**
 * Calls the complex aggregation Server Function
 */
export async function calculateAggregation(input: AggregationInput): Promise<AggregationResult> {
  // Served by the POST /api/calculations/aggregation route (story 5-12), which
  // invokes complexAggregation from ../../server/functions/financial under the
  // TanStack Start runtime with the auth/premium gate enforced server-side.
  const response = await fetch('/api/calculations/aggregation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to calculate aggregation')
  }

  const result: FinancialApiResult<AggregationResult> = await response.json()

  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate aggregation')
  }

  if (result.data === undefined) {
    throw new Error('Invalid response: aggregation data is undefined')
  }

  return result.data
}

/**
 * Pulls server-side entity changes since a cursor via HTTP (Story 4-18).
 *
 * Mirrors the calculations fetch+error-handling pattern and goes over HTTP to
 * the served GET /api/sync/changes route. It MUST NOT import the server function
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

  const result: { success: boolean; changes?: ServerChange[]; error?: string } =
    await response.json()

  if (!result.success) {
    throw new Error(result.error || 'Failed to fetch server changes')
  }

  return result.changes ?? []
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
}

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
    const errorData = (await response.json().catch(() => ({}))) as { error?: string }
    return {
      success: false,
      error: errorData.error || `Sync request failed (${response.status})`,
      // 429 (rate limit) and 5xx are transient; other 4xx are permanent.
      retryable: response.status === 429 || response.status >= 500,
      statusCode: response.status,
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
  // Server-side failure (validation/apply): a permanent reject — not retryable,
  // or the queue would replay the same rejected op forever.
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
