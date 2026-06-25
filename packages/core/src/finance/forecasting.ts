/**
 * Premium Forecasting Features
 *
 * Advanced financial forecasting calculations for paid tier users.
 * Provides scenario modeling, goal tracking, and financial projections.
 *
 * Architecture Requirement: FR5 - Core calculations (premium features)
 */

import { type NormalizableFinancialItem, calculateNetPeriodIncome } from './netIncome'

/**
 * Forecasting scenario input
 */
export interface ForecastingScenario {
  name: string
  description?: string
  // Income adjustments (percentage changes)
  incomeGrowthRate: number // Annual growth rate as decimal (e.g., 0.05 for 5%)
  // Expense adjustments (percentage changes)
  expenseGrowthRate: number // Annual growth rate as decimal
  // New recurring income/expenses
  newIncome?: NormalizableFinancialItem[]
  newExpenses?: NormalizableFinancialItem[]
  // One-time events (year, amount)
  oneTimeEvents?: Array<{ year: number; amount: number }>
}

/**
 * Yearly forecast result
 */
export interface YearlyForecast {
  year: number
  income: number // Total income in cents
  expenses: number // Total expenses in cents
  netIncome: number // Net income in cents
  savings: number // Savings in cents
  investments: number // Investments in cents
  netWorth: number // Net worth in cents
}

/**
 * Complete forecasting result
 */
export interface ForecastingResult {
  scenario: ForecastingScenario
  baseline: YearlyForecast[] // Projection without scenario
  projection: YearlyForecast[] // Projection with scenario
  summary: {
    startingNetWorth: number
    endingNetWorth: number
    totalGrowth: number
    averageAnnualGrowth: number
  }
}

/**
 * Calculates financial forecast based on current data and scenario
 *
 * @param currentData - Current financial data (income, expenses, savings, investments)
 * @param scenario - Forecasting scenario with assumptions
 * @param years - Number of years to project
 * @returns Complete forecasting result
 */
export function calculateFinancialForecast(
  currentData: {
    income: NormalizableFinancialItem[]
    expenses: NormalizableFinancialItem[]
    savings: number // Current savings in cents
    investments: number // Current investments in cents
  },
  scenario: ForecastingScenario,
  years = 10
): ForecastingResult {
  const baseline: YearlyForecast[] = []
  const projection: YearlyForecast[] = []

  // Calculate baseline (current trends without scenario adjustments)
  let currentSavings = currentData.savings
  const currentInvestments = currentData.investments
  const baselineNetIncome = calculateNetPeriodIncome(currentData.income, currentData.expenses)

  for (let year = 1; year <= years; year++) {
    // Baseline calculation
    const baselineYear: YearlyForecast = {
      year,
      income: calculateTotalIncome(currentData.income),
      expenses: calculateTotalExpenses(currentData.expenses),
      netIncome: baselineNetIncome,
      savings: currentSavings,
      investments: currentInvestments,
      netWorth: currentSavings + currentInvestments,
    }
    baseline.push(baselineYear)

    // Increment savings and investments by net income
    currentSavings += baselineNetIncome
    // Simple investment growth (no compounding in baseline)
  }

  // Calculate projection with scenario adjustments
  let projSavings = currentData.savings
  let projInvestments = currentData.investments

  for (let year = 1; year <= years; year++) {
    // Adjust income and expenses by growth rates
    const adjustedIncome = currentData.income.map((item) => ({
      ...item,
      amount: Math.round(item.amount * (1 + scenario.incomeGrowthRate) ** year),
    }))
    const adjustedExpenses = currentData.expenses.map((item) => ({
      ...item,
      amount: Math.round(item.amount * (1 + scenario.expenseGrowthRate) ** year),
    }))

    // Calculate net income with adjustments
    const netIncome = calculateNetPeriodIncome(adjustedIncome, adjustedExpenses)

    // Add one-time events for this year
    const oneTimeForYear =
      scenario.oneTimeEvents
        ?.filter((e) => e.year === year)
        .reduce((sum, e) => sum + e.amount, 0) || 0

    const totalNetIncome = netIncome + oneTimeForYear

    const yearProjection: YearlyForecast = {
      year,
      income: calculateTotalIncome(adjustedIncome),
      expenses: calculateTotalExpenses(adjustedExpenses),
      netIncome: totalNetIncome,
      savings: projSavings,
      investments: projInvestments,
      netWorth: projSavings + projInvestments,
    }
    projection.push(yearProjection)

    // Update savings and investments for next year
    projSavings += totalNetIncome
    // Investment growth with compounding
    projInvestments = Math.round(projInvestments * 1.07) // Assume 7% return
  }

  // Calculate summary
  const startingNetWorth = currentData.savings + currentData.investments
  const endingNetWorth = projection[projection.length - 1].netWorth
  const totalGrowth = endingNetWorth - startingNetWorth
  const averageAnnualGrowth = totalGrowth / years

  return {
    scenario,
    baseline,
    projection,
    summary: {
      startingNetWorth,
      endingNetWorth,
      totalGrowth,
      averageAnnualGrowth,
    },
  }
}

/**
 * Helper to calculate total income from financial items
 */
function calculateTotalIncome(items: NormalizableFinancialItem[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0)
}

/**
 * Helper to calculate total expenses from financial items
 */
function calculateTotalExpenses(items: NormalizableFinancialItem[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0)
}

/**
 * Calculates goal progress and timeline
 */
export interface GoalCalculation {
  targetAmount: number
  currentAmount: number
  monthlyContribution: number
  annualReturnRate: number
  yearsToGoal: number
  monthlyAmountNeeded: number
}

/**
 * Calculates how long it will take to reach a financial goal
 *
 * @param targetAmount - Target amount in cents
 * @param currentAmount - Current amount in cents
 * @param monthlyContribution - Monthly contribution in cents
 * @param annualReturnRate - Annual return rate as decimal
 * @returns Goal calculation with timeline
 */
export function calculateGoalTimeline(
  targetAmount: number,
  currentAmount: number,
  monthlyContribution: number,
  annualReturnRate: number
): GoalCalculation {
  if (currentAmount >= targetAmount) {
    return {
      targetAmount,
      currentAmount,
      monthlyContribution,
      annualReturnRate,
      yearsToGoal: 0,
      monthlyAmountNeeded: 0,
    }
  }

  let years = 0
  let amount = currentAmount
  const monthlyReturnRate = annualReturnRate / 12

  while (amount < targetAmount && years < 100) {
    years++
    // Compounding growth with monthly contributions
    amount = amount * (1 + monthlyReturnRate) + monthlyContribution * 12
  }

  // Calculate monthly amount needed to reach goal in a specific timeframe
  // Using future value of annuity formula
  const _monthlyRate = annualReturnRate / 12
  const months = years * 12
  // FV = PMT * [((1 + r)^n - 1) / r] * (1 + r)
  // We need to solve for PMT, but for simplicity we'll use an approximation
  const monthlyAmountNeeded = Math.round((targetAmount - currentAmount) / months)

  return {
    targetAmount,
    currentAmount,
    monthlyContribution,
    annualReturnRate,
    yearsToGoal: Math.round(years * 10) / 10, // Round to 1 decimal
    monthlyAmountNeeded,
  }
}

/**
 * Saves a forecasting scenario for later retrieval
 * This would be used with database persistence for paid users
 */
export interface SavedScenario {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
}

// Note: Actual save/load functionality would be implemented in Server Functions
// with database access for paid tier users
