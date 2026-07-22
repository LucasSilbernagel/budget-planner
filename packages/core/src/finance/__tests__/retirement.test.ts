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
      expect(calculateRequiredNestEgg(4_000_000, 0.06, 65, 80, 'deplete')).toBe(60_000_000)
    })

    it('deplete: works at zero return (growth = discount = 0 collapses the same way)', () => {
      // 15 years × $40,000 = $600,000, independent of the rate under this convention.
      expect(calculateRequiredNestEgg(4_000_000, 0, 65, 80, 'deplete')).toBe(60_000_000)
    })

    it('deplete: retirement age at/after life expectancy needs nothing', () => {
      expect(calculateRequiredNestEgg(4_000_000, 0.06, 80, 80, 'deplete')).toBe(0)
      expect(calculateRequiredNestEgg(4_000_000, 0.06, 85, 80, 'deplete')).toBe(0)
    })

    it('perpetual: equals the shipped Safe Withdrawal Model, independent of ages', () => {
      // $60,000/yr at 6% → monthly $5,000 → FV = 5000 × (12/0.06) = $1,000,000.
      const expected = calculateRequiredAssets(toMonthlyIncomeCents(6_000_000, 'annual'), 0.06)
      expect(expected).toBe(100_000_000)

      const required = calculateRequiredNestEgg(6_000_000, 0.06, 65, 80, 'perpetual')
      expect(required).toBe(100_000_000)
      // Life expectancy / retirement age must not affect the perpetual target.
      expect(calculateRequiredNestEgg(6_000_000, 0.06, 40, 120, 'perpetual')).toBe(100_000_000)
    })

    it('perpetual: throws on a non-positive return rate (shipped contract)', () => {
      expect(() => calculateRequiredNestEgg(6_000_000, 0, 65, 80, 'perpetual')).toThrow('positive')
      expect(() => calculateRequiredNestEgg(6_000_000, -0.01, 65, 80, 'perpetual')).toThrow(
        'positive'
      )
    })
  })

  describe('solveRetirementAccumulation', () => {
    const baseInput: RetirementAccumulationInput = {
      currentAge: 35,
      currentSavedCents: 5_954_100, // $59,541
      monthlySavingsCents: 179_900, // $1,799/mo
      annualReturnRate: 0.06,
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
        const prevRequired = calculateRequiredNestEgg(4_000_000, 0.06, prevAge, 80, 'deplete')
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
        desiredAnnualIncomeCents: 100_000_000, // $1,000,000/yr → required ≈ $16.7M
        lifeExpectancy: 65,
        model: 'perpetual',
      })
      expect(result.reachable).toBe(false)
    })

    it('perpetual with a zero/sub-precision return rate is not reachable (no throw)', () => {
      const result = solveRetirementAccumulation({
        ...baseInput,
        annualReturnRate: 0,
        model: 'perpetual',
      })
      expect(result.reachable).toBe(false)
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
  })
})
