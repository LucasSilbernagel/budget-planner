import { calculateCompoundingProjection } from '@budget-planner/core'
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
import { useBalanceEntries, useExpenses, useIncomeSources } from '../stores'
import { useFormattedAmount } from '../stores/currencyStore'
import { CurrencyToggle } from './settings/currency-toggle'

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

export function NetWorthProjectionPage() {
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()
  const balanceEntries = useBalanceEntries()
  // Amounts are stored in cents; the formatter respects the user's currency
  // display preference (currency-less vs explicit symbols) from the store.
  const formatAmount = useFormattedAmount()

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
    <div className="bg-gray-50 p-4 sm:p-8 min-h-screen">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8">
          <div>
            <h1 className="font-bold text-gray-900 text-3xl">Net Worth Projection</h1>
            <p className="mt-2 text-gray-600">
              Visualize your financial future based on current data
            </p>
          </div>
          <CurrencyToggle className="flex-shrink-0 mt-1" />
        </header>

        <main className="space-y-6">
          {/* Current Net Worth */}
          <section className="bg-white shadow-md p-6 rounded-lg">
            <h2 className="mb-4 font-semibold text-gray-800 text-xl">Current Net Worth</h2>
            <div className="gap-4 grid grid-cols-1 md:grid-cols-2">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-500 text-sm">Current Net Worth</p>
                <p className="mt-1 font-bold text-purple-600 text-2xl">
                  {formatAmount(initialNetWorth)}
                </p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-500 text-sm">Annual Net Income</p>
                <p className="mt-1 font-bold text-green-600 text-2xl">
                  {formatAmount(annualNetIncome)}
                </p>
              </div>
            </div>
          </section>

          {/* Projection Parameters */}
          <section className="bg-white shadow-md p-6 rounded-lg">
            <h2 className="mb-4 font-semibold text-gray-800 text-xl">Projection Parameters</h2>

            <div className="gap-4 grid grid-cols-1 md:grid-cols-3">
              <div>
                <label htmlFor="years" className="block mb-1 font-medium text-gray-700 text-sm">
                  Projection Period (years)
                </label>
                <input
                  type="number"
                  id="years"
                  value={years}
                  onChange={(e) => setYears(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  max="50"
                  className="shadow-sm px-3 py-2 border border-gray-300 focus:border-purple-500 rounded-md focus:outline-none focus:ring-purple-500 w-full"
                />
              </div>

              <div>
                <label
                  htmlFor="returnRate"
                  className="block mb-1 font-medium text-gray-700 text-sm"
                >
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
                  className="shadow-sm px-3 py-2 border border-gray-300 focus:border-purple-500 rounded-md focus:outline-none focus:ring-purple-500 w-full"
                />
              </div>

              <div>
                <label
                  htmlFor="additionalContribution"
                  className="block mb-1 font-medium text-gray-700 text-sm"
                >
                  Additional Annual Contribution ($)
                </label>
                <input
                  type="number"
                  id="additionalContribution"
                  value={additionalContribution}
                  onChange={(e) =>
                    setAdditionalContribution(Math.max(0, parseFloat(e.target.value) || 0))
                  }
                  min="0"
                  step="100"
                  className="shadow-sm px-3 py-2 border border-gray-300 focus:border-purple-500 rounded-md focus:outline-none focus:ring-purple-500 w-full"
                />
              </div>
            </div>
          </section>

          {/* Net Worth Projection Chart */}
          <section className="bg-white shadow-md p-6 rounded-lg">
            <h2 className="mb-4 font-semibold text-gray-800 text-xl">Net Worth Projection</h2>

            {!hasData ? (
              <div className="bg-gray-50 p-8 rounded-lg text-center">
                <p className="mb-4 text-gray-500">Insufficient data for projection</p>
                <p className="text-gray-400 text-sm">
                  Add income sources, expenses, or balance entries to see your financial projection
                </p>
              </div>
            ) : !isRateValid ? (
              <div className="bg-gray-50 p-8 rounded-lg text-center">
                <p className="mb-4 text-gray-500">
                  Enter an annual return rate of at least 0.1% to see your projection
                </p>
                <p className="text-gray-400 text-sm">
                  The return rate must be at least 0.1% for the compound projection to calculate.
                </p>
              </div>
            ) : (
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="year"
                      label={{ value: 'Years', position: 'insideBottom', offset: -5 }}
                    />
                    <YAxis
                      dataKey="netWorth"
                      label={{ value: 'Net Worth ($)', angle: -90, position: 'insideLeft' }}
                      tickFormatter={(value) => formatAmount(value * 100)}
                    />
                    <Tooltip
                      formatter={(value: number, name: string, _item: unknown) => {
                        if (name === 'netWorth') {
                          return [formatAmount(value * 100), 'Net Worth']
                        }
                        return [value, name]
                      }}
                      labelFormatter={(label) => `Year ${label}`}
                    />
                    <Legend />
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
            <section className="bg-white shadow-md p-6 rounded-lg">
              <h2 className="mb-4 font-semibold text-gray-800 text-xl">Projection Summary</h2>
              <div className="gap-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                {projection
                  .filter(
                    (_, index) =>
                      index === 0 ||
                      index === Math.floor(projection.length / 2) ||
                      index === projection.length - 1
                  )
                  .map((item, _index) => (
                    <div key={item.year} className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-gray-500 text-sm">Year {item.year}</p>
                      <p className="font-bold text-purple-600 text-lg">
                        {formatAmount(item.endingBalance)}
                      </p>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* Information */}
          <section className="bg-blue-50 shadow-md p-6 rounded-lg">
            <h3 className="mb-2 font-medium text-blue-800 text-lg">How It Works</h3>
            <p className="text-blue-700 text-sm">
              This projection uses compound interest calculations based on your current net worth,
              annual net income, and the return rate you specify. The formula accounts for both
              capital appreciation and regular contributions to give you a realistic view of your
              financial future.
            </p>
          </section>
        </main>

        {/* Navigation */}
        <div className="flex flex-wrap gap-4 mt-8">
          <a
            href="/"
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-md text-gray-800 transition-colors"
          >
            Back to Home
          </a>
          <a
            href="/income"
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-md text-gray-800 transition-colors"
          >
            View Income
          </a>
          <a
            href="/expenses"
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-md text-gray-800 transition-colors"
          >
            View Expenses
          </a>
          <a
            href="/savings"
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-md text-gray-800 transition-colors"
          >
            View Savings
          </a>
          <a
            href="/balance"
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-md text-gray-800 transition-colors"
          >
            View Balance
          </a>
        </div>
      </div>
    </div>
  )
}
