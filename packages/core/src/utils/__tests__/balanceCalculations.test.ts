/**
 * Balance Calculations Tests
 * 
 * Unit tests for balance tracking calculation utilities.
 * Tests timeline calculation, progress calculation, and formatting functions.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateMonthsToLimit,
  formatTimeline,
  calculateProjectedBalance,
  calculateContributionProgress,
  formatProgress,
} from '../balanceCalculations'

describe('calculateMonthsToLimit', () => {
  // AC 6: Given maxContributionLimit = $5000 and monthlyContribution = $500,
  // when viewed, shows it will reach the limit in 10 months at current rate
  it('should calculate 10 months for $5000 limit with $500 monthly contribution from $0', () => {
    // $5000 = 500000 cents, $500 = 50000 cents
    const result = calculateMonthsToLimit(0, 500000, 50000)
    expect(result).toBe(10)
  })

  it('should return null when no limit is set', () => {
    const result = calculateMonthsToLimit(0, undefined, 50000)
    expect(result).toBeNull()
  })

  it('should return null when no monthly contribution is set', () => {
    const result = calculateMonthsToLimit(0, 500000, undefined)
    expect(result).toBeNull()
  })

  it('should return null when monthly contribution is zero', () => {
    const result = calculateMonthsToLimit(0, 500000, 0)
    expect(result).toBeNull()
  })

  it('should return null when monthly contribution is negative', () => {
    const result = calculateMonthsToLimit(0, 500000, -100)
    expect(result).toBeNull()
  })

  it('should return 0 when current balance equals limit', () => {
    const result = calculateMonthsToLimit(500000, 500000, 50000)
    expect(result).toBe(0)
  })

  it('should return 0 when current balance exceeds limit', () => {
    const result = calculateMonthsToLimit(600000, 500000, 50000)
    expect(result).toBe(0)
  })

  it('should calculate fractional months rounded up', () => {
    // $100 current, $200 limit, $150/month -> 1 month (200-100=100, 100/150=0.666..., ceil=1)
    const result = calculateMonthsToLimit(10000, 20000, 15000)
    expect(result).toBe(1)
  })

  it('should handle negative current balance (debt)', () => {
    // -$1000 current (debt), $0 limit, $500/month -> null (no positive limit to reach)
    const result = calculateMonthsToLimit(-100000, 0, 50000)
    expect(result).toBe(0)
  })

  it('should calculate correctly from non-zero starting point', () => {
    // $1000 current, $5000 limit, $500/month -> (5000-1000)/500 = 8 months
    const result = calculateMonthsToLimit(100000, 500000, 50000)
    expect(result).toBe(8)
  })
})

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

describe('calculateContributionProgress', () => {
  it('should return null when no limit is set', () => {
    const result = calculateContributionProgress(100000, undefined)
    expect(result).toBeNull()
  })

  it('should return null when limit is zero', () => {
    const result = calculateContributionProgress(100000, 0)
    expect(result).toBeNull()
  })

  it('should return null when limit is negative', () => {
    const result = calculateContributionProgress(100000, -100)
    expect(result).toBeNull()
  })

  it('should return 0% when current is 0', () => {
    const result = calculateContributionProgress(0, 100000)
    expect(result).toBe(0)
  })

  it('should return 50% when current is half of limit', () => {
    const result = calculateContributionProgress(50000, 100000)
    expect(result).toBe(50)
  })

  it('should return 100% when current equals limit', () => {
    const result = calculateContributionProgress(100000, 100000)
    expect(result).toBe(100)
  })

  it('should cap at 100% when current exceeds limit', () => {
    const result = calculateContributionProgress(150000, 100000)
    expect(result).toBe(100)
  })

  it('should handle fractional percentages rounded to nearest integer', () => {
    // 12345 / 100000 = 0.12345 = 12.345% -> 12%
    const result = calculateContributionProgress(12345, 100000)
    expect(result).toBe(12)
  })

  it('should handle large numbers', () => {
    // 500000 / 1000000 = 0.5 = 50%
    const result = calculateContributionProgress(500000, 1000000)
    expect(result).toBe(50)
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
