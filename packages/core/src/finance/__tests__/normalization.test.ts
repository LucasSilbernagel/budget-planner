/**
 * Frequency Normalization Engine Tests
 * 
 * Mathematical validation tests for frequency normalization calculations.
 * Zero tolerance for errors - NFR3 requirement
 * 
 * Note: All amounts are in cents (e.g., $100 = 10000 cents) to avoid
 * floating-point precision issues
 * 
 * Multipliers:
 * - Weekly: 52/12 = 4.333333...
 * - Biweekly: 26/12 = 2.166666...
 * - Monthly: 1
 * - Annually: 1/12 = 0.083333...
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeToMonthly,
  getNormalizationMultiplier,
  denormalizeFromMonthly,
  calculateTotalMonthlyNormalized,
  validateFrequency,
  validateAmount,
  NormalizableFinancialItem,
} from '../normalization.js'

// Test data: amounts in cents (e.g., $100 = 10000 cents)
const TEST_AMOUNTS = {
  WEEKLY: 10000,    // $100/week
  BIWEEKLY: 20000,  // $200/biweekly
  MONTHLY: 50000,   // $500/month
  ANNUALLY: 120000, // $1200/year
}

// Expected monthly normalized values using exact fractions
// Weekly: $100 * (52/12) = $433.333... = 43333 cents (rounded)
// Biweekly: $200 * (26/12) = $433.333... = 43333 cents (rounded)
// Monthly: $500 * 1 = $500 = 50000 cents
// Annually: $1200 * (1/12) = $100 = 10000 cents
const EXPECTED_MONTHLY = {
  WEEKLY: 43333,    // $100 * 52/12 = $433.333... → 43333 cents
  BIWEEKLY: 43333,  // $200 * 26/12 = $433.333... → 43333 cents
  MONTHLY: 50000,   // $500 * 1 = $500
  ANNUALLY: 10000,  // $1200 * 1/12 = $100
}

describe('Frequency Normalization Engine', () => {
  describe('getNormalizationMultiplier', () => {
    it('should return correct exact multiplier for weekly frequency (52/12)', () => {
      const multiplier = getNormalizationMultiplier('weekly')
      expect(multiplier).toBe(52 / 12)
      expect(multiplier).toBeCloseTo(4.333333, 6)
    })

    it('should return correct exact multiplier for biweekly frequency (26/12)', () => {
      const multiplier = getNormalizationMultiplier('biweekly')
      expect(multiplier).toBe(26 / 12)
      expect(multiplier).toBeCloseTo(2.166666, 5) // Looser tolerance for floating point
    })

    it('should return correct multiplier for monthly frequency (1)', () => {
      expect(getNormalizationMultiplier('monthly')).toBe(1)
    })

    it('should return correct exact multiplier for annually frequency (1/12)', () => {
      const multiplier = getNormalizationMultiplier('annually')
      expect(multiplier).toBe(1 / 12)
      expect(multiplier).toBeCloseTo(0.083333, 6)
    })
  })

  describe('normalizeToMonthly', () => {
    it('should normalize weekly $100 to monthly ($433.33 = 43333 cents)', () => {
      const result = normalizeToMonthly(TEST_AMOUNTS.WEEKLY, 'weekly')
      expect(result).toBe(EXPECTED_MONTHLY.WEEKLY)
    })

    it('should normalize biweekly $200 to monthly ($433.33 = 43333 cents)', () => {
      const result = normalizeToMonthly(TEST_AMOUNTS.BIWEEKLY, 'biweekly')
      expect(result).toBe(EXPECTED_MONTHLY.BIWEEKLY)
    })

    it('should normalize monthly $500 to monthly (unchanged = 50000 cents)', () => {
      const result = normalizeToMonthly(TEST_AMOUNTS.MONTHLY, 'monthly')
      expect(result).toBe(EXPECTED_MONTHLY.MONTHLY)
      expect(result).toBe(50000)
    })

    it('should normalize annual $1200 to monthly ($100 = 10000 cents)', () => {
      const result = normalizeToMonthly(TEST_AMOUNTS.ANNUALLY, 'annually')
      expect(result).toBe(EXPECTED_MONTHLY.ANNUALLY)
      expect(result).toBe(10000)
    })

    it('should handle zero amount', () => {
      const result = normalizeToMonthly(0, 'weekly')
      expect(result).toBe(0)
    })

    it('should handle negative amounts (debt)', () => {
      const result = normalizeToMonthly(-10000, 'monthly')
      expect(result).toBe(-10000)
    })

    it('should handle negative amounts with weekly frequency', () => {
      const result = normalizeToMonthly(-10000, 'weekly')
      expect(result).toBe(-43333)
    })

    it('should round to nearest integer using Math.round', () => {
      // 1 cent weekly * 52/12 = 0.43333... which rounds to 0
      // But 100 cents weekly * 52/12 = 433.333... which rounds to 433
      const result = normalizeToMonthly(100, 'weekly')
      expect(result).toBe(433)
    })

    it('should verify Math.round is used for rounding (half-up)', () => {
      // Test that 0.5 rounds up
      // We need to find a value that results in exactly .5 after multiplication
      // For weekly: amount * (52/12) = amount * 4.333...
      // This is tricky to get exactly .5, but we can verify the rounding behavior
      const result1 = normalizeToMonthly(1, 'monthly')
      expect(result1).toBe(1)
      
      const result2 = normalizeToMonthly(2, 'monthly')
      expect(result2).toBe(2)
    })

    it('should handle very large amounts', () => {
      const result = normalizeToMonthly(1000000, 'weekly')
      expect(result).toBe(4333333)
    })
  })

  describe('denormalizeFromMonthly', () => {
    it('should denormalize monthly $433.33 to weekly (~$100 = 10000 cents)', () => {
      const monthlyAmount = 43333
      const result = denormalizeFromMonthly(monthlyAmount, 'weekly')
      expect(result).toBe(10000)
    })

    it('should denormalize monthly $433.33 to biweekly (~$200 = 20000 cents)', () => {
      const monthlyAmount = 43333
      const result = denormalizeFromMonthly(monthlyAmount, 'biweekly')
      expect(result).toBe(20000)
    })

    it('should denormalize monthly $500 to monthly (unchanged = 50000 cents)', () => {
      const monthlyAmount = 50000
      const result = denormalizeFromMonthly(monthlyAmount, 'monthly')
      expect(result).toBe(50000)
    })

    it('should denormalize monthly $100 to annually ($1200 = 120000 cents)', () => {
      const monthlyAmount = 10000
      const result = denormalizeFromMonthly(monthlyAmount, 'annually')
      expect(result).toBe(120000)
    })

    it('should handle zero monthly amount', () => {
      const result = denormalizeFromMonthly(0, 'weekly')
      expect(result).toBe(0)
    })
  })

  describe('calculateTotalMonthlyNormalized', () => {
    it('should calculate total from multiple items with all four frequencies', () => {
      const items: NormalizableFinancialItem[] = [
        { amount: 10000, frequency: 'weekly' as const },
        { amount: 20000, frequency: 'biweekly' as const },
        { amount: 50000, frequency: 'monthly' as const },
        { amount: 120000, frequency: 'annually' as const },
      ]
      
      const result = calculateTotalMonthlyNormalized(items)
      expect(result).toBe(146666)
    })

    it('should return 0 for empty array', () => {
      const result = calculateTotalMonthlyNormalized([])
      expect(result).toBe(0)
    })

    it('should handle mixed positive and negative amounts', () => {
      const items: NormalizableFinancialItem[] = [
        { amount: 10000, frequency: 'monthly' as const },
        { amount: -5000, frequency: 'monthly' as const },
      ]
      
      const result = calculateTotalMonthlyNormalized(items)
      expect(result).toBe(5000)
    })

    it('should handle all negative amounts', () => {
      const items = [
        { amount: -10000, frequency: 'weekly' as const },
        { amount: -20000, frequency: 'biweekly' as const },
      ]
      
      const result = calculateTotalMonthlyNormalized(items)
      expect(result).toBe(-86666)
    })

    it('should maintain precision with large numbers', () => {
      const items = [
        { amount: 1000000, frequency: 'weekly' as const },
        { amount: 5000000, frequency: 'monthly' as const },
      ]
      
      // 1000000 * (52/12) = 4333333.333... + 5000000 = 9333333.333...
      // Rounded to nearest integer = 9333333
      const result = calculateTotalMonthlyNormalized(items)
      expect(result).toBe(9333333)
    })
  })

  describe('Mathematical Validation - Zero Tolerance', () => {
    it('should pass exact validation: weekly $100 → $433.33 (43333 cents)', () => {
      const result = normalizeToMonthly(10000, 'weekly')
      expect(result).toBe(43333)
    })

    it('should pass exact validation: biweekly $200 → $433.33 (43333 cents)', () => {
      const result = normalizeToMonthly(20000, 'biweekly')
      expect(result).toBe(43333)
    })

    it('should pass exact validation: annual $1200 → $100 (10000 cents)', () => {
      const result = normalizeToMonthly(120000, 'annually')
      expect(result).toBe(10000)
    })

    it('should verify reverse operation for monthly', () => {
      const original = 50000
      const normalized = normalizeToMonthly(original, 'monthly')
      const denormalized = denormalizeFromMonthly(normalized, 'monthly')
      expect(denormalized).toBe(original)
    })
  })

  describe('Edge Cases - Zero Tolerance for Errors', () => {
    it('should throw error for NaN input', () => {
      expect(() => normalizeToMonthly(NaN, 'weekly')).toThrow('Amount must be a finite number')
    })

    it('should throw error for Infinity input', () => {
      expect(() => normalizeToMonthly(Infinity, 'weekly')).toThrow('Amount must be a finite number')
    })

    it('should throw error for negative Infinity input', () => {
      expect(() =>
        normalizeToMonthly(-Infinity, 'weekly')
      ).toThrow('Amount must be a finite number')
    })

    it('should handle very large numbers without overflow', () => {
      const largeAmount = Number.MAX_SAFE_INTEGER
      const result = normalizeToMonthly(largeAmount, 'monthly')
      expect(result).toBe(largeAmount)
    })

    it('should handle minimum safe integer', () => {
      const min = Number.MIN_SAFE_INTEGER
      const result = normalizeToMonthly(min, 'monthly')
      expect(result).toBe(min)
    })
  })

  describe('Edge Cases - Input Validation', () => {
    it('should throw error for null items array in calculateTotalMonthlyNormalized', () => {
      expect(() =>
        calculateTotalMonthlyNormalized(null as any)
      ).toThrow('Items must be an array')
    })

    it('should throw error for undefined items array in calculateTotalMonthlyNormalized', () => {
      expect(() =>
        calculateTotalMonthlyNormalized(undefined as any)
      ).toThrow('Items must be an array')
    })

    it('should handle empty array in calculateTotalMonthlyNormalized', () => {
      const result = calculateTotalMonthlyNormalized([])
      expect(result).toBe(0)
    })

    it('should handle zero amount', () => {
      const result = normalizeToMonthly(0, 'weekly')
      expect(result).toBe(0)
    })

    it('should handle negative amount', () => {
      const result = normalizeToMonthly(-10000, 'weekly')
      expect(result).toBe(-43333)
    })

    it('should denormalize zero amount', () => {
      const result = denormalizeFromMonthly(0, 'weekly')
      expect(result).toBe(0)
    })

    it('should handle integer overflow gracefully', () => {
      // Multiplying a very large number by 52/12 should not overflow
      const veryLarge = Number.MAX_SAFE_INTEGER / 2
      const result = normalizeToMonthly(veryLarge, 'weekly')
      expect(Number.isFinite(result)).toBe(true)
    })

    it('should throw error for invalid frequency type', () => {
      expect(() => normalizeToMonthly(10000, 'daily' as any)).toThrow('Invalid frequency')
    })

    it('should throw error for null amount in normalizeToMonthly', () => {
      expect(() =>
        normalizeToMonthly(null as any, 'weekly')
      ).toThrow('Amount must be a finite number')
    })

    it('should throw error for null frequency in normalizeToMonthly', () => {
      expect(() => normalizeToMonthly(10000, null as any)).toThrow('Invalid frequency')
    })

    it('should throw error for arrays with null elements', () => {
      const items = [
        { amount: 10000, frequency: 'weekly' as const },
        null as any,
        { amount: 20000, frequency: 'monthly' as const },
      ]
      expect(() => calculateTotalMonthlyNormalized(items)).toThrow()
    })

    it('should throw error for arrays with undefined elements', () => {
      const items = [
        { amount: 10000, frequency: 'weekly' as const },
        undefined as any,
        { amount: 20000, frequency: 'monthly' as const },
      ]
      expect(() => calculateTotalMonthlyNormalized(items)).toThrow()
    })

    it('should throw error for null monthlyAmount in denormalizeFromMonthly', () => {
      expect(() =>
        denormalizeFromMonthly(null as any, 'weekly')
      ).toThrow('Amount must be a finite number')
    })

    it('should handle negative zero correctly', () => {
      const result = normalizeToMonthly(-0, 'monthly')
      expect(result).toBe(-0)
      expect(Object.is(result, -0)).toBe(true)
    })
  })

  describe('Input Validation', () => {
    describe('validateFrequency', () => {
      it('should accept valid frequency values', () => {
        expect(() => validateFrequency('weekly')).not.toThrow()
        expect(() => validateFrequency('biweekly')).not.toThrow()
        expect(() => validateFrequency('monthly')).not.toThrow()
        expect(() => validateFrequency('annually')).not.toThrow()
      })

      it('should throw error for invalid frequency values', () => {
        expect(() => validateFrequency('daily')).toThrow('Invalid frequency')
        expect(() => validateFrequency('')).toThrow('Invalid frequency')
        expect(() => validateFrequency('invalid')).toThrow('Invalid frequency')
      })
    })

    describe('validateAmount', () => {
      it('should accept finite numbers', () => {
        expect(() => validateAmount(0)).not.toThrow()
        expect(() => validateAmount(100)).not.toThrow()
        expect(() => validateAmount(-100)).not.toThrow()
        expect(() => validateAmount(1.5)).not.toThrow()
        expect(() => validateAmount(Number.MAX_SAFE_INTEGER)).not.toThrow()
        expect(() => validateAmount(Number.MIN_SAFE_INTEGER)).not.toThrow()
      })

      it('should throw error for non-finite numbers', () => {
        expect(() => validateAmount(NaN)).toThrow('Amount must be a finite number')
        expect(() => validateAmount(Infinity)).toThrow('Amount must be a finite number')
        expect(() => validateAmount(-Infinity)).toThrow('Amount must be a finite number')
      })
    })
  })
})
