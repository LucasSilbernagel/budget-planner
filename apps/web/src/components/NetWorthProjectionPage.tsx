import { calculateCompoundingProjection } from '@budget-planner/core'
import { currencySymbol } from '@budget-planner/core/format/currency'
import { useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCompactAxisTick } from '../lib/chart-axis'
import { useChartColors } from '../lib/chartTheme'
import { useBalanceEntries, useExpenses, useIncomeSources } from '../stores'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'

// Calculate initial net worth from current data
function calculateInitialNetWorth(
  _incomeSources: Array<{ amount: number; frequency: string }>,
  _expenses: Array<{ amount: number; frequency: string }>,
  balanceEntries: Array<{ type: string; currentBalance: number }>
): number {
  // For simplicity, we'll use the current balances from balance tracking
  // In a full implementation, this would include all assets and liabilities
  const totalInvestments = balanceEntries
    .filter((entry) => entry.type === 'investment')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)

  const totalDebts = balanceEntries
    .filter((entry) => entry.type === 'debt')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)

  return totalInvestments - totalDebts
}

/**
 * The core compounding model rejects a rate below 0.1% (MIN_ANNUAL_RETURN_RATE
 * = 0.001 decimal). Keep this as the canonical decimal floor so the render guard
 * and the displayed hint stay in sync with the calculation.
 */
const MIN_RATE_DECIMAL = 0.001

/**
 * Parse a raw return-rate input string into a clean percentage number: clamped to
 * [0, 100] and quantized to at most 2 decimal places. This removes floating-point
 * display noise (e.g. `7.199999999999999` → `7.2`) and keeps the value in range.
 * An empty or non-numeric entry becomes 0, which the page then treats as an
 * "enter a rate" state rather than feeding 0 to the (throwing) core calculation.
 */
function quantizeRatePercent(raw: string): number {
  const parsed = Number.parseFloat(raw)
  if (Number.isNaN(parsed)) {
    return 0
  }
  const clamped = Math.min(100, Math.max(0, parsed))
  return Math.round(clamped * 100) / 100
}

/**
 * The compounding model rejects a projection longer than MAX_PROJECTION_YEARS (100)
 * with a throw, and this calc runs unconditionally on every render. A `type="number"`
 * field still accepts a *typed* value beyond its `max` attribute, so clamp the parsed
 * years to the field's own stated window [1, 50] — comfortably below the core's throw
 * threshold — before it can reach the calculation.
 */
function clampYears(raw: string): number {
  return Math.min(50, Math.max(1, Number.parseInt(raw, 10) || 1))
}

/**
 * Additional contribution is entered in whole currency units; the page multiplies it
 * by 100 (cents) before feeding the core calc, which throws on a non-finite value and
 * again if the per-year balance exceeds the safe-integer limit. A `type="number"` field
 * accepts exponent text (e.g. `1e999` → Infinity), so reject non-finite input (→ 0) and
 * cap over-large finite input well under MAX_SAFE_INTEGER/100 so neither the `* 100` nor
 * the compounding loop can overflow the core's guard.
 */
const MAX_CONTRIBUTION = 1_000_000_000 // 1e9 units — sane upper bound, cap * 100 stays a safe integer
function sanitizeContribution(raw: string): number {
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.min(MAX_CONTRIBUTION, Math.max(0, parsed))
}

export function NetWorthProjectionPage() {
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()
  const balanceEntries = useBalanceEntries()
  // Amounts are stored in cents; the formatter respects the user's currency
  // display preference (currency-less vs explicit symbols) from the store.
  const formatAmount = useFormattedAmount()
  // Show the selected currency's symbol in the amount label, or nothing in
  // currency-less mode — never a hard-coded "$" (story 14-3).
  const { mode, currency } = useCurrencyPreferences()
  // Theme-aware Recharts chrome so the chart stays legible on the dark card.
  const chartColors = useChartColors()

  // Calculate initial net worth
  const initialNetWorth = calculateInitialNetWorth(incomeSources, expenses, balanceEntries)

  // Calculate monthly net income (gross income - expenses) for projection
  // For simplicity, we'll use the raw amounts without frequency normalization
  // In a full implementation, this would use the normalized values
  const monthlyIncome = incomeSources.reduce((sum, source) => sum + source.amount, 0)
  const monthlyExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const monthlyNetIncome = monthlyIncome - monthlyExpenses
  const annualNetIncome = monthlyNetIncome * 12

  // State for projection parameters. The return rate is held as a *percentage*
  // (e.g. 7 for 7%), not a decimal, so the input binds to it directly without a
  // `* 100` round-trip that would surface floating-point noise (7.2 → 7.199999999999999).
  const [years, setYears] = useState(10)
  const [returnRatePercent, setReturnRatePercent] = useState(7) // 7% default
  const [additionalContribution, setAdditionalContribution] = useState(0) // Additional annual contribution

  // Convert to a decimal only at the calculation boundary — the math must use the
  // true rate, never a display-rounded value (NFR3).
  const annualReturnRate = returnRatePercent / 100

  // The core compounding model throws for a rate <= 0 or below 0.1%. Guard the call
  // (which runs unconditionally on every render) so an empty/zero field shows a hint
  // instead of crashing. Comparing the same decimal against MIN_RATE_DECIMAL keeps
  // this guard exactly in step with the core validation.
  const isRateValid = annualReturnRate >= MIN_RATE_DECIMAL

  // Calculate projection only when the rate is in the model's valid range.
  const projection = isRateValid
    ? calculateCompoundingProjection({
        principal: initialNetWorth,
        annualContribution: annualNetIncome + additionalContribution * 100, // Convert dollars to cents
        annualReturnRate,
        years,
      })
    : []

  // Prepare data for chart
  const chartData = projection.map((item) => ({
    year: item.year,
    netWorth: item.endingBalance / 100, // Convert cents to dollars for chart
  }))

  // Check if we have sufficient data
  const hasData = balanceEntries.length > 0 || incomeSources.length > 0

  return (
    <div className="surface-sunken p-4 sm:p-8 min-h-screen">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <div>
            <h1 className="font-bold text-heading text-3xl">Net Worth Projection</h1>
            <p className="mt-2 text-body">Visualize your financial future based on current data</p>
          </div>
        </header>

        <main className="space-y-6">
          {/* Current Net Worth */}
          <section className="surface shadow-md p-6 rounded-lg">
            <h2 className="mb-4 font-semibold text-subheading text-xl">Current Net Worth</h2>
            <div className="gap-4 grid grid-cols-1 md:grid-cols-2">
              <div className="surface-inset p-4 rounded-lg">
                <p className="text-muted text-sm">Current Net Worth</p>
                <p className="mt-1 font-bold text-purple-600 dark:text-purple-400 text-2xl">
                  {formatAmount(initialNetWorth)}
                </p>
              </div>
              <div className="surface-inset p-4 rounded-lg">
                <p className="text-muted text-sm">Annual Net Income</p>
                <p className="mt-1 font-bold text-green-600 dark:text-green-400 text-2xl">
                  {formatAmount(annualNetIncome)}
                </p>
              </div>
            </div>
          </section>

          {/* Projection Parameters */}
          <section className="surface shadow-md p-6 rounded-lg">
            <h2 className="mb-4 font-semibold text-subheading text-xl">Projection Parameters</h2>

            <div className="gap-4 grid grid-cols-1 md:grid-cols-3">
              <div>
                <label htmlFor="years" className="block mb-1 font-medium text-label text-sm">
                  Projection Period (years)
                </label>
                <input
                  type="number"
                  id="years"
                  value={years}
                  onChange={(e) => setYears(clampYears(e.target.value))}
                  min="1"
                  max="50"
                  className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-purple-500 w-full"
                />
              </div>

              <div>
                <label htmlFor="returnRate" className="block mb-1 font-medium text-label text-sm">
                  Annual Return Rate (%)
                </label>
                <input
                  type="number"
                  id="returnRate"
                  value={returnRatePercent}
                  onChange={(e) => setReturnRatePercent(quantizeRatePercent(e.target.value))}
                  min="0.1"
                  max="100"
                  step="0.01"
                  className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-purple-500 w-full"
                />
              </div>

              <div>
                <label
                  htmlFor="additionalContribution"
                  className="block mb-1 font-medium text-label text-sm"
                >
                  Additional Annual Contribution
                  {mode === 'symbol' ? ` (${currencySymbol(currency)})` : ''}
                </label>
                <input
                  type="number"
                  id="additionalContribution"
                  value={additionalContribution}
                  onChange={(e) => setAdditionalContribution(sanitizeContribution(e.target.value))}
                  min="0"
                  step="100"
                  className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-purple-500 w-full"
                />
              </div>
            </div>
          </section>

          {/* Net Worth Projection Chart */}
          <section className="surface shadow-md p-6 rounded-lg">
            <h2 className="mb-4 font-semibold text-subheading text-xl">Net Worth Projection</h2>

            {!hasData ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">Insufficient data for projection</p>
                <p className="text-faint text-sm">
                  Add income sources, expenses, or balance entries to see your financial projection
                </p>
              </div>
            ) : !isRateValid ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">
                  Enter an annual return rate of at least 0.1% to see your projection
                </p>
                <p className="text-faint text-sm">
                  The return rate must be at least 0.1% for the compound projection to calculate.
                </p>
              </div>
            ) : (
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                    <XAxis
                      dataKey="year"
                      label={{
                        value: 'Years',
                        position: 'insideBottom',
                        offset: -5,
                        fill: chartColors.axis,
                      }}
                      tick={{ fill: chartColors.axis }}
                      stroke={chartColors.axis}
                    />
                    {/* Compact, mode-aware tick labels (K/M/B, no cents). Full
                        grouped amounts overflow the narrow vertical axis and clip
                        to fragments; the tooltip below still shows the precise
                        figure. The rotated "Net Worth ($)" axis title was removed
                        with them — it overlapped the ticks and merely restated the
                        section heading, legend, and tooltip. */}
                    <YAxis
                      dataKey="netWorth"
                      tickFormatter={(value) => formatCompactAxisTick(value, mode, currency)}
                      tick={{ fill: chartColors.axis }}
                      stroke={chartColors.axis}
                      width={72}
                    />
                    <Tooltip
                      formatter={(value: number, name: string, _item: unknown) => {
                        if (name === 'netWorth') {
                          return [formatAmount(value * 100), 'Net Worth']
                        }
                        return [value, name]
                      }}
                      labelFormatter={(label) => `Year ${label}`}
                      contentStyle={{
                        backgroundColor: chartColors.tooltipBg,
                        border: `1px solid ${chartColors.tooltipBorder}`,
                        borderRadius: 8,
                        color: chartColors.tooltipText,
                      }}
                      labelStyle={{ color: chartColors.tooltipText }}
                      itemStyle={{ color: chartColors.tooltipText }}
                    />
                    <Legend wrapperStyle={{ color: chartColors.axis }} />
                    <Line
                      type="monotone"
                      dataKey="netWorth"
                      name="Projected Net Worth"
                      stroke="#8B5CF6"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 8 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Projection Summary */}
          {hasData && chartData.length > 0 && (
            <section className="surface shadow-md p-6 rounded-lg">
              <h2 className="mb-4 font-semibold text-subheading text-xl">Projection Summary</h2>
              <div className="gap-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                {projection
                  .filter(
                    (_, index) =>
                      index === 0 ||
                      index === Math.floor(projection.length / 2) ||
                      index === projection.length - 1
                  )
                  .map((item, _index) => (
                    <div key={item.year} className="surface-inset p-4 rounded-lg">
                      <p className="text-muted text-sm">Year {item.year}</p>
                      <p className="font-bold text-purple-600 dark:text-purple-400 text-lg">
                        {formatAmount(item.endingBalance)}
                      </p>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* Information */}
          <section className="bg-blue-50 dark:bg-blue-950/40 shadow-md p-6 rounded-lg">
            <h3 className="mb-2 font-medium text-blue-800 dark:text-blue-300 text-lg">
              How It Works
            </h3>
            <p className="text-blue-700 dark:text-blue-300 text-sm">
              This projection uses compound interest calculations based on your current net worth,
              annual net income, and the return rate you specify. The formula accounts for both
              capital appreciation and regular contributions to give you a realistic view of your
              financial future.
            </p>
          </section>
        </main>
      </div>
    </div>
  )
}
