import {
  type YearlyProjection,
  calculateCompoundingProjection,
} from '@budget-planner/core/finance/retirement'
import {
  type CurrencyCode,
  type CurrencyMode,
  currencySymbol,
  formatCurrency,
} from '@budget-planner/core/format/currency'
import React, { useState, useMemo, useCallback } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { formatCompactAxisTick } from '../lib/chart-axis'
import { useChartColors } from '../lib/chartTheme'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * Recharts chrome that cannot be driven by CSS (numeric/enum props) and so must
 * switch at the narrow-viewport breakpoint (story 24.1). On a phone we shrink the
 * chart, narrow the Y-axis gutter and ticks, trim the margins, and drop the axis
 * titles so the plot area stays usable down to 320px — mirroring the overview
 * charts' `useIsNarrowViewport` treatment. Pure + exported so both branches are
 * unit-tested directly (layout itself is not observable in jsdom).
 */
export interface RetirementChartChrome {
  height: number
  yAxisWidth: number
  tickFontSize: number
  marginLeft: number
  marginRight: number
  /** Whether to render the "Years from Now" / "Assets" axis titles. */
  showAxisLabels: boolean
}

export function getRetirementChartChrome(isNarrow: boolean): RetirementChartChrome {
  return isNarrow
    ? {
        height: 300,
        yAxisWidth: 48,
        tickFontSize: 10,
        marginLeft: 4,
        // Trimmed from the desktop 64, but kept wide enough to clear the
        // "Retirement" reference-line label — which is centered on a far-right
        // retirement year in the default scenario, so ~42px of it sits right of
        // the line. A smaller margin clips the word at 320px (story 24.1 review).
        marginRight: 44,
        showAxisLabels: false,
      }
    : {
        height: 400,
        yAxisWidth: 72,
        tickFontSize: 12,
        marginLeft: 20,
        marginRight: 64,
        showAxisLabels: true,
      }
}

/**
 * Props for RetirementTimelineChart component
 */
export interface RetirementTimelineChartProps {
  initialPrincipal?: number
  annualContribution?: number
  annualReturnRate?: number
  yearsToProject?: number
  retirementAge?: number
  currentAge?: number
}

/**
 * Format currency for chart display with abbreviations
 * Uses core formatCurrency with abbreviate option for large values
 *
 * @param value - Amount in cents
 * @param mode - Currency display mode
 * @param currency - Currency code (e.g., 'USD', 'EUR')
 * @param locale - BCP-47 locale for Intl.NumberFormat grouping/decimals
 * @returns Formatted currency string with abbreviations for large values
 */
function formatChartCurrency(
  value: number,
  mode: CurrencyMode,
  currency: CurrencyCode,
  locale: string
): string {
  return formatCurrency(value, { mode, currency, locale, abbreviate: true })
}

/**
 * Custom Tooltip component for the chart
 */
function CustomTooltip({
  active,
  payload,
  label,
  mode,
  currency,
  locale,
}: {
  active?: boolean
  payload?: Array<{ payload: unknown }>
  label?: string
  mode: CurrencyMode
  currency: CurrencyCode
  locale: string
}) {
  const firstEntry = payload?.[0]
  if (!active || !firstEntry) {
    return null
  }

  const data = firstEntry.payload as YearlyProjection & { retirementYear?: boolean }

  // Guard: check that required properties exist
  if (
    !('startingBalance' in data) ||
    !('annualContribution' in data) ||
    !('endingBalance' in data)
  ) {
    return (
      <div className="bg-white dark:bg-gray-800 dark:text-gray-100 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-semibold text-subheading">Year {label}</p>
        <p className="text-sm text-muted">Data unavailable</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 dark:text-gray-100 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
      <p className="font-semibold text-subheading">Year {label}</p>
      <p className="text-sm text-body">
        Starting Balance: {formatChartCurrency(data.startingBalance, mode, currency, locale)}
      </p>
      <p className="text-sm text-body">
        Annual Contribution: {formatChartCurrency(data.annualContribution, mode, currency, locale)}
      </p>
      <p className="text-sm text-body">
        Ending Balance: {formatChartCurrency(data.endingBalance, mode, currency, locale)}
      </p>
      {data.retirementYear && (
        <p className="text-sm text-green-600 dark:text-green-400 mt-2 font-medium">
          ✓ Retirement Year
        </p>
      )}
    </div>
  )
}

/**
 * RetirementTimelineChart component
 *
 * Visualizes compounding growth over time for retirement planning.
 *
 * Features:
 * - Interactive line chart with Recharts
 * - Configurable parameters: principal, contribution, return rate, years
 * - Age-based timeline mapping
 * - Tooltips with detailed information
 * - Responsive design
 * - Accessible chart elements
 *
 * AC Coverage: AC-3 (Age timeline mapping with compounding projections)
 */
function RetirementTimelineChartInner({
  initialPrincipal = 100000,
  annualContribution = 0,
  annualReturnRate = 0.06,
  yearsToProject = 30,
  retirementAge = 65,
  currentAge = 35,
}: RetirementTimelineChartProps) {
  const { mode, currency, locale } = useCurrencyPreferences()
  // Theme-aware Recharts chrome so axes/grid stay legible on the dark card.
  const chartColors = useChartColors()
  // Drop desktop-only chart chrome below the `sm` breakpoint so the plot area
  // stays usable at 320px (story 24.1).
  const isNarrow = useIsNarrowViewport()
  const chartChrome = getRetirementChartChrome(isNarrow)

  // Local state for user-configurable parameters
  // Note: returnRate is stored as percentage (0-100) for UI consistency
  // annualReturnRate prop is in decimal (0-1), so convert to percentage
  const [principal, setPrincipal] = useState<number>(initialPrincipal)
  const [contribution, setContribution] = useState<number>(annualContribution)
  const [returnRate, setReturnRate] = useState<number>(annualReturnRate * 100)
  const [years, setYears] = useState<number>(yearsToProject)
  const [currentAgeState, setCurrentAge] = useState<number>(currentAge)
  const [retirementAgeState, setRetirementAge] = useState<number>(retirementAge)

  // Calculate projections
  const [projectionError, setProjectionError] = useState<string | null>(null)

  const projections = useMemo(() => {
    try {
      // Validate inputs before calculation
      if (returnRate <= 0) {
        throw new Error('Return rate must be greater than 0')
      }

      if (years < 0) {
        throw new Error('Number of years must be non-negative')
      }

      // Handle edge case: if years is 0, return empty array (consistent with core)
      if (years === 0) {
        return []
      }

      // Ensure non-negative values for financial calculations
      const safePrincipal = Math.max(principal, 0)
      const safeContribution = Math.max(contribution, 0)
      const safeReturnRate = returnRate

      const result = calculateCompoundingProjection({
        principal: safePrincipal * 100, // Convert to cents
        annualContribution: safeContribution * 100,
        annualReturnRate: safeReturnRate / 100, // Convert percentage to decimal
        years,
      })

      setProjectionError(null)
      return result
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to calculate projection'
      setProjectionError(errorMessage)
      console.error('Projection calculation error:', e)
      return []
    }
  }, [principal, contribution, returnRate, years])

  // Add age information to projections
  const chartData = useMemo(() => {
    const retirementYear = retirementAgeState

    return projections.map((projection, index) => ({
      ...projection,
      year: projection.year,
      // Convert cents back to dollars for display
      startingBalance: projection.startingBalance / 100,
      endingBalance: projection.endingBalance / 100,
      annualContribution: projection.annualContribution / 100,
      age: currentAgeState + index,
      retirementYear: currentAgeState + index === retirementYear,
    }))
  }, [projections, currentAgeState, retirementAgeState])

  // Handle parameter changes
  const handlePrincipalChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value

    // Reject scientific notation
    if (rawValue.includes('e') || rawValue.includes('E')) {
      return
    }

    const value = parseFloat(rawValue)

    // Validate finite number
    if (!Number.isFinite(value)) {
      return
    }

    setPrincipal(value)
  }, [])

  const handleContributionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value

    // Reject scientific notation
    if (rawValue.includes('e') || rawValue.includes('E')) {
      return
    }

    const value = parseFloat(rawValue)

    // Validate finite number
    if (!Number.isFinite(value)) {
      return
    }

    setContribution(value)
  }, [])

  const handleReturnRateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value

    // Reject scientific notation
    if (rawValue.includes('e') || rawValue.includes('E')) {
      return
    }

    const value = parseFloat(rawValue)

    // Validate finite number
    if (!Number.isFinite(value)) {
      return
    }

    // Cap at 100% and ensure non-negative
    setReturnRate(Math.min(Math.max(value, 0), 100))
  }, [])

  const handleYearsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value

    // Reject scientific notation
    if (rawValue.includes('e') || rawValue.includes('E')) {
      return
    }

    const value = parseInt(rawValue, 10)

    // Validate finite number
    if (!Number.isFinite(value)) {
      return
    }

    setYears(value)
  }, [])

  const handleCurrentAgeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value

    // Reject scientific notation
    if (rawValue.includes('e') || rawValue.includes('E')) {
      return
    }

    const value = parseInt(rawValue, 10)

    // Validate finite number
    if (!Number.isFinite(value)) {
      return
    }

    // Enforce minimum age of 18 and maximum of 120
    setCurrentAge(Math.min(Math.max(value, 18), 120))
  }, [])

  const handleRetirementAgeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = e.target.value

      // Reject scientific notation
      if (rawValue.includes('e') || rawValue.includes('E')) {
        return
      }

      const value = parseInt(rawValue, 10)

      // Validate finite number
      if (!Number.isFinite(value)) {
        return
      }

      // Enforce minimum of currentAge + 1 and maximum of 120
      setRetirementAge(Math.min(Math.max(value, currentAgeState + 1), 120))
    },
    [currentAgeState]
  )

  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    setPrincipal(initialPrincipal)
    setContribution(annualContribution)
    setReturnRate(annualReturnRate * 100)
    setYears(yearsToProject)
    setCurrentAge(currentAge)
    setRetirementAge(retirementAge)
  }, [
    initialPrincipal,
    annualContribution,
    annualReturnRate,
    yearsToProject,
    currentAge,
    retirementAge,
  ])

  if (chartData.length === 0) {
    return (
      <div className="p-8 text-center text-muted">
        <p>{projectionError || 'No data to display. Please adjust the parameters.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 surface-inset rounded-lg">
        <div>
          <label htmlFor="principal" className="block text-sm font-medium text-label mb-1">
            Current Savings
          </label>
          <div className="relative rounded-md shadow-sm">
            {mode === 'symbol' && (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                {currencySymbol(currency)}
              </span>
            )}
            <input
              type="number"
              id="principal"
              value={principal}
              onChange={handlePrincipalChange}
              className={`w-full py-2 ${
                mode === 'symbol' ? 'pl-7 pr-3' : 'px-3'
              } border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px]`}
              min="0"
              step="1000"
            />
          </div>
        </div>

        <div>
          <label htmlFor="contribution" className="block text-sm font-medium text-label mb-1">
            Annual Contribution
          </label>
          <div className="relative rounded-md shadow-sm">
            {mode === 'symbol' && (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                {currencySymbol(currency)}
              </span>
            )}
            <input
              type="number"
              id="contribution"
              value={contribution}
              onChange={handleContributionChange}
              className={`w-full py-2 ${
                mode === 'symbol' ? 'pl-7 pr-3' : 'px-3'
              } border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px]`}
              min="0"
              step="1000"
            />
          </div>
        </div>

        <div>
          <label htmlFor="returnRate" className="block text-sm font-medium text-label mb-1">
            Return Rate
          </label>
          <div className="relative rounded-md shadow-sm">
            <input
              type="number"
              id="returnRate"
              value={returnRate}
              onChange={handleReturnRateChange}
              className="w-full min-h-[44px] py-2 pl-3 pr-7 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              min="0"
              max="100"
              step="0.1"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">
              %
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="years" className="block text-sm font-medium text-label mb-1">
            Years
          </label>
          <input
            type="number"
            id="years"
            value={years}
            onChange={handleYearsChange}
            className="w-full min-h-[44px] px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            min="0"
            max="100"
          />
        </div>

        <div>
          <label htmlFor="currentAge" className="block text-sm font-medium text-label mb-1">
            Current Age
          </label>
          <input
            type="number"
            id="currentAge"
            value={currentAgeState}
            onChange={handleCurrentAgeChange}
            className="w-full min-h-[44px] px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            min="18"
            max="120"
          />
        </div>

        <div>
          <label htmlFor="retirementAge" className="block text-sm font-medium text-label mb-1">
            Retirement Age
          </label>
          <input
            type="number"
            id="retirementAge"
            value={retirementAgeState}
            onChange={handleRetirementAgeChange}
            className="w-full min-h-[44px] px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            min={currentAgeState + 1}
            max="120"
          />
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={resetToDefaults}
            className="w-full min-h-[44px] py-2 px-3 border border-transparent rounded-md text-sm font-medium leading-6 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <ResponsiveContainer width="100%" height={chartChrome.height}>
          {/* Extra right margin so the "Retirement" reference-line label, which
              sits at the far-right final year in the default scenario (retire at
              the end of the projection), is not clipped by the container edge.
              Margins/labels are trimmed on narrow viewports (story 24.1). */}
          <LineChart
            data={chartData}
            margin={{
              top: 20,
              right: chartChrome.marginRight,
              left: chartChrome.marginLeft,
              bottom: 20,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            <XAxis
              dataKey="year"
              label={
                chartChrome.showAxisLabels
                  ? {
                      value: 'Years from Now',
                      position: 'insideBottom',
                      offset: -5,
                      fill: chartColors.axis,
                    }
                  : undefined
              }
              tick={{ fontSize: chartChrome.tickFontSize, fill: chartColors.axis }}
              stroke={chartColors.axis}
            />
            <YAxis
              dataKey="endingBalance"
              label={
                chartChrome.showAxisLabels
                  ? {
                      value: 'Assets',
                      angle: -90,
                      position: 'insideLeft',
                      offset: 10,
                      fill: chartColors.axis,
                    }
                  : undefined
              }
              tickFormatter={(value) => formatCompactAxisTick(value, mode, currency)}
              tick={{ fontSize: chartChrome.tickFontSize, fill: chartColors.axis }}
              stroke={chartColors.axis}
              domain={[0, 'auto']}
              width={chartChrome.yAxisWidth}
            />
            <Tooltip
              content={<CustomTooltip mode={mode} currency={currency} locale={locale} />}
              formatter={(value: number) => [
                formatChartCurrency(value, mode, currency, locale),
                'Assets',
              ]}
            />
            <Line
              type="monotone"
              dataKey="endingBalance"
              name="Retirement Assets"
              stroke="#3B82F6"
              strokeWidth={3}
              dot={{ r: 4, fill: '#3B82F6' }}
              activeDot={{ r: 8, fill: '#1D4ED8' }}
            />
            {/* Reference line at retirement year. */}
            {retirementAgeState > currentAgeState && (
              <ReferenceLine
                x={retirementAgeState - currentAgeState}
                stroke="#10B981"
                strokeDasharray="5 5"
                label={{ value: 'Retirement', position: 'top', fill: '#10B981' }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary */}
      <div className="p-4 surface-inset rounded-lg">
        <p className="text-sm text-body">
          <strong>Projection Summary:</strong> Starting with{' '}
          {formatChartCurrency(principal * 100, mode, currency, locale)} at age {currentAgeState},
          with a {returnRate}% annual return and{' '}
          {formatChartCurrency(contribution * 100, mode, currency, locale)} annual contributions,
          your assets could grow to{' '}
          <strong>
            {formatChartCurrency(
              chartData[chartData.length - 1]?.endingBalance * 100,
              mode,
              currency,
              locale
            )}
          </strong>{' '}
          in {years} years at age {currentAgeState + years}.
        </p>
      </div>
    </div>
  )
}

// Wrap with ErrorBoundary
export function RetirementTimelineChart(props: RetirementTimelineChartProps) {
  return (
    <ErrorBoundary>
      <RetirementTimelineChartInner {...props} />
    </ErrorBoundary>
  )
}

export default RetirementTimelineChart
