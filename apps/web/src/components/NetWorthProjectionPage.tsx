import { createNetWorthProjection } from '@budget-planner/core'
import { currencySymbol } from '@budget-planner/core/format/currency'
import { useMemo, useState } from 'react'
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
import {
  useBalanceEntries,
  useExpenses,
  useIncomeSources,
  useTotalDebtBalance,
  useTotalInvestmentBalance,
} from '../stores'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'

/**
 * Parse a raw return-rate input string into a clean percentage number: clamped to
 * [0, 100] and quantized to at most 2 decimal places. This removes floating-point
 * display noise (e.g. `7.199999999999999` → `7.2`) and keeps the value in range.
 * An empty or non-numeric entry becomes 0, which is a perfectly valid projection —
 * assets simply do not grow. The window stays [0, 100] even though the model accepts
 * down to -100%; negative returns are not something this page offers.
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
 * The projection model throws for a horizon of 0 or one beyond 50 years, and this calc
 * runs unconditionally on every render. A `type="number"` field still accepts a *typed*
 * value beyond its `max` attribute, so clamp the parsed years to the field's own stated
 * window [1, 50] — which is exactly the model's own limit — before it can reach the
 * calculation.
 */
function clampYears(raw: string): number {
  return Math.min(50, Math.max(1, Number.parseInt(raw, 10) || 1))
}

/**
 * Additional contribution is entered in whole currency units; the page multiplies it by
 * 100 (cents) before feeding the projection. A `type="number"` field accepts exponent
 * text (e.g. `1e999` → Infinity), so reject non-finite input (→ 0) and cap over-large
 * finite input well under MAX_SAFE_INTEGER/100 so the `* 100` cannot overflow. Values
 * that still grow out of range once compounded are caught by `ProjectionState` below.
 */
const MAX_CONTRIBUTION = 1_000_000_000 // 1e9 units — sane upper bound, cap * 100 stays a safe integer
function sanitizeContribution(raw: string): number {
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.min(MAX_CONTRIBUTION, Math.max(0, parsed))
}

/** A year-boundary point of the projection, in cents. */
interface YearlyNetWorth {
  year: number
  netWorthCents: number
}

/**
 * The projection either produces a series we can display honestly, or it does not — and
 * the two ways it can fail need different words. Figures that outgrow exact
 * representation are the user's own (very large) numbers and are theirs to reduce;
 * figures that were never valid cents arrive from a corrupt store or sync payload and no
 * amount of reducing will help.
 *
 * Both get an explicit state rather than a falsy render gate: every gate being falsy
 * renders a silent blank void, and rendering the numbers anyway would show
 * precision-corrupted money, which is worse than saying nothing (NFR3).
 */
type ProjectionState =
  | { kind: 'ok'; yearly: YearlyNetWorth[] }
  | { kind: 'too-large' }
  | { kind: 'invalid-data' }

export function NetWorthProjectionPage() {
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()
  const balanceEntries = useBalanceEntries()
  // Assets and liabilities are read as two independent totals — never pre-netted.
  // The whole point of this page's model is that the return rate applies to assets
  // alone while debts stand still, so the signed net must never become an input.
  // These are the same store selectors BalancePage uses for its own totals.
  const totalInvestments = useTotalInvestmentBalance()
  const totalDebts = useTotalDebtBalance()
  // Amounts are stored in cents; the formatter respects the user's currency
  // display preference (currency-less vs explicit symbols) from the store.
  const formatAmount = useFormattedAmount()
  // Show the selected currency's symbol in the amount label, or nothing in
  // currency-less mode — never a hard-coded "$" (story 14-3).
  const { mode, currency } = useCurrencyPreferences()
  // Theme-aware Recharts chrome so the chart stays legible on the dark card.
  const chartColors = useChartColors()

  // Today's net worth, for display only — it is never fed back into the projection.
  const initialNetWorth = totalInvestments - totalDebts

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

  // Assets and liabilities are modelled separately: the return compounds on assets
  // only, liabilities are carried flat, and the contributions land on the asset side.
  // Feeding the signed net as a single principal is exactly the bug this replaces —
  // it multiplied a debt-dominated (negative) balance by (1 + rate) every year, so a
  // mortgage grew geometrically out of thin air.
  //
  // The balance totals are clamped at 0 because the core model rejects negative assets
  // or liabilities outright. The entry form already enforces non-negative balances, but
  // `validateBalanceTracking` does not, so synced/imported data can still carry one.
  const projectionState = useMemo<ProjectionState>(() => {
    const result = createNetWorthProjection({
      currentAssetsCents: Math.max(0, totalInvestments),
      currentLiabilitiesCents: Math.max(0, totalDebts),
      // The model takes a monthly figure; the page's inflow is annual (net income plus
      // the contribution field, which is entered in whole currency units).
      monthlyNetIncomeCents: Math.round((annualNetIncome + additionalContribution * 100) / 12),
      assetReturnRate: annualReturnRate,
      incomeGrowthRate: 0, // the page models no income growth
      timeHorizon: 'custom',
      customYears: years,
    })

    // The model returns one point per month; the chart and the summary below are both
    // built around whole years, so take the year boundaries. This runs from year 0
    // (today) through year N.
    const yearBoundaries = result.timeline.filter((point) => point.month % 12 === 0)

    // Check the assets line too, not just the net figure. Assets and liabilities can both
    // be out of safe range while their difference lands back inside it, and a net worth
    // computed from two corrupted operands is corrupt however tidy it looks.
    const figures = yearBoundaries.flatMap((point) => [point.netWorthCents, point.assetsCents])

    // Anything that was never a whole number of cents did not come from this app's own
    // write path — `validateBalanceTracking` enforces integers, but the sync applier
    // writes straight to the store without it. Telling that user their figures are "too
    // large" would send them off reducing balances that are not the problem.
    if (!figures.every((value) => Number.isInteger(value))) {
      return { kind: 'invalid-data' }
    }

    // Balances and income are summed from stores with no combined cap, so a large enough
    // starting position compounds past the safe-integer range — at which point every
    // figure downstream is quietly wrong.
    if (!figures.every((value) => Number.isSafeInteger(value))) {
      return { kind: 'too-large' }
    }

    const yearly = yearBoundaries.map((point) => ({
      year: point.month / 12,
      netWorthCents: point.netWorthCents,
    }))

    return { kind: 'ok', yearly }
  }, [
    totalInvestments,
    totalDebts,
    annualNetIncome,
    additionalContribution,
    annualReturnRate,
    years,
  ])

  const projection = projectionState.kind === 'ok' ? projectionState.yearly : []

  // Prepare data for chart
  const chartData = projection.map((item) => ({
    year: item.year,
    netWorth: item.netWorthCents / 100, // Convert cents to dollars for chart
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
                  className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 w-full"
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
                  min="0"
                  max="100"
                  step="0.01"
                  className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 w-full"
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
                  className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 w-full"
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
            ) : projectionState.kind === 'too-large' ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">These figures are too large to project</p>
                <p className="text-faint text-sm">
                  Your balances or income exceed the range this projection can calculate accurately.
                  Reduce them, or shorten the projection period, to see your financial future.
                </p>
              </div>
            ) : projectionState.kind === 'invalid-data' ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">Some of your figures could not be read</p>
                <p className="text-faint text-sm">
                  One or more of your balances, income sources, or expenses is not a valid amount,
                  so this projection cannot be calculated. Check your entries for anything that
                  looks wrong.
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
          {hasData && projectionState.kind === 'ok' && chartData.length > 0 && (
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
                        {formatAmount(item.netWorthCents)}
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
              Your investments grow at the return rate you specify, and your annual net income and
              any additional contributions are added to them along the way. Debts are held at their
              current balance rather than growing with the return rate, so a mortgage or loan does
              not compound against you — your projected net worth is simply your growing investments
              minus what you still owe.
            </p>
          </section>
        </main>
      </div>
    </div>
  )
}
