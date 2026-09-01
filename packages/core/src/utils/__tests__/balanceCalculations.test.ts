/**
 * Balance Calculations Tests
 *
 * Unit tests for balance tracking calculation utilities.
 * Tests timeline calculation, progress calculation, and formatting functions.
 */

import { describe, expect, it } from 'vitest'
import {
  calculateDebtMetrics,
  calculateProjectedBalance,
  formatProgress,
  formatTimeline,
} from '../balanceCalculations'

describe('formatTimeline', () => {
  it('should return "No limit set" for null input', () => {
    const result = formatTimeline(null)
    expect(result).toBe('No limit set')
  })

  it('should return "Limit reached" for 0 months', () => {
    const result = formatTimeline(0)
    expect(result).toBe('Limit reached')
  })

  it('should return singular "1 month to limit" for 1 month', () => {
    const result = formatTimeline(1)
    expect(result).toBe('1 month to limit')
  })

  it('should return plural "X months to limit" for multiple months', () => {
    const result = formatTimeline(10)
    expect(result).toBe('10 months to limit')
  })
})

describe('calculateProjectedBalance', () => {
  it('should return current balance for 0 months', () => {
    const result = calculateProjectedBalance(100000, 10000, 0)
    expect(result).toBe(100000)
  })

  it('should calculate positive projection', () => {
    // $1000 + $500/month * 5 months = $3500
    const result = calculateProjectedBalance(100000, 50000, 5)
    expect(result).toBe(350000)
  })

  it('should calculate negative projection (debt reduction)', () => {
    // -$1000 - $500/month * 5 months = -$3500
    const result = calculateProjectedBalance(-100000, -50000, 5)
    expect(result).toBe(-350000)
  })

  it('should return current balance for negative months', () => {
    const result = calculateProjectedBalance(100000, 10000, -5)
    expect(result).toBe(100000)
  })
})

describe('formatProgress', () => {
  it('should return "No limit" for null input', () => {
    const result = formatProgress(null)
    expect(result).toBe('No limit')
  })

  it('should format percentage with % sign', () => {
    const result = formatProgress(50)
    expect(result).toBe('50%')
  })

  it('should format 0%', () => {
    const result = formatProgress(0)
    expect(result).toBe('0%')
  })

  it('should format 100%', () => {
    const result = formatProgress(100)
    expect(result).toBe('100%')
  })
})

// ============================================================================
// Edge Case Tests - Addressing code review findings
// ============================================================================

describe('Edge Case Handling - calculateProjectedBalance', () => {
  it('should return currentBalance for NaN currentBalance', () => {
    const result = calculateProjectedBalance(NaN, 10000, 5)
    expect(result).toBe(NaN)
  })

  it('should return currentBalance for Infinity currentBalance', () => {
    const result = calculateProjectedBalance(Infinity, 10000, 5)
    expect(result).toBe(Infinity)
  })

  it('should return currentBalance for NaN monthlyContribution', () => {
    const result = calculateProjectedBalance(100000, NaN, 5)
    expect(result).toBe(100000)
  })

  it('should return currentBalance for Infinity monthlyContribution', () => {
    const result = calculateProjectedBalance(100000, Infinity, 5)
    expect(result).toBe(100000)
  })

  it('should return currentBalance for NaN months', () => {
    const result = calculateProjectedBalance(100000, 10000, NaN)
    expect(result).toBe(100000)
  })

  it('should return currentBalance for Infinity months', () => {
    const result = calculateProjectedBalance(100000, 10000, Infinity)
    expect(result).toBe(100000)
  })

  it('should handle arithmetic overflow gracefully', () => {
    const result = calculateProjectedBalance(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100)
    expect(result).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('Debt-Specific Calculations', () => {
  describe('calculateDebtMetrics for credit-card', () => {
    /**
     * ⚠️ Story 49.1 (FR75). These two tests previously asserted a UTILISATION
     * percentage computed against `maxContributionLimit`, which this function was
     * borrowing as a credit limit. That field is gone, so utilisation is gone with
     * it — a credit-card row now reports its payoff TIMELINE and no progress.
     *
     * The tests are NARROWED rather than deleted: the timeline half is the part
     * that was never about the limit, and dropping it would silently retire the
     * only coverage of the no-payment branch.
     */
    it('reports the payoff timeline, and no progress without a recorded limit', () => {
      const result = calculateDebtMetrics(
        -100000, // -$1,000 owed
        50000, // $500/month payment
        'credit-card'
      )
      expect(result.progress).toBeNull()
      expect(result.progressLabel).toBe('No limit')
      expect(result.timeline).toBe(2) // 100000/50000 = 2 months
      expect(result.timelineLabel).toBe('2 months to pay off')
    })

    it('should handle credit card with no payment', () => {
      const result = calculateDebtMetrics(-100000, undefined, 'credit-card')
      expect(result.progress).toBeNull()
      expect(result.timeline).toBeNull()
      expect(result.timelineLabel).toBe('No payment set')
    })
  })

  describe('calculateDebtMetrics for mortgage', () => {
    it('should calculate payoff percentage with originalBalance', () => {
      const result = calculateDebtMetrics(
        -180000, // -$18,000 owed
        50000, // $500/month payment
        'mortgage',
        200000 // Original balance
      )
      // Paid off: 200000 - 180000 = 20000
      // Progress: 20000/200000 * 100 = 10%
      expect(result.progress).toBe(10)
      expect(result.progressLabel).toBe('10% paid off')
      expect(result.timeline).toBe(4) // 180000/50000 = 3.6 -> 4 months
      expect(result.timelineLabel).toBe('4 months to pay off')
    })

    it('should handle mortgage without originalBalance', () => {
      const result = calculateDebtMetrics(
        -180000,
        50000,
        'mortgage'
        // No originalBalance provided
      )
      expect(result.progress).toBeNull()
      expect(result.timeline).toBe(4)
      expect(result.timelineLabel).toBe('4 months to pay off')
    })
  })

  describe('calculateDebtMetrics with invalid inputs', () => {
    it('should handle NaN inputs gracefully', () => {
      const result = calculateDebtMetrics(NaN, 50000, 'credit-card')
      expect(result.progress).toBeNull()
      expect(result.progressLabel).toBe('Invalid data')
      expect(result.timeline).toBeNull()
      expect(result.timelineLabel).toBe('Invalid data')
    })

    it('should handle Infinity inputs gracefully', () => {
      const result = calculateDebtMetrics(Infinity, 50000, 'credit-card')
      expect(result.progress).toBeNull()
      expect(result.progressLabel).toBe('Invalid data')
      expect(result.timeline).toBeNull()
      expect(result.timelineLabel).toBe('Invalid data')
    })
  })
})
