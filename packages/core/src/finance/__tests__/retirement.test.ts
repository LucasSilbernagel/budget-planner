/**
 * Retirement Modeler Tests
 *
 * Mathematical validation tests for retirement calculations.
 * Zero tolerance for errors - NFR3 requirement
 *
 * Uses Safe Withdrawal Model: FV = Ir × (12 / r)
 * Where FV = Future Value, Ir = monthly income, r = annual return rate
 */

import { describe, expect, it } from 'vitest'
import {
  type CompoundingInput,
  type RetirementAccumulationInput,
  type RetirementInput,
  calculateCompoundingProjection,
  calculateRequiredAssets,
  calculateRequiredNestEgg,
  calculateRetirementRequirement,
  calculateSafeMonthlyWithdrawal,
  projectAccumulatedNestEgg,
  solveRetirementAccumulation,
  toMonthlyIncomeCents,
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

      // Currency-less is the default (story 4-6 AC-1); request symbol mode
      // explicitly to assert the human-readable formatted output.
      const result = calculateRetirementRequirement(input, { mode: 'symbol', currency: 'USD' })

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

      const result = calculateRetirementRequirement(input, { mode: 'symbol', currency: 'USD' })

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
        annualReturnRate: 0.1, // 10%
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
        annualReturnRate: 0.1,
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
      expect(() => calculateRequiredAssets(NaN, 0.06)).toThrow(
        'Monthly income must be a finite number'
      )
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
      expect(() => calculateCompoundingProjection(input)).toThrow(
        'Number of years must not exceed 100'
      )
    })

    it('should handle negative zero in retirement calculations', () => {
      const result = calculateRequiredAssets(-0, 0.06)
      expect(Object.is(result, -0)).toBe(true)
    })
  })

  // Story 15.2: annual↔monthly boundary conversion (AC-2 / NFR3).
  // The Safe Withdrawal Model core stays monthly-only; this helper divides an
  // annual figure by 12 at the boundary so entering annual == entering annual/12
  // monthly, numerically.
  describe('toMonthlyIncomeCents (annual/monthly boundary)', () => {
    it('passes a monthly amount through unchanged (identity)', () => {
      expect(toMonthlyIncomeCents(500000, 'monthly')).toBe(500000)
      expect(toMonthlyIncomeCents(0, 'monthly')).toBe(0)
    })

    it('converts an annual amount to Math.round(annualCents / 12)', () => {
      // $60,000/yr = 6,000,000¢ → 500,000¢ = $5,000/mo
      expect(toMonthlyIncomeCents(6000000, 'annual')).toBe(500000)
      // $10,000/yr = 1,000,000¢ → round(1,000,000 / 12) = 83,333¢
      expect(toMonthlyIncomeCents(1000000, 'annual')).toBe(83333)
    })

    it('rounds to the nearest cent (never truncates)', () => {
      // 100¢/yr → round(100/12) = round(8.333) = 8¢
      expect(toMonthlyIncomeCents(100, 'annual')).toBe(8)
      // 1000¢/yr → round(1000/12) = round(83.333) = 83¢
      expect(toMonthlyIncomeCents(1000, 'annual')).toBe(83)
    })

    it('throws for a non-finite amount', () => {
      expect(() => toMonthlyIncomeCents(Number.NaN, 'annual')).toThrow('finite')
      expect(() => toMonthlyIncomeCents(Number.POSITIVE_INFINITY, 'monthly')).toThrow('finite')
    })

    it('is numerically equivalent to entering annual/12 as a monthly amount (end-to-end)', () => {
      // $60,000/yr @ 6% → $5,000/mo → $1,000,000 required assets
      const annualCents = 6000000
      const rate = 0.06

      const viaAnnual = calculateRequiredAssets(toMonthlyIncomeCents(annualCents, 'annual'), rate)
      const viaMonthly = calculateRequiredAssets(Math.round(annualCents / 12), rate)

      expect(viaAnnual).toBe(viaMonthly)
      expect(viaAnnual).toBe(100000000) // $1,000,000 in cents
    })

    it('annual equivalence holds across representative values and rates', () => {
      const cases: Array<{ annualCents: number; rate: number }> = [
        { annualCents: 12000000, rate: 0.04 }, // $120k/yr @ 4%
        { annualCents: 3000000, rate: 0.05 }, // $30k/yr @ 5%
        { annualCents: 1000000, rate: 0.07 }, // $10k/yr @ 7%
        { annualCents: 999999, rate: 0.06 }, // odd cents, forces rounding
      ]

      for (const { annualCents, rate } of cases) {
        const viaHelper = calculateRequiredAssets(toMonthlyIncomeCents(annualCents, 'annual'), rate)
        const viaDivide = calculateRequiredAssets(Math.round(annualCents / 12), rate)
        expect(viaHelper).toBe(viaDivide)
      }
    })
  })
})

describe('Retirement Accumulation Solver (Story 26.6)', () => {
  describe('projectAccumulatedNestEgg', () => {
    it('reproduces the source-spreadsheet nest egg (~$788,649) at 202 months', () => {
      // age 35, saved $59,541, $1,799/mo, 6% annual, run to 202 months.
      // i = 0.06/12 = 0.005; (1.005)^202 ≈ 2.738699.
      // principal FV = 59,541 × (1.005)^202     (monthly-compounded)
      // annuity  FV = 1,799 × ((1.005)^202 − 1)/0.005  (ordinary/end-of-month)
      // total ≈ $788,649.23 → $788,649 to the dollar (matches the spreadsheet).
      const result = projectAccumulatedNestEgg(5_954_100, 179_900, 0.06, 202)

      expect(Math.round(result / 100)).toBe(788_649)
      // Closed-form exact cents (single round at the cents boundary).
      expect(result).toBe(78_864_923)
    })

    it('computes monthly-compounded FV for a small horizon (hand-checked)', () => {
      // principal $1,000, $100/mo, 12% annual → i = 0.01, n = 2.
      // growth = 1.01^2 = 1.0201.
      // FV = 1000 × 1.0201 + 100 × ((1.0201 − 1)/0.01) = 1020.10 + 100 × 2.01 = 1221.10
      const result = projectAccumulatedNestEgg(100_000, 10_000, 0.12, 2)

      expect(result).toBe(122_110) // $1,221.10 in cents
    })

    it('returns the principal unchanged when months = 0', () => {
      expect(projectAccumulatedNestEgg(5_954_100, 179_900, 0.06, 0)).toBe(5_954_100)
    })

    it('degrades to linear accumulation at zero return', () => {
      // 0% return: FV = principal + contribution × months, no compounding.
      // $2,000 + $500/mo × 24 = $2,000 + $12,000 = $14,000
      expect(projectAccumulatedNestEgg(200_000, 50_000, 0, 24)).toBe(1_400_000)
    })

    it('treats negative principal and contribution as zero (never negative)', () => {
      expect(projectAccumulatedNestEgg(-100_000, -5_000, 0.06, 12)).toBe(0)
    })

    it('returns 0 for zero principal and zero contribution at any horizon (no false overflow)', () => {
      // 0 saved + 0 contributed is always 0; must not trip the overflow guard even
      // when (1+i)^months would overflow to Infinity (0 × Infinity = NaN).
      expect(projectAccumulatedNestEgg(0, 0, 0.06, 200_000)).toBe(0)
    })

    it('throws on non-finite, negative, or non-integer inputs', () => {
      expect(() => projectAccumulatedNestEgg(Number.NaN, 0, 0.06, 12)).toThrow('finite')
      expect(() => projectAccumulatedNestEgg(1000, 0, -0.01, 12)).toThrow('non-negative')
      expect(() => projectAccumulatedNestEgg(1000, 0, 0.06, -1)).toThrow('non-negative')
      expect(() => projectAccumulatedNestEgg(1000, 0, 0.06, 12.5)).toThrow('integer')
    })
  })

  describe('calculateRequiredNestEgg', () => {
    it('deplete: required = yearsInRetirement × desiredAnnualIncome (exact cents)', () => {
      // retire at 65, life expectancy 80 → 15 years × $40,000/yr = $600,000.
      expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 65, 80, 'deplete')).toBe(60_000_000)
    })

    it('deplete: works at zero return (growth = discount = 0 collapses the same way)', () => {
      // 15 years × $40,000 = $600,000. With BOTH rates 0 the growth/discount
      // cancellation still holds, so this is the same figure as the 6% case.
      expect(calculateRequiredNestEgg(4_000_000, 0, 0, 65, 80, 'deplete')).toBe(60_000_000)
    })

    it('deplete: retirement age at/after life expectancy needs nothing', () => {
      expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 80, 80, 'deplete')).toBe(0)
      expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 85, 80, 'deplete')).toBe(0)
    })

    it('perpetual: equals the shipped Safe Withdrawal Model, independent of ages', () => {
      // $60,000/yr at 6% → monthly $5,000 → FV = 5000 × (12/0.06) = $1,000,000.
      const expected = calculateRequiredAssets(toMonthlyIncomeCents(6_000_000, 'annual'), 0.06)
      expect(expected).toBe(100_000_000)

      const required = calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 80, 'perpetual')
      expect(required).toBe(100_000_000)
      // Life expectancy / retirement age must not affect the perpetual target.
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 40, 120, 'perpetual')).toBe(
        100_000_000
      )
    })

    it('perpetual: throws on a non-positive return rate (shipped contract)', () => {
      expect(() => calculateRequiredNestEgg(6_000_000, 0, 0, 65, 80, 'perpetual')).toThrow(
        'positive'
      )
      expect(() => calculateRequiredNestEgg(6_000_000, -0.01, -0.01, 65, 80, 'perpetual')).toThrow(
        'positive'
      )
    })
  })

  describe('calculateRequiredNestEgg — two-rate model (story 35.3)', () => {
    it('deplete: a LOWER post-retirement rate increases the required nest egg (AC-7)', () => {
      // $60,000/yr, retire 65, life 90 → 25 years. Accumulation 6% throughout.
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 90, 'deplete')).toBe(150_000_000)
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.05, 65, 90, 'deplete')).toBe(168_462_831)
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.04, 65, 90, 'deplete')).toBe(190_305_280)
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.03, 65, 90, 'deplete')).toBe(216_263_200)
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.02, 65, 90, 'deplete')).toBe(247_252_237)
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.01, 65, 90, 'deplete')).toBe(284_415_840)
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0, 65, 90, 'deplete')).toBe(329_187_072)
    })

    it('deplete: a HIGHER post-retirement rate lowers the requirement (symmetry)', () => {
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.08, 65, 90, 'deplete')).toBeLessThan(
        calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 90, 'deplete')
      )
    })

    it('perpetual: sized by the POST-RETIREMENT rate, not the accumulation rate (AC-4)', () => {
      // $60,000/yr. Accumulation rate held at 6% throughout; only the withdrawal
      // rate moves. required = annual / rate.
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 90, 'perpetual')).toBe(100_000_000)
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.03, 65, 90, 'perpetual')).toBe(200_000_000)
      // Changing ONLY the accumulation rate must not move a perpetual target.
      expect(calculateRequiredNestEgg(6_000_000, 0.12, 0.06, 65, 90, 'perpetual')).toBe(100_000_000)
    })

    /**
     * AC-6 — the load-bearing regression guard.
     *
     * Every expectation shipped before story 35.3 must reproduce BIT-FOR-BIT when
     * the two rates are equal. Asserted here in a dedicated suite rather than
     * relying on the mechanical arity update of the pre-existing tests: a
     * mechanical edit that silently changed a number would still look green.
     */
    describe('equal rates reproduce the pre-35.3 results bit-for-bit (AC-6)', () => {
      it('reproduces all six shipped calculateRequiredNestEgg values', () => {
        expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 65, 80, 'deplete')).toBe(60_000_000)
        expect(calculateRequiredNestEgg(4_000_000, 0, 0, 65, 80, 'deplete')).toBe(60_000_000)
        expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 80, 80, 'deplete')).toBe(0)
        expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 85, 80, 'deplete')).toBe(0)
        expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 80, 'perpetual')).toBe(
          100_000_000
        )
        expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 40, 120, 'perpetual')).toBe(
          100_000_000
        )
      })

      it('reproduces both shipped perpetual THROW contracts', () => {
        expect(() => calculateRequiredNestEgg(6_000_000, 0, 0, 65, 80, 'perpetual')).toThrow(
          'positive'
        )
        expect(() =>
          calculateRequiredNestEgg(6_000_000, -0.01, -0.01, 65, 80, 'perpetual')
        ).toThrow('positive')
      })

      it('collapses to yearsInRetirement × income across a rate/horizon matrix', () => {
        // The identity is a property of the formula (k === 1 exactly), not of any
        // particular fixture — so sweep both axes rather than pinning one point.
        for (const rate of [0, 0.001, 0.03, 0.06, 0.07, 0.12]) {
          for (const years of [0, 1, 5, 15, 25, 40, 55]) {
            const retirementAge = 90 - years
            expect(
              calculateRequiredNestEgg(4_000_000, rate, rate, retirementAge, 90, 'deplete')
            ).toBe(4_000_000 * years)
          }
        }
      })
    })

    describe('boundaries (AC-8, AC-13)', () => {
      it('yearsInRetirement === 0 returns +0, never -0, when the post rate is LOWER', () => {
        // ⚠️ Direction matters. With the post rate BELOW the accumulation rate
        // k > 1, so (1 - k) is negative, 0 / negative is -0, and Math.round
        // preserves it. Object.is(-0, 0) is false, so a plain toBe(0) would fail
        // against an otherwise correct result. With the post rate ABOVE, the
        // quotient is a clean +0 and this test could not detect the defect.
        const result = calculateRequiredNestEgg(4_000_000, 0.06, 0.03, 80, 80, 'deplete')
        expect(Object.is(result, -0)).toBe(false)
        expect(result).toBe(0)
      })

      it('a retirement age past life expectancy clamps to 0 at unequal rates', () => {
        // Pins the Math.max(0, …) clamp. Without it the annuity factor is
        // evaluated at a NEGATIVE exponent and returns -18364622 — a negative
        // required nest egg, which reads as "instantly reachable".
        expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.03, 85, 80, 'deplete')).toBe(0)
      })

      it('a zero desired income returns 0 even on a horizon that overflows the factor', () => {
        // k > 1 with a huge horizon sends the annuity factor to Infinity, and
        // 0 × Infinity is NaN — which would trip the safe-integer guard and THROW
        // where the pre-35.3 formula returned 0.
        expect(calculateRequiredNestEgg(0, 0.06, 0.03, 65, 999_999, 'deplete')).toBe(0)
      })

      it('rejects a non-finite or negative post-retirement rate by name', () => {
        // ⚠️ Infinity is the case that matters: without the guard k = 0,
        // factor = 1, and it returns a plausible 6000000 with no throw at all.
        expect(() =>
          calculateRequiredNestEgg(6_000_000, 0.06, Number.POSITIVE_INFINITY, 65, 90, 'deplete')
        ).toThrow('Post-retirement return rate must be a finite number')
        expect(() =>
          calculateRequiredNestEgg(6_000_000, 0.06, Number.NaN, 65, 90, 'deplete')
        ).toThrow('Post-retirement return rate must be a finite number')
        expect(() => calculateRequiredNestEgg(6_000_000, 0.06, -1, 65, 90, 'deplete')).toThrow(
          'Post-retirement return rate must be a non-negative finite number'
        )
      })

      it('rejects a negative accumulation rate under deplete, which it used to ignore', () => {
        // Before 35.3 the deplete branch never read this rate, so garbage was
        // silently inert. It now drives the growth term.
        expect(() => calculateRequiredNestEgg(6_000_000, -1, 0.06, 65, 90, 'deplete')).toThrow(
          'Annual return rate must be a non-negative finite number'
        )
      })

      it('rejects a negative accumulation rate under PERPETUAL too (review finding)', () => {
        // ⚠️ Regression guard. The two-rate split originally let this through:
        // the non-negative check sat after the perpetual early return, so
        // `(-0.01, 0.06, 'perpetual')` returned a normal 100_000_000 while the
        // identical value threw under deplete — and threw pre-35.3, when there
        // was only one rate. Model choice must not decide whether garbage is
        // accepted.
        expect(() => calculateRequiredNestEgg(6_000_000, -0.01, 0.06, 65, 80, 'perpetual')).toThrow(
          'Annual return rate must be a non-negative finite number'
        )
      })

      it('still reports a bad POST rate with the shipped wording under perpetual', () => {
        // The companion to the guard above: the fix must not steal the message.
        // `calculateRequiredAssets` owns the post-retirement rate's rejection,
        // and the equal-rates regression contract pins its exact wording.
        expect(() => calculateRequiredNestEgg(6_000_000, 0.06, 0, 65, 80, 'perpetual')).toThrow(
          'positive'
        )
        expect(() =>
          calculateRequiredNestEgg(6_000_000, -0.01, -0.01, 65, 80, 'perpetual')
        ).toThrow('positive')
      })
    })
  })

  describe('solveRetirementAccumulation', () => {
    const baseInput: RetirementAccumulationInput = {
      currentAge: 35,
      currentSavedCents: 5_954_100, // $59,541
      monthlySavingsCents: 179_900, // $1,799/mo
      annualReturnRate: 0.06,
      // Equal to the accumulation rate, so every expectation in this describe
      // reproduces the pre-35.3 single-rate results bit-for-bit.
      postRetirementReturnRate: 0.06,
      desiredAnnualIncomeCents: 4_000_000, // $40,000/yr
      lifeExpectancy: 80,
      model: 'deplete',
    }

    it('always reports saved-per-year = monthly × 12', () => {
      const result = solveRetirementAccumulation(baseInput)
      expect(result.savedPerYearCents).toBe(2_158_800) // $1,799 × 12 = $21,588
    })

    it('finds the earliest reachable retirement age (deplete) with consistent outputs', () => {
      const result = solveRetirementAccumulation(baseInput)

      expect(result.reachable).toBe(true)
      expect(result.monthsToRetirement).not.toBeNull()
      const months = result.monthsToRetirement as number
      expect(Number.isInteger(months)).toBe(true)
      expect(months).toBeGreaterThanOrEqual(0)

      // Output invariants: age/years derive from the month count.
      expect(result.yearsToRetirement).toBe(months / 12)
      expect(result.earliestRetirementAge).toBe(35 + months / 12)

      // The crossing holds at the reported month and fails one month earlier.
      const projected = result.projectedNestEggCents as number
      const required = result.requiredNestEggCents as number
      expect(projected).toBeGreaterThanOrEqual(required)
      if (months > 0) {
        const prevAge = 35 + (months - 1) / 12
        const prevProjected = projectAccumulatedNestEgg(5_954_100, 179_900, 0.06, months - 1)
        const prevRequired = calculateRequiredNestEgg(4_000_000, 0.06, 0.06, prevAge, 80, 'deplete')
        expect(prevProjected).toBeLessThan(prevRequired)
      }
    })

    it('is deterministic (same inputs → same result)', () => {
      expect(solveRetirementAccumulation(baseInput)).toEqual(solveRetirementAccumulation(baseInput))
    })

    it('retires immediately when already fully funded (deplete)', () => {
      const result = solveRetirementAccumulation({
        ...baseInput,
        currentSavedCents: 100_000_000, // $1,000,000 already saved
        desiredAnnualIncomeCents: 1_200_000, // $12,000/yr × 45 yrs = $540,000 required at 35
      })
      expect(result.reachable).toBe(true)
      expect(result.monthsToRetirement).toBe(0)
      expect(result.earliestRetirementAge).toBe(35)
    })

    it('reports not-reachable when nothing is saved and income is required (deplete)', () => {
      const result = solveRetirementAccumulation({
        ...baseInput,
        currentSavedCents: 0,
        monthlySavingsCents: 0,
        desiredAnnualIncomeCents: 4_000_000,
      })
      expect(result.reachable).toBe(false)
      expect(result.monthsToRetirement).toBeNull()
      expect(result.earliestRetirementAge).toBeNull()
      expect(result.projectedNestEggCents).toBeNull()
      expect(result.requiredNestEggCents).toBeNull()
      expect(result.savedPerYearCents).toBe(0) // still populated
    })

    it('reports not-reachable when the perpetual target is never met before life expectancy', () => {
      const result = solveRetirementAccumulation({
        currentAge: 60,
        currentSavedCents: 0,
        monthlySavingsCents: 10_000, // $100/mo
        annualReturnRate: 0.06,
        postRetirementReturnRate: 0.06,
        desiredAnnualIncomeCents: 100_000_000, // $1,000,000/yr → required ≈ $16.7M
        lifeExpectancy: 65,
        model: 'perpetual',
      })
      expect(result.reachable).toBe(false)
    })

    it('perpetual with a zero/sub-precision return rate is not reachable (no throw)', () => {
      // ⚠️ BOTH rates must be overridden. Since story 35.3 the sub-precision
      // pre-check reads the POST-RETIREMENT rate (the perpetual target is sized
      // by it), so overriding `annualReturnRate` alone would leave the post rate
      // at baseInput's 0.06, the guard would not fire, and the solve would
      // succeed — required $666,666 is cleared by the rate-0 projection at month
      // 338, inside maxMonths 540. `reachable` would flip to true and this guard
      // would silently stop guarding anything.
      const result = solveRetirementAccumulation({
        ...baseInput,
        annualReturnRate: 0,
        postRetirementReturnRate: 0,
        model: 'perpetual',
      })
      expect(result.reachable).toBe(false)
    })

    it('perpetual: a sub-precision POST-RETIREMENT rate alone is not reachable (AC-4)', () => {
      // The accumulation rate is healthy; only the withdrawal-phase rate is
      // below the precision floor. This is the case the pre-check now exists for,
      // and it is unreachable by the pre-35.3 single-rate test above.
      const result = solveRetirementAccumulation({
        ...baseInput,
        annualReturnRate: 0.06,
        postRetirementReturnRate: 0,
        model: 'perpetual',
      })
      expect(result.reachable).toBe(false)
      expect(result.requiredNestEggCents).toBeNull()
    })

    it('is not reachable when current age is at or past life expectancy', () => {
      expect(
        solveRetirementAccumulation({ ...baseInput, currentAge: 80, lifeExpectancy: 80 }).reachable
      ).toBe(false)
      expect(
        solveRetirementAccumulation({ ...baseInput, currentAge: 85, lifeExpectancy: 80 }).reachable
      ).toBe(false)
    })

    it('always reports a finite saved-per-year, even on a not-reachable early return', () => {
      // Regression: monthlySavings must be validated so NaN/Infinity cannot leak
      // into savedPerYearCents via the pre-loop early returns.
      const result = solveRetirementAccumulation({
        ...baseInput,
        currentAge: 80,
        lifeExpectancy: 80,
      })
      expect(result.reachable).toBe(false)
      expect(Number.isFinite(result.savedPerYearCents)).toBe(true)
    })

    it('throws on non-finite savings or a non-finite/negative rate (both models, no silent swallow)', () => {
      expect(() =>
        solveRetirementAccumulation({ ...baseInput, monthlySavingsCents: Number.NaN })
      ).toThrow('finite')
      expect(() =>
        solveRetirementAccumulation({ ...baseInput, currentSavedCents: Number.NaN })
      ).toThrow('finite')
      expect(() =>
        solveRetirementAccumulation({ ...baseInput, desiredAnnualIncomeCents: Number.NaN })
      ).toThrow('finite')
      expect(() =>
        solveRetirementAccumulation({ ...baseInput, annualReturnRate: Number.NaN })
      ).toThrow('non-negative finite')
      expect(() => solveRetirementAccumulation({ ...baseInput, annualReturnRate: -0.01 })).toThrow(
        'non-negative finite'
      )
      // The perpetual model must not silently swallow a NaN rate into not-reachable.
      expect(() =>
        solveRetirementAccumulation({
          ...baseInput,
          model: 'perpetual',
          annualReturnRate: Number.NaN,
        })
      ).toThrow('non-negative finite')

      // The post-retirement rate is guarded identically, and its message names
      // the phase so the two are distinguishable (AC-9).
      expect(() =>
        solveRetirementAccumulation({ ...baseInput, postRetirementReturnRate: Number.NaN })
      ).toThrow('Post-retirement return rate must be a non-negative finite number')
      expect(() =>
        solveRetirementAccumulation({ ...baseInput, postRetirementReturnRate: -0.01 })
      ).toThrow('Post-retirement return rate must be a non-negative finite number')
      expect(() =>
        solveRetirementAccumulation({
          ...baseInput,
          model: 'perpetual',
          postRetirementReturnRate: Number.NaN,
        })
      ).toThrow('Post-retirement return rate must be a non-negative finite number')
    })

    it('terminates on a non-physical life expectancy without hanging (perpetual is age-independent)', () => {
      // The perpetual required nest egg does not depend on life expectancy, so a
      // huge value must yield the same reachable crossing — proving the horizon
      // cap bounds the loop without changing realistic results.
      const perpetualBase: RetirementAccumulationInput = { ...baseInput, model: 'perpetual' }
      const normal = solveRetirementAccumulation(perpetualBase)
      const huge = solveRetirementAccumulation({ ...perpetualBase, lifeExpectancy: 1_000_000 })

      expect(normal.reachable).toBe(true)
      expect(huge.reachable).toBe(true)
      expect(huge.monthsToRetirement).toBe(normal.monthsToRetirement)
    })

    describe('two-rate solving (story 35.3)', () => {
      // Story §3.3's published fixture. Accumulation 6% throughout.
      const sweepBase: RetirementAccumulationInput = {
        currentAge: 35,
        currentSavedCents: 5_954_100, // $59,541
        monthlySavingsCents: 179_900, // $1,799/mo
        annualReturnRate: 0.06,
        postRetirementReturnRate: 0.06,
        desiredAnnualIncomeCents: 6_000_000, // $60,000/yr
        lifeExpectancy: 90,
        model: 'deplete',
      }

      it('equal rates reproduce the shipped single-rate solve exactly (AC-6)', () => {
        const result = solveRetirementAccumulation(sweepBase)
        expect(result.reachable).toBe(true)
        expect(result.monthsToRetirement).toBe(320)
        expect(result.earliestRetirementAge).toBe(35 + 320 / 12)
        expect(result.requiredNestEggCents).toBe(170_000_000)
      })

      it('a lower post-retirement rate pushes retirement LATER (AC-7)', () => {
        // Pinned as literals, not only as comparisons: a direction-only assertion
        // survives mutations that move the numbers while preserving monotonicity.
        const months = [0.06, 0.05, 0.04, 0.03].map((postRetirementReturnRate) => {
          const result = solveRetirementAccumulation({ ...sweepBase, postRetirementReturnRate })
          expect(result.reachable).toBe(true)
          expect(Number.isInteger(result.monthsToRetirement)).toBe(true)
          return result.monthsToRetirement as number
        })
        expect(months).toEqual([320, 334, 348, 360])

        const required = [0.06, 0.05, 0.04, 0.03].map(
          (postRetirementReturnRate) =>
            solveRetirementAccumulation({ ...sweepBase, postRetirementReturnRate })
              .requiredNestEggCents as number
        )
        expect(required).toEqual([170_000_000, 185_030_631, 199_964_997, 216_263_200])
      })

      it('the requirement rises strictly as the post-retirement rate falls, both models', () => {
        for (const model of ['deplete', 'perpetual'] as const) {
          let previous = 0
          for (const postRetirementReturnRate of [0.06, 0.05, 0.04, 0.03, 0.02]) {
            const required = calculateRequiredNestEgg(
              sweepBase.desiredAnnualIncomeCents,
              sweepBase.annualReturnRate,
              postRetirementReturnRate,
              65,
              90,
              model
            )
            expect(required).toBeGreaterThan(previous)
            previous = required
          }
        }
      })

      it('the PROJECTION never sees the post-retirement rate (AC-5)', () => {
        // ⚠️ Written as an IDENTITY check, not a constancy check. The solver
        // returns projectedNestEggCents at the EARLIEST REACHABLE month, which
        // legitimately differs per post rate — asserting equality across rates
        // would fail against correct code. What must hold is that the value is
        // exactly the accumulation curve evaluated at the month it stopped on.
        // The loop must include an UNEQUAL rate: the 0.06 row alone cannot
        // distinguish the two rates.
        for (const postRetirementReturnRate of [0.06, 0.04, 0.03]) {
          const result = solveRetirementAccumulation({ ...sweepBase, postRetirementReturnRate })
          expect(result.reachable).toBe(true)
          expect(result.projectedNestEggCents).toBe(
            projectAccumulatedNestEgg(
              sweepBase.currentSavedCents,
              sweepBase.monthlySavingsCents,
              sweepBase.annualReturnRate, // accumulation rate ONLY
              result.monthsToRetirement as number
            )
          )
        }
      })

      it('a low enough post-retirement rate alone makes retirement unreachable (AC-7)', () => {
        // Perpetual, because its requirement is annual/rate and so grows without
        // bound as the withdrawal rate falls. (Deplete converges instead — its
        // requirement shrinks toward zero as retirement approaches life
        // expectancy, so it stays reachable across the whole legal rate range on
        // this fixture. Worth knowing before writing a deplete version of this.)
        const perpetual: RetirementAccumulationInput = { ...sweepBase, model: 'perpetual' }

        const reachable = solveRetirementAccumulation(perpetual)
        expect(reachable.reachable).toBe(true)
        expect(reachable.monthsToRetirement).toBe(236)
        expect(reachable.requiredNestEggCents).toBe(100_000_000)

        // 0.5% is well ABOVE the 0.1% precision floor, so this is a genuine
        // "the money runs out of time" result, not the sub-precision pre-check.
        const starved = solveRetirementAccumulation({
          ...perpetual,
          postRetirementReturnRate: 0.005,
        })
        expect(starved.reachable).toBe(false)
        expect(starved.monthsToRetirement).toBeNull()

        // One notch higher it is still reachable — pinning the flip means a
        // change that merely shifts the boundary cannot pass unnoticed.
        expect(
          solveRetirementAccumulation({ ...perpetual, postRetirementReturnRate: 0.006 }).reachable
        ).toBe(true)
      })
    })
  })
})
