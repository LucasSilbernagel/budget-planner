/**
 * Retirement Modeler Tests
 * 
 * Mathematical validation tests for retirement calculations.
 * Zero tolerance for errors - NFR3 requirement
 * 
 * Uses Safe Withdrawal Model: FV = Ir × (12 / r)
 * Where FV = Future Value, Ir = monthly income, r = annual return rate
 */

import { describe, it, expect } from 'vitest'
import {
  calculateRetirementRequirement,
  calculateRequiredAssets,
  calculateSafeMonthlyWithdrawal,
  calculateCompoundingProjection,
  type RetirementResult,
  type RetirementInput,
  type CompoundingInput,
  type YearlyProjection,
} from '../retirement'

describe('Retirement Modeler', () => {
  describe('calculateRetirementRequirement', () => {
    it('should calculate required assets for $5000/month income at 6% return', () => {
      // FV = 5000 * (12 / 0.06) = 5000 * 200 = 1,000,000
      // In cents: 500000 * (12 / 0.06) = 500000 * 200 = 100,000,000 cents
      const input: RetirementInput = {
        monthlyIncome: 500000, // $5000/month in cents
        annualReturnRate: 0.06, // 6%
      }
      
      const result = calculateRetirementRequirement(input)
      
      expect(result.requiredAssets).toBe(100000000) // $1,000,000
      expect(result.monthlyIncome).toBe(500000)
      expect(result.annualReturnRate).toBe(0.06)
      expect(result.annualReturnRatePercentage).toBe(6)
      expect(result.requiredAssetsFormatted).toContain('$1,000,000')
      expect(result.monthlyIncomeFormatted).toContain('$5,000')
    })

    it('should calculate required assets for $1000/month income at 4% return', () => {
      // FV = 1000 * (12 / 0.04) = 1000 * 300 = 300,000
      // In cents: 100000 * (12 / 0.04) = 100000 * 300 = 30,000,000 cents
      const input: RetirementInput = {
        monthlyIncome: 100000, // $1000/month in cents
        annualReturnRate: 0.04, // 4%
      }
      
      const result = calculateRetirementRequirement(input)
      
      expect(result.requiredAssets).toBe(30000000) // $300,000
      expect(result.requiredAssetsFormatted).toContain('$300,000')
    })

    it('should calculate required assets for $2500/month income at 5% return', () => {
      // FV = 2500 * (12 / 0.05) = 2500 * 240 = 600,000
      // In cents: 250000 * 240 = 60,000,000 cents
      const input: RetirementInput = {
        monthlyIncome: 250000, // $2500/month in cents
        annualReturnRate: 0.05, // 5%
      }
      
      const result = calculateRetirementRequirement(input)
      
      expect(result.requiredAssets).toBe(60000000) // $600,000
      expect(result.annualReturnRatePercentage).toBe(5)
    })

    it('should throw error for zero return rate', () => {
      const input: RetirementInput = {
        monthlyIncome: 500000,
        annualReturnRate: 0,
      }
      
      expect(() => calculateRetirementRequirement(input)).toThrow(
        'Annual return rate must be positive (greater than 0)'
      )
    })

    it('should throw error for negative return rate', () => {
      const input: RetirementInput = {
        monthlyIncome: 500000,
        annualReturnRate: -0.05,
      }
      
      expect(() => calculateRetirementRequirement(input)).toThrow(
        'Annual return rate must be positive (greater than 0)'
      )
    })

    it('should handle edge case: very high return rate (12%)', () => {
      // FV = 5000 * (12 / 0.12) = 5000 * 100 = 500,000
      const input: RetirementInput = {
        monthlyIncome: 500000, // $5000/month
        annualReturnRate: 0.12, // 12%
      }
      
      const result = calculateRetirementRequirement(input)
      
      expect(result.requiredAssets).toBe(50000000) // $500,000
    })

    it('should handle edge case: very low return rate (1%)', () => {
      // FV = 5000 * (12 / 0.01) = 5000 * 1200 = 6,000,000
      const input: RetirementInput = {
        monthlyIncome: 500000, // $5000/month
        annualReturnRate: 0.01, // 1%
      }
      
      const result = calculateRetirementRequirement(input)
      
      expect(result.requiredAssets).toBe(600000000) // $6,000,000
    })
  })

  describe('calculateRequiredAssets', () => {
    it('should calculate required assets for given monthly income and return rate', () => {
      // $5000/month, 6% return
      const result = calculateRequiredAssets(500000, 0.06)
      expect(result).toBe(100000000) // $1,000,000
    })

    it('should throw error for zero return rate', () => {
      expect(() => calculateRequiredAssets(500000, 0)).toThrow(
        'Annual return rate must be positive (greater than 0)'
      )
    })

    it('should handle exact calculation: $1000/month at 8% return', () => {
      // FV = 1000 * (12 / 0.08) = 1000 * 150 = 150,000
      const result = calculateRequiredAssets(100000, 0.08)
      expect(result).toBe(15000000) // $150,000
    })
  })

  describe('calculateSafeMonthlyWithdrawal', () => {
    it('should calculate safe monthly withdrawal from $1,000,000 at 6% return', () => {
      // Reverse: Ir = FV × (r / 12)
      // Ir = 1000000 × (0.06 / 12) = 1000000 × 0.005 = 5000
      // In cents: 100000000 × (0.06 / 12) = 100000000 × 0.005 = 500000 cents
      const result = calculateSafeMonthlyWithdrawal(100000000, 0.06)
      expect(result).toBe(500000) // $5000/month
    })

    it('should calculate safe monthly withdrawal from $500,000 at 4% return', () => {
      // Ir = 500000 × (0.04 / 12) = 500000 × 0.003333... = 1666.666...
      // In cents: 50000000 × (0.04 / 12) = 166666.666... → 166667 cents
      const result = calculateSafeMonthlyWithdrawal(50000000, 0.04)
      expect(result).toBe(166667) // ~$1666.67
    })

    it('should throw error for zero return rate', () => {
      expect(() => calculateSafeMonthlyWithdrawal(100000000, 0)).toThrow(
        'Annual return rate must be positive (greater than 0)'
      )
    })

    it('should verify round-trip calculation: income → assets → income', () => {
      const monthlyIncome = 500000 // $5000
      const returnRate = 0.06
      
      const requiredAssets = calculateRequiredAssets(monthlyIncome, returnRate)
      const withdrawal = calculateSafeMonthlyWithdrawal(requiredAssets, returnRate)
      
      // Due to rounding, these should be equal
      expect(withdrawal).toBe(monthlyIncome)
    })
  })

  describe('calculateCompoundingProjection', () => {
    it('should calculate single year projection with no contribution', () => {
      const input: CompoundingInput = {
        principal: 1000000, // $10,000 in cents
        annualContribution: 0,
        annualReturnRate: 0.05, // 5%
        years: 1,
      }
      
      const result = calculateCompoundingProjection(input)
      
      expect(result.length).toBe(1) // Year 1 only
      expect(result[0].year).toBe(1)
      expect(result[0].startingBalance).toBe(1000000)
      expect(result[0].annualContribution).toBe(0)
      // Growth: 1000000 * 1.05 + 0 = 1050000
      expect(result[0].endingBalance).toBe(1050000)
    })

    it('should calculate multi-year projection with annual contributions', () => {
      const input: CompoundingInput = {
        principal: 1000000, // $10,000
        annualContribution: 120000, // $1200/year
        annualReturnRate: 0.05, // 5%
        years: 2,
      }
      
      const result = calculateCompoundingProjection(input)
      
      expect(result.length).toBe(2) // Year 1, 2
      
      // Year 1: principal grows + contribution
      // Growth: 1000000 * 1.05 = 1050000
      // + contribution: 1050000 + 120000 = 1170000
      expect(result[0].year).toBe(1)
      expect(result[0].startingBalance).toBe(1000000)
      expect(result[0].annualContribution).toBe(120000)
      expect(result[0].endingBalance).toBe(1170000)
      
      // Year 2: previous balance grows + contribution
      // Growth: 1170000 * 1.05 = 1228500
      // + contribution: 1228500 + 120000 = 1348500
      expect(result[1].year).toBe(2)
      expect(result[1].startingBalance).toBe(1170000)
      expect(result[1].annualContribution).toBe(120000)
      expect(result[1].endingBalance).toBe(1348500)
    })

    it('should return empty array for zero years', () => {
      const input: CompoundingInput = {
        principal: 1000000,
        annualContribution: 0,
        annualReturnRate: 0.05,
        years: 0,
      }
      
      const result = calculateCompoundingProjection(input)
      
      // Edge case: zero years returns empty array
      expect(result.length).toBe(0)
    })

    it('should throw error for zero return rate', () => {
      const input: CompoundingInput = {
        principal: 1000000,
        annualContribution: 100000,
        annualReturnRate: 0,
        years: 2,
      }
      
      expect(() => calculateCompoundingProjection(input)).toThrow(
        'Annual return rate must be positive (greater than 0)'
      )
    })

    it('should throw error for negative return rate', () => {
      const input: CompoundingInput = {
        principal: 1000000,
        annualContribution: 0,
        annualReturnRate: -0.05,
        years: 1,
      }
      
      expect(() => calculateCompoundingProjection(input)).toThrow(
        'Annual return rate must be positive (greater than 0)'
      )
    })

    it('should throw error for negative years', () => {
      const input: CompoundingInput = {
        principal: 1000000,
        annualContribution: 0,
        annualReturnRate: 0.05,
        years: -1,
      }
      
      expect(() => calculateCompoundingProjection(input)).toThrow(
        'Number of years must be non-negative'
      )
    })
  })

  describe('Mathematical Validation - Zero Tolerance', () => {
    it('should pass exact validation: Safe Withdrawal Model formula', () => {
      // FV = Ir × (12 / r)
      // Ir = $4000, r = 0.06 (6%)
      // FV = 4000 * (12 / 0.06) = 4000 * 200 = 800,000
      const input: RetirementInput = {
        monthlyIncome: 400000, // $4000/month
        annualReturnRate: 0.06,
      }
      
      const result = calculateRetirementRequirement(input)
      expect(result.requiredAssets).toBe(80000000) // $800,000
    })

    it('should pass exact validation: reverse calculation', () => {
      // If FV = $800,000 and r = 6%, then Ir = 800000 × (0.06 / 12) = 4000
      const result = calculateSafeMonthlyWithdrawal(80000000, 0.06)
      expect(result).toBe(400000) // $4000/month
    })

    it('should pass exact validation: compounding with no contribution', () => {
      // P × (1 + r)^n
      // 1000000 × (1.10)^2 = 1000000 × 1.21 = 1210000
      const input: CompoundingInput = {
        principal: 1000000,
        annualContribution: 0,
        annualReturnRate: 0.10, // 10%
        years: 2,
      }
      
      const result = calculateCompoundingProjection(input)
      expect(result.length).toBe(2)
      expect(result[1].endingBalance).toBe(1210000)
    })

    it('should pass exact validation: compounding with contribution', () => {
      // Year 1: (1000000 * 1.10) + 100000 = 1100000 + 100000 = 1200000
      // Year 2: (1200000 * 1.10) + 100000 = 1320000 + 100000 = 1420000
      const input: CompoundingInput = {
        principal: 1000000,
        annualContribution: 100000,
        annualReturnRate: 0.10,
        years: 2,
      }
      
      const result = calculateCompoundingProjection(input)
      expect(result.length).toBe(2)
      expect(result[0].endingBalance).toBe(1200000)
      expect(result[1].endingBalance).toBe(1420000)
    })
  })

  describe('Edge Cases - Zero Tolerance for Errors', () => {
    it('should handle very large principal', () => {
      const result = calculateRequiredAssets(1000000000, 0.05) // $10M/month
      expect(result).toBeGreaterThan(0)
    })

    it('should handle very small return rate', () => {
      // FV = 5000 * (12 / 0.001) = 5000 * 12000 = 60,000,000 dollars
      // In cents: 60,000,000 * 100 = 6,000,000,000 cents
      const result = calculateRequiredAssets(500000, 0.001) // 0.1%, $5000/month
      expect(result).toBe(6000000000) // $60,000,000 in cents
    })

    it('should handle zero principal in compounding', () => {
      const input: CompoundingInput = {
        principal: 0,
        annualContribution: 100000,
        annualReturnRate: 0.05,
        years: 1,
      }
      
      const result = calculateCompoundingProjection(input)
      expect(result[0].endingBalance).toBe(100000)
    })

    it('should handle zero contribution in compounding', () => {
      const input: CompoundingInput = {
        principal: 1000000,
        annualContribution: 0,
        annualReturnRate: 0.05,
        years: 1,
      }
      
      const result = calculateCompoundingProjection(input)
      expect(result[0].endingBalance).toBe(1050000)
    })

    it('should throw error for zero return rate in calculateRequiredAssets', () => {
      expect(() => calculateRequiredAssets(500000, 0)).toThrow(
        'Annual return rate must be positive (greater than 0)'
      )
    })

    it('should throw error for negative return rate in calculateRequiredAssets', () => {
      expect(() => calculateRequiredAssets(500000, -0.05)).toThrow(
        'Annual return rate must be positive (greater than 0)'
      )
    })

    it('should throw error for zero return rate in calculateSafeMonthlyWithdrawal', () => {
      expect(() => calculateSafeMonthlyWithdrawal(100000000, 0)).toThrow(
        'Annual return rate must be positive (greater than 0)'
      )
    })

    it('should handle null monthlyIncome in calculateRequiredAssets', () => {
      expect(() => calculateRequiredAssets(null as any, 0.06)).toThrow()
    })

    it('should throw error for NaN in calculateRequiredAssets parameters', () => {
      expect(() =>
        calculateRequiredAssets(NaN, 0.06)
      ).toThrow('Monthly income must be a finite number')
    })

    it('should handle negative monthlyIncome value', () => {
      const result = calculateRequiredAssets(-500000, 0.06)
      // Negative income should produce negative required assets
      expect(result).toBeLessThan(0)
    })

    it('should throw error for very large years parameter (1000 years)', () => {
      const input: CompoundingInput = {
        principal: 1000000,
        annualContribution: 0,
        annualReturnRate: 0.05,
        years: 1000,
      }
      
      // Should throw error for years exceeding safe limit (100)
      expect(() =>
        calculateCompoundingProjection(input)
      ).toThrow('Number of years must not exceed 100')
    })

    it('should handle negative zero in retirement calculations', () => {
      const result = calculateRequiredAssets(-0, 0.06)
      expect(Object.is(result, -0)).toBe(true)
    })
  })
})
