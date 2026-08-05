/**
 * Scenario Builder Component
 *
 * Allows users to create and configure financial forecasting scenarios.
 * Includes income, expense, growth rate, and one-time event configuration.
 *
 * Architecture: React Component with Recharts for visualization
 * Data Sovereignty: Client-side input and calculation; saved forecasts stored in
 * the EU.
 */

import {
  type ForecastingResult,
  type ForecastingScenario,
  calculateFinancialForecast,
  currencySymbol,
  parseFromInput,
  sanitizeMoneyInput,
} from '@budget-planner/core'
import type { NormalizableFinancialItem } from '@budget-planner/core/finance'
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { sanitizeWithCaret } from '../../lib/sanitized-input'
import type { SavedForecast, ScenarioInputs } from '../../routes/forecasting'
import { useCurrencyPreferences, useFormattedAmount } from '../../stores/currencyStore'

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
  /**
   * Callback when user saves a forecast. May return a result so the builder can
   * surface a save failure (e.g. duplicate name) back to the user. `inputs`
   * carries the savings/investments/years that are NOT part of ForecastingScenario
   * so a saved forecast can be reopened faithfully (story bug-3).
   */
  onSave: (data: {
    name: string
    description?: string
    scenario: ForecastingScenario
    result: ForecastingResult
    inputs: ScenarioInputs
  }) =>
    | { success: boolean; error?: string }
    | undefined
    | Promise<{ success: boolean; error?: string } | undefined>
  /**
   * Emits the latest computed forecast (or null while none/invalid) so the page
   * can feed the Projections tab with the user's real scenario instead of sample
   * data (story bug-3).
   */
  onResultChange?: (result: ForecastingResult | null) => void
  /**
   * When provided, seeds every field from a saved forecast so "My Forecasts" →
   * Load reopens it into the builder (story bug-3). The parent remounts the
   * builder (via `key`) when the loaded forecast changes, so these are read once
   * in the state initializers.
   */
  initialForecast?: SavedForecast | null
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
  return items.map(({ id: _id, ...rest }) => rest)
}

/**
 * Format percentage for display
 */
function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

/**
 * Rebuild local (id-carrying) financial items from a saved scenario's items so a
 * loaded forecast can be edited. IDs are regenerated deterministically by index
 * (the persisted scenario stores no ids). Returns [] when the saved scenario had
 * no items of that kind.
 */
function itemsFromSaved(
  items: NormalizableFinancialItem[] | undefined,
  prefix: string
): LocalFinancialItem[] {
  if (!items || items.length === 0) return []
  return items.map((item, index) => ({
    ...item,
    id: `${prefix}-loaded-${index}`,
    // Coerce label/numerics defensively so a corrupt saved item can't seed a NaN
    // amount or an uncontrolled input (review bug-3).
    name: item.name ?? '',
    amount: Number.isFinite(item.amount) ? item.amount : 0,
    frequency: item.frequency ?? 'monthly',
  }))
}

/**
 * Rebuild local one-time events from a saved scenario. The persisted events may
 * carry a `name` (the builder writes one) even though `ForecastingScenario` types
 * `oneTimeEvents` as `{ year, amount }`; default the name when absent (e.g. an
 * older saved row).
 */
function eventsFromSaved(events: ForecastingScenario['oneTimeEvents']): OneTimeEvent[] {
  if (!events || events.length === 0) return []
  return events.map((event, index) => ({
    id: `event-loaded-${index}`,
    year: event.year,
    amount: event.amount,
    name: (event as { name?: string }).name ?? 'One-time event',
  }))
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
export function ScenarioBuilder({
  onSave,
  onResultChange,
  initialForecast,
}: ScenarioBuilderProps): React.ReactElement {
  // Display amounts respect the user's currency mode (currency-less vs symbols).
  const formatCurrency = useFormattedAmount()
  // Locale for parsing grouped/symbol input back to exact cents. parseFloat on a
  // formatted string is lossy (`parseFloat('5,000.00') === 5`); the core
  // parseFromInput helper strips grouping/symbols and canonicalizes the locale
  // (story 14-3), so both money fields round-trip correctly.
  const { locale } = useCurrencyPreferences()
  // State for financial items. When a saved forecast is loaded, seed every field
  // from it (the parent remounts this component via `key` on load, so these lazy
  // initializers run once per load); a fresh builder falls back to the defaults.
  const [incomeItems, setIncomeItems] = useState<LocalFinancialItem[]>(() =>
    initialForecast ? itemsFromSaved(initialForecast.scenario.newIncome, 'income') : DEFAULT_INCOME
  )
  const [expenseItems, setExpenseItems] = useState<LocalFinancialItem[]>(() =>
    initialForecast
      ? itemsFromSaved(initialForecast.scenario.newExpenses, 'expense')
      : DEFAULT_EXPENSES
  )

  // State for scenario configuration
  const [formData, setFormData] = useState<ScenarioFormData>(() =>
    initialForecast
      ? {
          name: initialForecast.scenario.name,
          description: initialForecast.scenario.description ?? '',
          incomeGrowthRate: initialForecast.scenario.incomeGrowthRate,
          expenseGrowthRate: initialForecast.scenario.expenseGrowthRate,
          years: initialForecast.inputs?.years ?? DEFAULT_FORM.years,
        }
      : DEFAULT_FORM
  )
  const [savings, setSavings] = useState<number>(
    () => initialForecast?.inputs?.savings ?? DEFAULT_SAVINGS
  )
  const [investments, setInvestments] = useState<number>(
    () => initialForecast?.inputs?.investments ?? DEFAULT_INVESTMENTS
  )
  const [oneTimeEvents, setOneTimeEvents] = useState<OneTimeEvent[]>(() =>
    initialForecast ? eventsFromSaved(initialForecast.scenario.oneTimeEvents) : []
  )

  // State for results — seed from the loaded forecast so its summary shows
  // immediately, before the debounced recompute runs.
  const [result, setResult] = useState<ForecastingResult | null>(
    () => initialForecast?.result ?? null
  )
  const [isCalculating, setIsCalculating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the latest onResultChange in a ref so the debounced recompute stays
  // correct even if a caller passes a non-memoized callback (review bug-3):
  // calculateForecast then needn't depend on the callback's identity.
  const onResultChangeRef = useRef(onResultChange)
  useEffect(() => {
    onResultChangeRef.current = onResultChange
  }, [onResultChange])

  // Calculate scenario whenever inputs change (with debounce)
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are exactly the inputs the debounced calculateForecast (declared below) depends on; depending on calculateForecast itself would reference it before initialization (TDZ).
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
        oneTimeEvents: oneTimeEvents.map(({ id: _id, ...rest }) => rest),
      }

      const currentData = {
        income: toNormalizableItems(incomeItems),
        expenses: toNormalizableItems(expenseItems),
        savings,
        investments,
      }

      const newResult = calculateFinancialForecast(currentData, scenario, formData.years)
      setResult(newResult)
      // Lift the fresh result to the page so the Projections tab reflects THIS
      // scenario instead of sample data (story bug-3). Keep the last good result
      // on error rather than blanking the chart. Read via ref so this callback's
      // identity doesn't depend on the caller passing a stable onResultChange.
      onResultChangeRef.current?.(newResult)
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
   * Handle savings change. The InputField's parseValue already converts the
   * typed string to cents via parseFromInput, so store it directly — the old
   * `Math.round(parseFloat(value) * 100)` re-scaled an already-cents value by
   * another ×100 (a typed 5000 became $500,000).
   */
  const handleSavingsChange = useCallback(
    (value: string | number) => {
      setSavings(typeof value === 'number' ? value : parseFromInput(value, locale))
    },
    [locale]
  )

  /**
   * Handle investments change (see handleSavingsChange — same double-×100 fix).
   */
  const handleInvestmentsChange = useCallback(
    (value: string | number) => {
      setInvestments(typeof value === 'number' ? value : parseFromInput(value, locale))
    },
    [locale]
  )

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
      _items: LocalFinancialItem[],
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
  const handleSave = useCallback(async () => {
    if (!result) {
      setError('No forecast calculated yet')
      return
    }
    // Guard against double-submit: a second concurrent save would race the
    // first and spuriously trip the unique-name constraint.
    if (isSaving) {
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
      scenario.oneTimeEvents = oneTimeEvents.map(({ id: _id, ...rest }) => rest)
    }

    setIsSaving(true)
    try {
      const saveResult = await onSave({
        name: formData.name,
        description: formData.description || undefined,
        scenario,
        result,
        // Persist the inputs that ForecastingScenario does not carry, so the
        // forecast can be reopened faithfully (story bug-3).
        inputs: { savings, investments, years: formData.years },
      })
      if (saveResult && !saveResult.success) {
        setError(saveResult.error || 'Failed to save forecast')
      } else {
        setError(null)
      }
    } finally {
      setIsSaving(false)
    }
  }, [
    result,
    isSaving,
    formData,
    incomeItems,
    expenseItems,
    oneTimeEvents,
    savings,
    investments,
    onSave,
  ])

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
        <h2 className="text-2xl font-bold text-subheading">Scenario Builder</h2>
        <p className="text-muted mt-1">Create and configure your financial forecasting scenario</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Scenario Configuration */}
      <section className="surface-inset rounded-xl p-6 space-y-6">
        <h3 className="text-lg font-semibold text-subheading">Scenario Settings</h3>

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
            parseValue={(v) => parseFromInput(v, locale)}
            sanitize={(v) => sanitizeMoneyInput(v, locale)}
          />

          {/* Current Investments */}
          <InputField
            label="Current Investments"
            value={investments}
            onChange={handleInvestmentsChange}
            type="text"
            inputMode="decimal"
            formatValue={formatCurrency}
            parseValue={(v) => parseFromInput(v, locale)}
            sanitize={(v) => sanitizeMoneyInput(v, locale)}
          />
        </div>
      </section>

      {/* Income Items */}
      <section className="surface-inset rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-subheading">Income Sources</h3>
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
      <section className="surface-inset rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-subheading">Expense Categories</h3>
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
      <section className="surface-inset rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-subheading">One-Time Events</h3>
          <button
            type="button"
            onClick={addOneTimeEvent}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Event
          </button>
        </div>

        {oneTimeEvents.length === 0 ? (
          <p className="text-muted text-sm">No one-time events configured</p>
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
        <section className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-subheading mb-4">Forecast Summary</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isCalculating || isSaving}
            >
              {isCalculating ? 'Calculating...' : isSaving ? 'Saving...' : 'Save Forecast'}
            </button>
          </div>
        </section>
      )}

      {/* Calculation Status */}
      {isCalculating && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          <span className="ml-2 text-body">Calculating forecast...</span>
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
  /**
   * Optional on-input character filter (story 28-1, FR46).
   *
   * Opt-in per call site rather than inferred from `inputMode`/`type`, because
   * this component is shared by money and non-money fields alike — a scenario
   * name must keep accepting letters. Only the two money fields pass it.
   */
  sanitize?: (raw: string) => string
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
  sanitize,
}: InputFieldProps): React.ReactElement {
  const [internalValue, setInternalValue] = useState<string>(() => {
    // `formatValue` here is the symbol-bearing display formatter, so a money field
    // would otherwise mount holding "$5,000.00" and lose the symbol the instant the
    // user types. Seed through the same filter the field enforces, so what mounts
    // is already a legal value for it.
    const seeded = formatValue ? formatValue(value) : String(value)
    return sanitize ? sanitize(seeded) : seeded
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Filter first, so the displayed value and the value lifted to the parent are
    // derived from the same string. There is no blur re-formatter on this surface,
    // which makes onChange the only filter point. `sanitizeWithCaret` also keeps
    // the cursor in place when a character is rejected mid-string.
    const rawValue = sanitize ? sanitizeWithCaret(e.target, sanitize) : e.target.value
    setInternalValue(rawValue)

    if (parseValue) {
      onChange(parseValue(rawValue))
    } else if (type === 'number') {
      const numValue = parseFloat(rawValue)
      onChange(Number.isNaN(numValue) ? 0 : numValue)
    } else {
      onChange(rawValue)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-label mb-1">{label}</label>
      <input
        type={type}
        value={internalValue}
        onChange={handleChange}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        inputMode={inputMode}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
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
  // The amount prefix follows the user's currency mode: the selected currency's
  // symbol in symbol mode, nothing in currency-less mode (a hard-coded `$` was
  // wrong in neutral mode and for non-USD currencies).
  const { mode, currency } = useCurrencyPreferences()

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    // Validate: ensure value is a valid number and not negative
    if (Number.isNaN(value) || value < 0) {
      onUpdate('amount', 0)
    } else {
      const cents = Math.round(value * 100)
      onUpdate('amount', cents)
    }
  }

  return (
    <div className="surface rounded-lg p-4 shadow-sm border border-default">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-label mb-1">Name</label>
          <input
            type="text"
            value={item.name}
            onChange={(e) => onUpdate('name', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
            placeholder="Income/Expense name"
          />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-label mb-1">Amount</label>
          <div className="relative">
            {mode === 'symbol' && (
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                {currencySymbol(currency)}
              </span>
            )}
            <input
              type="number"
              value={item.amount / 100}
              onChange={handleAmountChange}
              min={0}
              step={0.01}
              className={`w-full ${
                mode === 'symbol' ? 'px-6' : 'px-2'
              } py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm`}
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Frequency */}
        <div>
          <label className="block text-sm font-medium text-label mb-1">Frequency</label>
          <select
            value={item.frequency}
            onChange={(e) => onUpdate('frequency', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
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
            className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
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
  // Currency-mode-aware amount prefix (see FinancialItemRow) — never a literal `$`.
  const { mode, currency } = useCurrencyPreferences()

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    // Validate: ensure value is a valid number and not negative
    if (Number.isNaN(value) || value < 0) {
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
    <div className="surface rounded-lg p-4 shadow-sm border border-default">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-label mb-1">Event Name</label>
          <input
            type="text"
            value={event.name}
            onChange={(e) => onUpdate(event.id, 'name', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
            placeholder="Bonus, Windfall, etc."
          />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-label mb-1">Amount</label>
          <div className="relative">
            {mode === 'symbol' && (
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                {currencySymbol(currency)}
              </span>
            )}
            <input
              type="number"
              value={event.amount / 100}
              onChange={handleAmountChange}
              min={0}
              step={0.01}
              className={`w-full ${
                mode === 'symbol' ? 'px-6' : 'px-2'
              } py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm`}
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Year */}
        <div>
          <label className="block text-sm font-medium text-label mb-1">Year</label>
          <input
            type="number"
            value={event.year}
            onChange={handleYearChange}
            min={1}
            max={maxYear}
            step={1}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
          />
        </div>

        {/* Delete */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onDelete(event.id)}
            className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
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
        highlight ? 'bg-white dark:bg-gray-800 shadow' : 'bg-blue-100 dark:bg-blue-900/40'
      }`}
    >
      <dt className="text-xs font-medium text-muted uppercase tracking-wider">{label}</dt>
      <dd
        className={`mt-1 text-lg font-semibold ${
          highlight ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-100'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
