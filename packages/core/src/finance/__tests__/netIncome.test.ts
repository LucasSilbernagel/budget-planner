/**
 * Net Period Income Calculation Tests
 * 
 * Mathematical validation tests for net income calculations.
 * Zero tolerance for errors - NFR3 requirement
 * 
 * Uses exact frequency multipliers:
 * - Weekly: 52/12
 * - Biweekly: 26/12
 * - Monthly: 1
 * - Annually: 1/12
 */

import { describe, it, expect } from 'vitest'
import {
  calculateNetPeriodIncome,
  calculateGrossPeriodIncome,
  calculateTotalPeriodExpenses,
  calculateNetIncomeResult,
  type NetIncomeResult,
} from '../netIncome'

describe('Net Period Income Calculation', () => {
  describe('calculateGrossPeriodIncome', () => {
    it('should calculate gross income from single monthly source ($500 → 50000 cents)', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      
      const result = calculateGrossPeriodIncome(incomeSources)
      expect(result).toBe(50000)
    })

    it('should calculate gross income from weekly source ($100/week → $433.33 = 43333 cents)', () => {
      const incomeSources = [
        { amount: 10000, frequency: 'weekly' as const },
      ]
      
      const result = calculateGrossPeriodIncome(incomeSources)
      expect(result).toBe(43333)
    })

    it('should calculate gross income from multiple sources with different frequencies', () => {
      const incomeSources = [
        { amount: 10000, frequency: 'weekly' as const },    // $100/week → $433.33
        { amount: 20000, frequency: 'biweekly' as const },  // $200/biweekly → $433.33
        { amount: 50000, frequency: 'monthly' as const },   // $500/month → $500.00
      ]
      
      const result = calculateGrossPeriodIncome(incomeSources)
      // Total: 43333 + 43333 + 50000 = 136666 cents = $1366.66
      expect(result).toBe(136666)
    })

    it('should return 0 for empty array', () => {
      const result = calculateGrossPeriodIncome([])
      expect(result).toBe(0)
    })

    it('should handle negative income amounts', () => {
      const incomeSources = [
        { amount: -50000, frequency: 'monthly' as const },
      ]
      
      const result = calculateGrossPeriodIncome(incomeSources)
      expect(result).toBe(-50000)
    })
  })

  describe('calculateTotalPeriodExpenses', () => {
    it('should calculate total expenses from single monthly expense ($200 → 20000 cents)', () => {
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      
      const result = calculateTotalPeriodExpenses(expenses)
      expect(result).toBe(20000)
    })

    it('should calculate total expenses from weekly expense ($50/week → $216.67 = 21667 cents)', () => {
      const expenses = [
        { amount: 5000, frequency: 'weekly' as const },
      ]
      
      const result = calculateTotalPeriodExpenses(expenses)
      // $50 * 52/12 = $216.666... = 21667 cents (rounded)
      expect(result).toBe(21667)
    })

    it('should calculate total expenses from multiple expenses with different frequencies', () => {
      const expenses = [
        { amount: 10000, frequency: 'weekly' as const },    // $100/week → $433.33 = 43333 cents
        { amount: 5000, frequency: 'biweekly' as const },   // $50/biweekly → $108.33 = 10833 cents
        { amount: 20000, frequency: 'monthly' as const },  // $200/month → $200.00 = 20000 cents
      ]
      
      const result = calculateTotalPeriodExpenses(expenses)
      // Total: 43333 + 10833 + 20000 = 74166 cents = $741.66
      expect(result).toBe(74166)
    })

    it('should return 0 for empty array', () => {
      const result = calculateTotalPeriodExpenses([])
      expect(result).toBe(0)
    })

    it('should handle negative expense amounts', () => {
      const expenses = [
        { amount: -20000, frequency: 'monthly' as const },
      ]
      
      const result = calculateTotalPeriodExpenses(expenses)
      expect(result).toBe(-20000)
    })
  })

  describe('calculateNetPeriodIncome', () => {
    it('should calculate net income with surplus (income > expenses)', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      expect(result).toBe(30000)
    })

    it('should calculate net income with deficit (expenses > income)', () => {
      const incomeSources = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      expect(result).toBe(-30000)
    })

    it('should calculate net income with break-even (income = expenses)', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      expect(result).toBe(0)
    })

    it('should calculate net income with mixed frequencies', () => {
      const incomeSources = [
        { amount: 10000, frequency: 'weekly' as const }, // $100/week → $433.33
      ]
      const expenses = [
        { amount: 10000, frequency: 'biweekly' as const }, // $100/biweekly → $216.67
      ]
      
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      // Net: $433.33 - $216.67 = $216.66 = 21666 cents
      expect(result).toBe(21666)
    })

    it('should handle empty income and expense arrays', () => {
      const result = calculateNetPeriodIncome([], [])
      expect(result).toBe(0)
    })

    it('should handle empty expenses array', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome(incomeSources, [])
      expect(result).toBe(50000)
    })

    it('should handle empty income array', () => {
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome([], expenses)
      expect(result).toBe(-20000)
    })
  })

  describe('calculateNetIncomeResult', () => {
    it('should return detailed result with surplus', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      
      const result = calculateNetIncomeResult(incomeSources, expenses)
      
      expect(result).toEqual<NetIncomeResult>({
        grossIncome: 50000,
        totalExpenses: 20000,
        netIncome: 30000,
        isSurplus: true,
      })
    })

    it('should return detailed result with deficit', () => {
      const incomeSources = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      
      const result = calculateNetIncomeResult(incomeSources, expenses)
      
      expect(result).toEqual<NetIncomeResult>({
        grossIncome: 20000,
        totalExpenses: 50000,
        netIncome: -30000,
        isSurplus: false,
      })
    })

    it('should return detailed result with break-even', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      
      const result = calculateNetIncomeResult(incomeSources, expenses)
      
      expect(result).toEqual<NetIncomeResult>({
        grossIncome: 50000,
        totalExpenses: 50000,
        netIncome: 0,
        isSurplus: false, // 0 is break-even, not surplus (user decision)
      })
    })

    it('should handle empty arrays', () => {
      const result = calculateNetIncomeResult([], [])
      
      expect(result).toEqual<NetIncomeResult>({
        grossIncome: 0,
        totalExpenses: 0,
        netIncome: 0,
        isSurplus: true,
      })
    })
  })

  describe('Mathematical Validation - Zero Tolerance', () => {
    it('should pass exact validation: weekly income vs monthly expense', () => {
      const incomeSources = [
        { amount: 10000, frequency: 'weekly' as const },
      ]
      const expenses = [
        { amount: 10000, frequency: 'monthly' as const },
      ]
      
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      // $100/week → $433.33, $100/month → $100.00
      // Net = $433.33 - $100.00 = $333.33 = 33333 cents
      expect(result).toBe(33333)
    })

    it('should pass exact validation: complex scenario with multiple frequencies', () => {
      const incomeSources = [
        { amount: 10000, frequency: 'weekly' as const },   // $100/week → $433.33
        { amount: 5000, frequency: 'biweekly' as const }, // $50/biweekly → $108.33
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const }, // $200/month → $200.00
        { amount: 5000, frequency: 'weekly' as const },   // $50/week → $216.67
      ]
      
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      // Income: 43333 + 10833 = 54166 cents
      // Expenses: 20000 + 21667 = 41667 cents
      // Net: 54166 - 41667 = 12499 cents = $124.99
      expect(result).toBe(12499)
    })
  })

  describe('Edge Cases - Zero Tolerance for Errors', () => {
    it('should handle empty income array', () => {
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome([], expenses)
      expect(result).toBe(-20000)
    })

    it('should handle empty expenses array', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome(incomeSources, [])
      expect(result).toBe(50000)
    })

    it('should handle all negative amounts', () => {
      const incomeSources = [
        { amount: -10000, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: -5000, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      // grossIncome = -10000, totalExpenses = -5000
      // netIncome = -10000 - (-5000) = -5000
      expect(result).toBe(-5000)
    })

    it('should handle very large numbers', () => {
      const incomeSources = [
        { amount: Number.MAX_SAFE_INTEGER, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 0, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      expect(result).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('should handle null incomeSources array', () => {
      const result = calculateNetPeriodIncome(null as any, [])
      expect(result).toBe(0)
    })

    it('should handle undefined incomeSources array', () => {
      const result = calculateNetPeriodIncome(undefined as any, [])
      expect(result).toBe(0)
    })

    it('should handle null expenses array', () => {
      const result = calculateNetPeriodIncome([], null as any)
      expect(result).toBe(0)
    })

    it('should handle undefined expenses array', () => {
      const result = calculateNetPeriodIncome([], undefined as any)
      expect(result).toBe(0)
    })

    it('should handle both null arrays', () => {
      const result = calculateNetPeriodIncome(null as any, null as any)
      expect(result).toBe(0)
    })

    it('should handle arrays with null elements', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
        null as any,
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      // null elements should be filtered out, so 50000 - 20000 = 30000
      expect(result).toBe(30000)
    })

    it('should handle arrays with undefined elements', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
        undefined as any,
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      // undefined elements should be filtered out, so 50000 - 20000 = 30000
      expect(result).toBe(30000)
    })

    it('should handle NaN in income amounts', () => {
      const incomeSources = [
        { amount: NaN, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      // NaN in income should result in NaN
      expect(Number.isNaN(result)).toBe(true)
    })

    it('should handle Infinity in income amounts', () => {
      const incomeSources = [
        { amount: Infinity, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      // Infinity - finite = Infinity
      expect(result).toBe(Infinity)
    })

    it('should handle string numbers (type coercion)', () => {
      const incomeSources = [
        { amount: '50000' as any, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      // TypeScript will coerce string to number, but this is a type error
      // @ts-expect-error - intentional type error test
      const result = calculateNetPeriodIncome(incomeSources, expenses)
      expect(result).toBe(30000)
    })
  })
})
