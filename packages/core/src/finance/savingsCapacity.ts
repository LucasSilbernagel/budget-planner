/**
 * Savings Capacity Percentage Calculation
 *
 * Calculates the percentage of income that represents savings capacity.
 * Formula: (sum of normalized income - net period income) × 100
 *
 * Note: This formula is based on the specification in the user stories.
 * Where netPeriodIncome = normalizedIncome - normalizedExpenses,
 * savingsCapacity = normalizedIncome - netPeriodIncome = normalizedExpenses
 * So savingsCapacityPercentage = normalizedExpenses / normalizedIncome × 100
 *
 * Architecture Requirement: FR6 - Core calculations
 */

import {
  type Frequency,
  type NormalizableFinancialItem,
  calculateGrossPeriodIncome,
  calculateNetPeriodIncome,
} from './netIncome'
import { calculateTotalMonthlyNormalized, normalizeToMonthly } from './normalization'

/**
 * Calculates savings capacity percentage
 * Formula: ((grossIncome - netPeriodIncome) / grossIncome) × 100
 * Which simplifies to: (normalizedExpenses / grossIncome) × 100
 *
 * @param incomeSources - Array of income sources with amount and frequency
 * @param expenses - Array of expenses with amount and frequency
 * @returns Savings capacity as a percentage (0-100)
 */
export function calculateSavingsCapacityPercentage(
  incomeSources: NormalizableFinancialItem[],
  expenses: NormalizableFinancialItem[]
): number {
  const sources = incomeSources || []
  const expensesArray = expenses || []
  const grossIncome = calculateGrossPeriodIncome(sources)
  const netPeriodIncome = calculateNetPeriodIncome(sources, expensesArray)

  // Formula: (sum of normalized income - net period income) × 100
  // Which is: (grossIncome - netPeriodIncome) / grossIncome × 100
  // And since netPeriodIncome = grossIncome - normalizedExpenses,
  // this becomes: (grossIncome - (grossIncome - normalizedExpenses)) / grossIncome × 100
  // = normalizedExpenses / grossIncome × 100

  if (grossIncome === 0) {
    return 0
  }

  const savingsCapacity = grossIncome - netPeriodIncome
  const percentage = (savingsCapacity / grossIncome) * 100

  return Math.round(percentage)
}

/**
 * Calculates the maximum amount that can be allocated to savings
 * This is the net period income (income - expenses) after normalization
 *
 * @param incomeSources - Array of income sources with amount and frequency
 * @param expenses - Array of expenses with amount and frequency
 * @returns Maximum allocable savings in cents (can be negative if expenses exceed income)
 */
export function calculateMaxAllocableSavings(
  incomeSources: NormalizableFinancialItem[],
  expenses: NormalizableFinancialItem[]
): number {
  return calculateNetPeriodIncome(incomeSources || [], expenses || [])
}

/**
 * Calculates the maximum dynamically allocable savings
 * This ensures the value is never negative (returns 0 if expenses exceed income)
 *
 * @param incomeSources - Array of income sources with amount and frequency
 * @param expenses - Array of expenses with amount and frequency
 * @returns Maximum dynamically allocable savings in cents (always >= 0)
 */
export function calculateMaxDynamicallyAllocableSavings(
  incomeSources: NormalizableFinancialItem[],
  expenses: NormalizableFinancialItem[]
): number {
  const maxAllocable = calculateMaxAllocableSavings(incomeSources, expenses)
  return Math.max(0, maxAllocable)
}

/**
 * Result type for savings capacity calculation
 */
export interface SavingsCapacityResult {
  grossIncome: number // In cents, normalized to monthly
  netPeriodIncome: number // In cents, normalized to monthly
  savingsCapacityPercentage: number // Percentage (0-100)
  maxAllocableSavings: number // In cents, can be negative
}

/**
 * Calculates detailed savings capacity result
 * @param incomeSources - Array of income sources with amount and frequency
 * @param expenses - Array of expenses with amount and frequency
 * @returns Object with all savings capacity information
 */
export function calculateSavingsCapacityResult(
  incomeSources: NormalizableFinancialItem[],
  expenses: NormalizableFinancialItem[]
): SavingsCapacityResult {
  const sources = incomeSources || []
  const expensesArray = expenses || []
  const grossIncome = calculateGrossPeriodIncome(sources)
  const netPeriodIncome = calculateNetPeriodIncome(sources, expensesArray)
  const savingsCapacityPercentage = calculateSavingsCapacityPercentage(incomeSources, expenses)
  const maxAllocableSavings = netPeriodIncome

  return {
    grossIncome,
    netPeriodIncome,
    savingsCapacityPercentage,
    maxAllocableSavings,
  }
}
