import { projectAccumulatedNestEgg } from '@budget-planner/core/finance/retirement'
import {
  type CurrencyCode,
  type CurrencyMode,
  formatCurrency,
} from '@budget-planner/core/format/currency'
import { useMemo } from 'react'
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

// Recharts numeric props cannot be driven by CSS, so they switch at the breakpoint.
// Pure and exported because layout is not observable in jsdom.
export interface RetirementChartChrome {
  height: number
  yAxisWidth: number
  tickFontSize: number
  marginLeft: number
  marginRight: number
  showAxisLabels: boolean
}

export function getRetirementChartChrome(isNarrow: boolean): RetirementChartChrome {
  return isNarrow
    ? {
        height: 300,
        yAxisWidth: 48,
        tickFontSize: 10,
        marginLeft: 4,
        // Wide enough to clear the 'Retirement' reference-line label, which clips at 320px otherwise.
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

// Tested directly: jsdom renders no Recharts SVG. Rounded because the X axis is one category per year;
// 0 is valid (an already-met plan retires today).
export function getRetirementMarkerOffset(
  earliestRetirementAge: number | null,
  currentAge: number,
  horizonYears: number
): number | null {
  if (earliestRetirementAge === null) {
    return null
  }

  const offset = Math.round(earliestRetirementAge - currentAge)

  return offset >= 0 && offset <= horizonYears ? offset : null
}

// The X axis plots age, so ReferenceLine x must be an age, not a years-from-now offset.
export function getRetirementMarkerAge(
  markerOffset: number | null,
  currentAge: number
): number | null {
  return markerOffset === null ? null : currentAge + markerOffset
}

export interface RetirementTimelineChartProps {
  /** Current amount saved at year 0, in integer cents. */
  currentSavedCents: number
  /** Monthly contribution, in integer cents. */
  monthlySavingsCents: number
  /** Annual return as a decimal (0.06 = 6%). */
  annualReturnRate: number
  currentAge: number
  yearsToProject: number
  // null when unreachable: no marker, so the chart never claims an impossible retirement.
  earliestRetirementAge: number | null
}

/** One sampled year of the accumulation curve. All money in integer CENTS. */
interface RetirementChartPoint {
  year: number
  age: number
  startingBalance: number
  annualContribution: number
  endingBalance: number
  retirementYear: boolean
}

// Takes cents, like every other formatCurrency caller.
function formatChartCurrency(
  cents: number,
  mode: CurrencyMode,
  currency: CurrencyCode,
  locale: string
): string {
  return formatCurrency(cents, { mode, currency, locale, abbreviate: true })
}

// Exported because jsdom renders no Recharts SVG. `label` is the X axis dataKey (age).
export function CustomTooltip({
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

  const data = firstEntry.payload as RetirementChartPoint

  if (
    !('startingBalance' in data) ||
    !('annualContribution' in data) ||
    !('endingBalance' in data)
  ) {
    return (
      <div className="bg-white dark:bg-gray-800 dark:text-gray-100 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-semibold text-subheading">Age {label}</p>
        <p className="text-sm text-muted">Data unavailable</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 dark:text-gray-100 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
      <p className="font-semibold text-subheading">Age {label}</p>
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

function RetirementTimelineChartInner({
  currentSavedCents,
  monthlySavingsCents,
  annualReturnRate,
  currentAge,
  yearsToProject,
  earliestRetirementAge,
}: RetirementTimelineChartProps) {
  const { mode, currency, locale } = useCurrencyPreferences()
  const chartColors = useChartColors()
  const isNarrow = useIsNarrowViewport()
  const chartChrome = getRetirementChartChrome(isNarrow)

  // Returns a result instead of calling setState inside the memo (a render-phase setState).
  const projection = useMemo<
    { ok: true; points: RetirementChartPoint[] } | { ok: false; message: string }
  >(() => {
    if (yearsToProject <= 0) {
      return { ok: true, points: [] }
    }

    try {
      const annualContribution = Math.max(0, monthlySavingsCents) * 12
      const points: RetirementChartPoint[] = []

      // Starts at year 0 so an immediately-reachable retirement (offset 0) has a category for its marker.
      for (let year = 0; year <= yearsToProject; year++) {
        const age = currentAge + year
        points.push({
          year,
          age,
          startingBalance: projectAccumulatedNestEgg(
            currentSavedCents,
            monthlySavingsCents,
            annualReturnRate,
            Math.max(0, year - 1) * 12
          ),
          annualContribution: year === 0 ? 0 : annualContribution,
          endingBalance: projectAccumulatedNestEgg(
            currentSavedCents,
            monthlySavingsCents,
            annualReturnRate,
            year * 12
          ),
          retirementYear:
            earliestRetirementAge !== null && Math.round(earliestRetirementAge) === age,
        })
      }

      return { ok: true, points }
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof Error
            ? 'These numbers grow too large to chart. Try a smaller amount or a shorter horizon.'
            : 'Failed to calculate projection',
      }
    }
  }, [
    currentSavedCents,
    monthlySavingsCents,
    annualReturnRate,
    currentAge,
    yearsToProject,
    earliestRetirementAge,
  ])

  if (!projection.ok || projection.points.length === 0) {
    return (
      <div className="p-8 text-center text-muted" data-testid="retirement-chart-empty">
        <p>
          {projection.ok
            ? 'No projection to display yet — check your age and life expectancy.'
            : projection.message}
        </p>
      </div>
    )
  }

  const chartData = projection.points
  const finalPoint = chartData.at(-1)
  const retirementYearOffset = getRetirementMarkerOffset(
    earliestRetirementAge,
    currentAge,
    finalPoint?.year ?? 0
  )
  // The axis plots ages, so the marker is placed by age; the summary below reasons in offsets.
  const retirementMarkerAge = getRetirementMarkerAge(retirementYearOffset, currentAge)

  return (
    <div className="space-y-6">
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <ResponsiveContainer width="100%" height={chartChrome.height}>
          {/* Extra right margin so the 'Retirement' label at the final year is not clipped. */}
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
            {/* The tooltip header and reference line read their meaning from this dataKey; change all three together. */}
            <XAxis
              dataKey="age"
              label={
                chartChrome.showAxisLabels
                  ? {
                      value: 'Age',
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
              // `formatCompactAxisTick` takes whole currency UNITS, so a
              // cents-space series divides at the boundary (per its contract).
              tickFormatter={(value) => formatCompactAxisTick(value / 100, mode, currency)}
              tick={{ fontSize: chartChrome.tickFontSize, fill: chartColors.axis }}
              stroke={chartColors.axis}
              domain={[0, 'auto']}
              width={chartChrome.yAxisWidth}
            />
            <Tooltip content={<CustomTooltip mode={mode} currency={currency} locale={locale} />} />
            <Line
              type="monotone"
              dataKey="endingBalance"
              name="Retirement Assets"
              stroke="#3B82F6"
              strokeWidth={3}
              dot={{ r: 4, fill: '#3B82F6' }}
              activeDot={{ r: 8, fill: '#1D4ED8' }}
            />
            {/* At the solver's earliest reachable retirement, never a separately-entered age. */}
            {retirementMarkerAge !== null && (
              <ReferenceLine
                x={retirementMarkerAge}
                stroke="#10B981"
                strokeDasharray="5 5"
                label={{ value: 'Retirement', position: 'top', fill: '#10B981' }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="p-4 surface-inset rounded-lg">
        <p className="text-sm text-body">
          <strong>Projection Summary:</strong> Starting with{' '}
          {formatChartCurrency(Math.max(0, currentSavedCents), mode, currency, locale)} at age{' '}
          {currentAge}, with a {(annualReturnRate * 100).toFixed(1)}% return while saving and{' '}
          {formatChartCurrency(Math.max(0, monthlySavingsCents) * 12, mode, currency, locale)} saved
          each year, your assets reach{' '}
          <strong>
            {formatChartCurrency(finalPoint?.endingBalance ?? 0, mode, currency, locale)}
          </strong>{' '}
          in {finalPoint?.year ?? 0} {finalPoint?.year === 1 ? 'year' : 'years'}, at age{' '}
          {finalPoint?.age ?? currentAge}
          {/* An already-met plan retires at offset 0 but the curve is floored at one year, so its end
             is a year past retirement. */}
          {retirementYearOffset !== null && retirementYearOffset === finalPoint?.year
            ? ' — when you can retire'
            : ''}
          .
        </p>
      </div>
    </div>
  )
}

export function RetirementTimelineChart(props: RetirementTimelineChartProps) {
  return (
    <ErrorBoundary>
      <RetirementTimelineChartInner {...props} />
    </ErrorBoundary>
  )
}
