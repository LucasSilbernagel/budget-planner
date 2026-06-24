/**
 * Projection Chart Component
 *
 * Visualizes financial forecasting data using Recharts.
 * Shows baseline vs. scenario projections for comparison.
 *
 * Architecture: React Component with Recharts
 * Data Sovereignty: Client-side visualization of server-calculated data
 */

import { type ForecastingResult, calculateFinancialForecast } from '@budget-planner/core'
import type { NormalizableFinancialItem } from '@budget-planner/core/finance'
import React, { useState, useMemo } from 'react'
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
 * Format currency for display
 */
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

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
  if (!active || !payload || !payload.length) return null

  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-3">
      <p className="text-gray-500 text-sm">{formatYear(Number(label))}</p>
      <div className="mt-2 space-y-1">
        {payload.map((entry) => (
          <p key={entry.dataKey} className="text-sm" style={{ color: entry.color || '#374151' }}>
            <span
              className="inline-block w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: entry.color || '#374151' }}
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
 * Projection Chart Component
 *
 * Visualizes financial forecasting data with baseline vs. scenario comparison.
 * Supports interactive exploration of projection data.
 */
export function ProjectionChart(): React.ReactElement {
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG)
  const [sampleResult, setSampleResult] = useState<ForecastingResult | null>(null)

  // Generate sample data for demonstration
  useMemo(() => {
    // Create sample financial data
    const sampleIncome: NormalizableFinancialItem[] = [
      { name: 'Salary', amount: 500000, frequency: 'monthly' },
    ]
    const sampleExpenses: NormalizableFinancialItem[] = [
      { name: 'Expenses', amount: 300000, frequency: 'monthly' },
    ]

    const sampleScenario = {
      name: 'Sample Scenario',
      incomeGrowthRate: 0.03,
      expenseGrowthRate: 0.02,
    }

    const sampleData = {
      income: sampleIncome,
      expenses: sampleExpenses,
      savings: 500000,
      investments: 1000000,
    }

    const result = calculateFinancialForecast(sampleData, sampleScenario, 10)
    setSampleResult(result)
  }, [])

  const chartData = convertToChartData(sampleResult)

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
          <h2 className="text-2xl font-bold text-gray-800">Forecast Projections</h2>
          <p className="text-gray-500 mt-1">
            Visual comparison of baseline vs. scenario projections
          </p>
        </div>

        {/* Chart Controls */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => toggleOption('showGrid')}
            className={`px-3 py-1 text-sm rounded-md ${
              config.showGrid ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            Grid
          </button>
          <button
            type="button"
            onClick={() => toggleOption('showLegend')}
            className={`px-3 py-1 text-sm rounded-md ${
              config.showLegend ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            Legend
          </button>
          <button
            type="button"
            onClick={() => toggleOption('showTooltip')}
            className={`px-3 py-1 text-sm rounded-md ${
              config.showTooltip ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            Tooltips
          </button>
        </div>

        {/* Chart Container */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4">
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-[400px] text-gray-500">
              No projection data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                {config.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />}

                <XAxis
                  dataKey="year"
                  tickFormatter={formatYear}
                  label={{ value: 'Time (Years)', position: 'insideBottom', offset: -5 }}
                  tick={{ fontSize: 12, fill: '#9ca3af' }}
                />

                <YAxis
                  tickFormatter={formatCurrency}
                  label={{ value: 'Net Worth', angle: -90, position: 'insideLeft' }}
                  tick={{ fontSize: 12, fill: '#9ca3af' }}
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
                  label={{ value: 'Starting', fill: '#374151', fontSize: 10 }}
                  stroke="#9ca3af"
                  strokeDasharray="3 3"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Summary Statistics */}
        {sampleResult && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Starting Net Worth"
              value={formatCurrency(sampleResult.summary.startingNetWorth)}
              change={0}
            />
            <SummaryCard
              label="Ending Net Worth"
              value={formatCurrency(sampleResult.summary.endingNetWorth)}
              change={sampleResult.summary.totalGrowth}
              positive={sampleResult.summary.totalGrowth >= 0}
            />
            <SummaryCard
              label="Total Growth"
              value={formatCurrency(sampleResult.summary.totalGrowth)}
              change={0}
              positive={sampleResult.summary.totalGrowth >= 0}
            />
            <SummaryCard
              label="Avg Annual Growth"
              value={formatCurrency(Math.round(sampleResult.summary.averageAnnualGrowth))}
              change={0}
              positive={sampleResult.summary.averageAnnualGrowth >= 0}
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

function SummaryCard({
  label,
  value,
  change,
  positive = true,
}: SummaryCardProps): React.ReactElement {
  const changeFormatted = formatCurrency(change)
  const isPositive = change >= 0

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-gray-800">{value}</dd>
      {change !== 0 && (
        <p className={`mt-1 text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
          {isPositive ? '+' : ''}
          {changeFormatted}
        </p>
      )}
    </div>
  )
}
