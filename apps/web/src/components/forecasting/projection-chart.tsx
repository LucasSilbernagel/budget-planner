/**
 * Projection Chart Component
 *
 * Visualizes financial forecasting data using Recharts.
 * Shows baseline vs. scenario projections for comparison.
 *
 * Architecture: React Component with Recharts
 * Data Sovereignty: Client-side visualization of client-calculated data
 */

import type { ForecastingResult } from '@budget-planner/core'
import React, { useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useChartColors } from '../../lib/chartTheme'
import { useFormattedAmount } from '../../stores/currencyStore'
import { ErrorBoundary } from '../ErrorBoundary'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Chart data point
 */
interface ChartDataPoint {
  year: number
  baselineNetWorth: number
  scenarioNetWorth: number
  baselineIncome: number
  scenarioIncome: number
}

/**
 * Chart configuration
 */
interface ChartConfig {
  showGrid: boolean
  showLegend: boolean
  showTooltip: boolean
  animate: boolean
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: ChartConfig = {
  showGrid: true,
  showLegend: true,
  showTooltip: true,
  animate: true,
}

const CHART_COLORS = {
  baseline: '#3b82f6', // Blue
  scenario: '#8b5cf6', // Purple
  income: '#10b981', // Green
  expense: '#ef4444', // Red
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format year for X-axis
 */
function formatYear(year: number): string {
  return `Year ${year}`
}

/**
 * Convert forecast result to chart data
 */
function convertToChartData(result: ForecastingResult | null): ChartDataPoint[] {
  if (!result) return []

  const data: ChartDataPoint[] = []
  const maxLength = Math.max(result.baseline.length, result.projection.length)

  for (let i = 0; i < maxLength; i++) {
    const year = i + 1
    const baseline = result.baseline[i]
    const projection = result.projection[i]

    data.push({
      year,
      baselineNetWorth: baseline?.netWorth || 0,
      scenarioNetWorth: projection?.netWorth || 0,
      baselineIncome: baseline?.income || 0,
      scenarioIncome: projection?.income || 0,
    })
  }

  return data
}

// ============================================================================
// Custom Tooltip Component
// ============================================================================

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    name: string
    value: number
    dataKey: string
    color?: string
  }>
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps): React.ReactElement | null {
  const formatCurrency = useFormattedAmount()
  // Theme-aware fallback so a series without an explicit color stays legible on
  // the dark tooltip surface (gray-700 default would be near-invisible there).
  const chartColors = useChartColors()
  if (!active || !payload || !payload.length) return null

  return (
    <div className="bg-white dark:bg-gray-800 dark:text-gray-100 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3">
      <p className="text-muted text-sm">{formatYear(Number(label))}</p>
      <div className="mt-2 space-y-1">
        {payload.map((entry) => (
          <p
            key={entry.dataKey}
            className="text-sm"
            style={{ color: entry.color || chartColors.tooltipText }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: entry.color || chartColors.tooltipText }}
            />
            {entry.name}: {formatCurrency(entry.value)}
          </p>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Props for ProjectionChart component
 */
export interface ProjectionChartProps {
  /**
   * The forecast to visualize, lifted from the Scenario Builder. When null (no
   * scenario has produced a result yet), a neutral empty state is shown instead
   * of fabricated sample data (story bug-3).
   */
  result: ForecastingResult | null
}

/**
 * Projection Chart Component
 *
 * Visualizes the user's forecasting result with baseline vs. scenario comparison.
 * Supports interactive exploration of projection data.
 */
export function ProjectionChart({ result }: ProjectionChartProps): React.ReactElement {
  // Display amounts respect the user's currency mode (currency-less vs symbols).
  const formatCurrency = useFormattedAmount()
  const chartColors = useChartColors()
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG)

  const chartData = convertToChartData(result)

  // Calculate chart dimensions
  const chartHeight = 400

  // Toggle chart options
  const toggleOption = (option: keyof ChartConfig) => {
    setConfig((prev) => ({ ...prev, [option]: !prev[option] }))
  }

  return (
    <ErrorBoundary fallback={<div className="p-4 text-red-600">Chart error occurred</div>}>
      <div className="space-y-6">
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-subheading">Forecast Projections</h2>
          <p className="text-muted mt-1">Visual comparison of baseline vs. scenario projections</p>
        </div>

        {/* Chart Controls */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => toggleOption('showGrid')}
            className={`px-3 py-1 text-sm rounded-md ${
              config.showGrid
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            Grid
          </button>
          <button
            type="button"
            onClick={() => toggleOption('showLegend')}
            className={`px-3 py-1 text-sm rounded-md ${
              config.showLegend
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            Legend
          </button>
          <button
            type="button"
            onClick={() => toggleOption('showTooltip')}
            className={`px-3 py-1 text-sm rounded-md ${
              config.showTooltip
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            Tooltips
          </button>
        </div>

        {/* Chart Container */}
        <div className="surface rounded-xl shadow-lg border border-default p-4">
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-[400px] text-muted text-center px-4">
              Build a scenario in the Scenario Builder to see its projection here.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                {config.showGrid && (
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                )}

                <XAxis
                  dataKey="year"
                  tickFormatter={formatYear}
                  label={{
                    value: 'Time (Years)',
                    position: 'insideBottom',
                    offset: -5,
                    fill: chartColors.axis,
                  }}
                  tick={{ fontSize: 12, fill: chartColors.axis }}
                  stroke={chartColors.axis}
                />

                <YAxis
                  tickFormatter={formatCurrency}
                  label={{
                    value: 'Net Worth',
                    angle: -90,
                    position: 'insideLeft',
                    fill: chartColors.axis,
                  }}
                  tick={{ fontSize: 12, fill: chartColors.axis }}
                  stroke={chartColors.axis}
                  domain={['dataMin - 100000', 'dataMax + 100000']}
                />

                {config.showTooltip && <Tooltip content={<CustomTooltip />} />}

                {config.showLegend && (
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ paddingBottom: 20 }} />
                )}

                {/* Baseline Line */}
                <Line
                  type="monotone"
                  dataKey="baselineNetWorth"
                  name="Baseline"
                  stroke={CHART_COLORS.baseline}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  isAnimationActive={config.animate}
                />

                {/* Scenario Line */}
                <Line
                  type="monotone"
                  dataKey="scenarioNetWorth"
                  name="Scenario"
                  stroke={CHART_COLORS.scenario}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  isAnimationActive={config.animate}
                />

                {/* Reference line at current net worth */}
                <ReferenceLine
                  y={chartData[0]?.baselineNetWorth}
                  label={{ value: 'Starting', fill: chartColors.axis, fontSize: 10 }}
                  stroke="#9ca3af"
                  strokeDasharray="3 3"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Summary Statistics — gated on chartData (not just `result`) so an
            empty-arrays result can't show the cards alongside the empty state. */}
        {result && chartData.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Starting Net Worth"
              value={formatCurrency(result.summary.startingNetWorth)}
              change={0}
            />
            <SummaryCard
              label="Ending Net Worth"
              value={formatCurrency(result.summary.endingNetWorth)}
              change={result.summary.totalGrowth}
              positive={result.summary.totalGrowth >= 0}
            />
            <SummaryCard
              label="Total Growth"
              value={formatCurrency(result.summary.totalGrowth)}
              change={0}
              positive={result.summary.totalGrowth >= 0}
            />
            <SummaryCard
              label="Avg Annual Growth"
              value={formatCurrency(Math.round(result.summary.averageAnnualGrowth))}
              change={0}
              positive={result.summary.averageAnnualGrowth >= 0}
            />
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

/**
 * Summary Card Component
 */
interface SummaryCardProps {
  label: string
  value: string
  change: number
  positive?: boolean
}

function SummaryCard({ label, value, change }: SummaryCardProps): React.ReactElement {
  const formatCurrency = useFormattedAmount()
  const changeFormatted = formatCurrency(change)
  const isPositive = change >= 0

  return (
    <div className="surface-inset rounded-lg p-4">
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-subheading">{value}</dd>
      {change !== 0 && (
        <p
          className={`mt-1 text-xs font-medium ${
            isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {isPositive ? '+' : ''}
          {changeFormatted}
        </p>
      )}
    </div>
  )
}
