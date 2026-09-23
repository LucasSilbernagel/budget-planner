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
import type { Frequency, NormalizableFinancialItem } from '@budget-planner/core/finance'
import React, { useState, useCallback, useMemo, useRef, useEffect, useId } from 'react'
import { useIsInitialSyncPending } from '../../hooks/useIsInitialSyncPending'
import { useStoresHydrated } from '../../hooks/useStoresHydrated'
import { isKnownFrequency } from '../../lib/readable-rows'
import { sanitizeWithCaret } from '../../lib/sanitized-input'
import type { SavedForecast, ScenarioInputs } from '../../routes/forecasting'
import { useTotalInvestmentBalance } from '../../stores/balanceStore'
import { useCurrencyPreferences, useFormattedAmount } from '../../stores/currencyStore'
import { useExpenses } from '../../stores/expenseStore'
import { useIncomeSources } from '../../stores/incomeStore'
import { useTotalSavings } from '../../stores/savingsStore'

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
  /**
   * ⚠️ Was missing, and every value of this type has carried it all along —
   * `itemsFromSaved` and `itemsFromStore` both coerce it defensively and the row
   * editor reads and writes it. (This cited `DEFAULT_INCOME`/`DEFAULT_EXPENSES`,
   * deleted by story 62.1, and `toLocalItems`, which has not existed for longer
   * than that — corrected in code review 62.1.)
   * `NormalizableFinancialItem` (core) is deliberately just `{amount, frequency}`,
   * so the label belongs here, on the UI-local extension.
   */
  name: string
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

/**
 * ⚠️ There are deliberately NO `DEFAULT_INCOME` / `DEFAULT_EXPENSES` /
 * `DEFAULT_SAVINGS` / `DEFAULT_INVESTMENTS` constants any more (story 62.1,
 * FR94). A fresh builder seeds from the user's own stores, and a user with
 * nothing recorded gets an EMPTY builder — never a demo row.
 *
 * Do not reintroduce a `rows.length === 0 ? DEMO_ROWS : rows` fallback. It would
 * restore the defect for exactly the users least able to recognise that the
 * salary on screen is not theirs.
 */
const DEFAULT_FORM: ScenarioFormData = {
  name: 'My Financial Forecast',
  description: 'Projecting my financial situation over the next 10 years',
  // ⚠️ Both ZERO since story 62.1 (FR94). The builder projects the user's real
  // position by default and invents no growth; a rate is something the user opts
  // into, not an assumption baked into every scenario they open.
  incomeGrowthRate: 0,
  expenseGrowthRate: 0,
  years: 10,
}

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
function formatPercentage(value: string | number): string {
  // `string | number` to match `InputFieldProps.formatValue`, which is what this is
  // for. Both call sites pass a number, and `Number()` is identity on one.
  return `${(Number(value) * 100).toFixed(2)}%`
}

/**
 * Rebuild local (id-carrying) financial items from a saved scenario's items so a
 * loaded forecast can be edited. IDs are regenerated deterministically by index
 * (the persisted scenario stores no ids). Returns [] when the saved scenario had
 * no items of that kind.
 */
function itemsFromSaved(
  // Saved items carry a label that `NormalizableFinancialItem` deliberately does
  // not model (core keeps it to `{amount, frequency}`). Optional because a
  // corrupt or older saved scenario may lack it — which the `?? ''` below already
  // handled, before the type admitted it was possible.
  items: (NormalizableFinancialItem & { name?: string })[] | undefined,
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
 * Build local (id-carrying) financial items from the user's own store rows, for
 * a FRESH scenario (story 62.1, FR94).
 *
 * ⚠️ Fields are mapped EXPLICITLY rather than spread. `toNormalizableItems`
 * above strips only `id`, so a spread would carry `profileId`, `userId`,
 * `categoryId` and `position` into the scenario — and from there into the saved
 * `newIncome`/`newExpenses` JSON, silently changing the save format.
 *
 * ⚠️ `amount`/`frequency` are passed through as the RAW pair the row carries.
 * They are not monthly-normalized (`useTotalIncome` is the normalized hook and
 * is deliberately not used here) — the engine normalizes downstream, so
 * pre-normalizing would count every non-monthly row twice over.
 *
 * Ids are re-keyed rather than reused: store ids are uuids, while this component
 * mints its own with `generateId`. The deterministic `-seeded-<index>` form
 * matches `itemsFromSaved` and cannot collide with a later `generateId` row.
 *
 * ⚠️ Values are validated, not merely null-coalesced (corrected in code review
 * 62.1). The parameter type says these fields are present and well-typed, but
 * the rows come from localStorage and from the sync applier, neither of which
 * validates — `lib/readable-rows.ts:7-15` records that hazard as live. So a `??`
 * chain was parity with `itemsFromSaved` AND a gap: it catches `null`/`undefined`
 * but waves through `'Monthly'`, `'quarterly'` or `''`, which then reach
 * `validateFrequency` and throw, killing the whole forecast with an "Invalid
 * frequency" banner and no indication of WHICH row is at fault — while the row's
 * own `<select>` renders the corrupt value as "Weekly", so it is invisible.
 * `isKnownFrequency` is the house predicate for this.
 */
function itemsFromStore(
  rows: readonly { name: string; amount: number; frequency: Frequency }[],
  prefix: string
): LocalFinancialItem[] {
  return rows.map((row, index) => ({
    id: `${prefix}-seeded-${index}`,
    name: typeof row.name === 'string' ? row.name : '',
    amount: Number.isFinite(row.amount) ? row.amount : 0,
    frequency: isKnownFrequency(row.frequency) ? row.frequency : 'monthly',
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
    initialForecast ? itemsFromSaved(initialForecast.scenario.newIncome, 'income') : []
  )
  const [expenseItems, setExpenseItems] = useState<LocalFinancialItem[]>(() =>
    initialForecast ? itemsFromSaved(initialForecast.scenario.newExpenses, 'expense') : []
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
  // ⚠️ DECISION REVERSED by story 62.1 (FR94), replacing the story 32.2 / FR59
  // audit note that stood here.
  //
  // 32.2 examined these two fields and deliberately left them on hard-coded demo
  // constants, reasoning that they are what-if SCENARIO inputs the user types
  // rather than reads of the savings or balance stores. That reasoning was not
  // wrong — it was OUTRANKED. A builder that opens on a stranger's $5,000 asks
  // the user to correct three rows before they can start, and the downstream
  // "Starting/Ending Net Worth" wording still describes the scenario, so nothing
  // 32.2 was protecting is lost by starting that scenario from the user's own
  // position.
  //
  // A fresh builder therefore seeds from `useTotalSavings()` /
  // `useTotalInvestmentBalance()` in the hydration effect below. `0` here is the
  // pre-seed value, and it is also the final value for a LOADED forecast whose
  // saved row predates persisted `inputs` — reading the live stores in that case
  // would silently re-baseline a forecast saved months ago, which is exactly what
  // AC-7 forbids.
  const [savings, setSavings] = useState<number>(() => initialForecast?.inputs?.savings ?? 0)
  const [investments, setInvestments] = useState<number>(
    () => initialForecast?.inputs?.investments ?? 0
  )
  const [oneTimeEvents, setOneTimeEvents] = useState<OneTimeEvent[]>(() =>
    initialForecast ? eventsFromSaved(initialForecast.scenario.oneTimeEvents) : []
  )

  // ── Seeding a FRESH scenario from the user's own finances (story 62.1, FR94) ──
  //
  // ⚠️⚠️ WHY THIS IS AN EFFECT AND NOT A LAZY `useState` INITIALIZER.
  //
  // All four hooks below are zustand selectors, and zustand passes
  // `getInitialState` to React as `getServerSnapshot`. React uses that snapshot
  // for the WHOLE hydration pass, so they report empty/zero on the first client
  // render however full localStorage already is — the BUG-F distinction story
  // 38.1 turned on, measured in `hooks/useStoresHydrated.ts`'s docblock
  // (`liveSavings=1` beside `snapshotSavings=0`).
  //
  // A lazy initializer runs exactly once, during that render. It would capture
  // the empty snapshot and NEVER RECOVER — and an empty builder is
  // indistinguishable from the legitimate empty-user state, so the failure would
  // be silent. `useStoresHydrated()` is the house gate for "has the client taken
  // over yet"; it is `false` on the server and during hydration by construction
  // and flips on the commit after mount, by which point these hooks report live
  // data.
  //
  // ⚠️ `hasSeeded` starts TRUE for a loaded forecast, so this is a no-op on that
  // path and cannot re-baseline a saved scenario (AC-7). It flips on the first
  // seed, so this cannot run twice or overwrite the user's own edits.
  //
  // ⚠️ Known, accepted: the builder paints one commit with empty rows before the
  // seed lands. That is a transient, not a hydration mismatch, and the 500 ms
  // debounce means the chart never flickers.
  const storesHydrated = useStoresHydrated()
  const storeIncome = useIncomeSources()
  const storeExpenses = useExpenses()
  const storeSavings = useTotalSavings()
  const storeInvestments = useTotalInvestmentBalance()

  // ⚠️ A PAID USER ON A FRESH DEVICE (code review 62.1). `useStoresHydrated()`
  // resolves off localStorage alone, which on a new browser is EMPTY while
  // `ActiveSync`'s first-ever pull is still in flight over the network. Without
  // this gate the builder seeds `[]`/`0`, latches `hasSeeded`, and the rows that
  // arrive moments later reach `/income` but never the builder — landing the
  // user in a state indistinguishable from the legitimate empty-user one, which
  // is the exact silent failure this story's AC-9 exists to prevent.
  //
  // `useIsInitialSyncPending` is the house hook for this window and all five
  // data pages already use it in the same `hydrated && !pending` shape. It takes
  // the CALLER's own emptiness so a device with anything to seed is never gated.
  const nothingToSeed =
    storeIncome.length === 0 &&
    storeExpenses.length === 0 &&
    storeSavings === 0 &&
    storeInvestments === 0
  const isInitialSyncPending = useIsInitialSyncPending(nothingToSeed)
  const readyToSeed = storesHydrated && !isInitialSyncPending

  const [hasSeeded, setHasSeeded] = useState<boolean>(() => Boolean(initialForecast))

  useEffect(() => {
    if (hasSeeded || !readyToSeed) return
    setIncomeItems(itemsFromStore(storeIncome, 'income'))
    setExpenseItems(itemsFromStore(storeExpenses, 'expense'))
    // ⚠️ Both totals are raw `reduce(sum + currentBalance)` over persisted rows
    // (`savingsStore.ts:70`, `balanceStore.ts:373`) with NO finiteness guard, so
    // one corrupt row makes the whole total NaN. Every row `amount` is already
    // guarded in `itemsFromStore`; these two were not (code review 62.1). An
    // unguarded NaN reaches the money field AND the saved forecast's `inputs`.
    setSavings(Number.isFinite(storeSavings) ? storeSavings : 0)
    setInvestments(Number.isFinite(storeInvestments) ? storeInvestments : 0)
    setHasSeeded(true)
  }, [hasSeeded, readyToSeed, storeIncome, storeExpenses, storeSavings, storeInvestments])

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
          {/* ⚠️ `type="text"`, NOT `type="number"` (code review 62.1). These fields
              display through `formatPercentage`, i.e. the string "0.00%" — and a
              number input REJECTS that outright, so `.value` was `''` and the
              field rendered BLANK. Measured in jsdom and in Chromium:
              `.value=[]` while `getAttribute('value')=[0.00%]`.
              That was true before this story too, with 3%/2% silently applied
              behind an empty box. `inputMode="decimal"` keeps the numeric
              keypad on mobile; `min`/`max`/`step` are dropped because they are
              inert on a text input and implying otherwise is worse than
              omitting them.
              ⚠️ This comment first claimed "clamping already lives in
              `handleFormChange`". It does NOT — that handler is a pass-through
              (`:476-481`) and nothing bounds a growth rate at either call site.
              Nothing is LOST by dropping `min`/`max` (they never clamped a typed
              value on a number input either; they gate the spinner and form
              validation only), but the absence of clamping is pre-existing and
              real. Caught re-reading my own comment during code review 62.1. */}
          <InputField
            label="Income Growth Rate"
            value={formData.incomeGrowthRate}
            onChange={(v) => handleFormChange('incomeGrowthRate', Number(v))}
            type="text"
            inputMode="decimal"
            formatValue={formatPercentage}
            parseValue={(v) => parseFloat(v) / 100}
          />

          {/* Expense Growth Rate */}
          {/* ⚠️ `type="text"`, NOT `type="number"` (code review 62.1). These fields
              display through `formatPercentage`, i.e. the string "0.00%" — and a
              number input REJECTS that outright, so `.value` was `''` and the
              field rendered BLANK. Measured in jsdom and in Chromium:
              `.value=[]` while `getAttribute('value')=[0.00%]`.
              That was true before this story too, with 3%/2% silently applied
              behind an empty box. `inputMode="decimal"` keeps the numeric
              keypad on mobile; `min`/`max`/`step` are dropped because they are
              inert on a text input and implying otherwise is worse than
              omitting them.
              ⚠️ This comment first claimed "clamping already lives in
              `handleFormChange`". It does NOT — that handler is a pass-through
              (`:476-481`) and nothing bounds a growth rate at either call site.
              Nothing is LOST by dropping `min`/`max` (they never clamped a typed
              value on a number input either; they gate the spinner and form
              validation only), but the absence of clamping is pre-existing and
              real. Caught re-reading my own comment during code review 62.1. */}
          <InputField
            label="Expense Growth Rate"
            value={formData.expenseGrowthRate}
            onChange={(v) => handleFormChange('expenseGrowthRate', Number(v))}
            type="text"
            inputMode="decimal"
            formatValue={formatPercentage}
            parseValue={(v) => parseFloat(v) / 100}
          />

          {/* Current Savings */}
          {/* ⚠️ `key` REMOUNTS this field when the story-62.1 seed lands, and it
              is load-bearing, not cosmetic. `InputField` snapshots its display
              string in a LAZY `useState` initializer and never resyncs when the
              `value` prop changes (deliberately — there is no blur
              re-formatter, so resyncing would fight the user mid-type). Without
              the remount the seeded total reaches `savings` state and the SAVED
              scenario, while the input on screen still reads the pre-seed
              `0.00` — correct data, wrong thing displayed, and no test of the
              state alone would see it.
              Safe because `hasSeeded` flips exactly once, on the commit after
              mount, long before anyone can type. The income/expense rows need no
              equivalent: their `key` is the item id, so seeding remounts them
              anyway. */}
          <InputField
            key={`savings-${hasSeeded}`}
            label="Current Savings"
            value={savings}
            onChange={handleSavingsChange}
            type="text"
            inputMode="decimal"
            formatValue={(v) => formatCurrency(Number(v))}
            parseValue={(v) => parseFromInput(v, locale)}
            sanitize={(v) => sanitizeMoneyInput(v, locale)}
          />

          {/* Current Investments — remounted on seed for the same reason as
              Current Savings above. */}
          <InputField
            key={`investments-${hasSeeded}`}
            label="Current Investments"
            value={investments}
            onChange={handleInvestmentsChange}
            type="text"
            inputMode="decimal"
            formatValue={(v) => formatCurrency(Number(v))}
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

  // Associate the label with its control (story `forecast-2`). `useId` keeps the
  // pairing unique across the seven call sites without threading an id prop.
  const inputId = useId()

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-label mb-1">
        {label}
      </label>
      <input
        id={inputId}
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

  // Associate each label with its control (story `forecast-2`). The event row has
  // been associated since `forecast-1`; this story closed the rest — the FOUR
  // default financial-item rows (1 income + 3 expenses) here, and the seven
  // `InputField` call sites above, which include Current Savings and Current
  // Investments. Before this story none of those were named to assistive tech.
  const nameId = useId()
  const amountId = useId()
  const frequencyId = useId()

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
          <label htmlFor={nameId} className="block text-sm font-medium text-label mb-1">
            Name
          </label>
          <input
            id={nameId}
            type="text"
            value={item.name}
            onChange={(e) => onUpdate('name', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
            placeholder="Income/Expense name"
          />
        </div>

        {/* Amount */}
        <div>
          <label htmlFor={amountId} className="block text-sm font-medium text-label mb-1">
            Amount
          </label>
          <div className="relative">
            {mode === 'symbol' && (
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                {currencySymbol(currency)}
              </span>
            )}
            <input
              id={amountId}
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
          <label htmlFor={frequencyId} className="block text-sm font-medium text-label mb-1">
            Frequency
          </label>
          <select
            id={frequencyId}
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

  /**
   * Direction is held locally and the stored `amount` stays SIGNED (story
   * `forecast-1`): negative is money out. Keeping the sign on the wire means the
   * engine (`calculateFinancialForecast` already sums signed amounts) and the
   * saved `scenarioData` JSON both need no change.
   *
   * ⚠️ The sign is authoritative WHENEVER THE AMOUNT IS NON-ZERO, so direction is
   * derived from it and cannot drift out of step with what the engine will do.
   * State is needed only for `amount: 0`, where the sign carries no information —
   * a new event starts there, and without a remembered choice, picking "Money
   * out" and then typing would silently produce an inflow.
   *
   * (An earlier revision held direction purely in state and claimed it "cannot be
   * derived from the sign on every render". That was overstated — it is
   * underivable only at zero — and it left a second source of truth that the
   * zero case could genuinely desynchronise across a reload.)
   */
  const [pendingDirection, setPendingDirection] = useState<'in' | 'out'>(
    event.amount < 0 ? 'out' : 'in'
  )
  const direction: 'in' | 'out' =
    event.amount !== 0 ? (event.amount < 0 ? 'out' : 'in') : pendingDirection

  /**
   * The input holds a MAGNITUDE, which is why it keeps `min={0}` — a minus sign
   * never has to be typed into a money field.
   *
   * ⚠️ `cents === 0` is returned unnegated on purpose: `-0` is not `< 0`, so a
   * stored `-0` would reload as "Money in", and `JSON.stringify` flattens it to
   * `0` anyway. Normalising here keeps sign and direction in agreement.
   */
  const signed = (cents: number, dir: 'in' | 'out') =>
    dir === 'out' && cents !== 0 ? -cents : cents

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    const value = parseFloat(raw)

    if (Number.isNaN(value)) {
      /**
       * Mid-edit: the field is empty, or holds a lone "-" (which an
       * `<input type="number">` reports as `""` — badInput).
       *
       * ⚠️ DO NOT WRITE STATE HERE. The earlier version called
       * `onUpdate(…, 0)` on every such keystroke. `updateOneTimeEvent` always
       * builds a new object, so that re-rendered this controlled input, and
       * React resets a number input's DOM value when the committed value is 0
       * and `element.value` is `""` — wiping the "-" the user had just typed
       * before the digits arrived. The minus was then never seen by this
       * handler at all, and the feature only worked for a paste or an
       * insertion in front of existing digits.
       *
       * Leaving state untouched keeps the partial entry in the DOM. The row is
       * already 0 if nothing was entered, and a real clear is committed by the
       * next parseable keystroke.
       */
      /**
       * MEASURED in Chromium (throwaway Playwright probe, story `forecast-2`):
       * typing `-500` keystroke-by-keystroke yields
       *   raw="" badInput=true  ->  "-5"  ->  "-50"  ->  "-500"
       * ending at amount -50000, direction "out". So the minus IS delivered, on
       * the SECOND keystroke, as a parseable negative — this branch's job is only
       * to get out of the way on the first.
       *
       * The `startsWith('-')` below is therefore belt-and-braces: Chromium reports
       * `""` for a lone minus, so it does not fire there. It covers a UA that
       * reports the partial `"-"` instead.
       */
      if (raw.startsWith('-') && direction !== 'out') setPendingDirection('out')
      return
    }

    /**
     * ⚠️ A TYPED MINUS SELECTS "Money out" — it does not erase the entry
     * (story `forecast-2`).
     *
     * This field holds a magnitude, so the old handler clamped any negative to 0
     * and silently discarded the digits. With a Money in / Money out control
     * sitting beside it, reaching for the familiar accounting convention
     * (`-500` for an outflow) became the natural wrong guess — and the punishment
     * was losing what you typed. Interpret it as the intent it obviously is.
     */
    const cents = Math.round(Math.abs(value) * 100)
    const nextDirection = value < 0 ? 'out' : direction
    if (nextDirection !== direction) setPendingDirection(nextDirection)
    onUpdate(event.id, 'amount', signed(cents, nextDirection))
  }

  const handleDirectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value === 'out' ? 'out' : 'in'
    setPendingDirection(next)
    // Re-sign whatever is already entered, so flipping direction after typing
    // does not require re-typing the amount.
    onUpdate(event.id, 'amount', signed(Math.abs(event.amount), next))
  }

  const amountId = `event-amount-${event.id}`
  const directionId = `event-direction-${event.id}`
  const yearId = `event-year-${event.id}`
  const nameId = `event-name-${event.id}`

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const year = Math.max(1, Math.min(maxYear, parseInt(e.target.value, 10) || 1))
    onUpdate(event.id, 'year', year)
  }

  return (
    <div className="surface rounded-lg p-4 shadow-sm border border-default">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        {/* Name */}
        <div>
          <label htmlFor={nameId} className="block text-sm font-medium text-label mb-1">
            Event Name
          </label>
          <input
            id={nameId}
            type="text"
            value={event.name}
            onChange={(e) => onUpdate(event.id, 'name', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
            // Direction-neutral since story `forecast-1`: this row models money
            // out as well as in, so an inflow-only example would misdescribe it.
            placeholder="Bonus, house deposit, etc."
          />
        </div>

        {/* Direction (story `forecast-1`) */}
        <div>
          <label htmlFor={directionId} className="block text-sm font-medium text-label mb-1">
            Direction
          </label>
          <select
            id={directionId}
            value={direction}
            onChange={handleDirectionChange}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded text-sm"
          >
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </div>

        {/* Amount */}
        <div>
          <label htmlFor={amountId} className="block text-sm font-medium text-label mb-1">
            Amount
          </label>
          <div className="relative">
            {mode === 'symbol' && (
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                {currencySymbol(currency)}
              </span>
            )}
            <input
              id={amountId}
              type="number"
              // Magnitude only — `direction` carries the sign.
              value={Math.abs(event.amount) / 100}
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
          <label htmlFor={yearId} className="block text-sm font-medium text-label mb-1">
            Year
          </label>
          <input
            id={yearId}
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
