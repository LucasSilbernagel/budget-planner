/**
 * Net Period Income Calculation
 *
 * Calculates net period income by normalizing all income and expense values
 * to a monthly base and then computing: totalNormalizedIncome - totalNormalizedExpenses
 *
 * Architecture Requirement: FR5 - Core calculations
 */

import {
  type Frequency,
  calculateTotalMonthlyNormalized,
  normalizeToMonthly,
} from './normalization'

/**
 * Interface for financial items that can be normalized
 */
export interface NormalizableFinancialItem {
  amount: number
  frequency: Frequency
}

/**
 * Calculates net period income from income sources and expenses
 * @param incomeSources - Array of income sources with amount and frequency
 * @param expenses - Array of expenses with amount and frequency
 * @returns Net period income in cents (positive = surplus, negative = deficit)
 */
export function calculateNetPeriodIncome(
  incomeSources: NormalizableFinancialItem[],
  expenses: NormalizableFinancialItem[]
): number {
  const sources = incomeSources || []
  const expensesArray = expenses || []
  const totalNormalizedIncome = calculateTotalMonthlyNormalized(sources)
  const totalNormalizedExpenses = calculateTotalMonthlyNormalized(expensesArray)

  // Net period income = income - expenses
  return totalNormalizedIncome - totalNormalizedExpenses
}

/**
 * Calculates gross period income from income sources
 * @param incomeSources - Array of income sources with amount and frequency
 * @returns Gross period income in cents (always positive or zero)
 */
export function calculateGrossPeriodIncome(incomeSources: NormalizableFinancialItem[]): number {
  return calculateTotalMonthlyNormalized(incomeSources || [])
}

/**
 * Calculates total period expenses from expenses
 * @param expenses - Array of expenses with amount and frequency
 * @returns Total period expenses in cents (always positive or zero)
 */
export function calculateTotalPeriodExpenses(expenses: NormalizableFinancialItem[]): number {
  return calculateTotalMonthlyNormalized(expenses || [])
}

/**
 * Result type for net income calculation
 */
export interface NetIncomeResult {
  grossIncome: number // In cents, normalized to monthly
  totalExpenses: number // In cents, normalized to monthly
  netIncome: number // In cents, can be positive or negative
  isSurplus: boolean // True if netIncome >= 0
}

/**
 * Calculates detailed net income result with breakdown
 * @param incomeSources - Array of income sources with amount and frequency
 * @param expenses - Array of expenses with amount and frequency
 * @returns Object with grossIncome, totalExpenses, netIncome, and isSurplus
 */
export function calculateNetIncomeResult(
  incomeSources: NormalizableFinancialItem[],
  expenses: NormalizableFinancialItem[]
): NetIncomeResult {
  const grossIncome = calculateGrossPeriodIncome(incomeSources)
  const totalExpenses = calculateTotalPeriodExpenses(expenses)
  const netIncome = grossIncome - totalExpenses

  return {
    grossIncome,
    totalExpenses,
    netIncome,
    isSurplus: netIncome > 0,
  }
}
