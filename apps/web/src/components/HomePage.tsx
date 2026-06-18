import React from 'react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { useIncomeSources, useExpenses, useSavingsGoals, useBalanceEntries } from '../stores'
import { APP_VERSION } from '../utils/version'
import { calculateNetIncomeResult } from '@budget-planner/core/finance'

// Colors for the charts
const INCOME_COLOR = '#10B981'
const EXPENSE_COLOR = '#EF4444'
const SAVINGS_COLOR = '#8B5CF6'
const INVESTMENT_COLOR = '#3B82F6'
const DEBT_COLOR = '#DC2626'

// Format amount in cents to dollars
const formatAmount = (cents: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

/**
 * Calculates a financial health score based on various financial metrics
 * Score is out of 100 points
 * Uses NORMALIZED values for income and expenses to ensure accurate ratios
 */
function calculateFinancialHealthScore(
  totalNormalizedIncome: number,
  totalNormalizedExpenses: number,
  totalSavings: number,
  totalInvestments: number,
  totalDebts: number
): number {
  let score = 0

  // Income vs Expenses ratio (max 40 points) - using NORMALIZED values
  if (totalNormalizedIncome > 0) {
    const expenseRatio = totalNormalizedExpenses / totalNormalizedIncome
    if (expenseRatio <= 0.5) {
      score += 40
    } else if (expenseRatio <= 0.8) {
      score += 30
    } else if (expenseRatio <= 1.0) {
      score += 20
    } else {
      score += 10
    }
  } else {
    score += 0
  }

  // Savings health (max 30 points)
  if (totalSavings > 0) {
    score += Math.min(30, totalSavings / 10000) // $100 = 1 point, max 30
  }

  // Investment health (max 20 points)
  if (totalInvestments > 0) {
    score += Math.min(20, totalInvestments / 5000) // $50 = 1 point, max 20
  }

  // Debt management (max 10 points)
  if (totalDebts === 0) {
    score += 10
  } else if (totalInvestments > totalDebts) {
    score += 5
  }

  return Math.min(100, Math.round(score))
}

export function HomePage() {
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()
  const savingsGoals = useSavingsGoals()
  const balanceEntries = useBalanceEntries()

  // Calculate normalized totals for consistent monthly comparison
  // This ensures income and expenses with different frequencies are comparable
  const netIncomeResult = calculateNetIncomeResult(
    incomeSources.map((s) => ({ amount: s.amount, frequency: s.frequency })),
    expenses.map((e) => ({ amount: e.amount, frequency: e.frequency }))
  )

  const totalNormalizedIncome = netIncomeResult.grossIncome
  const totalNormalizedExpenses = netIncomeResult.totalExpenses
  const netPeriodIncome = netIncomeResult.netIncome

  // Calculate totals for non-normalized display (raw amounts)
  const totalIncomeRaw = incomeSources.reduce(
    (sum, source) => sum + source.amount,
    0
  )
  const totalExpensesRaw = expenses.reduce(
    (sum, expense) => sum + expense.amount,
    0
  )
  const totalSavings = savingsGoals.reduce(
    (sum, goal) => sum + goal.currentBalance,
    0
  )
  const totalInvestments = balanceEntries
    .filter((entry) => entry.type === 'investment')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)
  const totalDebts = balanceEntries
    .filter((entry) => entry.type === 'debt')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)
  const netWorth = totalInvestments - totalDebts

  // Check if we have any data
  const hasData = incomeSources.length > 0 || expenses.length > 0

  // Prepare data for the income vs expense pie chart (using NORMALIZED values)
  const incomeVsExpenseData = [
    {
      name: 'Income',
      value: totalNormalizedIncome,
      color: INCOME_COLOR,
    },
    {
      name: 'Expenses',
      value: totalNormalizedExpenses,
      color: EXPENSE_COLOR,
    },
  ].filter((item) => item.value > 0)

  // Prepare data for the asset breakdown pie chart
  const assetBreakdownData = [
    {
      name: 'Savings',
      value: totalSavings,
      color: SAVINGS_COLOR,
    },
    {
      name: 'Investments',
      value: totalInvestments,
      color: INVESTMENT_COLOR,
    },
    {
      name: 'Debts',
      value: totalDebts,
      color: DEBT_COLOR,
    },
  ].filter((item) => item.value > 0)

  // Prepare data for the net worth over time bar chart (simplified)
  // This shows current state of different financial categories
  // Use normalized values for income and expenses to ensure consistent comparison
  const netWorthBarData = [
    {
      category: 'Income (Normalized)',
      amount: totalNormalizedIncome,
      fill: INCOME_COLOR,
    },
    {
      category: 'Expenses (Normalized)',
      amount: -totalNormalizedExpenses,
      fill: EXPENSE_COLOR,
    },
    {
      category: 'Savings',
      amount: totalSavings,
      fill: SAVINGS_COLOR,
    },
    {
      category: 'Investments',
      amount: totalInvestments,
      fill: INVESTMENT_COLOR,
    },
    {
      category: 'Debts',
      amount: -totalDebts,
      fill: DEBT_COLOR,
    },
  ].filter((item) => item.amount !== 0)

  // Calculate overall financial health score (0-100)
  // Using normalized values for accurate income/expense ratio
  const financialHealthScore = calculateFinancialHealthScore(
    totalNormalizedIncome,
    totalNormalizedExpenses,
    totalSavings,
    totalInvestments,
    totalDebts
  )

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Budget Planner</h1>
          <p className="text-gray-600 mt-2">
            Track your income and expenses with ease
          </p>
        </header>

        <main className="space-y-6">
          {/* Quick Stats */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Financial Overview
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Total Income (Monthly Normalized)</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatAmount(totalNormalizedIncome)}
                </p>
                {totalNormalizedIncome !== totalIncomeRaw && (
                  <p className="text-xs text-gray-400 mt-1">
                    Raw: {formatAmount(totalIncomeRaw)}
                  </p>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Total Expenses (Monthly Normalized)</p>
                <p className="text-2xl font-bold text-red-600">
                  {formatAmount(totalNormalizedExpenses)}
                </p>
                {totalNormalizedExpenses !== totalExpensesRaw && (
                  <p className="text-xs text-gray-400 mt-1">
                    Raw: {formatAmount(totalExpensesRaw)}
                  </p>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Net Period Income</p>
                <p
                  className={`text-2xl font-bold ${
                    netPeriodIncome >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {formatAmount(netPeriodIncome)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Net Worth</p>
                <p
                  className={`text-2xl font-bold ${
                    netWorth >= 0 ? 'text-purple-600' : 'text-red-600'
                  }`}
                >
                  {formatAmount(netWorth)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Financial Health</p>
                <p className="text-2xl font-bold text-blue-600">
                  {financialHealthScore}%
                </p>
              </div>
            </div>
          </section>

          {/* Enhanced Visualizations */}
          {hasData ? (
            <>
              {/* Row 1: Two pie charts side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Income vs Expense Breakdown */}
                <section className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4">
                    Income vs Expense Breakdown
                  </h2>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={incomeVsExpenseData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                          nameKey="name"
                          label={({ name, percent }) =>
                            `${name}: ${(percent * 100).toFixed(1)}%`
                          }
                        >
                          {incomeVsExpenseData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.color}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            formatAmount(value as number),
                            name,
                          ]}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* Asset Breakdown */}
                <section className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4">
                    Asset & Liability Breakdown
                  </h2>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={assetBreakdownData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                          nameKey="name"
                          label={({ name, percent }) =>
                            `${name}: ${(percent * 100).toFixed(1)}%`
                          }
                        >
                          {assetBreakdownData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.color}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            formatAmount(value as number),
                            name,
                          ]}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>

              {/* Row 2: Full width bar chart */}
              <section className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">
                  Financial Category Summary
                </h2>
                {netWorthBarData.length > 0 ? (
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={netWorthBarData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          type="number"
                          domain={[
                            (dataMin: number) => Math.min(0, dataMin - 100),
                            (dataMax: number) => Math.max(0, dataMax + 100),
                          ]}
                          tickFormatter={(value) => formatAmount(value)}
                        />
                        <YAxis
                          dataKey="category"
                          type="category"
                          width={120}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            formatAmount(value),
                            name,
                          ]}
                        />
                        <Legend />
                        <Bar dataKey="amount" name="Amount">
                          {netWorthBarData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.fill}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-8 text-center">
                    <p className="text-gray-500">
                      No financial data to display
                    </p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="bg-white rounded-lg shadow-md p-6">
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-4">
                  No data available for visualization
                </p>
                <p className="text-sm text-gray-400">
                  Add income sources, expenses, savings goals, or balance entries to
                  see your financial overview
                </p>
              </div>
            </section>
          )}

          {/* Navigation to CRUD pages */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Manage Your Finances
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <a
                href="/income"
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-center"
              >
                Income
              </a>
              <a
                href="/expenses"
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-center"
              >
                Expenses
              </a>
              <a
                href="/savings"
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-center"
              >
                Savings
              </a>
              <a
                href="/balance"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-center"
              >
                Balance
              </a>
              <a
                href="/net-worth-projection"
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors text-center"
              >
                Projections
              </a>
            </div>
          </section>
        </main>

        <footer className="mt-8 pt-4 border-t border-gray-200 text-center text-sm text-gray-500">
          <div className="flex flex-col md:flex-row justify-between items-center gap-2">
            <p>
              Budget Planner v{APP_VERSION} - Built with TanStack Start & React 19
            </p>
            <a
              href="https://github.com/lucassilbernagel/budget-planner/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800"
            >
              Report Issue / Feedback
            </a>
          </div>
        </footer>
      </div>
    </div>
  )
}
