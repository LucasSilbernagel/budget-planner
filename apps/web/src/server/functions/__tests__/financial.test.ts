/**
 * Financial Server Functions Tests
 *
 * Unit tests for financial calculation server functions.
 * Tests validate calculation logic, parameter validation, and error handling.
 *
 * Note: These tests use mock Request objects since server functions require authentication.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the authentication function.
// Path is relative to this test file (server/functions/__tests__/), so it must
// resolve to server/api/auth/paddle — the exact module financial.ts imports —
// otherwise the mock fails to intercept and the real session lookup runs.
vi.mock('../../api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(),
}))

// Mock the core calculation functions
vi.mock('@budget-planner/core', () => ({
  calculateRetirementRequirement: vi.fn(),
  calculateSafeMonthlyWithdrawal: vi.fn(),
  calculateCompoundingProjection: vi.fn(),
}))

import {
  calculateCompoundingProjection,
  calculateRetirementRequirement,
  calculateSafeMonthlyWithdrawal,
} from '@budget-planner/core'
// Import after mocking
import { getCurrentUserSession } from '../../api/auth/paddle'
import {
  complexAggregation,
  compoundingProjection,
  netWorthProjection,
  retirementCalculation,
  safeWithdrawalCalculation,
} from '../financial'

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Create a mock Request object for testing
 */
function createMockRequest(userData: any = null): Request {
  const mockRequest = {
    json: vi.fn().mockResolvedValue({}),
    headers: new Headers(),
  } as unknown as Request

  // Mock getCurrentUserSession based on userData
  if (userData) {
    ;(getCurrentUserSession as vi.Mock).mockResolvedValue({
      success: true,
      data: userData,
    })
  } else {
    ;(getCurrentUserSession as vi.Mock).mockResolvedValue({
      success: false,
      error: 'No user session',
    })
  }

  return mockRequest
}

/**
 * Create a mock paid user
 */
function createMockPaidUser() {
  return {
    id: 1,
    email: 'test@example.com',
    subscriptionStatus: 'active',
  }
}

/**
 * Create a mock free user (no subscription)
 */
function createMockFreeUser() {
  return {
    id: 1,
    email: 'test@example.com',
    subscriptionStatus: 'inactive',
  }
}

// ============================================================================
// Test: retirementCalculation
// ============================================================================

describe('retirementCalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject unauthenticated requests', async () => {
    const mockRequest = createMockRequest(null)
    const input = { monthlyIncome: 5000, annualReturnRate: 0.07 }

    const result = await retirementCalculation(mockRequest, input)

    expect(result.success).toBe(false)
    // getAuthenticatedUser surfaces the underlying session error verbatim; the
    // mocked unauthenticated session reports 'No user session'.
    expect(result.error).toContain('No user session')
  })

  it('should reject free tier users', async () => {
    const mockRequest = createMockRequest(createMockFreeUser())
    const input = { monthlyIncome: 5000, annualReturnRate: 0.07 }

    const result = await retirementCalculation(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Premium feature')
  })

  it('should reject missing required parameters', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    // Omit monthlyIncome entirely to exercise the missing-params branch.
    const input = { annualReturnRate: 0.07 } as any

    const result = await retirementCalculation(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing required parameters')
  })

  it('should reject negative income', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = { monthlyIncome: -1000, annualReturnRate: 0.07 }

    const result = await retirementCalculation(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Desired monthly income must be positive')
  })

  it('should reject invalid return rate (zero)', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = { monthlyIncome: 5000, annualReturnRate: 0 }

    const result = await retirementCalculation(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Annual return rate must be between 0 and 1')
  })

  it('should reject invalid return rate (>= 1)', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = { monthlyIncome: 5000, annualReturnRate: 1.5 }

    const result = await retirementCalculation(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Annual return rate must be between 0 and 1')
  })

  it('should call core function with valid input', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = { monthlyIncome: 5000, annualReturnRate: 0.07 }

    const mockResult = { requiredAssets: 857142.86 }
    ;(calculateRetirementRequirement as vi.Mock).mockReturnValue(mockResult)

    const result = await retirementCalculation(mockRequest, input)

    expect(result.success).toBe(true)
    expect(result.data).toEqual(mockResult)
    expect(calculateRetirementRequirement).toHaveBeenCalledWith(input)
  })
})

// ============================================================================
// Test: safeWithdrawalCalculation
// ============================================================================

describe('safeWithdrawalCalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject unauthenticated requests', async () => {
    const mockRequest = createMockRequest(null)

    const result = await safeWithdrawalCalculation(mockRequest, 1000000, 0.07)

    expect(result.success).toBe(false)
    // getAuthenticatedUser surfaces the underlying session error verbatim; the
    // mocked unauthenticated session reports 'No user session'.
    expect(result.error).toContain('No user session')
  })

  it('should reject negative asset value', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())

    const result = await safeWithdrawalCalculation(mockRequest, -1000, 0.07)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Asset value cannot be negative')
  })

  it('should call core function with valid input', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const assets = 1000000
    const annualReturnRate = 0.07
    const expectedResult = 7000
    ;(calculateSafeMonthlyWithdrawal as vi.Mock).mockReturnValue(expectedResult)

    const result = await safeWithdrawalCalculation(mockRequest, assets, annualReturnRate)

    expect(result.success).toBe(true)
    expect(result.data).toBe(expectedResult)
    expect(calculateSafeMonthlyWithdrawal).toHaveBeenCalledWith(assets, annualReturnRate)
  })
})

// ============================================================================
// Test: compoundingProjection
// ============================================================================

describe('compoundingProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject unauthenticated requests', async () => {
    const mockRequest = createMockRequest(null)
    const input = { principal: 10000, annualReturnRate: 0.07, years: 30 }

    const result = await compoundingProjection(mockRequest, input)

    expect(result.success).toBe(false)
    // getAuthenticatedUser surfaces the underlying session error verbatim; the
    // mocked unauthenticated session reports 'No user session'.
    expect(result.error).toContain('No user session')
  })

  it('should reject missing required parameters', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    // Omit principal entirely to exercise the missing-params branch.
    const input = { annualReturnRate: 0.07, years: 30 } as any

    const result = await compoundingProjection(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing required parameters')
  })

  it('should reject negative principal', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = { principal: -1000, annualReturnRate: 0.07, years: 30 }

    const result = await compoundingProjection(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Principal cannot be negative')
  })

  it('should reject negative return rate', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = { principal: 10000, annualReturnRate: -0.07, years: 30 }

    const result = await compoundingProjection(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Return rate cannot be negative')
  })

  it('should reject non-positive time horizon', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = { principal: 10000, annualReturnRate: 0.07, years: 0 }

    const result = await compoundingProjection(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Time horizon must be positive')
  })

  it('should call core function with valid input', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = { principal: 10000, annualReturnRate: 0.07, years: 30 }
    const mockResult = [{ year: 0, value: 10000 }]
    ;(calculateCompoundingProjection as vi.Mock).mockReturnValue(mockResult)

    const result = await compoundingProjection(mockRequest, input)

    expect(result.success).toBe(true)
    expect(result.data).toEqual(mockResult)
    expect(calculateCompoundingProjection).toHaveBeenCalledWith(input)
  })
})

// ============================================================================
// Test: netWorthProjection
// ============================================================================

describe('netWorthProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject unauthenticated requests', async () => {
    const mockRequest = createMockRequest(null)
    const input = {
      currentAssets: 100000,
      currentLiabilities: 50000,
      monthlySavings: 1000,
      expectedReturnRate: 0.07,
      timeHorizonYears: 30,
    }

    const result = await netWorthProjection(mockRequest, input)

    expect(result.success).toBe(false)
    // getAuthenticatedUser surfaces the underlying session error verbatim; the
    // mocked unauthenticated session reports 'No user session'.
    expect(result.error).toContain('No user session')
  })

  it('should reject non-positive time horizon', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      currentAssets: 100000,
      currentLiabilities: 50000,
      monthlySavings: 1000,
      expectedReturnRate: 0.07,
      timeHorizonYears: 0,
    }

    const result = await netWorthProjection(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Time horizon must be positive')
  })

  it('should reject invalid return rate', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      currentAssets: 100000,
      currentLiabilities: 50000,
      monthlySavings: 1000,
      expectedReturnRate: 1.5,
      timeHorizonYears: 30,
    }

    const result = await netWorthProjection(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Return rate must be between 0 and 1')
  })

  it('should calculate net worth projection correctly', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      currentAssets: 10000000, // $100,000 in cents
      currentLiabilities: 0,
      monthlySavings: 100000, // $1,000/month in cents
      expectedReturnRate: 0.07, // 7%
      timeHorizonYears: 1,
    }

    const result = await netWorthProjection(mockRequest, input)

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data?.yearlyProjections).toHaveLength(2) // Year 0 and year 1
    expect(result.data?.finalNetWorth).toBeGreaterThan(input.currentAssets)
  })
})

// ============================================================================
// Test: complexAggregation
// ============================================================================

describe('complexAggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject unauthenticated requests', async () => {
    const mockRequest = createMockRequest(null)
    const input = {
      values: [100, 200, 300],
      operation: 'sum',
    }

    const result = await complexAggregation(mockRequest, input)

    expect(result.success).toBe(false)
    // getAuthenticatedUser surfaces the underlying session error verbatim; the
    // mocked unauthenticated session reports 'No user session'.
    expect(result.error).toContain('No user session')
  })

  it('should reject empty values array', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      values: [],
      operation: 'sum',
    }

    const result = await complexAggregation(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Values array must not be empty')
  })

  it('should reject invalid operation', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      values: [100, 200, 300],
      operation: 'invalid' as any,
    }

    const result = await complexAggregation(mockRequest, input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid operation')
  })

  it('should calculate sum correctly', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      values: [100, 200, 300],
      operation: 'sum',
    }

    const result = await complexAggregation(mockRequest, input)

    expect(result.success).toBe(true)
    expect(result.data?.result).toBe(600)
    expect(result.data?.operation).toBe('sum')
    expect(result.data?.count).toBe(3)
  })

  it('should calculate average correctly', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      values: [100, 200, 300],
      operation: 'average',
    }

    const result = await complexAggregation(mockRequest, input)

    expect(result.success).toBe(true)
    expect(result.data?.result).toBe(200)
    expect(result.data?.operation).toBe('average')
  })

  it('should calculate max correctly', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      values: [100, 200, 300],
      operation: 'max',
    }

    const result = await complexAggregation(mockRequest, input)

    expect(result.success).toBe(true)
    expect(result.data?.result).toBe(300)
  })

  it('should calculate min correctly', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      values: [100, 200, 300],
      operation: 'min',
    }

    const result = await complexAggregation(mockRequest, input)

    expect(result.success).toBe(true)
    expect(result.data?.result).toBe(100)
  })

  it('should calculate median correctly for odd number of values', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      values: [100, 200, 300],
      operation: 'median',
    }

    const result = await complexAggregation(mockRequest, input)

    expect(result.success).toBe(true)
    expect(result.data?.result).toBe(200)
  })

  it('should calculate median correctly for even number of values', async () => {
    const mockRequest = createMockRequest(createMockPaidUser())
    const input = {
      values: [100, 200, 300, 400],
      operation: 'median',
    }

    const result = await complexAggregation(mockRequest, input)

    expect(result.success).toBe(true)
    expect(result.data?.result).toBe(250)
  })
})
