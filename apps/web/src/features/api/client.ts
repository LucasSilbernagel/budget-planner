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
import type { ServerChange } from '@budget-planner/core/sync'
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
 * Generic API error class
 */
export class ApiError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode?: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
