/**
 * useFinancialCalculations — retirement field-contract tests
 *
 * Regression guard for the story 5-12 code-review finding: the retirement input
 * field must be `monthlyIncome` (core's RetirementInput) consistently across the
 * form → hook → client → server chain. A mismatch (`desiredMonthlyIncome`)
 * previously made the server reject every real paid-tier retirement call while
 * the mocked unit/route tests stayed green. These tests exercise the hook across
 * the free and paid paths directly, so a future field drift fails CI.
 *
 * Note: since story 29.1 the retirement page computes live in the browser and no
 * longer calls this hook (RetirementForm, its only caller, was folded into the
 * consolidated planner). The hook and its `/api/calculations/retirement` route
 * still ship, and this contract guard is what keeps them honest.
 */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the server API client (dynamically imported by the hook's paid-tier path).
vi.mock('../../features/api/client', () => ({
  calculateRetirement: vi.fn(),
  calculateSafeWithdrawal: vi.fn(),
  calculateProjection: vi.fn(),
  calculateNetWorth: vi.fn(),
  calculateAggregation: vi.fn(),
}))

import { calculateRetirement as calculateRetirementServer } from '../../features/api/client'
import { useFinancialCalculations } from '../useFinancialCalculations'

describe('useFinancialCalculations — retirement field contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('free tier: computes a real result from a { monthlyIncome } input', async () => {
    // No session → tier falls back to the client-side calc (real @budget-planner/core).
    const { result } = renderHook(() => useFinancialCalculations())

    await act(async () => {
      await result.current.calculateRetirement({ monthlyIncome: 500000, annualReturnRate: 0.07 })
    })

    expect(result.current.retirement.isError).toBe(false)
    expect(result.current.retirement.isSuccess).toBe(true)
    // Assert the FULL RetirementResult shape — guards against a regression to the
    // bare-number `calculateRequiredAssets` (which made data.requiredAssets undefined).
    const data = result.current.retirement.data
    expect(data?.requiredAssets).toBeGreaterThan(0)
    expect(typeof data?.requiredAssetsFormatted).toBe('string')
    expect(data?.monthlyIncome).toBe(500000)
    expect(data?.annualReturnRate).toBe(0.07)
    expect(data?.annualReturnRatePercentage).toBeCloseTo(7)
  })

  it('free tier: surfaces a clean error state when the core calc throws (does not crash)', async () => {
    // rate 0 makes calculateRetirementRequirement throw; the hook must catch it
    // and set error state rather than propagate. (The form gates rate>0, but the
    // hook is the safety net for the free-tier throwing path the fix introduced.)
    const { result } = renderHook(() => useFinancialCalculations())

    await act(async () => {
      await result.current.calculateRetirement({ monthlyIncome: 500000, annualReturnRate: 0 })
    })

    expect(result.current.retirement.isError).toBe(true)
    expect(result.current.retirement.isSuccess).toBe(false)
    expect(result.current.retirement.data).toBeNull()
    expect(result.current.retirement.error).toBeTruthy()
  })

  it('paid tier: forwards the { monthlyIncome } shape to the server client', async () => {
    localStorage.setItem('paddle_user_session', JSON.stringify({ subscriptionStatus: 'active' }))
    ;(calculateRetirementServer as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      requiredAssets: 123,
      requiredAssetsFormatted: '$1.23',
      monthlyIncome: 500000,
      monthlyIncomeFormatted: '$5,000.00',
      annualReturnRate: 0.07,
      annualReturnRatePercentage: 7,
    })

    const { result } = renderHook(() => useFinancialCalculations())

    await act(async () => {
      await result.current.calculateRetirement({ monthlyIncome: 500000, annualReturnRate: 0.07 })
    })

    expect(calculateRetirementServer).toHaveBeenCalledWith({
      monthlyIncome: 500000,
      annualReturnRate: 0.07,
    })
    expect(result.current.retirement.isSuccess).toBe(true)
  })
})
