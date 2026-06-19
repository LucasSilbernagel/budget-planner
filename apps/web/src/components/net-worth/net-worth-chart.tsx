/**
 * Net Worth Chart Component
 * 
 * Interactive Recharts line chart for visualizing net worth projections.
 * Displays projection timeline with assets, liabilities, and net worth.
 */

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
} from 'recharts';
import type { NetWorthProjectionResult, ProjectionPoint } from '@budget-planner/core';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for NetWorthChart component
 */
export interface NetWorthChartProps {
  /** Projection result to visualize */
  projection: NetWorthProjectionResult;
  
  /** Height of the chart in pixels */
  height?: number;
  
  /** Whether to show the brush for zooming */
  showBrush?: boolean;
}

/**
 * Formatted data point for the chart
 */
interface ChartDataPoint {
  name: string; // Year.Month format
  assets: number;
  liabilities: number;
  netWorth: number;
  month: number;
  year: number;
}

// ============================================================================
// Constants
// ============================================================================

const COLORS = {
  assets: '#10b981', // Emerald/Green
  liabilities: '#ef4444', // Red
  netWorth: '#3b82f6', // Blue
  grid: '#e5e7eb', // Gray-200
  text: '#374151', // Gray-700
  textMuted: '#6b7280', // Gray-500
};

// Format currency for display
const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100);
};

// Format short currency for compact display (e.g., $1.5M)
const formatShortCurrency = (value: number): string => {
  const absValue = Math.abs(value) / 100;
  if (absValue >= 1_000_000) {
    return `$${(absValue / 1_000_000).toFixed(1)}M`;
  }
  if (absValue >= 1_000) {
    return `$${(absValue / 1_000).toFixed(0)}K`;
  }
  return formatCurrency(value);
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert projection timeline to chart data format
 */
function convertToChartData(timeline: ProjectionPoint[]): ChartDataPoint[] {
  return timeline.map((point) => ({
    name: `${point.year}.${String(point.month % 12).padStart(2, '0')}`, // e.g., "5.06" for year 5, month 6
    assets: point.assetsCents / 100, // Convert to dollars
    liabilities: point.liabilitiesCents / 100,
    netWorth: point.netWorthCents / 100,
    month: point.month,
    year: point.year,
  }));
}

/**
 * Custom tooltip component
 */
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;
  
  return (
    <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
      <p className="text-sm font-medium text-gray-600">
        Year {data.year}, Month {data.month % 12 + 1}
      </p>
      <div className="mt-2 space-y-1">
        {payload.map((entry: any) => (
          <p key={entry.dataKey} className="text-sm">
            <span
              className="inline-block w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: entry.color }}
            />
            <span className="font-medium">{entry.name}:</span> {formatCurrency(entry.value * 100)}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Custom legend component
 */
function CustomLegend({ payload }: any) {
  return (
    <div className="flex justify-center space-x-6 pb-4">
      {payload.map((entry: any) => (
        <div key={entry.value} className="flex items-center">
          <span
            className="inline-block w-3 h-3 rounded-full mr-2"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-sm text-gray-700">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Format Y-axis tick values
 */
function formatYAxisTick(value: number): string {
  return formatShortCurrency(value * 100); // Convert back to cents for formatting
}

/**
 * Format X-axis tick values
 */
function formatXAxisTick(value: string): string {
  // value is in "year.month" format
  const [year, month] = value.split('.');
  return `Y${year}`;
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
      <h3 className="text-lg font-semibold text-gray-700 mb-2">
        Insufficient Data for Projection
      </h3>
      <p className="text-gray-500 text-center max-w-md mb-4">
        Please add some financial data to see your net worth projection.
        You need at least some assets, liabilities, or income data.
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
          href="/balance-tracking"
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors"
        >
          Add Assets
        </a>
      </div>
    </div>
  );
}

/**
 * Check if projection has insufficient data
 */
export function hasInsufficientData(projection: NetWorthProjectionResult): boolean {
  const { currentAssetsCents, currentLiabilitiesCents, monthlyNetIncomeCents } = projection.input;
  
  // Check if all values are zero
  const allZero = 
    currentAssetsCents === 0 &&
    currentLiabilitiesCents === 0 &&
    monthlyNetIncomeCents === 0;
  
  // Also check if the projection has no growth potential
  const noGrowth = 
    projection.input.assetReturnRate === 0 &&
    projection.input.incomeGrowthRate === 0 &&
    monthlyNetIncomeCents === 0;
  
  return allZero || noGrowth;
}

// ============================================================================
// Main Component
// ============================================================================

export function NetWorthChart({
  projection,
  height = 400,
  showBrush = true,
}: NetWorthChartProps) {
  // Check for insufficient data
  if (hasInsufficientData(projection)) {
    return <NetWorthChartEmptyState />;
  }

  // Convert timeline to chart data
  const chartData = convertToChartData(projection.timeline);
  
  // Find max value for Y-axis domain
  const maxAssets = Math.max(...chartData.map(d => d.assets)) * 1.1; // Add 10% padding
  const minValue = Math.min(
    0,
    ...chartData.map(d => Math.min(d.assets, d.liabilities, d.netWorth))
  ) * 1.1;

  // Get starting and ending values
  const startNetWorth = chartData[0].netWorth;
  const endNetWorth = chartData[chartData.length - 1].netWorth;
  const growthPercentage = projection.summary.growthPercentage;

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-2">
          Net Worth Projection
        </h2>
        <div className="flex space-x-4 text-sm">
          <div>
            <span className="text-gray-500">Starting:</span> 
            <span className="font-medium text-gray-800">{formatCurrency(chartData[0].netWorth * 100)}</span>
          </div>
          <div>
            <span className="text-gray-500">Projected:</span> 
            <span className="font-medium text-gray-800">{formatCurrency(endNetWorth * 100)}</span>
          </div>
          <div>
            <span className="text-gray-500">Growth:</span> 
            <span className={`font-medium ${growthPercentage > 100 ? 'text-green-600' : growthPercentage < 100 ? 'text-red-600' : 'text-gray-800'}`}>
              {growthPercentage > 100 ? '+' : ''}{(growthPercentage - 100).toFixed(1)}%
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
              tickFormatter={formatYAxisTick}
              tick={{ fill: COLORS.textMuted, fontSize: 12 }}
              tickLine={false}
              axisLine={true}
              domain={[minValue, maxAssets]}
              tickCount={6}
            />
            
            <Tooltip content={<CustomTooltip />} />
            
            <Legend content={<CustomLegend />} />
            
            {/* Reference line at current net worth (start) */}
            <ReferenceLine
              y={startNetWorth}
              stroke={COLORS.textMuted}
              strokeDasharray="3 3"
              label={{ 
                value: `Start: ${formatShortCurrency(startNetWorth * 100)}`,
                fill: COLORS.textMuted,
                fontSize: 11,
              }}
            />
            
            {/* Net Worth Line */}
            <Line
              type="monotone"
              dataKey="netWorth"
              name="Net Worth"
              stroke={COLORS.netWorth}
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 8, fill: COLORS.netWorth }}
              animationDuration={500}
            />
            
            {/* Assets Line */}
            <Line
              type="monotone"
              dataKey="assets"
              name="Assets"
              stroke={COLORS.assets}
              strokeWidth={2}
              dot={false}
              strokeDasharray="5 5"
              animationDuration={500}
            />
            
            {/* Liabilities Line */}
            <Line
              type="monotone"
              dataKey="liabilities"
              name="Liabilities"
              stroke={COLORS.liabilities}
              strokeWidth={2}
              dot={false}
              animationDuration={500}
            />
            
            {showBrush && (
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

      {/* Summary Statistics */}
      <div className="mt-6 pt-4 border-t border-gray-200 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-sm text-gray-500">Time Period</p>
          <p className="text-lg font-semibold text-gray-800">
            {projection.summary.totalMonths / 12} years
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-sm text-gray-500">Total Growth</p>
          <p className="text-lg font-semibold text-green-600">
            {formatCurrency(projection.summary.totalGrowthCents)}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-sm text-gray-500">Avg Monthly</p>
          <p className="text-lg font-semibold text-gray-800">
            {formatCurrency(projection.summary.averageMonthlyGrowthCents)}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-sm text-gray-500">Final Value</p>
          <p className="text-lg font-semibold text-blue-600">
            {formatCurrency(projection.summary.endingNetWorthCents)}
          </p>
        </div>
      </div>
    </div>
  );
}
