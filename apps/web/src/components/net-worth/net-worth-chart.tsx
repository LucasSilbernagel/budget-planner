/**
 * Net Worth Chart Component
 *
 * Interactive Recharts line chart for visualizing net worth projections.
 * Supports multiple scenarios for comparison.
 * Displays projection timeline with assets, liabilities, and net worth.
 */

import type { NetWorthProjectionResult } from '@budget-planner/core'
import React from 'react'
import {
  Brush,
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
import { useFormattedAmount, useFormattedAmountWithOptions } from '../../stores/currencyStore'
import type { Scenario } from './scenario-controls'

// ============================================================================
// Types
// ============================================================================

/**
 * Props for NetWorthChart component
 */
export interface NetWorthChartProps {
  /** Array of scenarios with their projections */
  scenarios: {
    scenario: Scenario
    projection: NetWorthProjectionResult
  }[]

  /** Height of the chart in pixels */
  height?: number

  /** Whether to show the brush for zooming */
  showBrush?: boolean
}

/**
 * Formatted data point for the chart
 */
interface ChartDataPoint {
  name: string // Year.Month format
  month: number
  year: number
  // Dynamic keys for each scenario's net worth
  [key: string]: string | number
}

/**
 * Scenario line configuration
 */
interface ScenarioLineConfig {
  scenarioId: string
  name: string
  color: string
  dataKey: string
  strokeWidth: number
  strokeDasharray?: string
}

// ============================================================================
// Constants
// ============================================================================

const COLORS = {
  grid: '#e5e7eb', // Gray-200
  text: '#374151', // Gray-700
  textMuted: '#6b7280', // Gray-500
}

// Currency formatting functions that use user preferences
// These are created inside the component to have access to hooks

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert projection timeline to chart data format for multiple scenarios
 */
function convertToChartData(
  scenarios: { scenario: Scenario; projection: NetWorthProjectionResult }[]
): ChartDataPoint[] {
  // Find the maximum timeline length across all scenarios
  const maxLength = Math.max(...scenarios.map((s) => s.projection.timeline.length))

  // Create array of data points
  const data: ChartDataPoint[] = []

  for (let i = 0; i < maxLength; i++) {
    const point: ChartDataPoint = {
      name: '',
      month: i,
      year: 0,
    }

    // Set name and year from first scenario that has this point
    if (scenarios[0]?.projection.timeline[i]) {
      const p = scenarios[0].projection.timeline[i]
      point.name = `${p.year}.${String(p.month % 12).padStart(2, '0')}`
      point.year = p.year
    }

    // Add net worth for each visible scenario
    scenarios.forEach((s, scenarioIndex) => {
      if (s.scenario.isVisible && s.projection.timeline[i]) {
        const p = s.projection.timeline[i]
        const dataKey = `scenario-${scenarioIndex}-netWorth`
        point[dataKey] = p.netWorthCents

        // Also add assets and liabilities for tooltip
        point[`scenario-${scenarioIndex}-assets`] = p.assetsCents
        point[`scenario-${scenarioIndex}-liabilities`] = p.liabilitiesCents
        point[`scenario-${scenarioIndex}-monthlyIncome`] = p.monthlyNetIncomeCents
      }
    })

    data.push(point)
  }

  return data
}

/**
 * Get scenario line configurations
 */
function getScenarioLines(
  scenarios: { scenario: Scenario; projection: NetWorthProjectionResult }[]
): ScenarioLineConfig[] {
  return scenarios
    .filter((s) => s.scenario.isVisible)
    .map((s, _index) => ({
      scenarioId: s.scenario.id,
      name: s.scenario.name,
      color: s.scenario.color,
      dataKey: `scenario-${scenarios.indexOf(s)}-netWorth`,
      strokeWidth: 3,
    }))
}

/**
 * Get the starting net worth for the first visible scenario
 */
function getStartingNetWorth(
  scenarios: { scenario: Scenario; projection: NetWorthProjectionResult }[]
): number {
  const firstVisible = scenarios.find((s) => s.scenario.isVisible)
  return firstVisible?.projection.timeline[0]?.netWorthCents ?? 0
}

/**
 * Single entry in a Recharts tooltip payload (only the fields used here).
 */
interface TooltipPayloadItem {
  dataKey?: string | number
  value?: number
  payload?: { year?: number }
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
  scenarios: { scenario: Scenario; projection: NetWorthProjectionResult }[]
  formatAmount: (cents: number) => string
}

/**
 * Custom tooltip component for multiple scenarios
 */
function CustomTooltip({ active, payload, label, scenarios, formatAmount }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null
  }

  // `formatAmount` is a required prop, always supplied from `useFormattedAmount()`
  // (story 14-2), so every tooltip figure routes through the shared core formatter
  // and inherits locale-aware grouping. No bespoke `.toFixed()` fallback — that
  // would silently emit ungrouped, hard-coded-decimal output.
  const safeFormat = formatAmount

  // Find the month index from the label
  const monthMatch = label?.match(/^(\d+)\.(\d+)$/)
  const monthIndex = monthMatch
    ? parseInt(monthMatch[1] ?? '0', 10) * 12 + parseInt(monthMatch[2] ?? '0', 10)
    : 0

  return (
    <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg min-w-[280px]">
      <p className="text-sm font-medium text-gray-600 mb-2">
        Year {payload[0]?.payload?.year ?? 0}, Month {(monthIndex % 12) + 1}
      </p>
      <div className="mt-2 space-y-1 max-h-[300px] overflow-y-auto">
        {scenarios
          .filter((s) => s.scenario.isVisible)
          .map((s, _scenarioIndex) => {
            const scenarioDataKey = `scenario-${scenarios.indexOf(s)}-netWorth`
            const dataPoint = payload.find((p) => p.dataKey === scenarioDataKey)

            if (!dataPoint) return null

            const netWorthCents = dataPoint.value as number
            const assetsCents = payload.find(
              (p) => p.dataKey === `scenario-${scenarios.indexOf(s)}-assets`
            )?.value as number
            const liabilitiesCents = payload.find(
              (p) => p.dataKey === `scenario-${scenarios.indexOf(s)}-liabilities`
            )?.value as number

            return (
              <div
                key={s.scenario.id}
                className="mb-3 pb-2 border-b border-gray-100 last:border-0 last:mb-0"
              >
                <p className="text-sm font-medium text-gray-700 mb-1 flex items-center">
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: s.scenario.color }}
                  />
                  {s.scenario.name}
                </p>
                <p className="text-xs">
                  <span className="text-gray-500">Net Worth:</span> {safeFormat(netWorthCents)}
                </p>
                <p className="text-xs">
                  <span className="text-gray-500">Assets:</span> {safeFormat(assetsCents)}
                </p>
                <p className="text-xs">
                  <span className="text-gray-500">Liabilities:</span> {safeFormat(liabilitiesCents)}
                </p>
              </div>
            )
          })}
      </div>
    </div>
  )
}

/**
 * Custom legend component for multiple scenarios
 */
interface LegendPayloadItem {
  dataKey: string
  color?: string
  value?: string
}

interface CustomLegendProps {
  payload?: LegendPayloadItem[]
  onVisibilityToggle?: (scenarioId: string) => void
}

function CustomLegend({ payload, onVisibilityToggle }: CustomLegendProps) {
  return (
    <div className="flex flex-wrap justify-center gap-4 pb-4">
      {payload?.map((entry) => {
        return (
          <div key={entry.dataKey} className="flex items-center">
            <span
              className="inline-block w-3 h-3 rounded-full mr-2 cursor-pointer"
              style={{ backgroundColor: entry.color }}
              onClick={() => onVisibilityToggle?.(entry.dataKey)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onVisibilityToggle?.(entry.dataKey)
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Toggle ${entry.value} visibility`}
            />
            <span className="text-sm text-gray-700">{entry.value}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Format X-axis tick values
 */
function formatXAxisTick(value: string): string {
  // value is in "year.month" format
  const [year, _month] = value.split('.')
  return `Y${year}`
}

// ============================================================================
// Empty State Component
// ============================================================================

/**
 * Component shown when there's insufficient data for projection
 */
export function NetWorthChartEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 bg-gray-50 rounded-xl border border-dashed border-gray-300">
      <div className="text-6xl text-gray-300 mb-4">📈</div>
      <h3 className="text-lg font-semibold text-gray-700 mb-2">Insufficient Data for Projection</h3>
      <p className="text-gray-500 text-center max-w-md mb-4">
        Please add some financial data to see your net worth projection. You need at least some
        assets, liabilities, or income data.
      </p>
      <div className="flex space-x-4">
        <a
          href="/income"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors"
        >
          Add Income
        </a>
        <a
          href="/expenses"
          className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-md transition-colors"
        >
          Add Expenses
        </a>
        <a
          href="/balance"
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors"
        >
          Add Assets
        </a>
      </div>
    </div>
  )
}

/**
 * Check if all scenarios have insufficient data
 */
export function hasInsufficientData(
  scenarios: { scenario: Scenario; projection: NetWorthProjectionResult }[]
): boolean {
  if (scenarios.length === 0) return true

  // Check if all scenarios have insufficient data
  return scenarios.every((s) => {
    const { currentAssetsCents, currentLiabilitiesCents, monthlyNetIncomeCents } =
      s.projection.input

    const allZero =
      currentAssetsCents === 0 && currentLiabilitiesCents === 0 && monthlyNetIncomeCents === 0

    const noGrowth =
      s.projection.input.assetReturnRate === 0 &&
      s.projection.input.incomeGrowthRate === 0 &&
      monthlyNetIncomeCents === 0

    return allZero || noGrowth
  })
}

/**
 * Check if any single scenario has insufficient data
 */
export function hasAnyInsufficientData(
  scenarios: { scenario: Scenario; projection: NetWorthProjectionResult }[]
): boolean {
  return scenarios.some((s) => {
    const { currentAssetsCents, currentLiabilitiesCents, monthlyNetIncomeCents } =
      s.projection.input

    const allZero =
      currentAssetsCents === 0 && currentLiabilitiesCents === 0 && monthlyNetIncomeCents === 0

    const noGrowth =
      s.projection.input.assetReturnRate === 0 &&
      s.projection.input.incomeGrowthRate === 0 &&
      monthlyNetIncomeCents === 0

    return allZero || noGrowth
  })
}

// ============================================================================
// Main Component
// ============================================================================

export function NetWorthChart({ scenarios, height = 400, showBrush = true }: NetWorthChartProps) {
  // Get user currency preferences
  const formatAmount = useFormattedAmount()
  const formatShortAmount = useFormattedAmountWithOptions({ abbreviate: true })

  // Safe formatting helpers that guard against NaN/Infinity
  const safeFormatAmount = (cents: number): string => {
    if (!Number.isFinite(cents)) return '0'
    return formatAmount(cents)
  }

  const safeFormatShortAmount = (cents: number): string => {
    if (!Number.isFinite(cents)) return '0'
    return formatShortAmount(cents)
  }

  // Check for insufficient data
  if (hasInsufficientData(scenarios)) {
    return <NetWorthChartEmptyState />
  }

  // Convert timelines to chart data
  const chartData = convertToChartData(scenarios)

  if (chartData.length === 0) {
    return <NetWorthChartEmptyState />
  }

  // Get scenario lines configuration
  const scenarioLines = getScenarioLines(scenarios)

  // Find max and min values for Y-axis
  const allNetWorthValues = scenarios.flatMap((s) =>
    s.projection.timeline.map((p) => p.netWorthCents)
  )
  const maxNetWorth = (Math.max(...allNetWorthValues) / 100) * 1.1 // Add 10% padding
  const minNetWorth = (Math.min(...allNetWorthValues) / 100) * 1.1

  // Get starting net worth from first visible scenario
  const startNetWorth = getStartingNetWorth(scenarios) / 100

  // Calculate summary statistics
  const firstVisibleScenario = scenarios.find((s) => s.scenario.isVisible)
  const totalMonths = firstVisibleScenario?.projection.summary.totalMonths ?? 0

  // Calculate average growth across visible scenarios
  const visibleScenarios = scenarios.filter((s) => s.scenario.isVisible)
  const avgGrowthPercentage =
    visibleScenarios.reduce((sum, s) => sum + s.projection.summary.growthPercentage, 0) /
    visibleScenarios.length

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-2">Net Worth Projection</h2>
        <div className="flex space-x-4 text-sm">
          <div>
            <span className="text-gray-500">Time Period:</span>
            <span className="font-medium text-gray-800">{totalMonths / 12} years</span>
          </div>
          <div>
            <span className="text-gray-500">Starting:</span>
            <span className="font-medium text-gray-800">
              {safeFormatAmount(Math.round(startNetWorth * 100))}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Avg Growth:</span>
            <span
              className={`font-medium ${
                avgGrowthPercentage > 100
                  ? 'text-green-600'
                  : avgGrowthPercentage < 100
                    ? 'text-red-600'
                    : 'text-gray-800'
              }`}
            >
              {avgGrowthPercentage > 100 ? '+' : ''}
              {(avgGrowthPercentage - 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />

            <XAxis
              dataKey="name"
              tickFormatter={formatXAxisTick}
              tick={{ fill: COLORS.textMuted, fontSize: 12 }}
              tickLine={false}
              axisLine={true}
            />

            <YAxis
              tickFormatter={(value) => safeFormatShortAmount(Math.round(value * 100))}
              tick={{ fill: COLORS.textMuted, fontSize: 12 }}
              tickLine={false}
              axisLine={true}
              domain={[minNetWorth, maxNetWorth]}
              tickCount={6}
            />

            <Tooltip
              content={<CustomTooltip scenarios={scenarios} formatAmount={formatAmount} />}
              contentStyle={{ border: 'none', borderRadius: '0.5rem' }}
            />

            <Legend content={<CustomLegend />} />

            {/* Reference line at starting net worth */}
            <ReferenceLine
              y={startNetWorth}
              stroke={COLORS.textMuted}
              strokeDasharray="3 3"
              label={{
                value: `Start: ${safeFormatShortAmount(Math.round(startNetWorth * 100))}`,
                fill: COLORS.textMuted,
                fontSize: 11,
              }}
            />

            {/* Render a line for each visible scenario */}
            {scenarioLines.map((line) => (
              <Line
                key={line.scenarioId}
                type="monotone"
                dataKey={line.dataKey}
                name={line.name}
                stroke={line.color}
                strokeWidth={line.strokeWidth}
                dot={false}
                activeDot={{ r: 8, fill: line.color }}
                animationDuration={500}
              />
            ))}

            {showBrush && scenarios.length > 1 && (
              <Brush
                dataKey="name"
                height={30}
                stroke={COLORS.textMuted}
                fill={COLORS.grid}
                travellerWidth={10}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary Statistics for each scenario */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Scenario Comparison</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {scenarios
            .filter((s) => s.scenario.isVisible)
            .map((s) => (
              <div key={s.scenario.id} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-700">{s.scenario.name}</h4>
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: s.scenario.color }}
                  />
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Starting:</span>
                    <span className="font-medium">
                      {safeFormatShortAmount(s.projection.summary.startingNetWorthCents)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Projected:</span>
                    <span className="font-medium">
                      {safeFormatShortAmount(s.projection.summary.endingNetWorthCents)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Growth:</span>
                    <span className="font-medium">
                      {s.projection.summary.growthPercentage > 100 ? '+' : ''}
                      {(s.projection.summary.growthPercentage - 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

      {hasAnyInsufficientData(scenarios) && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-700">
            ⚠️ Some scenarios have insufficient data and are not displayed
          </p>
        </div>
      )}
    </div>
  )
}

// Export backwards-compatible single projection version
export function SingleNetWorthChart({
  projection,
  height,
  showBrush,
}: {
  projection: NetWorthProjectionResult
  height?: number
  showBrush?: boolean
}) {
  const scenario: Scenario = {
    id: 'single',
    name: 'Projection',
    input: projection.input,
    color: '#3b82f6',
    isVisible: true,
  }

  return (
    <NetWorthChart scenarios={[{ scenario, projection }]} height={height} showBrush={showBrush} />
  )
}
