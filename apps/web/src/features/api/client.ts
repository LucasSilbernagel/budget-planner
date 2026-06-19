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
  RetirementInput,
  RetirementResult,
  CompoundingInput,
  YearlyProjection,
} from '@budget-planner/core'
import type { FinancialApiResult, NetWorthProjectionInput, NetWorthProjectionResult, AggregationInput, AggregationResult } from '../../server/functions/financial'

/**
 * Calls the retirement calculation Server Function via HTTP
 * Uses the new TanStack Start Server Functions with authentication
 */
export async function calculateRetirement(
  input: RetirementInput
): Promise<RetirementResult> {
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
  
  if (!result.data) {
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
  
  if (!result.data) {
    throw new Error('Invalid response: safe withdrawal data is undefined')
  }
  
  return result.data
}

/**
 * Calls the compounding projection Server Function via HTTP
 * Uses the new TanStack Start Server Functions with authentication
 */
export async function calculateProjection(
  input: CompoundingInput
): Promise<YearlyProjection[]> {
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
  
  if (!result.data) {
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
  // Use the new TanStack Start Server Functions via the route defined in tanstack.config.ts
  // This will call netWorthProjection from ../../server/functions/financial
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
  
  if (!result.data) {
    throw new Error('Invalid response: net worth projection data is undefined')
  }
  
  return result.data
}

/**
 * Calls the complex aggregation Server Function
 */
export async function calculateAggregation(
  input: AggregationInput
): Promise<AggregationResult> {
  // Use the new TanStack Start Server Functions via the route defined in tanstack.config.ts
  // This will call complexAggregation from ../../server/functions/financial
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
  
  if (!result.data) {
    throw new Error('Invalid response: aggregation data is undefined')
  }
  
  return result.data
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
