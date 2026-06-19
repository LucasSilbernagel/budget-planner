import React, { useState, useMemo, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { calculateCompoundingProjection, type YearlyProjection } from '@budget-planner/core/finance/retirement'
import { formatCurrency, type CurrencyMode, type CurrencyCode } from '@budget-planner/core/format/currency'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { ErrorBoundary } from './ErrorBoundary'

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
 * @returns Formatted currency string with abbreviations for large values
 */
function formatChartCurrency(value: number, mode: CurrencyMode, currency: CurrencyCode): string {
  return formatCurrency(value, { mode, currency, abbreviate: true })
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
}: {
  active?: boolean
  payload?: any[]
  label?: string
  mode: CurrencyMode
  currency: CurrencyCode
}) {
  if (!active || !payload || !payload.length) {
    return null
  }

  const data = payload[0].payload as YearlyProjection & { retirementYear?: boolean }
  
  // Guard: check that required properties exist
  if (!('startingBalance' in data) || !('annualContribution' in data) || !('endingBalance' in data)) {
    return (
      <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200">
        <p className="font-semibold text-gray-800">Year {label}</p>
        <p className="text-sm text-gray-500">Data unavailable</p>
      </div>
    )
  }
  
  return (
    <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200">
      <p className="font-semibold text-gray-800">Year {label}</p>
      <p className="text-sm text-gray-600">
        Starting Balance: {formatChartCurrency(data.startingBalance, mode, currency)}
      </p>
      <p className="text-sm text-gray-600">
        Annual Contribution: {formatChartCurrency(data.annualContribution, mode, currency)}
      </p>
      <p className="text-sm text-gray-600">
        Ending Balance: {formatChartCurrency(data.endingBalance, mode, currency)}
      </p>
      {data.retirementYear && (
        <p className="text-sm text-green-600 mt-2 font-medium">
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
  const { mode, currency } = useCurrencyPreferences()
  
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
  
  const handleRetirementAgeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [currentAgeState])
  
  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    setPrincipal(initialPrincipal)
    setContribution(annualContribution)
    setReturnRate(annualReturnRate * 100)
    setYears(yearsToProject)
    setCurrentAge(currentAge)
    setRetirementAge(retirementAge)
  }, [initialPrincipal, annualContribution, annualReturnRate, yearsToProject, currentAge, retirementAge])
  
  if (chartData.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p>{projectionError || 'No data to display. Please adjust the parameters.'}</p>
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 p-4 bg-gray-50 rounded-lg">
        <div>
          <label htmlFor="principal" className="block text-xs font-medium text-gray-600 mb-1">
            Current Savings
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              id="principal"
              value={principal}
              onChange={handlePrincipalChange}
              className="w-full pl-7 pr-2 py-1.5 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              min="0"
              step="1000"
            />
          </div>
        </div>
        
        <div>
          <label htmlFor="contribution" className="block text-xs font-medium text-gray-600 mb-1">
            Annual Contribution
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              id="contribution"
              value={contribution}
              onChange={handleContributionChange}
              className="w-full pl-7 pr-2 py-1.5 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              min="0"
              step="1000"
            />
          </div>
        </div>
        
        <div>
          <label htmlFor="returnRate" className="block text-xs font-medium text-gray-600 mb-1">
            Return Rate
          </label>
          <div className="relative">
            <input
              type="number"
              id="returnRate"
              value={returnRate}
              onChange={handleReturnRateChange}
              className="w-full pl-2 pr-7 py-1.5 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              min="0"
              max="100"
              step="0.1"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
        </div>
        
        <div>
          <label htmlFor="years" className="block text-xs font-medium text-gray-600 mb-1">
            Years
          </label>
          <input
            type="number"
            id="years"
            value={years}
            onChange={handleYearsChange}
            className="w-full pl-2 pr-2 py-1.5 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            min="0"
            max="100"
          />
        </div>
        
        <div>
          <label htmlFor="currentAge" className="block text-xs font-medium text-gray-600 mb-1">
            Current Age
          </label>
          <input
            type="number"
            id="currentAge"
            value={currentAgeState}
            onChange={handleCurrentAgeChange}
            className="w-full pl-2 pr-2 py-1.5 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            min="18"
            max="120"
          />
        </div>
        
        <div>
          <label htmlFor="retirementAge" className="block text-xs font-medium text-gray-600 mb-1">
            Retirement Age
          </label>
          <input
            type="number"
            id="retirementAge"
            value={retirementAgeState}
            onChange={handleRetirementAgeChange}
            className="w-full pl-2 pr-2 py-1.5 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            min={currentAgeState + 1}
            max="120"
          />
        </div>
        
        <div className="flex items-end">
          <button
            onClick={resetToDefaults}
            className="w-full text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 py-1.5 px-2 rounded transition-colors"
          >
            Reset
          </button>
        </div>
      </div>
      
      {/* Chart */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="year"
              label={{ value: 'Years from Now', position: 'insideBottom', offset: -5 }}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              dataKey="endingBalance"
              label={{ value: 'Assets (USD)', angle: -90, position: 'insideLeft', offset: 10 }}
              tickFormatter={(value) => formatChartCurrency(value, mode, currency)}
              tick={{ fontSize: 12 }}
              domain={[0, 'auto']}
            />
            <Tooltip
              content={<CustomTooltip mode={mode} currency={currency} />}
              formatter={(value: number) => [formatChartCurrency(value, mode, currency), 'Assets']}
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
            {/* Reference line at retirement year */}
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
      <div className="p-4 bg-gray-50 rounded-lg">
        <p className="text-sm text-gray-600">
          <strong>Projection Summary:</strong> Starting with {formatChartCurrency(principal * 100, mode, currency)} 
          at age {currentAgeState}, with a {returnRate}% annual return and 
          {formatChartCurrency(contribution * 100, mode, currency)} annual contributions, 
          your assets could grow to <strong>{formatChartCurrency(chartData[chartData.length - 1]?.endingBalance * 100, mode, currency)}</strong> 
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
