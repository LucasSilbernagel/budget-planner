/**
 * Finance Module Index Tests
 * 
 * Tests that all exports from the finance module index are properly exported
 * and accessible. This ensures the module's public API is correctly exposed.
 * 
 * Zero tolerance for errors - NFR3 requirement
 */

import { describe, it, expect } from 'vitest'
import * as finance from '../index'

describe('Finance Module Index', () => {
  describe('Normalization exports', () => {
    it('should export normalizeToMonthly function', () => {
      expect(typeof finance.normalizeToMonthly).toBe('function')
    })

    it('should export getNormalizationMultiplier function', () => {
      expect(typeof finance.getNormalizationMultiplier).toBe('function')
    })

    it('should export denormalizeFromMonthly function', () => {
      expect(typeof finance.denormalizeFromMonthly).toBe('function')
    })

    it('should export calculateTotalMonthlyNormalized function', () => {
      expect(typeof finance.calculateTotalMonthlyNormalized).toBe('function')
    })

    it('should export Frequency type', () => {
      // Verify it's a type by using it
      const freq: finance.Frequency = 'weekly'
      expect(freq).toBe('weekly')
    })

    it('should export all frequency values', () => {
      const frequencies: finance.Frequency[] = ['weekly', 'biweekly', 'monthly', 'annually']
      expect(frequencies).toContain('weekly')
      expect(frequencies).toContain('biweekly')
      expect(frequencies).toContain('monthly')
      expect(frequencies).toContain('annually')
    })
  })

  describe('Net Income exports', () => {
    it('should export calculateNetPeriodIncome function', () => {
      expect(typeof finance.calculateNetPeriodIncome).toBe('function')
    })

    it('should export calculateGrossPeriodIncome function', () => {
      expect(typeof finance.calculateGrossPeriodIncome).toBe('function')
    })

    it('should export calculateTotalPeriodExpenses function', () => {
      expect(typeof finance.calculateTotalPeriodExpenses).toBe('function')
    })

    it('should export calculateNetIncomeResult function', () => {
      expect(typeof finance.calculateNetIncomeResult).toBe('function')
    })

    it('should export NormalizableFinancialItem interface', () => {
      // Verify it's a type by creating an instance
      const item: finance.NormalizableFinancialItem = {
        amount: 10000,
        frequency: 'monthly',
      }
      expect(item.amount).toBe(10000)
      expect(item.frequency).toBe('monthly')
    })

    it('should export NetIncomeResult interface', () => {
      const result: finance.NetIncomeResult = {
        grossIncome: 50000,
        totalExpenses: 20000,
        netIncome: 30000,
        isSurplus: true,
      }
      expect(result.netIncome).toBe(30000)
    })
  })

  describe('Savings Capacity exports', () => {
    it('should export calculateSavingsCapacityPercentage function', () => {
      expect(typeof finance.calculateSavingsCapacityPercentage).toBe('function')
    })

    it('should export calculateMaxAllocableSavings function', () => {
      expect(typeof finance.calculateMaxAllocableSavings).toBe('function')
    })

    it('should export calculateMaxDynamicallyAllocableSavings function', () => {
      expect(typeof finance.calculateMaxDynamicallyAllocableSavings).toBe('function')
    })

    it('should export calculateSavingsCapacityResult function', () => {
      expect(typeof finance.calculateSavingsCapacityResult).toBe('function')
    })

    it('should export SavingsCapacityResult interface', () => {
      const result: finance.SavingsCapacityResult = {
        grossIncome: 50000,
        netPeriodIncome: 30000,
        savingsCapacityPercentage: 40,
        maxAllocableSavings: 30000,
      }
      expect(result.savingsCapacityPercentage).toBe(40)
    })
  })

  describe('Retirement exports', () => {
    it('should export calculateRetirementRequirement function', () => {
      expect(typeof finance.calculateRetirementRequirement).toBe('function')
    })

    it('should export calculateRequiredAssets function', () => {
      expect(typeof finance.calculateRequiredAssets).toBe('function')
    })

    it('should export calculateSafeMonthlyWithdrawal function', () => {
      expect(typeof finance.calculateSafeMonthlyWithdrawal).toBe('function')
    })

    it('should export calculateCompoundingProjection function', () => {
      expect(typeof finance.calculateCompoundingProjection).toBe('function')
    })

    it('should export RetirementInput interface', () => {
      const input: finance.RetirementInput = {
        monthlyIncome: 500000,
        annualReturnRate: 0.06,
      }
      expect(input.monthlyIncome).toBe(500000)
    })

    it('should export RetirementResult interface', () => {
      const result: finance.RetirementResult = {
        requiredAssets: 100000000,
        requiredAssetsFormatted: '$1,000,000.00',
        monthlyIncome: 500000,
        monthlyIncomeFormatted: '$5,000.00',
        annualReturnRate: 0.06,
        annualReturnRatePercentage: 6,
      }
      expect(result.requiredAssets).toBe(100000000)
    })

    it('should export CompoundingInput interface', () => {
      const input: finance.CompoundingInput = {
        principal: 1000000,
        annualContribution: 100000,
        annualReturnRate: 0.05,
        years: 10,
      }
      expect(input.years).toBe(10)
    })

    it('should export YearlyProjection interface', () => {
      const projection: finance.YearlyProjection = {
        year: 1,
        startingBalance: 1000000,
        annualContribution: 100000,
        endingBalance: 1100000,
      }
      expect(projection.year).toBe(1)
    })
  })

  describe('Forecasting exports', () => {
    it('should export calculateFinancialForecast function', () => {
      expect(typeof finance.calculateFinancialForecast).toBe('function')
    })

    it('should export calculateGoalTimeline function', () => {
      expect(typeof finance.calculateGoalTimeline).toBe('function')
    })

    it('should export ForecastingScenario interface', () => {
      const scenario: finance.ForecastingScenario = {
        name: 'Test Scenario',
        description: 'Test description',
        incomeGrowthRate: 0.05,
        expenseGrowthRate: 0.03,
      }
      expect(scenario.name).toBe('Test Scenario')
    })

    it('should export ForecastingResult interface', () => {
      // Partial check - this is a complex interface
      const result: Partial<finance.ForecastingResult> = {
        scenario: {
          name: 'Test',
          incomeGrowthRate: 0.05,
          expenseGrowthRate: 0.03,
        },
      }
      expect(result.scenario?.name).toBe('Test')
    })

    it('should export YearlyForecast interface', () => {
      const forecast: finance.YearlyForecast = {
        year: 1,
        income: 5000000,
        expenses: 3000000,
        netIncome: 2000000,
        savings: 1000000,
        investments: 2000000,
        netWorth: 3000000,
      }
      expect(forecast.netWorth).toBe(3000000)
    })

    it('should export GoalCalculation interface', () => {
      const goal: finance.GoalCalculation = {
        targetAmount: 100000000,
        currentAmount: 50000000,
        monthlyContribution: 1000000,
        annualReturnRate: 0.07,
        yearsToGoal: 10,
        monthlyAmountNeeded: 500000,
      }
      expect(goal.yearsToGoal).toBe(10)
    })

    it('should export SavedScenario interface', () => {
      const saved: finance.SavedScenario = {
        id: 'test-id',
        name: 'Test Saved Scenario',
        description: 'Test description',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      }
      expect(saved.id).toBe('test-id')
    })
  })

  describe('Functional integration tests', () => {
    it('should calculate normalization using exported function', () => {
      const result = finance.normalizeToMonthly(10000, 'weekly')
      // $100/week * 52/12 = $433.333... → 43333 cents
      expect(result).toBe(43333)
    })

    it('should calculate net period income using exported functions', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      
      const result = finance.calculateNetPeriodIncome(incomeSources, expenses)
      expect(result).toBe(30000)
    })

    it('should calculate savings capacity using exported function', () => {
      const incomeSources = [
        { amount: 50000, frequency: 'monthly' as const },
      ]
      const expenses = [
        { amount: 20000, frequency: 'monthly' as const },
      ]
      
      const result = finance.calculateSavingsCapacityPercentage(incomeSources, expenses)
      expect(result).toBe(40)
    })

    it('should calculate retirement requirement using exported function', () => {
      const result = finance.calculateRetirementRequirement({
        monthlyIncome: 500000, // $5000/month
        annualReturnRate: 0.06, // 6%
      })
      
      expect(result.requiredAssets).toBe(100000000) // $1,000,000
    })

    it('should verify all modules work together', () => {
      // Test net income
      const netIncome = finance.calculateNetPeriodIncome(
        [{ amount: 50000, frequency: 'monthly' as const }],
        [{ amount: 20000, frequency: 'monthly' as const }]
      )
      expect(netIncome).toBe(30000)
      
      // Test savings capacity
      const savingsCapacity = finance.calculateSavingsCapacityPercentage(
        [{ amount: 50000, frequency: 'monthly' as const }],
        [{ amount: 20000, frequency: 'monthly' as const }]
      )
      expect(savingsCapacity).toBe(40)
      
      // Test retirement
      const retirement = finance.calculateRequiredAssets(500000, 0.06)
      expect(retirement).toBe(100000000)
    })
  })

  describe('Mathematical Validation - Zero Tolerance', () => {
    it('should pass exact validation across all modules', () => {
      // Net income: $500 - $200 = $300 (30000 cents)
      expect(finance.calculateNetPeriodIncome(
        [{ amount: 50000, frequency: 'monthly' as const }],
        [{ amount: 20000, frequency: 'monthly' as const }]
      )).toBe(30000)
      
      // Savings capacity: (expenses / grossIncome) * 100 = 40%
      expect(finance.calculateSavingsCapacityPercentage(
        [{ amount: 50000, frequency: 'monthly' as const }],
        [{ amount: 20000, frequency: 'monthly' as const }]
      )).toBe(40)
      
      // Retirement: $5000 * (12 / 0.06) = $1,000,000
      expect(finance.calculateRequiredAssets(500000, 0.06)).toBe(100000000)
    })

    it('should calculate financial forecast using exported function', () => {
      const currentData = {
        income: [{ amount: 50000, frequency: 'monthly' as const }],
        expenses: [{ amount: 20000, frequency: 'monthly' as const }],
        savings: 1000000, // $10,000
        investments: 500000, // $5,000
      }
      const scenario: finance.ForecastingScenario = {
        name: 'Test Scenario',
        incomeGrowthRate: 0.05,
        expenseGrowthRate: 0.03,
      }
      
      const result = finance.calculateFinancialForecast(currentData, scenario, 1)
      
      // Verify structure
      expect(result.scenario).toBeDefined()
      expect(result.baseline).toBeDefined()
      expect(result.projection).toBeDefined()
      expect(result.summary).toBeDefined()
      expect(result.baseline.length).toBeGreaterThan(0)
      expect(result.projection.length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases - Zero Tolerance for Errors', () => {
    it('should handle empty arrays in net income calculation', () => {
      const result = finance.calculateNetPeriodIncome([], [])
      expect(result).toBe(0)
    })

    it('should handle zero amounts in normalization', () => {
      const result = finance.normalizeToMonthly(0, 'weekly')
      expect(result).toBe(0)
    })

    it('should handle break-even scenario in savings capacity', () => {
      const result = finance.calculateSavingsCapacityPercentage(
        [{ amount: 50000, frequency: 'monthly' as const }],
        [{ amount: 50000, frequency: 'monthly' as const }]
      )
      expect(result).toBe(100)
    })

    it('should handle zero income in retirement calculation', () => {
      const result = finance.calculateRequiredAssets(0, 0.06)
      expect(result).toBe(0)
    })
  })
})
