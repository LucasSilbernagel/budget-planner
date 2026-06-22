/**
 * Scenario Builder Component
 * 
 * Allows users to create and configure financial forecasting scenarios.
 * Includes income, expense, growth rate, and one-time event configuration.
 * 
 * Architecture: React Component with Recharts for visualization
 * Data Sovereignty: Client-side input, server-side calculations
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  calculateFinancialForecast,
  type ForecastingScenario,
  type ForecastingResult,
} from '@budget-planner/core'
import type { NormalizableFinancialItem } from '@budget-planner/core/finance'

// ============================================================================
// Constants
// ============================================================================

const DEBOUNCE_DELAY_MS = 500

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Local financial item with ID for UI management
 */
export interface LocalFinancialItem extends NormalizableFinancialItem {
  id: string
}

/**
 * One-time event for forecasting
 */
export interface OneTimeEvent {
  id: string
  year: number
  amount: number // In cents
  name: string
}

/**
 * Props for ScenarioBuilder component
 */
export interface ScenarioBuilderProps {
  /** Callback when user saves a forecast */
  onSave: (data: {
    name: string
    description?: string
    scenario: ForecastingScenario
    result: ForecastingResult
  }) => void
}

/**
 * Form data for scenario configuration
 */
interface ScenarioFormData {
  name: string
  description: string
  incomeGrowthRate: number
  expenseGrowthRate: number
  years: number
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_INCOME: LocalFinancialItem[] = [
  {
    id: 'income-1',
    name: 'Salary',
    amount: 500000, // $5,000 in cents
    frequency: 'monthly',
  },
]

const DEFAULT_EXPENSES: LocalFinancialItem[] = [
  {
    id: 'expense-1',
    name: 'Rent/Mortgage',
    amount: 150000, // $1,500 in cents
    frequency: 'monthly',
  },
  {
    id: 'expense-2',
    name: 'Utilities',
    amount: 20000, // $200 in cents
    frequency: 'monthly',
  },
  {
    id: 'expense-3',
    name: 'Groceries',
    amount: 60000, // $600 in cents
    frequency: 'monthly',
  },
]

const DEFAULT_FORM: ScenarioFormData = {
  name: 'My Financial Forecast',
  description: 'Projecting my financial situation over the next 10 years',
  incomeGrowthRate: 0.03, // 3%
  expenseGrowthRate: 0.02, // 2%
  years: 10,
}

const DEFAULT_SAVINGS = 500000 // $5,000
const DEFAULT_INVESTMENTS = 1000000 // $10,000

const FREQUENCY_OPTIONS = [
  { value: 'weekly' as const, label: 'Weekly' },
  { value: 'biweekly' as const, label: 'Biweekly' },
  { value: 'monthly' as const, label: 'Monthly' },
  { value: 'annually' as const, label: 'Annually' },
]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
}

/**
 * Convert local financial items to normalizable items
 */
function toNormalizableItems(items: LocalFinancialItem[]): NormalizableFinancialItem[] {
  return items.map(({ id, ...rest }) => rest)
}

/**
 * Format currency for display
 */
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

/**
 * Format percentage for display
 */
function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Scenario Builder Component
 * 
 * Allows users to build and configure financial forecasting scenarios.
 * Calculates projections based on user input.
 */
export function ScenarioBuilder({ onSave }: ScenarioBuilderProps): React.ReactElement {
  // State for financial items
  const [incomeItems, setIncomeItems] = useState<LocalFinancialItem[]>(DEFAULT_INCOME)
  const [expenseItems, setExpenseItems] = useState<LocalFinancialItem[]>(DEFAULT_EXPENSES)
  
  // State for scenario configuration
  const [formData, setFormData] = useState<ScenarioFormData>(DEFAULT_FORM)
  const [savings, setSavings] = useState<number>(DEFAULT_SAVINGS)
  const [investments, setInvestments] = useState<number>(DEFAULT_INVESTMENTS)
  const [oneTimeEvents, setOneTimeEvents] = useState<OneTimeEvent[]>([])
  
  // State for results
  const [result, setResult] = useState<ForecastingResult | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Calculate scenario whenever inputs change (with debounce)
  useEffect(() => {
    // Clear any existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
    
    // Set new timer
    debounceTimer.current = setTimeout(() => {
      calculateForecast()
    }, DEBOUNCE_DELAY_MS)
    
    // Cleanup on unmount
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [incomeItems, expenseItems, formData, savings, investments, oneTimeEvents])

  /**
   * Calculate forecast based on current inputs
   */
  const calculateForecast = useCallback(async () => {
    setIsCalculating(true)
    setError(null)

    try {
      const scenario: ForecastingScenario = {
        name: formData.name,
        description: formData.description || undefined,
        incomeGrowthRate: formData.incomeGrowthRate,
        expenseGrowthRate: formData.expenseGrowthRate,
        newIncome: toNormalizableItems(incomeItems),
        newExpenses: toNormalizableItems(expenseItems),
        oneTimeEvents: oneTimeEvents.map(({ id, ...rest }) => rest),
      }

      const currentData = {
        income: toNormalizableItems(incomeItems),
        expenses: toNormalizableItems(expenseItems),
        savings,
        investments,
      }

      const newResult = calculateFinancialForecast(
        currentData,
        scenario,
        formData.years
      )
      setResult(newResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate forecast')
    } finally {
      setIsCalculating(false)
    }
  }, [incomeItems, expenseItems, formData, savings, investments, oneTimeEvents])

  /**
   * Handle form input change
   */
  const handleFormChange = useCallback((field: keyof ScenarioFormData, value: string | number) => {
    setFormData((prev) => ({
      ...prev,
      [field]: typeof value === 'string' ? value : value,
    }))
  }, [])

  /**
   * Handle savings change
   */
  const handleSavingsChange = useCallback((value: string) => {
    const cents = Math.round(parseFloat(value) * 100)
    setSavings(cents)
  }, [])

  /**
   * Handle investments change
   */
  const handleInvestmentsChange = useCallback((value: string) => {
    const cents = Math.round(parseFloat(value) * 100)
    setInvestments(cents)
  }, [])

  /**
   * Add new income item
   */
  const addIncomeItem = useCallback(() => {
    setIncomeItems((prev) => [
      ...prev,
      {
        id: generateId('income'),
        name: 'New Income',
        amount: 0,
        frequency: 'monthly',
      },
    ])
  }, [])

  /**
   * Add new expense item
   */
  const addExpenseItem = useCallback(() => {
    setExpenseItems((prev) => [
      ...prev,
      {
        id: generateId('expense'),
        name: 'New Expense',
        amount: 0,
        frequency: 'monthly',
      },
    ])
  }, [])

  /**
   * Update financial item
   */
  const updateFinancialItem = useCallback(
    (
      items: LocalFinancialItem[],
      setItems: React.Dispatch<React.SetStateAction<LocalFinancialItem[]>>,
      id: string,
      field: keyof LocalFinancialItem,
      value: string | number
    ) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                [field]: typeof value === 'string' ? value : value,
              }
            : item
        )
      )
    },
    []
  )

  /**
   * Delete financial item
   */
  const deleteFinancialItem = useCallback(
    (
      items: LocalFinancialItem[],
      setItems: React.Dispatch<React.SetStateAction<LocalFinancialItem[]>>,
      id: string
    ) => {
      if (items.length <= 1) {
        setError('At least one item is required')
        return
      }
      setItems((prev) => prev.filter((item) => item.id !== id))
    },
    []
  )

  /**
   * Add one-time event
   */
  const addOneTimeEvent = useCallback(() => {
    setOneTimeEvents((prev) => [
      ...prev,
      {
        id: generateId('event'),
        year: 1,
        amount: 0,
        name: 'One-time Event',
      },
    ])
  }, [])

  /**
   * Update one-time event
   */
  const updateOneTimeEvent = useCallback(
    (id: string, field: keyof OneTimeEvent, value: string | number) => {
      setOneTimeEvents((prev) =>
        prev.map((event) =>
          event.id === id
            ? {
                ...event,
                [field]: typeof value === 'string' ? value : value,
              }
            : event
        )
      )
    },
    []
  )

  /**
   * Delete one-time event
   */
  const deleteOneTimeEvent = useCallback((id: string) => {
    setOneTimeEvents((prev) => prev.filter((event) => event.id !== id))
  }, [])

  /**
   * Handle save
   */
  const handleSave = useCallback(() => {
    if (!result) {
      setError('No forecast calculated yet')
      return
    }

    const scenario: ForecastingScenario = {
      name: formData.name,
      description: formData.description || undefined,
      incomeGrowthRate: formData.incomeGrowthRate,
      expenseGrowthRate: formData.expenseGrowthRate,
    }

    if (incomeItems.length > 0) {
      scenario.newIncome = toNormalizableItems(incomeItems)
    }
    if (expenseItems.length > 0) {
      scenario.newExpenses = toNormalizableItems(expenseItems)
    }
    if (oneTimeEvents.length > 0) {
      scenario.oneTimeEvents = oneTimeEvents.map(({ id, ...rest }) => rest)
    }

    onSave({
      name: formData.name,
      description: formData.description || undefined,
      scenario,
      result,
    })
  }, [result, formData, incomeItems, expenseItems, oneTimeEvents, onSave])

  // Calculate summary statistics
  const summary = useMemo(() => {
    if (!result) return null
    return {
      startingNetWorth: result.summary.startingNetWorth,
      endingNetWorth: result.summary.endingNetWorth,
      totalGrowth: result.summary.totalGrowth,
      averageAnnualGrowth: result.summary.averageAnnualGrowth,
    }
  }, [result])

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Scenario Builder</h2>
        <p className="text-gray-500 mt-1">
          Create and configure your financial forecasting scenario
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Scenario Configuration */}
      <section className="bg-gray-50 rounded-xl p-6 space-y-6">
        <h3 className="text-lg font-semibold text-gray-800">Scenario Settings</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Scenario Name */}
          <InputField
            label="Scenario Name"
            value={formData.name}
            onChange={(v) => handleFormChange('name', v)}
            type="text"
            placeholder="My Financial Forecast"
          />

          {/* Description */}
          <InputField
            label="Description"
            value={formData.description}
            onChange={(v) => handleFormChange('description', v)}
            type="text"
            placeholder="Optional description"
          />

          {/* Projection Years */}
          <InputField
            label="Projection Period (years)"
            value={formData.years}
            onChange={(v) => handleFormChange('years', Number(v))}
            type="number"
            min={1}
            max={30}
            step={1}
          />

          {/* Income Growth Rate */}
          <InputField
            label="Income Growth Rate"
            value={formData.incomeGrowthRate}
            onChange={(v) => handleFormChange('incomeGrowthRate', Number(v))}
            type="number"
            min={-1}
            max={1}
            step={0.01}
            formatValue={formatPercentage}
            parseValue={(v) => parseFloat(v) / 100}
          />

          {/* Expense Growth Rate */}
          <InputField
            label="Expense Growth Rate"
            value={formData.expenseGrowthRate}
            onChange={(v) => handleFormChange('expenseGrowthRate', Number(v))}
            type="number"
            min={-1}
            max={1}
            step={0.01}
            formatValue={formatPercentage}
            parseValue={(v) => parseFloat(v) / 100}
          />

          {/* Current Savings */}
          <InputField
            label="Current Savings"
            value={savings}
            onChange={handleSavingsChange}
            type="text"
            inputMode="decimal"
            formatValue={formatCurrency}
            parseValue={(v) => parseFloat(v) * 100}
          />

          {/* Current Investments */}
          <InputField
            label="Current Investments"
            value={investments}
            onChange={handleInvestmentsChange}
            type="text"
            inputMode="decimal"
            formatValue={formatCurrency}
            parseValue={(v) => parseFloat(v) * 100}
          />
        </div>
      </section>

      {/* Income Items */}
      <section className="bg-gray-50 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">Income Sources</h3>
          <button
            type="button"
            onClick={addIncomeItem}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Income
          </button>
        </div>

        <div className="space-y-4">
          {incomeItems.map((item) => (
            <FinancialItemRow
              key={item.id}
              item={item}
              frequencyOptions={FREQUENCY_OPTIONS}
              onUpdate={(field, value) =>
                updateFinancialItem(incomeItems, setIncomeItems, item.id, field, value)
              }
              onDelete={() => deleteFinancialItem(incomeItems, setIncomeItems, item.id)}
            />
          ))}
        </div>
      </section>

      {/* Expense Items */}
      <section className="bg-gray-50 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">Expense Categories</h3>
          <button
            type="button"
            onClick={addExpenseItem}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Expense
          </button>
        </div>

        <div className="space-y-4">
          {expenseItems.map((item) => (
            <FinancialItemRow
              key={item.id}
              item={item}
              frequencyOptions={FREQUENCY_OPTIONS}
              onUpdate={(field, value) =>
                updateFinancialItem(expenseItems, setExpenseItems, item.id, field, value)
              }
              onDelete={() => deleteFinancialItem(expenseItems, setExpenseItems, item.id)}
            />
          ))}
        </div>
      </section>

      {/* One-Time Events */}
      <section className="bg-gray-50 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">One-Time Events</h3>
          <button
            type="button"
            onClick={addOneTimeEvent}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Event
          </button>
        </div>

        {oneTimeEvents.length === 0 ? (
          <p className="text-gray-500 text-sm">No one-time events configured</p>
        ) : (
          <div className="space-y-4">
            {oneTimeEvents.map((event) => (
              <OneTimeEventRow
                key={event.id}
                event={event}
                onUpdate={updateOneTimeEvent}
                onDelete={deleteOneTimeEvent}
                maxYear={formData.years}
              />
            ))}
          </div>
        )}
      </section>

      {/* Results Summary */}
      {result && (
        <section className="bg-blue-50 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Forecast Summary</h3>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Starting Net Worth"
              value={formatCurrency(summary?.startingNetWorth || 0)}
            />
            <StatCard
              label="Ending Net Worth"
              value={formatCurrency(summary?.endingNetWorth || 0)}
            />
            <StatCard
              label="Total Growth"
              value={formatCurrency(summary?.totalGrowth || 0)}
              highlight
            />
            <StatCard
              label="Avg Annual Growth"
              value={formatCurrency(Math.round(summary?.averageAnnualGrowth || 0))}
            />
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              disabled={isCalculating}
            >
              {isCalculating ? 'Calculating...' : 'Save Forecast'}
            </button>
          </div>
        </section>
      )}

      {/* Calculation Status */}
      {isCalculating && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          <span className="ml-2 text-gray-600">Calculating forecast...</span>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

/**
 * Input Field Component
 */
interface InputFieldProps {
  label: string
  value: string | number
  onChange: (value: string | number) => void
  type: 'text' | 'number'
  placeholder?: string
  min?: number
  max?: number
  step?: number
  inputMode?: 'decimal' | 'numeric'
  formatValue?: (value: string | number) => string
  parseValue?: (value: string) => string | number
}

function InputField({
  label,
  value,
  onChange,
  type,
  placeholder,
  min,
  max,
  step,
  inputMode,
  formatValue,
  parseValue,
}: InputFieldProps): React.ReactElement {
  const [internalValue, setInternalValue] = useState<string>(
    formatValue ? formatValue(value) : String(value)
  )

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    setInternalValue(rawValue)
    
    if (parseValue) {
      onChange(parseValue(rawValue))
    } else if (type === 'number') {
      const numValue = parseFloat(rawValue)
      onChange(isNaN(numValue) ? 0 : numValue)
    } else {
      onChange(rawValue)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={internalValue}
        onChange={handleChange}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        inputMode={inputMode}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
      />
    </div>
  )
}

/**
 * Financial Item Row Component
 */
interface FinancialItemRowProps {
  item: LocalFinancialItem
  frequencyOptions: { value: string; label: string }[]
  onUpdate: (field: keyof LocalFinancialItem, value: string | number) => void
  onDelete: () => void
}

function FinancialItemRow({
  item,
  frequencyOptions,
  onUpdate,
  onDelete,
}: FinancialItemRowProps): React.ReactElement {
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    // Validate: ensure value is a valid number and not negative
    if (isNaN(value) || value < 0) {
      onUpdate('amount', 0)
    } else {
      const cents = Math.round(value * 100)
      onUpdate('amount', cents)
    }
  }

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={item.name}
            onChange={(e) => onUpdate('name', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
            placeholder="Income/Expense name"
          />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">$</span>
            <input
              type="number"
              value={item.amount / 100}
              onChange={handleAmountChange}
              min={0}
              step={0.01}
              className="w-full px-6 py-1.5 border border-gray-300 rounded text-sm"
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Frequency */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
          <select
            value={item.frequency}
            onChange={(e) => onUpdate('frequency', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          >
            {frequencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Delete */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDelete}
            className="px-2 py-1.5 bg-red-100 text-red-600 rounded text-xs font-medium hover:bg-red-200 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * One-Time Event Row Component
 */
interface OneTimeEventRowProps {
  event: OneTimeEvent
  onUpdate: (id: string, field: keyof OneTimeEvent, value: string | number) => void
  onDelete: (id: string) => void
  maxYear: number
}

function OneTimeEventRow({
  event,
  onUpdate,
  onDelete,
  maxYear,
}: OneTimeEventRowProps): React.ReactElement {
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    // Validate: ensure value is a valid number and not negative
    if (isNaN(value) || value < 0) {
      onUpdate(event.id, 'amount', 0)
    } else {
      const cents = Math.round(value * 100)
      onUpdate(event.id, 'amount', cents)
    }
  }

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const year = Math.max(1, Math.min(maxYear, parseInt(e.target.value, 10) || 1))
    onUpdate(event.id, 'year', year)
  }

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Event Name</label>
          <input
            type="text"
            value={event.name}
            onChange={(e) => onUpdate(event.id, 'name', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
            placeholder="Bonus, Windfall, etc."
          />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">$</span>
            <input
              type="number"
              value={event.amount / 100}
              onChange={handleAmountChange}
              min={0}
              step={0.01}
              className="w-full px-6 py-1.5 border border-gray-300 rounded text-sm"
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Year */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
          <input
            type="number"
            value={event.year}
            onChange={handleYearChange}
            min={1}
            max={maxYear}
            step={1}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          />
        </div>

        {/* Delete */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onDelete(event.id)}
            className="px-2 py-1.5 bg-red-100 text-red-600 rounded text-xs font-medium hover:bg-red-200 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Stat Card Component
 */
interface StatCardProps {
  label: string
  value: string
  highlight?: boolean
}

function StatCard({ label, value, highlight }: StatCardProps): React.ReactElement {
  return (
    <div
      className={`rounded-lg p-4 text-center ${
        highlight ? 'bg-white shadow' : 'bg-blue-100'
      }`}
    >
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold ${highlight ? 'text-blue-600' : 'text-gray-800'}`}>
        {value}
      </dd>
    </div>
  )
}
