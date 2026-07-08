/**
 * Scenario Controls Component
 *
 * Provides interactive controls for adjusting net worth projection parameters.
 * Supports multiple scenarios for comparison.
 * Used in the net worth projection page for scenario modeling.
 */

import type { NetWorthProjectionInput, TimeHorizon } from '@budget-planner/core'
import { formatForInput, parseFromInput } from '@budget-planner/core/format/currency'
import React from 'react'

// ============================================================================
// Types
// ============================================================================

/**
 * Props for ScenarioControls component
 */
export interface ScenarioControlsProps {
  /** Array of scenarios to manage */
  scenarios: Scenario[]

  /** Currently active scenario index */
  activeScenarioIndex: number

  /** Called when scenarios change */
  onScenariosChange: (scenarios: Scenario[]) => void

  /** Called when active scenario changes */
  onActiveScenarioChange: (index: number) => void

  /** Whether projection is currently in progress */
  isCalculating?: boolean
}

/**
 * A single scenario with its input and display settings
 */
export interface Scenario {
  id: string
  name: string
  input: NetWorthProjectionInput
  color: string
  isVisible: boolean
}

/**
 * Individual control configuration
 */
interface ControlConfig {
  label: string
  key: keyof NetWorthProjectionInput
  type: 'number' | 'select'
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
  description: string
  formatValue?: (value: number | string | undefined) => string
  parseValue?: (value: string) => number | string
}

// ============================================================================
// Constants
// ============================================================================

const TIME_HORIZONS: { value: TimeHorizon; label: string }[] = [
  { value: '1y', label: '1 Year' },
  { value: '5y', label: '5 Years' },
  { value: '10y', label: '10 Years' },
  { value: 'custom', label: 'Custom' },
]

// Predefined scenario colors
const SCENARIO_COLORS = [
  '#3b82f6', // Blue (primary)
  '#10b981', // Emerald
  '#8b5cf6', // Purple
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#84cc16', // Lime
]

const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: 'scenario-1',
    name: 'Base Case',
    input: {
      currentAssetsCents: 10000000, // $100,000
      currentLiabilitiesCents: 0,
      monthlyNetIncomeCents: 500000, // $5,000
      assetReturnRate: 0.07, // 7%
      incomeGrowthRate: 0.03, // 3%
      timeHorizon: '10y',
      customYears: undefined,
    },
    color: SCENARIO_COLORS[0],
    isVisible: true,
  },
  {
    id: 'scenario-2',
    name: 'Conservative',
    input: {
      currentAssetsCents: 10000000,
      currentLiabilitiesCents: 0,
      monthlyNetIncomeCents: 500000,
      assetReturnRate: 0.05, // 5% - lower return
      incomeGrowthRate: 0.01, // 1% - lower growth
      timeHorizon: '10y',
      customYears: undefined,
    },
    color: SCENARIO_COLORS[2],
    isVisible: true,
  },
  {
    id: 'scenario-3',
    name: 'Optimistic',
    input: {
      currentAssetsCents: 10000000,
      currentLiabilitiesCents: 0,
      monthlyNetIncomeCents: 500000,
      assetReturnRate: 0.1, // 10% - higher return
      incomeGrowthRate: 0.05, // 5% - higher growth
      timeHorizon: '10y',
      customYears: undefined,
    },
    color: SCENARIO_COLORS[1],
    isVisible: true,
  },
]

/**
 * Control configs for the scenario builder (story 14-3).
 *
 * The three currency controls format/parse through the shared core helpers
 * (`formatForInput`/`parseFromInput`) instead of a hard-coded
 * `Intl.NumberFormat('en-US', { currency: 'USD' })`, so no forced-USD formatting.
 * These render in a native `type="number"` control, whose value is always a plain
 * en-US-canonical (`.`-decimal, ungrouped) number string — so formatting stays
 * ungrouped and parsing is locale-neutral (passing a display locale here would
 * misread the number input's canonical `.` as a group separator). Non-currency
 * controls (percentages, time horizon) are unchanged.
 *
 * NOTE: `ScenarioControls` is currently an orphan (unmounted — see deferred-work.md);
 * symbol affordance + locale grouping await a text-input conversion of `NumberControl`.
 */
const CONTROLS: ControlConfig[] = [
  {
    label: 'Current Assets',
    key: 'currentAssetsCents',
    type: 'number',
    min: 0,
    step: 10000,
    description: 'Your current total assets (investments, savings, etc.)',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        return formatForInput(value)
      }
      return typeof value === 'string' ? value : ''
    },
    parseValue: (value: string) => parseFromInput(value),
  },
  {
    label: 'Current Liabilities',
    key: 'currentLiabilitiesCents',
    type: 'number',
    min: 0,
    step: 10000,
    description: 'Your current total liabilities (debts, loans, etc.)',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        return formatForInput(value)
      }
      return typeof value === 'string' ? value : ''
    },
    parseValue: (value: string) => parseFromInput(value),
  },
  {
    label: 'Monthly Net Income',
    key: 'monthlyNetIncomeCents',
    type: 'number',
    min: -1000000,
    max: 1000000,
    step: 1000,
    description: 'Your monthly income minus expenses (can be negative)',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        return formatForInput(value)
      }
      return typeof value === 'string' ? value : ''
    },
    parseValue: (value: string) => parseFromInput(value),
  },
  {
    label: 'Asset Return Rate (%)',
    key: 'assetReturnRate',
    type: 'number',
    min: -100,
    max: 100,
    step: 0.1,
    description: 'Expected annual return on your assets',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        return `${(value * 100).toFixed(1)}%`
      }
      return typeof value === 'string' ? value : ''
    },
    parseValue: (value: string) => parseFloat(value) / 100,
  },
  {
    label: 'Income Growth Rate (%)',
    key: 'incomeGrowthRate',
    type: 'number',
    min: -100,
    max: 100,
    step: 0.1,
    description: 'Expected annual growth rate for your net income',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        return `${(value * 100).toFixed(1)}%`
      }
      return typeof value === 'string' ? value : ''
    },
    parseValue: (value: string) => parseFloat(value) / 100,
  },
  {
    label: 'Time Horizon',
    key: 'timeHorizon',
    type: 'select',
    options: TIME_HORIZONS,
    description: 'How far into the future to project',
    formatValue: (value: string | undefined) => {
      const option = TIME_HORIZONS.find((o) => o.value === value)
      return option?.label ?? value ?? ''
    },
    parseValue: (value: string) => value as TimeHorizon,
  },
]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique ID for a new scenario
 */
function generateScenarioId(): string {
  return `scenario-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Get the next available color from the palette
 */
function getNextColor(usedColors: string[]): string {
  for (const color of SCENARIO_COLORS) {
    if (!usedColors.includes(color)) {
      return color
    }
  }
  return SCENARIO_COLORS[0]
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Number input control with formatting
 */
function NumberControl({
  label,
  value,
  onChange,
  min,
  max,
  step,
  description,
  formatValue,
  parseValue,
  disabled,
}: {
  label: string
  value: unknown
  onChange: (newValue: unknown) => void
  min?: number
  max?: number
  step?: number
  description: string
  formatValue?: (value: number | string | undefined) => string
  parseValue?: (value: string) => number | string
  disabled?: boolean
}) {
  const formattedValue = formatValue ? formatValue(value as number) : String(value)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseValue ? parseValue(e.target.value) : parseFloat(e.target.value)
    onChange(newValue)
  }

  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="number"
        value={formattedValue}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
      />
      <p className="mt-1 text-xs text-gray-500">{description}</p>
    </div>
  )
}

/**
 * Select input control
 */
function SelectControl({
  label,
  value,
  onChange,
  options,
  description,
  formatValue,
  parseValue,
  disabled,
}: {
  label: string
  value: unknown
  onChange: (newValue: unknown) => void
  options?: { value: string; label: string }[]
  description: string
  formatValue?: (value: number | string | undefined) => string
  parseValue?: (value: string) => number | string
  disabled?: boolean
}) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = parseValue ? parseValue(e.target.value) : e.target.value
    onChange(newValue)
  }

  const formattedValue = formatValue ? formatValue(value as string) : String(value)

  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select
        value={formattedValue}
        onChange={handleChange}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
      >
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
    </div>
  )
}

// Custom input for when time horizon is custom
function CustomYearsInput({
  customYears,
  onChange,
  disabled,
}: {
  customYears: number | undefined
  onChange: (years: number) => void
  disabled?: boolean
}) {
  if (!customYears && customYears !== 0) return null

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const years = parseInt(e.target.value, 10)
    if (!Number.isNaN(years) && years > 0 && years <= 50) {
      onChange(years)
    }
  }

  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-gray-700 mb-1">Custom Years</label>
      <input
        type="number"
        value={customYears}
        onChange={handleChange}
        min={1}
        max={50}
        step={1}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
      />
      <p className="mt-1 text-xs text-gray-500">Number of years for custom projection (1-50)</p>
    </div>
  )
}

// Scenario tab for switching between scenarios
function ScenarioTab({
  scenario,
  index,
  isActive,
  onClick,
  onClose,
  disabled,
}: {
  scenario: Scenario
  index: number
  isActive: boolean
  onClick: () => void
  onClose: () => void
  disabled?: boolean
}) {
  return (
    <div
      className={`flex items-center px-3 py-2 rounded-t-lg cursor-pointer transition-colors ${
        isActive
          ? 'bg-white border-t border-l border-r border-gray-200'
          : 'bg-gray-50 hover:bg-gray-100 border border-transparent'
      }`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      tabIndex={0}
      role="button"
    >
      <div className="flex items-center">
        <span
          className="inline-block w-3 h-3 rounded-full mr-2"
          style={{ backgroundColor: scenario.color }}
        />
        <span className={`text-sm font-medium ${isActive ? 'text-gray-800' : 'text-gray-600'}`}>
          {scenario.name}
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        disabled={disabled || index === 0}
        className={`ml-2 text-xs p-1 rounded hover:bg-gray-200 ${
          isActive ? 'text-gray-500' : 'text-gray-400'
        } disabled:opacity-0 disabled:cursor-not-allowed`}
      >
        ×
      </button>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function ScenarioControls({
  scenarios,
  activeScenarioIndex,
  onScenariosChange,
  onActiveScenarioChange,
  isCalculating = false,
}: ScenarioControlsProps) {
  const activeScenario = scenarios[activeScenarioIndex]

  // Update a specific scenario
  const updateScenario = (index: number, updates: Partial<Scenario>) => {
    const newScenarios = [...scenarios]
    newScenarios[index] = { ...newScenarios[index], ...updates }
    onScenariosChange(newScenarios)
  }

  // Add a new scenario
  const addScenario = () => {
    const usedColors = scenarios.map((s) => s.color)
    const newColor = getNextColor(usedColors)
    const newScenario: Scenario = {
      id: generateScenarioId(),
      name: `Scenario ${scenarios.length + 1}`,
      input: { ...activeScenario.input },
      color: newColor,
      isVisible: true,
    }
    onScenariosChange([...scenarios, newScenario])
    onActiveScenarioChange(scenarios.length)
  }

  // Remove a scenario
  const removeScenario = (index: number) => {
    if (scenarios.length <= 1) return
    if (index === activeScenarioIndex) {
      onActiveScenarioChange(Math.max(0, index - 1))
    }
    const newScenarios = scenarios.filter((_, i) => i !== index)
    onScenariosChange(newScenarios)
  }

  // Update scenario name
  const updateScenarioName = (index: number, name: string) => {
    updateScenario(index, { name })
  }

  // Update scenario visibility
  const toggleScenarioVisibility = (index: number) => {
    updateScenario(index, { isVisible: !scenarios[index].isVisible })
  }

  // Update input value for active scenario
  const handleInputChange = (key: keyof NetWorthProjectionInput, newValue: unknown) => {
    updateScenario(activeScenarioIndex, {
      input: { ...activeScenario.input, [key]: newValue },
    })
  }

  // Handle custom years change
  const handleCustomYearsChange = (years: number) => {
    updateScenario(activeScenarioIndex, {
      input: {
        ...activeScenario.input,
        timeHorizon: 'custom',
        customYears: years,
      },
    })
  }

  // Sync time horizon across all scenarios
  const syncTimeHorizon = (horizon: TimeHorizon) => {
    const newScenarios = scenarios.map((scenario) => ({
      ...scenario,
      input: { ...scenario.input, timeHorizon: horizon },
    }))
    onScenariosChange(newScenarios)
  }

  return (
    <div className="bg-white rounded-xl shadow-lg">
      {/* Scenario Tabs */}
      <div className="flex overflow-x-auto border-b border-gray-200">
        {scenarios.map((scenario, index) => (
          <ScenarioTab
            key={scenario.id}
            scenario={scenario}
            index={index}
            isActive={index === activeScenarioIndex}
            onClick={() => onActiveScenarioChange(index)}
            onClose={() => removeScenario(index)}
            disabled={isCalculating}
          />
        ))}

        {/* Add Scenario Button */}
        <button
          type="button"
          onClick={addScenario}
          disabled={isCalculating}
          className="px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 text-sm font-medium rounded-tr-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          + Add
        </button>
      </div>

      {/* Scenario Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span
              className="inline-block w-3 h-3 rounded-full mr-2"
              style={{ backgroundColor: activeScenario.color }}
            />
            <input
              type="text"
              value={activeScenario.name}
              onChange={(e) => updateScenarioName(activeScenarioIndex, e.target.value)}
              disabled={isCalculating}
              className="text-lg font-semibold text-gray-800 bg-transparent border-none focus:ring-0 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="flex items-center space-x-2">
            {/* Visibility Toggle */}
            <button
              type="button"
              onClick={() => toggleScenarioVisibility(activeScenarioIndex)}
              disabled={isCalculating}
              className={`p-2 rounded-md ${
                activeScenario.isVisible ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={activeScenario.isVisible ? 'Hide scenario' : 'Show scenario'}
            >
              {activeScenario.isVisible ? (
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              )}
            </button>

            {/* Sync Time Horizon */}
            <button
              type="button"
              onClick={() => syncTimeHorizon(activeScenario.input.timeHorizon)}
              disabled={isCalculating || scenarios.length === 1}
              className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              title="Sync time horizon across all scenarios"
            >
              <svg
                aria-hidden="true"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Parameters</h3>

        <div className="space-y-3">
          {CONTROLS.map((control) => {
            const ControlComponent = control.type === 'select' ? SelectControl : NumberControl
            return (
              <ControlComponent
                key={control.key}
                label={control.label}
                value={(activeScenario.input as Record<string, unknown>)[control.key]}
                onChange={(newValue) => handleInputChange(control.key, newValue)}
                disabled={isCalculating}
                {...control}
              />
            )
          })}

          {/* Custom years input - only shown when time horizon is custom */}
          {activeScenario.input.timeHorizon === 'custom' && (
            <CustomYearsInput
              customYears={activeScenario.input.customYears}
              onChange={handleCustomYearsChange}
              disabled={isCalculating}
            />
          )}
        </div>

        {/* Reset to defaults button */}
        <div className="mt-4 pt-3 border-t border-gray-200">
          <button
            type="button"
            onClick={() =>
              updateScenario(activeScenarioIndex, {
                input: DEFAULT_SCENARIOS[0].input,
              })
            }
            disabled={isCalculating}
            className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            Reset to Defaults
          </button>
        </div>
      </div>

      {/* Scenario List (Mobile) */}
      <div className="p-4 border-t border-gray-200 lg:hidden">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Scenarios</h3>
        <div className="space-y-2">
          {scenarios.map((scenario, index) => (
            <div
              key={scenario.id}
              className={`flex items-center justify-between p-2 rounded-md ${
                index === activeScenarioIndex ? 'bg-blue-50' : ''
              }`}
              onClick={() => onActiveScenarioChange(index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onActiveScenarioChange(index)
                }
              }}
              tabIndex={0}
              role="button"
            >
              <div className="flex items-center">
                <span
                  className="inline-block w-3 h-3 rounded-full mr-2"
                  style={{ backgroundColor: scenario.color }}
                />
                <span className="text-sm">{scenario.name}</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeScenario(index)
                }}
                disabled={isCalculating || index === 0}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Export default scenarios for initial state
export { DEFAULT_SCENARIOS }
export type { Scenario }
