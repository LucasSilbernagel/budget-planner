import { calculateNetIncomeResult } from '@budget-planner/core/finance'
import {
  CATEGORY_COLORS,
  aggregateByCategoryAndType,
  filterByDateRange,
  generateColorMap,
  getDateRangeForPreset,
  toPieChartData,
} from '@budget-planner/core/finance/visualization'
import type {
  DateRange,
  FinancialDataPoint,
  RechartsDataItem,
  TimePeriodPreset,
} from '@budget-planner/core/finance/visualization'
import React, { useState, useMemo, useCallback } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { useBalanceEntries, useExpenses, useIncomeSources, useSavingsGoals } from '../stores'
import { useFormattedAmount } from '../stores/currencyStore'
import { ErrorBoundary } from './ErrorBoundary'
import { useCategoryDrillDown } from './finance/category-drill-down'
import { TimePeriodFilter } from './finance/time-period-filter'
import { PremiumFeatureGate } from './premium'
import { CurrencyToggle } from './settings/currency-toggle'

// Colors for the charts
const INCOME_COLOR = '#10B981'
const EXPENSE_COLOR = '#EF4444'
const SAVINGS_COLOR = '#8B5CF6'
const INVESTMENT_COLOR = '#3B82F6'
const DEBT_COLOR = '#DC2626'

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

  // Use currency formatting from store (respects user preferences)
  const formatAmount = useFormattedAmount()

  // Below Tailwind `sm` (≤639px) charts must drop their desktop-width chrome
  // (vertical right legend, wide Y-axis) so the plot area stays usable at 320px.
  const isNarrowViewport = useIsNarrowViewport()

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
  const totalIncomeRaw = incomeSources.reduce((sum, source) => sum + source.amount, 0)
  const totalExpensesRaw = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const totalSavings = savingsGoals.reduce((sum, goal) => sum + goal.currentBalance, 0)
  const totalInvestments = balanceEntries
    .filter((entry) => entry.type === 'investment')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)
  const totalDebts = balanceEntries
    .filter((entry) => entry.type === 'debt')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)
  const netWorth = totalInvestments - totalDebts

  // Check if we have any data
  const hasData = incomeSources.length > 0 || expenses.length > 0

  // ============================================================================
  // Enhanced Visualization State (Story 3-3)
  // ============================================================================

  // Time period filtering state
  const [timePeriodPreset, setTimePeriodPreset] = useState<TimePeriodPreset>('last-month')
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(undefined)

  // Convert stores data to FinancialDataPoint format for visualization utilities
  const financialData = useMemo<FinancialDataPoint[]>(() => {
    const data: FinancialDataPoint[] = []

    // Add income sources
    for (const source of incomeSources) {
      // Validate required fields per project context (zero tolerance for invalid financial data)
      if (
        !source?.id ||
        !source?.name ||
        typeof source?.amount !== 'number' ||
        !Number.isFinite(source?.amount) ||
        !source?.frequency
      ) {
        console.warn('Invalid income source, skipping:', source)
        continue
      }
      // Parse createdAt date if available
      const sourceDate = source.createdAt ? new Date(source.createdAt) : undefined

      data.push({
        id: source.id,
        name: source.name,
        amount: source.amount,
        frequency: source.frequency,
        category: source.category ?? source.name, // Use explicit category if available, fallback to name
        type: 'income' as const,
        date: sourceDate,
      })
    }

    // Add expenses
    for (const expense of expenses) {
      // Validate required fields per project context (zero tolerance for invalid financial data)
      if (
        !expense?.id ||
        !expense?.name ||
        typeof expense?.amount !== 'number' ||
        !Number.isFinite(expense?.amount) ||
        !expense?.frequency
      ) {
        console.warn('Invalid expense, skipping:', expense)
        continue
      }
      // Parse createdAt date if available
      const expenseDate = expense.createdAt ? new Date(expense.createdAt) : undefined

      data.push({
        id: expense.id,
        name: expense.name,
        amount: expense.amount,
        frequency: expense.frequency,
        category: expense.category ?? expense.name, // Use explicit category if available, fallback to name
        type: 'expense' as const,
        date: expenseDate,
      })
    }

    return data
  }, [incomeSources, expenses])

  // Drill-down state for category navigation
  const {
    currentData: drillDownCurrentData,
    breadcrumb,
    drillDown,
    drillUp,
    reset: resetDrillDown,
    isActive: isDrillDownActive,
  } = useCategoryDrillDown(financialData)

  // Handle time period change
  const handleTimePeriodChange = useCallback(
    (preset: TimePeriodPreset, customRange?: DateRange) => {
      setTimePeriodPreset(preset)
      setCustomDateRange(customRange)
    },
    []
  )

  // Get current date range
  const currentDateRange = useMemo(() => {
    return customDateRange || getDateRangeForPreset(timePeriodPreset)
  }, [timePeriodPreset, customDateRange])

  // Filter data by date range (currently all data since we don't have dates)
  const filteredData = useMemo(() => {
    return filterByDateRange(financialData, currentDateRange)
  }, [financialData, currentDateRange])

  // Get data for current drill-down level or use filtered data
  const displayData = useMemo(() => {
    return isDrillDownActive ? drillDownCurrentData : filteredData
  }, [isDrillDownActive, drillDownCurrentData, filteredData])

  // Aggregate data by category and type
  const aggregatedData = useMemo(() => {
    return aggregateByCategoryAndType(displayData)
  }, [displayData])

  // Generate color map for categories
  const categoryColors = useMemo(() => {
    const allCategories = [
      ...(aggregatedData.get('income') || []).map((d) => d.category),
      ...(aggregatedData.get('expense') || []).map((d) => d.category),
    ]
    return generateColorMap(allCategories)
  }, [aggregatedData])

  // Convert to pie chart data for Recharts
  const incomeData = useMemo(() => {
    return toPieChartData(aggregatedData.get('income') || [], categoryColors)
  }, [aggregatedData, categoryColors])

  const expenseData = useMemo(() => {
    return toPieChartData(aggregatedData.get('expense') || [], categoryColors)
  }, [aggregatedData, categoryColors])

  // Prepare data for the income vs expense pie chart (using NORMALIZED values)
  const _incomeVsExpenseData = [
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

  // Enhanced data with category breakdowns (Story 3-3)
  const allCategoryData = useMemo(() => {
    return [...incomeData, ...expenseData]
  }, [incomeData, expenseData])

  // Calculate total amount for pie chart (memoized to avoid O(n^2) recalculation)
  const totalChartAmount = useMemo(
    () => allCategoryData.reduce((sum, item) => sum.value + item.value, 0),
    [allCategoryData]
  )

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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Budget Planner</h1>
            <p className="text-gray-600 mt-2">Track your income and expenses with ease</p>
          </div>
          <CurrencyToggle className="mt-1 flex-shrink-0" />
        </header>

        <main className="space-y-6">
          {/* Quick Stats */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Financial Overview</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Total Income (Monthly Normalized)</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatAmount(totalNormalizedIncome)}
                </p>
                {totalNormalizedIncome !== totalIncomeRaw && (
                  <p className="text-xs text-gray-400 mt-1">Raw: {formatAmount(totalIncomeRaw)}</p>
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
                <p className="text-2xl font-bold text-blue-600">{financialHealthScore}%</p>
              </div>
            </div>
          </section>

          {/* Enhanced Visualizations */}
          {hasData ? (
            <>
              {/* Row 1: Two pie charts side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Enhanced Income vs Expense Breakdown (Story 3-3) */}
                <section className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-gray-800">
                      Income vs Expense Breakdown
                    </h2>
                    <div className="flex items-center space-x-2">
                      <TimePeriodFilter
                        selectedPreset={timePeriodPreset}
                        customRange={customDateRange}
                        onTimePeriodChange={handleTimePeriodChange}
                        size="sm"
                      />
                    </div>
                  </div>

                  {/* Drill-down breadcrumb navigation */}
                  {isDrillDownActive && breadcrumb.length > 0 && (
                    <div className="mb-4 p-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <nav
                          className="flex items-center space-x-2"
                          aria-label="drill-down-breadcrumb"
                        >
                          <button
                            type="button"
                            onClick={resetDrillDown}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            🏠 All Categories
                          </button>
                          {breadcrumb.map((item) => (
                            <React.Fragment key={`${item.type}-${item.name}`}>
                              <span className="text-gray-400">→</span>
                              <span className="text-sm text-gray-600">{item.name}</span>
                            </React.Fragment>
                          ))}
                        </nav>
                        <button
                          type="button"
                          onClick={drillUp}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium whitespace-nowrap"
                        >
                          ← Back
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="h-[350px]">
                    <ErrorBoundary
                      fallback={<div className="p-4 text-red-600">Chart error occurred</div>}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart aria-label="Financial category breakdown chart" role="img">
                          <Pie
                            data={allCategoryData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={isNarrowViewport ? 70 : 80}
                            fill="#8884d8"
                            dataKey="value"
                            nameKey="name"
                            // At ≤320px the outer slice labels extend past the
                            // chart container and force horizontal page overflow;
                            // the legend (moved to the bottom on narrow) and the
                            // tooltip carry the same information instead.
                            label={
                              isNarrowViewport
                                ? false
                                : ({ name, percent }) => {
                                    // Show name and percentage, handle long names
                                    const displayName =
                                      name.length > 15 ? `${name.substring(0, 12)}...` : name
                                    return `${displayName}: ${(percent * 100).toFixed(1)}%`
                                  }
                            }
                            onClick={(_data, index, _event) => {
                              // Handle chart segment click for drill-down
                              const clickedItem = allCategoryData[index]
                              if (clickedItem?.name) {
                                // Extract type from the data or use a default
                                const itemType = clickedItem.type ?? 'expense'
                                drillDown(clickedItem.name, itemType)
                              }
                            }}
                          >
                            {allCategoryData.map((entry, index) => {
                              const percentage =
                                totalChartAmount > 0
                                  ? ((entry.value / totalChartAmount) * 100).toFixed(1)
                                  : '0'
                              return (
                                <Cell
                                  key={`${entry.type}-${entry.category}`}
                                  fill={
                                    entry.fill ||
                                    entry.color ||
                                    CATEGORY_COLORS[index % CATEGORY_COLORS.length]
                                  } // CATEGORY_COLORS is a const array with 16 colors
                                  stroke="#fff"
                                  strokeWidth={2}
                                  aria-label={`${entry.name}: ${formatAmount(
                                    entry.value
                                  )} (${percentage}%)`}
                                />
                              )
                            })}
                          </Pie>
                          <Tooltip
                            formatter={(
                              value: number,
                              name: string,
                              payload: {
                                payload: RechartsDataItem & {
                                  originalAmount?: number
                                  count?: number
                                }
                              }
                            ) => {
                              if (payload?.payload) {
                                const data = payload.payload
                                const amount = data.originalAmount ?? value
                                return [
                                  `${name}: ${formatAmount(amount)}`,
                                  `Type: ${data.type ?? 'N/A'}`,
                                  `Count: ${data.count ?? 1}`,
                                  `Percentage: ${
                                    totalChartAmount > 0
                                      ? ((value / totalChartAmount) * 100).toFixed(1)
                                      : '0'
                                  }%`,
                                ]
                              }
                              return [formatAmount(value), name]
                            }}
                          />
                          <Legend
                            layout={isNarrowViewport ? 'horizontal' : 'vertical'}
                            align={isNarrowViewport ? 'center' : 'right'}
                            verticalAlign={isNarrowViewport ? 'bottom' : 'middle'}
                            wrapperStyle={isNarrowViewport ? undefined : { paddingLeft: '20px' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </ErrorBoundary>
                  </div>

                  {/* Category breakdown summary */}
                  {allCategoryData.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <h3 className="text-sm font-medium text-gray-600 mb-2">Top Categories</h3>
                      <div className="space-y-1">
                        {allCategoryData
                          .sort((a, b) => b.value - a.value)
                          .slice(0, 5)
                          .map((item) => (
                            <div
                              key={`${item.type}-${item.category}`}
                              className="flex justify-between text-xs"
                            >
                              <span className="flex items-center">
                                <span
                                  className="w-2 h-2 rounded-full mr-2"
                                  style={{ backgroundColor: item.fill || item.color }}
                                />
                                {item.name}
                              </span>
                              <span>{formatAmount(item.value)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </section>

                {/* Asset Breakdown */}
                <section className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4">
                    Asset & Liability Breakdown
                  </h2>
                  <div className="h-[350px]">
                    <ErrorBoundary
                      fallback={<div className="p-4 text-red-600">Chart error occurred</div>}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart aria-label="Financial category breakdown chart" role="img">
                          <Pie
                            data={assetBreakdownData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={isNarrowViewport ? 70 : 80}
                            fill="#8884d8"
                            dataKey="value"
                            nameKey="name"
                            // Suppress outer labels at ≤320px (they overflow the
                            // container); legend + tooltip convey the breakdown.
                            label={
                              isNarrowViewport
                                ? false
                                : ({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`
                            }
                          >
                            {assetBreakdownData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
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
                    </ErrorBoundary>
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
                    <ErrorBoundary
                      fallback={<div className="p-4 text-red-600">Chart error occurred</div>}
                    >
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
                            width={isNarrowViewport ? 72 : 120}
                            tick={{ fontSize: isNarrowViewport ? 11 : 12 }}
                          />
                          <Tooltip
                            formatter={(value: number, name: string) => [formatAmount(value), name]}
                          />
                          <Legend />
                          <Bar dataKey="amount" name="Amount">
                            {netWorthBarData.map((entry) => (
                              <Cell key={entry.category} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ErrorBoundary>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-8 text-center">
                    <p className="text-gray-500">No financial data to display</p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="bg-white rounded-lg shadow-md p-6">
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-4">No data available for visualization</p>
                <p className="text-sm text-gray-400">
                  Add income sources, expenses, savings goals, or balance entries to see your
                  financial overview
                </p>
              </div>
            </section>
          )}

          {/* Navigation to CRUD pages */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Manage Your Finances</h2>
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

          {/* Premium features — discoverable but locked for free users (story
              7-2, FR24). Paid users get the working link; everyone else sees the
              feature with a lock badge and an upgrade prompt. Enforcement stays
              server-side (the /forecasting loader + session gate). */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Premium Features</h2>
            <PremiumFeatureGate
              featureName="Advanced Forecasting"
              className="flex w-full items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-left transition-colors hover:bg-blue-100"
              locked={<PremiumFeatureLabel />}
            >
              <a
                href="/forecasting"
                className="flex w-full items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-left transition-colors hover:bg-blue-100"
              >
                <PremiumFeatureLabel />
                <span className="text-sm font-medium text-blue-700 whitespace-nowrap">Open →</span>
              </a>
            </PremiumFeatureGate>
          </section>
        </main>

        {/* The version and the "Report Issue / Feedback" link now live in the
            global <Footer> (story 4-8 + 4-9), so the page no longer renders its
            own stopgap footer block. */}
      </div>
    </div>
  )
}

/**
 * Shared label for the Advanced Forecasting premium entry, rendered identically
 * in both the unlocked (link) and locked (gate button) states so the two look
 * the same apart from the lock badge the gate adds.
 */
function PremiumFeatureLabel(): React.ReactElement {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-gray-800">Advanced Forecasting</span>
      <span className="text-sm text-gray-500">
        Scenario modeling, projections, and saved forecasts
      </span>
    </span>
  )
}
