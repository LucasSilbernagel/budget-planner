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
import type { ApiResult } from '../../server/api/calculations/retirement'

/**
 * Calls the retirement calculation Server Function
 */
export async function calculateRetirement(
  input: RetirementInput
): Promise<RetirementResult> {
  // In TanStack Start, Server Functions are imported and called directly
  // This is a placeholder for the actual implementation
  const { calculateRetirementServer } = await import('../../server/api/calculations/retirement')
  const result = await calculateRetirementServer(input)
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate retirement requirement')
  }
  
  return result.data!
}

/**
 * Calls the safe withdrawal calculation Server Function
 */
export async function calculateSafeWithdrawal(
  assets: number,
  annualReturnRate: number
): Promise<number> {
  const { calculateSafeWithdrawalServer } = await import('../../server/api/calculations/retirement')
  const result = await calculateSafeWithdrawalServer(assets, annualReturnRate)
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate safe withdrawal')
  }
  
  return result.data!
}

/**
 * Calls the compounding projection Server Function
 */
export async function calculateProjection(
  input: CompoundingInput
): Promise<YearlyProjection[]> {
  const { calculateProjectionServer } = await import('../../server/api/calculations/retirement')
  const result = await calculateProjectionServer(input)
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate projection')
  }
  
  return result.data!
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
