import {
  calculateNetIncomeResult,
  denormalizeFromMonthly,
  normalizeToMonthly,
} from '@budget-planner/core/finance'
import {
  CATEGORY_COLORS,
  aggregateByCategoryAndType,
  generateColorMap,
  toPieChartData,
} from '@budget-planner/core/finance/visualization'
import type {
  FinancialDataPoint,
  RechartsDataItem,
} from '@budget-planner/core/finance/visualization'
import React, { useState, useMemo, useId, useRef, useEffect } from 'react'
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
import { useChartColors } from '../lib/chartTheme'
import { useBalanceEntries, useExpenses, useIncomeSources, useSavingsGoals } from '../stores'
import { useFormattedAmount } from '../stores/currencyStore'
import {
  type OverviewDuration,
  useOverviewDuration,
  useSetOverviewDuration,
} from '../stores/overviewDurationStore'
import { ErrorBoundary } from './ErrorBoundary'
import { useCategoryDrillDown } from './finance/category-drill-down'
import { PremiumFeatureGate } from './premium'

// Card-label suffix for the selected overview duration (story 12-2). "monthly"
// keeps the original "(per month)" copy so the surviving cards read naturally at
// every duration.
const DURATION_LABEL: Record<OverviewDuration, string> = {
  weekly: '(per week)',
  monthly: '(per month)',
  annually: '(per year)',
}

// Colors for the charts
const INCOME_COLOR = '#10B981'
const EXPENSE_COLOR = '#EF4444'
const SAVINGS_COLOR = '#8B5CF6'
const INVESTMENT_COLOR = '#3B82F6'
const DEBT_COLOR = '#DC2626'

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

  // Theme-aware Recharts chrome (axis/grid/tooltip) for the summary bar chart so
  // it stays legible on the dark `.surface` card (story 11-2 / 12-4 AC-2).
  const chartColors = useChartColors()

  // Calculate normalized totals for consistent monthly comparison
  // This ensures income and expenses with different frequencies are comparable
  const netIncomeResult = calculateNetIncomeResult(
    incomeSources.map((s) => ({ amount: s.amount, frequency: s.frequency })),
    expenses.map((e) => ({ amount: e.amount, frequency: e.frequency }))
  )

  const totalNormalizedIncome = netIncomeResult.grossIncome
  const totalNormalizedExpenses = netIncomeResult.totalExpenses

  // Global duration selector (story 12-2, FR31). One control, persisted in its
  // own store, drives BOTH the Total Income and Total Expenses cards — no
  // per-card duplication. Values are stored monthly-normalized; we re-express
  // them at the chosen duration via the core denormalizer (annually ×12, weekly
  // ÷(52/12)), reusing the frequency engine rather than re-deriving factors.
  // Amounts stay in cents, so `formatAmount` (currency mode/locale) is unchanged.
  const duration = useOverviewDuration()
  const setDuration = useSetOverviewDuration()
  const incomeForDuration = denormalizeFromMonthly(totalNormalizedIncome, duration)
  const expensesForDuration = denormalizeFromMonthly(totalNormalizedExpenses, duration)

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
  // Enhanced Visualization State (Story 3-3, simplified in 12-3)
  // ============================================================================

  // Income vs Expense Breakdown cadence (story 12-3). Replaces the old six
  // date-range presets with a plain Monthly/Annually toggle, defaulting to
  // Annually (UX-DR20). Unlike the overview duration selector (12-2) this control
  // has NO persistence AC and is independent of it, so component-local state is
  // correct and simplest — do not reuse overviewDurationStore.
  const [chartPeriod, setChartPeriod] = useState<'monthly' | 'annually'>('annually')

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

  // Re-express each entry at the chosen cadence BEFORE aggregation (story 12-3,
  // AC-2). The breakdown previously summed raw entered amounts and ignored
  // frequency entirely, so a weekly $100 and an annual $100 rendered as equal
  // slices. We normalize every entry to monthly then denormalize to the target
  // cadence, reusing the core frequency engine (annually ⇒ monthly ×12) rather
  // than re-deriving any factors. Values stay integer cents, so formatAmount and
  // the currency mode are unaffected.
  const periodScaledData = useMemo<FinancialDataPoint[]>(
    () =>
      financialData.map((point) => {
        const monthly = normalizeToMonthly(point.amount, point.frequency)
        const scaled =
          chartPeriod === 'annually'
            ? denormalizeFromMonthly(monthly, 'annually') // monthly ×12
            : monthly
        return { ...point, amount: scaled }
      }),
    [financialData, chartPeriod]
  )

  // Drill-down state for category navigation (fed the period-scaled data so
  // drilled figures stay consistent with the selected cadence).
  const {
    currentData: drillDownCurrentData,
    breadcrumb,
    drillDown,
    drillUp,
    reset: resetDrillDown,
    isActive: isDrillDownActive,
  } = useCategoryDrillDown(periodScaledData)

  // Get data for current drill-down level or the full period-scaled dataset.
  const displayData = useMemo(() => {
    return isDrillDownActive ? drillDownCurrentData : periodScaledData
  }, [isDrillDownActive, drillDownCurrentData, periodScaledData])

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

  // Prepare data for the net worth over time bar chart (simplified)
  // This shows current state of different financial categories
  // Use normalized values for income and expenses to ensure consistent comparison
  const netWorthBarData = [
    {
      category: 'Income (monthly)',
      amount: totalNormalizedIncome,
      fill: INCOME_COLOR,
    },
    {
      category: 'Expenses (monthly)',
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Budget Planner</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Track your income and expenses with ease
            </p>
          </div>
        </header>

        <main className="space-y-6">
          {/* Quick Stats */}
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
                Financial Overview
              </h2>
              {/* One global duration selector (story 12-2). Drives both the Total
                  Income and Total Expenses cards from a single source of truth. */}
              <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                <span className="sr-only">Show income and expenses per</span>
                <select
                  aria-label="Show income and expenses per"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value as OverviewDuration)}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="annually">Annually</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-4">
                <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                  {`Total Income ${DURATION_LABEL[duration]}`}
                  {totalNormalizedIncome !== totalIncomeRaw && (
                    <InfoTooltip
                      label="More information about the income figure"
                      text={`We convert weekly, monthly, and annual amounts to a common period so your totals are comparable. Entered total before conversion: ${formatAmount(
                        totalIncomeRaw
                      )}.`}
                    />
                  )}
                </p>
                <p className="text-2xl font-bold text-green-600">
                  {formatAmount(incomeForDuration)}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-4">
                <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                  {`Total Expenses ${DURATION_LABEL[duration]}`}
                  {totalNormalizedExpenses !== totalExpensesRaw && (
                    <InfoTooltip
                      label="More information about the expenses figure"
                      text={`We convert weekly, monthly, and annual amounts to a common period so your totals are comparable. Entered total before conversion: ${formatAmount(
                        totalExpensesRaw
                      )}.`}
                    />
                  )}
                </p>
                <p className="text-2xl font-bold text-red-600">
                  {formatAmount(expensesForDuration)}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Net Worth</p>
                <p
                  className={`text-2xl font-bold ${
                    netWorth >= 0 ? 'text-purple-600' : 'text-red-600'
                  }`}
                >
                  {formatAmount(netWorth)}
                </p>
              </div>
            </div>
          </section>

          {/* Enhanced Visualizations */}
          {hasData ? (
            <>
              {/* Income vs Expense category breakdown (Story 3-3). Formerly the
                  left of a two-pie row; the redundant "Asset & Liability
                  Breakdown" pie that sat beside it was removed in story 12-4, so
                  this is now a full-width section stacked above the bar chart. */}
              <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
                    Income vs Expense Breakdown
                  </h2>
                  {/* Monthly/Annually cadence toggle (story 12-3, UX-DR20),
                        replacing the six date-range presets. The native select
                        matches the dark-mode + a11y idiom of the overview
                        selector (12-2) and settings/currency-toggle, and adds the
                        dark-mode support the old TimePeriodFilter lacked
                        (Epic 11.2). */}
                  <div className="flex items-center space-x-2">
                    <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                      <span className="sr-only">Show breakdown per</span>
                      <select
                        aria-label="Show breakdown per"
                        value={chartPeriod}
                        onChange={(e) => setChartPeriod(e.target.value as 'monthly' | 'annually')}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      >
                        <option value="monthly">Monthly</option>
                        <option value="annually">Annually</option>
                      </select>
                    </label>
                  </div>
                </div>

                {/* Drill-down breadcrumb navigation */}
                {isDrillDownActive && breadcrumb.length > 0 && (
                  <div className="mb-4 p-2 bg-gray-50 dark:bg-gray-700/40 rounded-lg">
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

                {/* This pie used to sit in a half-width column beside the (now
                    removed, story 12-4) asset pie. As a full-width card it would
                    leave a large empty gutter, so cap the plot+legend to a
                    centered max-width to keep it balanced. */}
                <div className="h-[350px] max-w-3xl mx-auto">
                  <ErrorBoundary
                    fallback={<div className="p-4 text-red-600">Chart error occurred</div>}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart aria-label="Income and expense category breakdown chart" role="img">
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
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
                      Top Categories
                    </h3>
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

              {/* Financial Category Summary bar chart. After the redundant
                  "Asset & Liability Breakdown" pie was removed (story 12-4), this
                  is the sole carrier of the current Savings / Investments / Debts
                  figures (alongside monthly Income / Expenses). */}
              <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
                  Financial Category Summary
                </h2>
                {netWorthBarData.length > 0 ? (
                  <div className="h-[350px]">
                    <ErrorBoundary
                      fallback={
                        <div className="p-4 text-red-600 dark:text-red-400">
                          Chart error occurred
                        </div>
                      }
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={netWorthBarData} layout="vertical">
                          {/* Recharts' default axis/grid/tooltip strokes are only
                              legible on a light canvas; route them through the
                              shared chartTheme so the surviving summary chart is
                              readable on the dark `.surface` card too (story 11-2
                              / 12-4 AC-2 dark-mode constraint). */}
                          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                          <XAxis
                            type="number"
                            domain={[
                              (dataMin: number) => Math.min(0, dataMin - 100),
                              (dataMax: number) => Math.max(0, dataMax + 100),
                            ]}
                            tickFormatter={(value) => formatAmount(value)}
                            tick={{ fontSize: 12, fill: chartColors.axis }}
                            stroke={chartColors.axis}
                          />
                          <YAxis
                            dataKey="category"
                            type="category"
                            width={isNarrowViewport ? 72 : 120}
                            tick={{ fontSize: isNarrowViewport ? 11 : 12, fill: chartColors.axis }}
                            stroke={chartColors.axis}
                          />
                          <Tooltip
                            formatter={(value: number, name: string) => [formatAmount(value), name]}
                            contentStyle={{
                              backgroundColor: chartColors.tooltipBg,
                              border: `1px solid ${chartColors.tooltipBorder}`,
                              color: chartColors.tooltipText,
                            }}
                            labelStyle={{ color: chartColors.tooltipText }}
                            itemStyle={{ color: chartColors.tooltipText }}
                          />
                          <Legend wrapperStyle={{ color: chartColors.tooltipText }} />
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
                  <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-8 text-center">
                    <p className="text-gray-500 dark:text-gray-400">No financial data to display</p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-8 text-center">
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  No data available for visualization
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  Add income sources, expenses, savings goals, or balance entries to see your
                  financial overview
                </p>
              </div>
            </section>
          )}

          {/* Navigation to CRUD pages. Non-color-dependent tiles (story 11-3,
              WCAG 1.4.1 "Use of Color"): a neutral surface + an always-visible
              label + a distinct accent-colored category icon. The accent hue is
              a secondary scannability cue on the icon only, never the sole way
              to tell destinations apart, and the old danger-red Expenses fill is
              gone — red stays reserved for destructive controls like delete.

              Hidden below `sm` (640px) via `hidden sm:block` (story 18-3,
              UX-DR24): below that width GlobalNav renders the fixed bottom bar,
              which already links these same five destinations
              (Income/Expenses/Savings/Balance/Projections), so the tiles are
              pure duplication there. CSS-only on purpose — the `useIsNarrowViewport`
              boolean is `false` on the server and first client render, so a
              JS-gated hide would flash the tiles in then out after mount. No
              destination is lost: all five remain in the bottom nav (<640px) and
              the tiles themselves return at ≥640px (2-col) and `md:` (5-col). */}
          <section className="hidden bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 sm:block">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
              Manage Your Finances
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {SECTION_TILES.map(({ href, label, Icon, accentClass }) => (
                <a
                  key={href}
                  href={href}
                  className="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 font-medium text-gray-800 transition-colors hover:border-gray-300 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  <Icon className={`h-5 w-5 shrink-0 ${accentClass}`} />
                  {label}
                </a>
              ))}
            </div>
          </section>

          {/* Premium features — discoverable but locked for free users (story
              7-2, FR24). Paid users get the working link; everyone else sees the
              feature with a lock badge and an upgrade prompt. Enforcement stays
              server-side (the /forecasting loader + session gate). */}
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
              Premium Features
            </h2>
            <PremiumFeatureGate
              featureName="Advanced Forecasting"
              className="flex w-full items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-left transition-colors hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:hover:bg-blue-900/40"
              locked={<PremiumFeatureLabel />}
            >
              <a
                href="/forecasting"
                className="flex w-full items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-left transition-colors hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:hover:bg-blue-900/40"
              >
                <PremiumFeatureLabel />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap">
                  Open →
                </span>
              </a>
            </PremiumFeatureGate>

            {/* Custom Profiles — surfaced-but-locked next to Advanced Forecasting
                (story 13-3, AC-1/AC-4), consistent with how the other Premium
                feature is presented. Resolves the /profiles nav-orphan; enforcement
                stays server-side (the profile server functions' tier guard) + the
                /profiles route gate. */}
            <PremiumFeatureGate
              featureName="Custom Profiles"
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-left transition-colors hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:hover:bg-blue-900/40"
              locked={<CustomProfilesFeatureLabel />}
            >
              <a
                href="/profiles"
                className="mt-3 flex w-full items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-left transition-colors hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:hover:bg-blue-900/40"
              >
                <CustomProfilesFeatureLabel />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap">
                  Open →
                </span>
              </a>
            </PremiumFeatureGate>
          </section>
        </main>

        {/* The version and the in-app "Contact" link now live in the global
            <Footer> (story 4-8; story 9-1 replaced the old GitHub feedback link
            from story 4-9), so the page no longer renders its own stopgap
            footer block. */}
      </div>
    </div>
  )
}

/**
 * Primary section-navigation tiles for the Home dashboard (story 11-3).
 *
 * Each destination is distinguished by its label and a distinct category icon;
 * the accent hue is applied to the icon only, as a secondary scannability cue,
 * so no information is conveyed by color alone (WCAG 1.4.1). Expenses uses an
 * amber accent rather than danger-red on purpose — red stays reserved for
 * genuinely destructive actions (e.g. delete) elsewhere in the app, so a plain
 * navigation control must never read as destructive.
 */
interface SectionTile {
  href: string
  label: string
  Icon: (props: { className: string }) => React.ReactElement
  /** Tailwind text-color classes (light + dark) applied to the icon only. */
  accentClass: string
}

const SECTION_TILES: readonly SectionTile[] = [
  {
    href: '/income',
    label: 'Income',
    Icon: IncomeIcon,
    accentClass: 'text-green-600 dark:text-green-400',
  },
  {
    href: '/expenses',
    label: 'Expenses',
    Icon: ExpensesIcon,
    accentClass: 'text-amber-600 dark:text-amber-400',
  },
  {
    href: '/savings',
    label: 'Savings',
    Icon: SavingsIcon,
    accentClass: 'text-purple-600 dark:text-purple-400',
  },
  {
    href: '/balance',
    label: 'Balance',
    Icon: BalanceIcon,
    accentClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    href: '/net-worth-projection',
    label: 'Projections',
    Icon: ProjectionsIcon,
    accentClass: 'text-indigo-600 dark:text-indigo-400',
  },
]

/**
 * Small accessible info affordance (story 11-4). Reveals a plain-language
 * explanation on hover or keyboard focus — progressive disclosure — instead of
 * leading the card with a bare, jargon-y sub-line.
 *
 * Accessibility (hardened in code review):
 * - Hover and focus are tracked independently (`open = hovered || focused`) so a
 *   mouse-leave never hides a tooltip the keyboard user still has focused, and a
 *   blur never hides one the mouse is still over. Escape dismisses without moving
 *   focus.
 * - A short close delay plus hover handlers on the bubble let the pointer travel
 *   from the trigger onto the bubble without it vanishing, so the content stays
 *   hoverable (WCAG 1.4.13).
 * - The bubble is rendered only while open and positioned `fixed` with its left
 *   clamped to the viewport, so it can neither contribute to horizontal overflow
 *   nor clip off-screen at 320px regardless of which card edge the icon sits near.
 * - `aria-describedby` is wired only while the bubble exists.
 */
function InfoTooltip({ label, text }: { label: string; text: string }): React.ReactElement {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tooltipId = useId()
  const open = hovered || focused

  const openHover = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setHovered(true)
  }
  // Delay the close so the pointer can cross the small gap onto the bubble
  // (which re-opens via its own onMouseEnter) before it unmounts.
  const closeHoverSoon = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setHovered(false), 120)
  }

  // Position the bubble in viewport space, clamped so it never overflows either
  // edge. Runs after the trigger is laid out and whenever the tooltip opens.
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const margin = 8
    const width = Math.min(224, window.innerWidth - margin * 2)
    const centered = rect.left + rect.width / 2 - width / 2
    const left = Math.max(margin, Math.min(centered, window.innerWidth - width - margin))
    setCoords({ top: rect.bottom + 4, left, width })
  }, [open])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  return (
    <span
      className="inline-flex align-middle"
      onMouseEnter={openHover}
      onMouseLeave={closeHoverSoon}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:text-gray-200"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (closeTimer.current) clearTimeout(closeTimer.current)
            setHovered(false)
            setFocused(false)
          }
        }}
      >
        <InfoIcon className="h-4 w-4" />
      </button>
      {open && coords && (
        <span
          role="tooltip"
          id={tooltipId}
          onMouseEnter={openHover}
          onMouseLeave={closeHoverSoon}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width }}
          className="z-20 rounded-md bg-gray-900 px-3 py-2 text-left text-xs font-normal text-gray-100 shadow-lg dark:bg-gray-700"
        >
          {text}
        </span>
      )}
    </span>
  )
}

function InfoIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11.25 11.25h.75v3.75m-.75 0h1.5M12 8.25h.008v.008H12V8.25zM21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

/**
 * Category icons for the section-navigation tiles. Each is decorative
 * (`aria-hidden`) — the visible tile label is the announced name — and inherits
 * its color from the tile's accent class via `currentColor`, matching the inline
 * SVG idiom used elsewhere (e.g. PremiumLockBadge). Distinct shapes give each
 * destination a non-color differentiator.
 */
function IncomeIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  )
}

function ExpensesIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
      />
    </svg>
  )
}

function SavingsIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5"
      />
    </svg>
  )
}

function BalanceIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z"
      />
    </svg>
  )
}

function ProjectionsIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
      />
    </svg>
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
      <span className="font-medium text-gray-800 dark:text-gray-100">Advanced Forecasting</span>
      <span className="text-sm text-gray-500 dark:text-gray-400">
        Scenario modeling, projections, and saved forecasts
      </span>
    </span>
  )
}

/**
 * Shared label for the Custom Profiles premium entry (story 13-3), rendered
 * identically in both the unlocked (link) and locked (gate button) states so the
 * two look the same apart from the lock badge the gate adds.
 */
function CustomProfilesFeatureLabel(): React.ReactElement {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-gray-800 dark:text-gray-100">Custom Profiles</span>
      <span className="text-sm text-gray-500 dark:text-gray-400">
        Separate sets of finances you can switch between, synced across devices
      </span>
    </span>
  )
}
