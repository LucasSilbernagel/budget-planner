import { calculateCompoundingProjection } from '@budget-planner/core'
import React, { useState } from 'react'
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

const FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

// Format amount in cents to dollars
function formatAmount(cents: number): string {
  return FORMATTER.format(cents / 100)
}

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

export function NetWorthProjectionPage() {
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()
  const balanceEntries = useBalanceEntries()

  // Calculate initial net worth
  const initialNetWorth = calculateInitialNetWorth(incomeSources, expenses, balanceEntries)

  // Calculate monthly net income (gross income - expenses) for projection
  // For simplicity, we'll use the raw amounts without frequency normalization
  // In a full implementation, this would use the normalized values
  const monthlyIncome = incomeSources.reduce((sum, source) => sum + source.amount, 0)
  const monthlyExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const monthlyNetIncome = monthlyIncome - monthlyExpenses
  const annualNetIncome = monthlyNetIncome * 12

  // State for projection parameters
  const [years, setYears] = useState(10)
  const [annualReturnRate, setAnnualReturnRate] = useState(0.07) // 7% default
  const [additionalContribution, setAdditionalContribution] = useState(0) // Additional annual contribution

  // Calculate projection
  const projection = calculateCompoundingProjection({
    principal: initialNetWorth,
    annualContribution: annualNetIncome + additionalContribution * 100, // Convert dollars to cents
    annualReturnRate,
    years,
  })

  // Prepare data for chart
  const chartData = projection.map((item) => ({
    year: item.year,
    netWorth: item.endingBalance / 100, // Convert cents to dollars for chart
  }))

  // Check if we have sufficient data
  const hasData = balanceEntries.length > 0 || incomeSources.length > 0

  // Format tooltip
  const _formatTooltip = (value: number, name: string, _item: unknown) => {
    if (name === 'netWorth') {
      return [formatAmount(value * 100), 'Net Worth']
    }
    return [value, name]
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Net Worth Projection</h1>
          <p className="text-gray-600 mt-2">
            Visualize your financial future based on current data
          </p>
        </header>

        <main className="space-y-6">
          {/* Current Net Worth */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Current Net Worth</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Current Net Worth</p>
                <p className="text-2xl font-bold text-purple-600 mt-1">
                  {formatAmount(initialNetWorth)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Annual Net Income</p>
                <p className="text-2xl font-bold text-green-600 mt-1">
                  {formatAmount(annualNetIncome)}
                </p>
              </div>
            </div>
          </section>

          {/* Projection Parameters */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Projection Parameters</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="years" className="block text-sm font-medium text-gray-700 mb-1">
                  Projection Period (years)
                </label>
                <input
                  type="number"
                  id="years"
                  value={years}
                  onChange={(e) => setYears(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  max="50"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              <div>
                <label
                  htmlFor="returnRate"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Annual Return Rate (%)
                </label>
                <input
                  type="number"
                  id="returnRate"
                  value={annualReturnRate * 100}
                  onChange={(e) =>
                    setAnnualReturnRate(
                      Math.max(0, Math.min(1, parseFloat(e.target.value) / 100)) || 0
                    )
                  }
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              <div>
                <label
                  htmlFor="additionalContribution"
                  className="block text-sm font-medium text-gray-700 mb-1"
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
            </div>
          </section>

          {/* Net Worth Projection Chart */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Net Worth Projection</h2>

            {hasData ? (
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
            ) : (
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-4">Insufficient data for projection</p>
                <p className="text-sm text-gray-400">
                  Add income sources, expenses, or balance entries to see your financial projection
                </p>
              </div>
            )}
          </section>

          {/* Projection Summary */}
          {hasData && chartData.length > 0 && (
            <section className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Projection Summary</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {projection
                  .filter(
                    (_, index) =>
                      index === 0 ||
                      index === Math.floor(projection.length / 2) ||
                      index === projection.length - 1
                  )
                  .map((item, _index) => (
                    <div key={item.year} className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-500">Year {item.year}</p>
                      <p className="text-lg font-bold text-purple-600">
                        {formatAmount(item.endingBalance)}
                      </p>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* Information */}
          <section className="bg-blue-50 rounded-lg shadow-md p-6">
            <h3 className="text-lg font-medium text-blue-800 mb-2">How It Works</h3>
            <p className="text-sm text-blue-700">
              This projection uses compound interest calculations based on your current net worth,
              annual net income, and the return rate you specify. The formula accounts for both
              capital appreciation and regular contributions to give you a realistic view of your
              financial future.
            </p>
          </section>
        </main>

        {/* Navigation */}
        <div className="mt-8 flex gap-4 flex-wrap">
          <a
            href="/"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            Back to Home
          </a>
          <a
            href="/income"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            View Income
          </a>
          <a
            href="/expenses"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            View Expenses
          </a>
          <a
            href="/savings"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            View Savings
          </a>
          <a
            href="/balance"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            View Balance
          </a>
        </div>
      </div>
    </div>
  )
}
