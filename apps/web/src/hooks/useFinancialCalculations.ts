/**
 * useFinancialCalculations Hook
 * 
 * React hook for accessing server-side financial calculation functions.
 * Provides type-safe access to TanStack Start Server Functions for paid tier users.
 * Falls back to client-side calculations for free tier users.
 * 
 * Architecture: React Hook with TanStack Start Server Functions
 */

import { useState, useCallback } from 'react'
import type {
  RetirementInput,
  RetirementResult,
  CompoundingInput,
  YearlyProjection,
} from '@budget-planner/core'
import type {
  FinancialApiResult,
  NetWorthProjectionInput,
  NetWorthProjectionResult,
  AggregationInput,
  AggregationResult,
} from '../server/functions/financial'
import {
  calculateRequiredAssets,
  calculateSafeMonthlyWithdrawal as calculateSafeMonthlyWithdrawalClient,
  calculateCompoundingProjection as calculateCompoundingProjectionClient,
} from '@budget-planner/core/finance'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Loading state for a calculation
 */
export interface CalculationState<T> {
  data: T | null
  error: string | null
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
}

/**
 * Initial state for calculations
 */
const initialState = <T,>(): CalculationState<T> => ({
  data: null,
  error: null,
  isLoading: false,
  isSuccess: false,
  isError: false,
})

/**
 * Tier detection for feature availability
 */
export type UserTier = 'free' | 'paid' | 'unknown'

/**
 * Result type for useFinancialCalculations hook
 */
export interface UseFinancialCalculationsResult {
  // State for each calculation type
  retirement: CalculationState<RetirementResult>
  withdrawal: CalculationState<number>
  projection: CalculationState<YearlyProjection[]>
  netWorth: CalculationState<NetWorthProjectionResult>
  aggregation: CalculationState<AggregationResult>
  
  // Tier information
  tier: UserTier
  isPaidTier: boolean
  
  // Calculation functions
  calculateRetirement: (input: RetirementInput) => Promise<void>
  calculateWithdrawal: (assets: number, annualReturnRate: number) => Promise<void>
  calculateProjection: (input: CompoundingInput) => Promise<void>
  calculateNetWorth: (input: NetWorthProjectionInput) => Promise<void>
  calculateAggregation: (input: AggregationInput) => Promise<void>
  
  // Reset functions
  resetRetirement: () => void
  resetWithdrawal: () => void
  resetProjection: () => void
  resetNetWorth: () => void
  resetAggregation: () => void
  resetAll: () => void
}

// ============================================================================
// Tier Detection
// ============================================================================

/**
 * Detect user tier based on authentication status
 * For now, this is a placeholder that checks if there's an active session
 * In production, this would integrate with the authentication system
 */
function detectUserTier(): UserTier {
  // SSR guard: only access localStorage on the client
  if (typeof window === 'undefined') {
    return 'unknown'
  }
  
  // Check for user session in localStorage (for client-side detection)
  try {
    const userSession = localStorage.getItem('paddle_user_session')
    
    // SSR guard: JSON.parse can throw if userSession is malformed
    const userData = userSession ? JSON.parse(userSession) : null
    
    if (userData && userData.subscriptionStatus === 'active') {
      return 'paid'
    }
    
    // If there's a user but no active subscription, it's free tier
    if (userData) {
      return 'free'
    }
  } catch (error) {
    // Ignore errors in localStorage access or JSON parsing
    // Note: In production, consider using a proper logger
  }
  
  return 'unknown'
}

// ============================================================================
// Client-Side Fallback Functions
// ============================================================================

/**
 * Client-side retirement calculation fallback
 * Uses the Safe Withdrawal Model: FV = Ir × (12 / r)
 */
function calculateRetirementClient(input: RetirementInput): RetirementResult {
  // Use the existing core function which implements the Safe Withdrawal Model
  return calculateRequiredAssets(input.desiredMonthlyIncome, input.annualReturnRate)
}

/**
 * Client-side compounding projection fallback
 */
function calculateProjectionClient(input: CompoundingInput): YearlyProjection[] {
  return calculateCompoundingProjectionClient({
    principal: input.principal,
    annualReturnRate: input.annualReturnRate,
    years: input.years,
    monthlyContribution: input.monthlyContribution || 0,
  })
}

/**
 * Client-side net worth projection
 */
function calculateNetWorthClient(input: NetWorthProjectionInput): NetWorthProjectionResult {
  const yearlyProjections: NetWorthProjectionResult['yearlyProjections'] = []
  let assets = input.currentAssets / 100
  let liabilities = input.currentLiabilities / 100
  const monthlySavings = input.monthlySavings / 100
  
  for (let year = 0; year <= input.timeHorizonYears; year++) {
    const netWorth = assets - liabilities
    
    yearlyProjections.push({
      year,
      assets: Math.round(assets * 100),
      liabilities: Math.round(liabilities * 100),
      netWorth: Math.round(netWorth * 100),
    })
    
    assets *= (1 + input.expectedReturnRate)
    assets += monthlySavings * 12
  }
  
  return {
    yearlyProjections,
    finalNetWorth: yearlyProjections[yearlyProjections.length - 1]?.netWorth || 0,
  }
}

/**
 * Client-side aggregation fallback
 */
function calculateAggregationClient(input: AggregationInput): AggregationResult {
  const sortedValues = [...input.values].sort((a, b) => a - b)
  let result: number
  
  switch (input.operation) {
    case 'sum':
      result = input.values.reduce((acc, val) => acc + val, 0)
      break
    case 'average':
      result = input.values.reduce((acc, val) => acc + val, 0) / input.values.length
      break
    case 'median':
      const mid = Math.floor(sortedValues.length / 2)
      result = sortedValues.length % 2 !== 0
        ? sortedValues[mid]
        : (sortedValues[mid - 1] + sortedValues[mid]) / 2
      break
    case 'max':
      result = Math.max(...input.values)
      break
    case 'min':
      result = Math.min(...input.values)
      break
    default:
      result = 0
  }
  
  return {
    result,
    operation: input.operation,
    count: input.values.length,
  }
}

// ============================================================================
// Server Function Callers
// ============================================================================

/**
 * Call retirement calculation server function
 */
async function callRetirementServer(input: RetirementInput): Promise<RetirementResult> {
  const { calculateRetirement } = await import('../features/api/client')
  return calculateRetirement(input)
}

/**
 * Call withdrawal calculation server function
 */
async function callWithdrawalServer(assets: number, annualReturnRate: number): Promise<number> {
  const { calculateSafeWithdrawal } = await import('../features/api/client')
  return calculateSafeWithdrawal(assets, annualReturnRate)
}

/**
 * Call projection calculation server function
 */
async function callProjectionServer(input: CompoundingInput): Promise<YearlyProjection[]> {
  const { calculateProjection } = await import('../features/api/client')
  return calculateProjection(input)
}

/**
 * Call net worth calculation server function
 */
async function callNetWorthServer(input: NetWorthProjectionInput): Promise<NetWorthProjectionResult> {
  const { calculateNetWorth } = await import('../features/api/client')
  return calculateNetWorth(input)
}

/**
 * Call aggregation calculation server function
 */
async function callAggregationServer(input: AggregationInput): Promise<AggregationResult> {
  const { calculateAggregation } = await import('../features/api/client')
  return calculateAggregation(input)
}

// ============================================================================
// Main Hook Implementation
// ============================================================================

/**
 * useFinancialCalculations Hook
 * 
 * Provides access to financial calculation functions with automatic tier detection.
 * Paid tier users get server-side calculations with persistence.
 * Free tier users get client-side calculations.
 * 
 * @returns Object with calculation functions and state
 * 
 * @example
 * ```tsx
 * const { calculateRetirement, retirement } = useFinancialCalculations()
 * 
 * const handleCalculate = async () => {
 *   await calculateRetirement({ desiredMonthlyIncome: 5000, annualReturnRate: 0.07 })
 * }
 * 
 * if (retirement.isLoading) return <Spinner />
 * if (retirement.error) return <Error message={retirement.error} />
 * return <Result data={retirement.data} />
 * ```
 */
export function useFinancialCalculations(): UseFinancialCalculationsResult {
  // Tier detection
  const tier = detectUserTier()
  const isPaidTier = tier === 'paid'
  
  // State for each calculation type
  const [retirementState, setRetirementState] = useState<CalculationState<RetirementResult>>(initialState())
  const [withdrawalState, setWithdrawalState] = useState<CalculationState<number>>(initialState())
  const [projectionState, setProjectionState] = useState<CalculationState<YearlyProjection[]>>(initialState())
  const [netWorthState, setNetWorthState] = useState<CalculationState<NetWorthProjectionResult>>(initialState())
  const [aggregationState, setAggregationState] = useState<CalculationState<AggregationResult>>(initialState())
  
  // Retirement calculation
  const calculateRetirement = useCallback(async (input: RetirementInput) => {
    setRetirementState({ ...initialState(), isLoading: true })
    
    try {
      const result = isPaidTier
        ? await callRetirementServer(input)
        : calculateRetirementClient(input)
      
      setRetirementState({
        data: result,
        error: null,
        isLoading: false,
        isSuccess: true,
        isError: false,
      })
    } catch (error) {
      setRetirementState({
        data: null,
        error: error instanceof Error ? error.message : 'Failed to calculate retirement requirement',
        isLoading: false,
        isSuccess: false,
        isError: true,
      })
    }
  }, [isPaidTier])
  
  // Withdrawal calculation
  const calculateWithdrawal = useCallback(async (assets: number, annualReturnRate: number) => {
    setWithdrawalState({ ...initialState(), isLoading: true })
    
    try {
      const result = isPaidTier
        ? await callWithdrawalServer(assets, annualReturnRate)
        : calculateSafeMonthlyWithdrawalClient(assets, annualReturnRate)
      
      setWithdrawalState({
        data: result,
        error: null,
        isLoading: false,
        isSuccess: true,
        isError: false,
      })
    } catch (error) {
      setWithdrawalState({
        data: null,
        error: error instanceof Error ? error.message : 'Failed to calculate safe withdrawal',
        isLoading: false,
        isSuccess: false,
        isError: true,
      })
    }
  }, [isPaidTier])
  
  // Projection calculation
  const calculateProjection = useCallback(async (input: CompoundingInput) => {
    setProjectionState({ ...initialState(), isLoading: true })
    
    try {
      const result = isPaidTier
        ? await callProjectionServer(input)
        : calculateProjectionClient(input)
      
      setProjectionState({
        data: result,
        error: null,
        isLoading: false,
        isSuccess: true,
        isError: false,
      })
    } catch (error) {
      setProjectionState({
        data: null,
        error: error instanceof Error ? error.message : 'Failed to calculate projection',
        isLoading: false,
        isSuccess: false,
        isError: true,
      })
    }
  }, [isPaidTier])
  
  // Net worth calculation
  const calculateNetWorth = useCallback(async (input: NetWorthProjectionInput) => {
    setNetWorthState({ ...initialState(), isLoading: true })
    
    try {
      const result = isPaidTier
        ? await callNetWorthServer(input)
        : calculateNetWorthClient(input)
      
      setNetWorthState({
        data: result,
        error: null,
        isLoading: false,
        isSuccess: true,
        isError: false,
      })
    } catch (error) {
      setNetWorthState({
        data: null,
        error: error instanceof Error ? error.message : 'Failed to calculate net worth projection',
        isLoading: false,
        isSuccess: false,
        isError: true,
      })
    }
  }, [isPaidTier])
  
  // Aggregation calculation
  const calculateAggregation = useCallback(async (input: AggregationInput) => {
    setAggregationState({ ...initialState(), isLoading: true })
    
    try {
      const result = isPaidTier
        ? await callAggregationServer(input)
        : calculateAggregationClient(input)
      
      setAggregationState({
        data: result,
        error: null,
        isLoading: false,
        isSuccess: true,
        isError: false,
      })
    } catch (error) {
      setAggregationState({
        data: null,
        error: error instanceof Error ? error.message : 'Failed to calculate aggregation',
        isLoading: false,
        isSuccess: false,
        isError: true,
      })
    }
  }, [isPaidTier])
  
  // Reset functions
  const resetRetirement = useCallback(() => setRetirementState(initialState()), [])
  const resetWithdrawal = useCallback(() => setWithdrawalState(initialState()), [])
  const resetProjection = useCallback(() => setProjectionState(initialState()), [])
  const resetNetWorth = useCallback(() => setNetWorthState(initialState()), [])
  const resetAggregation = useCallback(() => setAggregationState(initialState()), [])
  const resetAll = useCallback(() => {
    resetRetirement()
    resetWithdrawal()
    resetProjection()
    resetNetWorth()
    resetAggregation()
  }, [resetRetirement, resetWithdrawal, resetProjection, resetNetWorth, resetAggregation])
  
  return {
    // State
    retirement: retirementState,
    withdrawal: withdrawalState,
    projection: projectionState,
    netWorth: netWorthState,
    aggregation: aggregationState,
    
    // Tier info
    tier,
    isPaidTier,
    
    // Calculation functions
    calculateRetirement,
    calculateWithdrawal,
    calculateProjection,
    calculateNetWorth,
    calculateAggregation,
    
    // Reset functions
    resetRetirement,
    resetWithdrawal,
    resetProjection,
    resetNetWorth,
    resetAggregation,
    resetAll,
  }
}

// ============================================================================
// Index Export
// ============================================================================

export type {
  NetWorthProjectionInput,
  NetWorthProjectionResult,
  AggregationInput,
  AggregationResult,
} from '../server/functions/financial'
