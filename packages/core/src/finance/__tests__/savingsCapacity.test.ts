/**
 * Savings Capacity Calculation Tests
 *
 * Mathematical validation tests for savings capacity calculations.
 * Zero tolerance for errors - NFR3 requirement
 *
 * Formula: savingsCapacityPercentage = (totalExpenses / grossIncome) × 100
 * This is derived from: (grossIncome - netPeriodIncome) / grossIncome × 100
 * Where netPeriodIncome = grossIncome - totalExpenses
 */

import { describe, expect, it } from 'vitest'
import {
  type SavingsCapacityResult,
  calculateMaxAllocableSavings,
  calculateMaxDynamicallyAllocableSavings,
  calculateSavingsCapacityPercentage,
  calculateSavingsCapacityResult,
} from '../savingsCapacity.js'

describe('Savings Capacity Calculation', () => {
  describe('calculateMaxAllocableSavings', () => {
    it('should return net period income as max allocable savings', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 20000, frequency: 'monthly' as const }]

      const result = calculateMaxAllocableSavings(incomeSources, expenses)
      // grossIncome = 50000, totalExpenses = 20000
      // netPeriodIncome = 50000 - 20000 = 30000
      expect(result).toBe(30000)
    })

    it('should return negative value when expenses exceed income', () => {
      const incomeSources = [{ amount: 20000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

      const result = calculateMaxAllocableSavings(incomeSources, expenses)
      // grossIncome = 20000, totalExpenses = 50000
      // netPeriodIncome = 20000 - 50000 = -30000
      expect(result).toBe(-30000)
    })

    it('should return 0 for break-even', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

      const result = calculateMaxAllocableSavings(incomeSources, expenses)
      expect(result).toBe(0)
    })

    it('should handle empty arrays', () => {
      const result = calculateMaxAllocableSavings([], [])
      expect(result).toBe(0)
    })

    it('should return full income when no expenses', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const result = calculateMaxAllocableSavings(incomeSources, [])
      // grossIncome = 50000, totalExpenses = 0
      // netPeriodIncome = 50000 - 0 = 50000
      expect(result).toBe(50000)
    })

    it('should handle mixed frequencies', () => {
      const incomeSources = [
        { amount: 10000, frequency: 'weekly' as const }, // $100/week → $433.33
      ]
      const expenses = [
        { amount: 10000, frequency: 'biweekly' as const }, // $100/biweekly → $216.67
      ]

      const result = calculateMaxAllocableSavings(incomeSources, expenses)
      // grossIncome = 43333, totalExpenses = 21667
      // netPeriodIncome = 43333 - 21667 = 21666
      expect(result).toBe(21666)
    })
  })

  describe('calculateMaxDynamicallyAllocableSavings', () => {
    it('should return positive net income unchanged', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 20000, frequency: 'monthly' as const }]

      const result = calculateMaxDynamicallyAllocableSavings(incomeSources, expenses)
      expect(result).toBe(30000)
    })

    it('should return 0 when net income is negative', () => {
      const incomeSources = [{ amount: 20000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

      const result = calculateMaxDynamicallyAllocableSavings(incomeSources, expenses)
      expect(result).toBe(0)
    })

    it('should return 0 when net income is 0', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

      const result = calculateMaxDynamicallyAllocableSavings(incomeSources, expenses)
      expect(result).toBe(0)
    })

    it('should handle empty arrays', () => {
      const result = calculateMaxDynamicallyAllocableSavings([], [])
      expect(result).toBe(0)
    })

    it('should return full income when no expenses', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const result = calculateMaxDynamicallyAllocableSavings(incomeSources, [])
      // grossIncome = 50000, totalExpenses = 0
      // netPeriodIncome = 50000 - 0 = 50000
      // max(0, 50000) = 50000
      expect(result).toBe(50000)
    })
  })

  describe('calculateSavingsCapacityPercentage', () => {
    it('should calculate savings capacity percentage with surplus', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 20000, frequency: 'monthly' as const }]

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      // grossIncome = 50000, netPeriodIncome = 30000
      // savingsCapacity = 50000 - 30000 = 20000
      // percentage = (20000 / 50000) * 100 = 40%
      expect(result).toBe(40)
    })

    it('should return 0 when expenses are 0', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const expenses: Array<{ amount: number; frequency: any }> = []

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      // grossIncome = 50000, netPeriodIncome = 50000
      // savingsCapacity = 50000 - 50000 = 0
      // percentage = (0 / 50000) * 100 = 0%
      expect(result).toBe(0)
    })

    it('should return 0 when income is 0', () => {
      const incomeSources: Array<{ amount: number; frequency: any }> = []
      const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      expect(result).toBe(0)
    })

    it('should return 100 when expenses equal income (break-even)', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      // grossIncome = 50000, netPeriodIncome = 0
      // savingsCapacity = 50000 - 0 = 50000
      // percentage = (50000 / 50000) * 100 = 100%
      expect(result).toBe(100)
    })

    it('should calculate correct percentage with mixed frequencies', () => {
      const incomeSources = [
        { amount: 10000, frequency: 'weekly' as const }, // $100/week → $433.33
      ]
      const expenses = [
        { amount: 10000, frequency: 'monthly' as const }, // $100/month
      ]

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      // grossIncome = 43333, totalExpenses = 10000
      // netPeriodIncome = 43333 - 10000 = 33333
      // savingsCapacity = 43333 - 33333 = 10000
      // percentage = (10000 / 43333) * 100 ≈ 23.08% → 23%
      expect(result).toBe(23)
    })

    it('should return 50% when expenses are half of income', () => {
      const incomeSources = [
        { amount: 10000, frequency: 'monthly' as const }, // $100
      ]
      const expenses = [
        { amount: 5000, frequency: 'monthly' as const }, // $50
      ]

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      // grossIncome = 10000, totalExpenses = 5000
      // netPeriodIncome = 10000 - 5000 = 5000
      // savingsCapacity = 10000 - 5000 = 5000
      // percentage = (5000 / 10000) * 100 = 50%
      expect(result).toBe(50)
    })

    it('should return >100% when expenses exceed gross income (overspending)', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const }, // $500
      ]
      const expenses = [
        { amount: 75000, frequency: 'monthly' as const }, // $750
      ]

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      // grossIncome = 50000, totalExpenses = 75000
      // percentage = (75000 / 50000) * 100 = 150%
      expect(result).toBe(150)
    })
  })

  describe('calculateSavingsCapacityResult', () => {
    it('should return detailed result with surplus', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 20000, frequency: 'monthly' as const }]

      const result = calculateSavingsCapacityResult(incomeSources, expenses)

      expect(result).toEqual<SavingsCapacityResult>({
        grossIncome: 50000,
        netPeriodIncome: 30000,
        savingsCapacityPercentage: 40,
        maxAllocableSavings: 30000,
      })
    })

    it('should return detailed result with deficit', () => {
      const incomeSources = [{ amount: 20000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

      const result = calculateSavingsCapacityResult(incomeSources, expenses)

      // With deficit (expenses > income), savings capacity percentage exceeds 100%
      // Formula: (expenses / grossIncome) * 100 = (50000 / 20000) * 100 = 250%
      expect(result).toEqual<SavingsCapacityResult>({
        grossIncome: 20000,
        netPeriodIncome: -30000,
        savingsCapacityPercentage: 250,
        maxAllocableSavings: -30000,
      })
    })

    it('should return >100% percentage when overspending', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 75000, frequency: 'monthly' as const }]

      const result = calculateSavingsCapacityResult(incomeSources, expenses)
      expect(result).toEqual<SavingsCapacityResult>({
        grossIncome: 50000,
        netPeriodIncome: -25000,
        savingsCapacityPercentage: 150, // >100% for overspending
        maxAllocableSavings: -25000,
      })
    })

    it('should handle empty arrays', () => {
      const result = calculateSavingsCapacityResult([], [])

      expect(result).toEqual<SavingsCapacityResult>({
        grossIncome: 0,
        netPeriodIncome: 0,
        savingsCapacityPercentage: 0,
        maxAllocableSavings: 0,
      })
    })
  })

  describe('Mathematical Validation - Zero Tolerance', () => {
    it('should pass exact validation: formula (expenses/grossIncome × 100)', () => {
      const incomeSources = [{ amount: 10000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 2500, frequency: 'monthly' as const }]

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      // ($25 / $100) * 100 = 25%
      expect(result).toBe(25)
    })

    it('should pass exact validation: 100% when expenses equal income', () => {
      const incomeSources = [{ amount: 10000, frequency: 'monthly' as const }]
      const expenses = [{ amount: 10000, frequency: 'monthly' as const }]

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      expect(result).toBe(100)
    })

    it('should pass exact validation: 0% when no expenses', () => {
      const incomeSources = [{ amount: 10000, frequency: 'monthly' as const }]
      const expenses: Array<{ amount: number; frequency: any }> = []

      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      expect(result).toBe(0)
    })
  })

  describe('Edge Cases - Zero Tolerance for Errors', () => {
    it('should handle empty income array', () => {
      const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
      const result = calculateSavingsCapacityPercentage([], expenses)
      expect(result).toBe(0)
    })

    it('should handle empty expenses array', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
      const result = calculateSavingsCapacityPercentage(incomeSources, [])
      expect(result).toBe(0)
    })

    it('should handle very large numbers', () => {
      const incomeSources = [{ amount: Number.MAX_SAFE_INTEGER, frequency: 'monthly' as const }]
      const expenses = [{ amount: 0, frequency: 'monthly' as const }]
      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      expect(result).toBe(0)
    })

    it('should handle negative income and expenses', () => {
      const incomeSources = [{ amount: -10000, frequency: 'monthly' as const }]
      const expenses = [{ amount: -5000, frequency: 'monthly' as const }]
      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      // grossIncome = -10000, netPeriodIncome = -5000
      // savingsCapacity = -10000 - (-5000) = -5000
      // percentage = (-5000 / -10000) * 100 = 50%
      expect(result).toBe(50)
    })

    it('should handle null incomeSources array', () => {
      const result = calculateSavingsCapacityPercentage(null as any, [])
      expect(result).toBe(0)
    })

    it('should handle undefined incomeSources array', () => {
      const result = calculateSavingsCapacityPercentage(undefined as any, [])
      expect(result).toBe(0)
    })

    it('should handle null expenses array', () => {
      const result = calculateSavingsCapacityPercentage([], null as any)
      expect(result).toBe(0)
    })

    it('should handle both null arrays', () => {
      const result = calculateSavingsCapacityPercentage(null as any, null as any)
      expect(result).toBe(0)
    })

    it('should throw error for NaN in income amounts', () => {
      const incomeSources = [{ amount: NaN, frequency: 'monthly' as const }]
      const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
      expect(() => calculateSavingsCapacityPercentage(incomeSources, expenses)).toThrow(
        'Amount must be a finite number'
      )
    })

    it('should throw error for arrays with null elements', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }, null as any]
      const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
      expect(() => calculateSavingsCapacityPercentage(incomeSources, expenses)).toThrow(
        'Amount must be a finite number'
      )
    })

    it('should throw error for arrays with undefined elements', () => {
      const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }, undefined as any]
      const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
      expect(() => calculateSavingsCapacityPercentage(incomeSources, expenses)).toThrow(
        'Amount must be a finite number'
      )
    })

    it('should return 0 for negative zero in savings capacity calculation', () => {
      const incomeSources = [{ amount: -0, frequency: 'monthly' as const }]
      const expenses = [{ amount: 0, frequency: 'monthly' as const }]
      const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
      // -0 / -0 is NaN, but we should return 0 to avoid NaN in UI
      expect(result).toBe(0)
    })

    it('should handle null inputs to calculateSavingsCapacityResult', () => {
      const result = calculateSavingsCapacityResult(null as any, null as any)
      expect(result).toEqual({
        grossIncome: 0,
        netPeriodIncome: 0,
        savingsCapacityPercentage: 0,
        maxAllocableSavings: 0,
      })
    })
  })
})
