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
 * Where to draw the "Retirement" reference line, as a years-from-now offset, or
 * `null` for no marker at all.
 *
 * Pure + exported for the same reason as `getRetirementChartChrome`: Recharts
 * renders no SVG children under jsdom's zero-size `ResponsiveContainer`, so a
 * DOM-based assertion cannot tell "no marker" apart from "no chart" — it passes
 * vacuously in both directions. Testing the decision directly is the only honest
 * coverage.
 *
 * Rounded to a whole year because the X axis is categorical (one point per
 * projected year); the solver returns month precision, which has no category to
 * sit on. `0` is a legitimate answer — a plan that is already met retires today,
 * and that is exactly when the user most wants the marker. An earlier `>= 1`
 * floor hid it for every solve under six months.
 */
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

/**
 * Props for RetirementTimelineChart.
 *
 * ⚠️ Every value is REQUIRED and comes from the consolidated planner's single
 * shared input set (story 29.1). This component owns no inputs and keeps no
 * parameter state of its own — that is the whole point of the consolidation.
 * Before 29.1 it collected its own current-savings / contribution / return-rate /
 * age, defaulted them (principal `100000`!), and drew a curve that disagreed with
 * the planner's solver for the same user.
 */
export interface RetirementTimelineChartProps {
  /** Current amount saved at year 0, in integer cents. */
  currentSavedCents: number
  /** Monthly contribution, in integer cents. */
  monthlySavingsCents: number
  /** Annual return as a decimal (0.06 = 6%). */
  annualReturnRate: number
  /** The user's age today, in whole years. */
  currentAge: number
  /** Horizon in whole years, derived from life expectancy − current age. */
  yearsToProject: number
  /**
   * The solver's earliest reachable retirement age, used for the reference-line
   * marker. `null` when retirement is not reachable — no marker is drawn, so the
   * chart can never claim a retirement the planner says is impossible.
   */
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

/**
 * Format a CENTS amount for chart display, abbreviating large values.
 *
 * ⚠️ Takes cents, like every other `formatCurrency` caller in the app. Before
 * 29.1 this component kept `chartData` in dollars and handed those dollars
 * straight to this function from the tooltip — rendering every hovered balance
 * 100× too small — while the summary line remembered to multiply back up. Keeping
 * the whole series in cents removes the class of bug rather than the instance.
 */
function formatChartCurrency(
  cents: number,
  mode: CurrencyMode,
  currency: CurrencyCode,
  locale: string
): string {
  return formatCurrency(cents, { mode, currency, locale, abbreviate: true })
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

  const data = firstEntry.payload as RetirementChartPoint

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
 * Visualizes the accumulation curve behind the planner's numbers: the same
 * monthly-compounded projection the solver itself walks, sampled once per year.
 *
 * ⚠️ It samples `projectAccumulatedNestEgg` — the solver's own accumulation
 * function — and deliberately NOT `calculateCompoundingProjection`, which
 * compounds ANNUALLY over whole years (story 26.6 keeps the two distinct on
 * purpose). Driving the chart with the annual function while the planner solves
 * monthly would print two different nest eggs from one input set, which is
 * exactly the contradiction story 29.1 exists to remove.
 */
function RetirementTimelineChartInner({
  currentSavedCents,
  monthlySavingsCents,
  annualReturnRate,
  currentAge,
  yearsToProject,
  earliestRetirementAge,
}: RetirementTimelineChartProps) {
  const { mode, currency, locale } = useCurrencyPreferences()
  // Theme-aware Recharts chrome so axes/grid stay legible on the dark card.
  const chartColors = useChartColors()
  // Drop desktop-only chart chrome below the `sm` breakpoint so the plot area
  // stays usable at 320px (story 24.1).
  const isNarrow = useIsNarrowViewport()
  const chartChrome = getRetirementChartChrome(isNarrow)

  // Build the curve. Returns a discriminated result rather than calling
  // `setProjectionError` from inside the memo — the previous version did exactly
  // that, a render-phase setState that would break under a Suspense/provider
  // boundary. A failure here is a projection overflow, not a crash.
  const projection = useMemo<
    { ok: true; points: RetirementChartPoint[] } | { ok: false; message: string }
  >(() => {
    if (yearsToProject <= 0) {
      return { ok: true, points: [] }
    }

    try {
      const annualContribution = Math.max(0, monthlySavingsCents) * 12
      const points: RetirementChartPoint[] = []

      // Starts at year 0 — today's balance, the one number on this curve the user
      // actually knows to be true. Without it the series opened at age+1 while the
      // summary said "starting with X at age N", and an immediately-reachable
      // retirement (offset 0) had no category for its marker to sit on.
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
          // Nothing has been contributed yet at year 0.
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

  // ⚠️ This component renders NO inputs, so an empty/failed projection can only
  // ever replace the chart itself. Before 29.1 the six parameter inputs and the
  // Reset button lived BELOW an identical early return, so typing `0` into Years
  // or Return Rate made every control vanish with no way back short of a reload.
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
  const finalPoint = chartData[chartData.length - 1]
  // Years-from-now position of the retirement marker. Rounded to a whole year
  // because the X axis is categorical (one point per projected year); the solver
  // returns month precision, which has no category to sit on.
  const retirementYearOffset = getRetirementMarkerOffset(
    earliestRetirementAge,
    currentAge,
    finalPoint?.year ?? 0
  )

  return (
    <div className="space-y-6">
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
            {/* Reference line at the solver's earliest reachable retirement —
                never at a separately-entered age the solver disagrees with. */}
            {retirementYearOffset !== null && (
              <ReferenceLine
                x={retirementYearOffset}
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
          {formatChartCurrency(Math.max(0, currentSavedCents), mode, currency, locale)} at age{' '}
          {currentAge}, with a {(annualReturnRate * 100).toFixed(1)}% annual return and{' '}
          {formatChartCurrency(Math.max(0, monthlySavingsCents) * 12, mode, currency, locale)} saved
          each year, your assets reach{' '}
          <strong>
            {formatChartCurrency(finalPoint?.endingBalance ?? 0, mode, currency, locale)}
          </strong>{' '}
          in {finalPoint?.year ?? 0} {finalPoint?.year === 1 ? 'year' : 'years'}, at age{' '}
          {finalPoint?.age ?? currentAge}
          {/* Only claim the end of the curve IS retirement when it actually is.
              An already-met plan retires at offset 0 while the curve is floored
              at one year so it has something to draw, so the last point sits a
              year PAST retirement — saying "when you can retire" there would
              contradict the earliest-retirement-age output by a year. */}
          {retirementYearOffset !== null && retirementYearOffset === finalPoint?.year
            ? ' — when you can retire'
            : ''}
          .
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
