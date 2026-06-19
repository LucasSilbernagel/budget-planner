/**
 * Time Period Filter Component
 * 
 * Provides time period filtering functionality for financial visualizations.
 * Supports presets (Last Month, Last 3 Months, etc.) and custom date ranges.
 * 
 * Story: 3-3-enhance-income-vs-expense-visualization
 * Task: 3 - Create time period filter component
 */

import React, { useState, useCallback } from 'react'
import { TIME_PERIOD_PRESETS, getDateRangeForPreset } from '@budget-planner/core/finance/visualization'
import type { TimePeriodPreset, DateRange } from '@budget-planner/core/finance/visualization'

// ============================================================================
// Types
// ============================================================================

/**
 * Props for TimePeriodFilter component
 */
export interface TimePeriodFilterProps {
  /** Currently selected preset */
  selectedPreset: TimePeriodPreset
  
  /** Custom date range (used when preset is 'custom') */
  customRange?: DateRange
  
  /** Callback when time period changes */
  onTimePeriodChange: (preset: TimePeriodPreset, customRange?: DateRange) => void
  
  /** Available presets (defaults to all) */
  availablePresets?: TimePeriodPreset[]
  
  /** Whether to show custom range option */
  showCustomRange?: boolean
  
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
}

// ============================================================================
// Constants
// ============================================================================

const PRESET_ORDER: TimePeriodPreset[] = [
  'last-month',
  'last-3-months',
  'last-6-months',
  'year-to-date',
  'last-year',
  'custom',
]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Get all available preset options
 */
function getAvailablePresets(available?: TimePeriodPreset[]): TimePeriodPreset[] {
  if (available) {
    return PRESET_ORDER.filter(preset => available.includes(preset))
  }
  return PRESET_ORDER
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Time Period Filter Component
 * 
 * Allows users to select a time period for financial data visualization.
 * Supports preset periods and custom date ranges.
 */
export function TimePeriodFilter({
  selectedPreset,
  customRange,
  onTimePeriodChange,
  availablePresets,
  showCustomRange = true,
  size = 'md',
}: TimePeriodFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const available = getAvailablePresets(availablePresets)
  
  // Handle preset selection
  const handlePresetSelect = useCallback((preset: TimePeriodPreset) => {
    onTimePeriodChange(preset)
    setIsExpanded(false)
  }, [onTimePeriodChange])
  
  // Get current date range
  const currentRange = customRange 
    ? customRange 
    : getDateRangeForPreset(selectedPreset)
  
  // Determine button size classes
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'px-3 py-1.5 text-sm'
      case 'lg':
        return 'px-4 py-2.5 text-base'
      default:
        return 'px-4 py-2 text-sm'
    }
  }
  
  return (
    <div className="relative inline-block text-left">
      {/* Main Button */}
      <div>
        <button
          type="button"
          className={`inline-flex justify-between items-center w-full rounded-md border border-gray-300 bg-white shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${getSizeClasses()}`}
          id="time-period-menu"
          aria-expanded="false"
          aria-haspopup="true"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="flex items-center">
            <span className="mr-2">📅</span>
            <span>{TIME_PERIOD_PRESETS[selectedPreset]?.label || selectedPreset}</span>
          </span>
          <svg
            className="ml-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </div>
      
      {/* Date Range Display (below button) */}
      <div className="mt-1 text-xs text-gray-500 text-center">
        {formatDate(currentRange.startDate)} - {formatDate(currentRange.endDate)}
      </div>
      
      {/* Dropdown Menu */}
      {isExpanded && (
        <div
          className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="time-period-menu"
        >
          <div className="py-1" role="none">
            {available
              .filter(preset => showCustomRange || preset !== 'custom')
              .map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 hover:text-gray-900 ${selectedPreset === preset ? 'bg-gray-100 text-gray-900' : 'text-gray-700'}`}
                  role="menuitem"
                  onClick={() => handlePresetSelect(preset)}
                >
                  <span className="flex items-center">
                    {preset === 'custom' && <span className="mr-2">📅</span>}
                    {TIME_PERIOD_PRESETS[preset]?.label || preset}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
      
      {/* Custom Range Inputs (shown when custom is selected) */}
      {selectedPreset === 'custom' && showCustomRange && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="start-date" className="block text-xs text-gray-600 mb-1">
              Start Date
            </label>
            <input
              type="date"
              id="start-date"
              value={customRange?.startDate ? customRange.startDate.toISOString().split('T')[0] : ''}
              onChange={(e) => {
                if (customRange) {
                  const newStart = new Date(e.target.value)
                  onTimePeriodChange('custom', {
                    ...customRange,
                    startDate: newStart,
                  })
                }
              }}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>
          <div>
            <label htmlFor="end-date" className="block text-xs text-gray-600 mb-1">
              End Date
            </label>
            <input
              type="date"
              id="end-date"
              value={customRange?.endDate ? customRange.endDate.toISOString().split('T')[0] : ''}
              onChange={(e) => {
                if (customRange) {
                  const newEnd = new Date(e.target.value)
                  onTimePeriodChange('custom', {
                    ...customRange,
                    endDate: newEnd,
                  })
                }
              }}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Default Props
// ============================================================================

TimePeriodFilter.defaultProps = {
  showCustomRange: true,
  size: 'md',
}

// ============================================================================
// Export
// ============================================================================

export {
  PRESET_ORDER,
  getAvailablePresets,
}

export type {
  TimePeriodFilterProps,
}
