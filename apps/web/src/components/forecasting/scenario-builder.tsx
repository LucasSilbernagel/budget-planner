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
  DEFAULT_FORECAST_YEARS,
  DEFAULT_INVESTMENT_RETURN,
  type ForecastingResult,
  type ForecastingScenario,
  MAX_FORECAST_YEARS,
  MAX_GROWTH_RATE,
  MIN_FORECAST_YEARS,
  MIN_GROWTH_RATE,
  calculateFinancialForecast,
  currencySymbol,
  debtOwedCents,
  isValidForecastYears,
  isValidGrowthRate,
  resolveDebtPaymentExpense,
  solveAutomaticAllocations,
} from '@budget-planner/core'
import type { Frequency, NormalizableFinancialItem } from '@budget-planner/core/finance'
import type { ClientBalanceTracking } from '@budget-planner/core/services/balanceTracking'
import type { ClientSavingsGoal } from '@budget-planner/core/services/savingsGoals'
import { Link } from '@tanstack/react-router'
import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useId,
  useLayoutEffect,
} from 'react'
import { useIsInitialSyncPending } from '../../hooks/useIsInitialSyncPending'
import { useStoresHydrated } from '../../hooks/useStoresHydrated'
import { isKnownFrequency } from '../../lib/readable-rows'
import { sanitizeWithCaret } from '../../lib/sanitized-input'
import { investmentContributionItems } from '../../lib/savings/investment-contribution-items'
import type { SavedForecast, ScenarioInputs } from '../../routes/forecasting'
import { useBalanceEntries, useInvestmentEntries } from '../../stores/balanceStore'
import { useCurrencyPreferences, useFormattedAmount } from '../../stores/currencyStore'
import { useExpenses } from '../../stores/expenseStore'
import { useIncomeSources } from '../../stores/incomeStore'
import { useSavingsGoals } from '../../stores/savingsStore'
import { GroupedAmount } from '../ui/GroupedAmount'

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
 * One savings account or goal as a what-if row (story 100.1, FR164). Money in
 * cents. Never written back to the savings store (D0): the row is the scenario's
 * own copy, seeded from the store once.
 */
export interface LocalSavingsAccount {
  id: string
  name: string
  balance: number
  monthlyContribution: number
}

/**
 * One investment or debt as a what-if row (story 100.2, FR165). Money in cents;
 * `balance` is a positive MAGNITUDE for both types. `contribution` is the amount at
 * `frequency` cadence, as `/balance` shows it (the engine normalises it). Never
 * written back to the balance store (D0).
 *
 * `annualReturn` (story 100.3, FR166) is a decimal (0.06 = 6%), what-if only:
 * `/balance` has no rate. Every row holds one, seeded at `DEFAULT_INVESTMENT_RETURN`;
 * it is shown, sent to the engine and saved on INVESTMENT rows only. A debt row
 * keeps it hidden, so switching back to Investment shows it again (D8).
 */
export interface LocalBalanceAccount {
  id: string
  name: string
  type: 'investment' | 'debt'
  balance: number
  contribution: number
  frequency: Frequency
  /**
   * The money is already counted in Expenses, so the engine does not take it
   * from cash again. Investment row: "Not taken from the money left over" (story
   * 45.1). Debt row (story 102.2, D1/D2): "Payment already in Expenses", which
   * keeps the 100.2 D4 math; off, the row's payment is cash out while the debt
   * is owed. Off on every seeded, new or type-switched row (D8); on for every
   * debt of a forecast saved before version 5.
   */
  contributionRecordedAsExpense: boolean
  /** Story 100.3: the row's annual return; only investment rows use it. */
  annualReturn: number
  /**
   * Story 102.2 (D6): the name of the Expenses row a seeded debt's payment came
   * from, shown as "from Expenses: <name>" on debt rows only. Saved in version 5.
   * Absent when the row has no source (unlinked, added here, older forecasts).
   */
  paidByExpenseName?: string
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
   * carries the savings/investments/years (and, since story 100.1, the savings
   * rows) that are NOT part of ForecastingScenario so a saved forecast can be
   * reopened faithfully (story bug-3).
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
  /**
   * Whether a save can work at all, resolved by the PAGE (story 62.2, FR95).
   *
   * ⚠️ The builder must never resolve this itself. `routes/forecasting.tsx` owns
   * the profile lookup; a second fetch from here would double the request and
   * could disagree with the answer the save path actually uses.
   *
   * ⚠️ Optional, defaulting to `ready`, and that default is load-bearing: the
   * `none` arm renders a `<Link>`, which needs a router in context. Every test in
   * `scenario-builder.test.tsx` and `scenario-builder.seeding.dom.test.tsx` uses a
   * bare `render()` with no router and omits this prop. Change the default and
   * ~40 tests fail on a missing router, which looks like anything but the cause.
   */
  saveAvailability?: SaveAvailability
  /**
   * Reports whether a save is in flight so the PAGE can lock its tab strip
   * (code review 62.2). Switching tabs CSS-hides this component, and the failure
   * alert lives inside it — hidden, it is neither focusable nor announced.
   *
   * ⚠️ Driven from the same `finally` that clears `isSaving`, so it can never
   * latch `true` and leave the user's navigation permanently disabled.
   */
  onSavingChange?: (isSaving: boolean) => void
}

/**
 * Why a save may or may not be possible right now.
 *
 * ⚠️⚠️ These four arms exist because `defaultProfileId` used to be a bare
 * `string | null`, and `null` meant FIVE different things: the effect had not run
 * yet, the account had zero profiles, the session had expired, premium was denied
 * at the server boundary, or the fetch threw. Only ONE of those is "go and create
 * a profile". Collapsing them again reintroduces two defects at once — a prompt
 * that flashes on every page load, and wrong advice for anyone whose fetch failed.
 */
export type SaveAvailability =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'none' }
  | { kind: 'error' }

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
  years: DEFAULT_FORECAST_YEARS,
}

/**
 * Copy for the blocked-save states (story 62.2, FR95).
 *
 * ⚠️ `NO_PROFILE_*` and `PROFILE_ERROR_*` must stay distinguishable. Telling a
 * user whose profile fetch merely failed to "create a profile" is wrong advice
 * about their own account, and it is indistinguishable from the real empty case
 * unless the wording differs.
 */
const NO_PROFILE_NOTICE =
  'Saving a forecast needs a financial profile, and this account does not have one yet.'
const NO_PROFILE_SHORT = 'Needs a financial profile'
const PROFILE_ERROR_NOTICE =
  'We could not check your financial profiles, so saving is unavailable right now. Reload the page to try again.'
const PROFILE_ERROR_SHORT = 'Profile check failed'
const FALLBACK_SAVE_ERROR = 'Failed to save forecast'

/**
 * Copy for an out-of-range Projection Period (story 77.1, FR124). The range is
 * core's, so the message cannot drift from the rule the engine enforces.
 */
const YEARS_INVALID_MESSAGE = `Enter a whole number of years from ${MIN_FORECAST_YEARS} to ${MAX_FORECAST_YEARS}.`
const YEARS_INVALID_SHORT = 'Fix the projection period to save'

/**
 * Copy for the other fields a scenario can hold a bad value in (story 81.1,
 * FR132). Each is shown on ITS field, never as the engine's banner: before 81.1 an
 * emptied growth rate surfaced as "Amount must be a finite number" — an amount the
 * user never touched — and, with no rows of that kind, as nothing at all.
 *
 * The growth range is core's, so the message cannot drift from the engine's rule.
 */
const GROWTH_INVALID_MESSAGE = `Enter a growth rate from ${MIN_GROWTH_RATE * 100}% to ${
  MAX_GROWTH_RATE * 100
}%.`
/**
 * The Annual return field's message (story 100.3, D7), from the same core bounds
 * as `GROWTH_INVALID_MESSAGE`, so it cannot drift from the engine's rule.
 */
const RETURN_INVALID_MESSAGE = `Enter an annual return from ${MIN_GROWTH_RATE * 100}% to ${
  MAX_GROWTH_RATE * 100
}%.`
const AMOUNT_NEGATIVE_MESSAGE = 'Enter an amount of 0 or more.'
const AMOUNT_TOO_LARGE_MESSAGE = 'Enter a smaller amount.'
const AMOUNT_NOT_A_NUMBER_MESSAGE = 'Enter a number.'
/**
 * The Save reason for any invalid field OTHER than the period alone. When the
 * period is the only bad field it keeps `YEARS_INVALID_SHORT` (77.1's copy);
 * once anything else is also wrong, this general reason is the accurate one.
 */
const FIELDS_INVALID_SHORT = 'Fix the highlighted fields to save'

/**
 * Copy for the Savings Accounts section (story 100.1). The note is Lucas's to
 * tweak (AC-9); a copy test pins it.
 */
export const SAVINGS_WHAT_IF_NOTE = "What-if only: changes here don't change your Savings page."
export const NO_SAVINGS_ACCOUNTS = 'No savings accounts in this scenario'

/**
 * Copy for the Investments & Debts section (story 100.2, AC-11). Lucas may tweak
 * it; a copy test pins it. The last two sentences say why the starting net worth
 * is not the Overview's: debts now count, assets do not (D1).
 */
export const BALANCE_WHAT_IF_NOTE =
  "What-if only: changes here don't change your Balance Tracking page. Debts count against your starting net worth. Things you own outright (assets) aren't included."
export const NO_BALANCE_ACCOUNTS = 'No investments or debts in this scenario'
/** The same label `/balance` gives the flag (story 45.1). */
const NOT_FROM_LEFT_OVER_LABEL = 'Not taken from the money left over'
/** The same flag on a debt row (story 102.2, D2): the payment is already an Expenses line. */
const PAYMENT_IN_EXPENSES_LABEL = 'Payment already in Expenses'
const BALANCE_TYPE_OPTIONS = [
  { value: 'investment' as const, label: 'Investment' },
  { value: 'debt' as const, label: 'Debt' },
]

/** `1 year` / `N years`, for the per-row outcome lines. */
function yearsLabel(years: number): string {
  return `${years} ${years === 1 ? 'year' : 'years'}`
}

/**
 * A saved growth rate as the builder should hold it (story 81.1, D3). JSON has no
 * NaN, so a rate saved while its field was empty comes back as `null`; the engine
 * ran it as 0 (`1 + null === 1`), and the field would display `formatPercentage(null)`
 * = "0.00%" beside a field error. Load it as 0. A FINITE rate outside the range is
 * kept: the field shows why, and the user fixes it (refuse, not clamp).
 */
function growthRateFromSaved(rate: unknown): number {
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : 0
}

/**
 * A saved investment row's annual return as the builder should hold it (story
 * 100.3, D3/D9). Absent (a v1-v3 forecast), `null` (JSON's NaN) or any other
 * non-finite value reloads at `DEFAULT_INVESTMENT_RETURN` (6%). A FINITE rate
 * outside −100%..100% is kept: its field flags it from the first render and holds
 * Save and the recompute until it is fixed (refuse, not clamp, as
 * `growthRateFromSaved` and `useMoneyDraft` do).
 */
function annualReturnFromSaved(rate: unknown): number {
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : DEFAULT_INVESTMENT_RETURN
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
 * A persisted money value as a row may hold it: finite and at least 0, else 0
 * (story 100.1). The same coercion as core's `sumManualAllocations`, so a manual
 * row seeds exactly the figure /savings counts for it.
 */
function nonNegativeCents(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

/**
 * Build what-if savings rows from the active profile's savings rows, for a FRESH
 * scenario (story 100.1, AC-1, AC-3).
 *
 * A manual row seeds its `monthlyAllocation`. An automatic row (an absent or
 * unrecognised mode, as core's `resolveAllocationMode` reads it) seeds its share
 * from `allocations`, the solver's output for the SAME inputs /savings uses, so
 * every seeded contribution equals the figure /savings shows. `allocations` is
 * `null` when the solver threw: automatic rows then seed 0 and the builder still
 * renders.
 *
 * ⚠️ Fields mapped explicitly, as in `itemsFromStore`: a spread would carry
 * `profileId`, `targetAmount` and friends into the saved JSON.
 */
function savingsFromStore(
  goals: readonly ClientSavingsGoal[],
  allocations: Readonly<Record<string, number>> | null
): LocalSavingsAccount[] {
  return goals.map((goal, index) => ({
    id: `savings-seeded-${index}`,
    name: typeof goal.name === 'string' ? goal.name : '',
    balance: nonNegativeCents(goal.currentBalance),
    monthlyContribution:
      (goal.allocationMode ?? 'automatic') === 'manual'
        ? nonNegativeCents(goal.monthlyAllocation)
        : nonNegativeCents(allocations?.[goal.id]),
  }))
}

/**
 * Rebuild what-if savings rows from a saved forecast's inputs (story 100.1).
 *
 * A v2 forecast carries its rows. A v1 forecast carries only the `savings` total,
 * which reloads as ONE row named `Savings` with no contribution (AC-12), or as no
 * row at all when the total is 0. A forecast saved before persisted inputs
 * (pre-bug-3) has neither, so it starts at 0, as before.
 */
function savingsFromSaved(inputs: ScenarioInputs | undefined): LocalSavingsAccount[] {
  // Defensive on its own (code review 100.1): `mapToSavedForecast` already
  // coerces, but this is the builder's boundary, so a caller that skips the route
  // (a test, a future caller) cannot crash it with a `null` entry or a non-array.
  const saved: unknown = inputs?.savingsAccounts
  if (Array.isArray(saved)) {
    return saved.map((entry: unknown, index) => {
      const account =
        typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
      return {
        id: `savings-loaded-${index}`,
        name: typeof account['name'] === 'string' ? account['name'] : '',
        balance: nonNegativeCents(account['balance']),
        monthlyContribution: nonNegativeCents(account['monthlyContribution']),
      }
    })
  }
  // ⚠️ A NEGATIVE v1 total is kept as it is, not clamped (Lucas, code review
  // 100.1): the old field accepted `-5`. The row's field then flags it from the
  // start (`useMoneyDraft`), which holds Save and the recompute until the user
  // fixes it, so the starting figure never changes behind their back.
  if (inputs && Number.isFinite(inputs.savings) && inputs.savings !== 0) {
    return [
      { id: 'savings-loaded-0', name: 'Savings', balance: inputs.savings, monthlyContribution: 0 },
    ]
  }
  return []
}

/** A balance row's type, or `null` for anything else (assets, corrupt values). */
function balanceRowType(type: unknown): LocalBalanceAccount['type'] | null {
  return type === 'investment' || type === 'debt' ? type : null
}

/**
 * Build what-if investment/debt rows from the active profile's balance entries,
 * for a FRESH scenario (story 100.2, AC-6). Assets are not rows (D1).
 *
 * - `contribution` is the entry's RAW `monthlyContribution` at its own
 *   `frequency`, so the row shows what `/balance` shows; the engine normalises it.
 * - A DEBT's contribution (story 102.1, FR169, D5) is its LINKED EXPENSE's amount
 *   at that expense's frequency, never its own stored contribution, which
 *   `/balance` no longer shows or writes. No link (or one that does not resolve
 *   in `expenses`, the active profile's) seeds 0.
 * - Story 102.2 (FR170, D5): the linked expense MOVES into the debt row. The row
 *   carries its name (`paidByExpenseName`) and its flag starts off, so the engine
 *   takes the payment from cash while the debt is owed; `consumedExpenseIds`
 *   names the expenses the caller must leave OUT of the seeded Expenses rows, so
 *   the payment is one cash line, not two. One expense pays at most ONE debt row,
 *   the first in store order: a later debt linked to the same expense (102.1's
 *   deferred two-device race) seeds as unlinked, so it is never counted twice.
 * - Balance sign (D6): a debt seeds `|balance|`, because a debt can be stored
 *   negative (the screenshot seed's mortgage, sync-applied rows) while the row
 *   holds a positive magnitude. A negative or non-finite investment seeds 0, as a
 *   savings row does.
 * - The flag is kept for an investment only (`/balance` enforces the same).
 * - Every row starts at `DEFAULT_INVESTMENT_RETURN` (story 100.3, D2): `/balance`
 *   has no rate to seed from.
 *
 * ⚠️ Fields mapped explicitly, as in `itemsFromStore`: a spread would carry
 * `profileId` and friends into the saved JSON.
 */
function balanceFromStore(
  entries: readonly ClientBalanceTracking[],
  expenses: readonly { id: string; name: unknown; amount: unknown; frequency: unknown }[]
): { rows: LocalBalanceAccount[]; consumedExpenseIds: ReadonlySet<string> } {
  const rows: LocalBalanceAccount[] = []
  const consumedExpenseIds = new Set<string>()
  for (const entry of entries) {
    const type = balanceRowType(entry.type)
    if (type === null) continue
    const raw = entry.currentBalance
    const balance =
      type === 'debt'
        ? typeof raw === 'number' && Number.isFinite(raw)
          ? debtOwedCents(raw) // Story 103.1: the one reading every surface uses
          : 0
        : nonNegativeCents(raw)
    let linked: (typeof expenses)[number] | null = null
    if (type === 'debt') {
      const resolved = resolveDebtPaymentExpense(entry, expenses)
      // Code review 102.2: the expense moves only when the move keeps the money.
      // A debt at 0 (paid off, or corrupt and seeded 0 by D6) would pay nothing,
      // and an amount that is not a finite number above 0 would seed 0 (a
      // negative one lowers expenses today); either way the payment would vanish
      // from the scenario, so such a debt seeds as unlinked and the expense stays.
      const amount = resolved?.amount
      if (
        resolved !== null &&
        !consumedExpenseIds.has(resolved.id) &&
        balance > 0 &&
        typeof amount === 'number' &&
        Number.isFinite(amount) &&
        amount > 0
      ) {
        linked = resolved
        consumedExpenseIds.add(resolved.id)
      }
    }
    const linkedName = typeof linked?.name === 'string' ? linked.name.trim() : ''
    rows.push({
      id: `balance-seeded-${rows.length}`,
      name: typeof entry.name === 'string' ? entry.name : '',
      type,
      balance,
      ...(type === 'debt'
        ? debtPaymentFromExpense(linked)
        : {
            contribution: nonNegativeCents(entry.monthlyContribution),
            frequency: isKnownFrequency(entry.frequency) ? entry.frequency : 'monthly',
          }),
      // A debt starts OFF (102.2, D2): its payment left the Expenses rows with it.
      contributionRecordedAsExpense:
        type === 'investment' && entry.contributionRecordedAsExpense === true,
      annualReturn: DEFAULT_INVESTMENT_RETURN,
      ...(linkedName !== '' ? { paidByExpenseName: linkedName } : {}),
    })
  }
  return { rows, consumedExpenseIds }
}

/**
 * A debt row's seeded payment from its linked expense (story 102.1): the same
 * coercion as every other seeded money value (finite and >= 0, else 0; an
 * unknown frequency reads monthly). No expense: 0, monthly.
 */
function debtPaymentFromExpense(expense: { amount: unknown; frequency: unknown } | null): {
  contribution: number
  frequency: Frequency
} {
  if (expense === null) return { contribution: 0, frequency: 'monthly' }
  return {
    contribution: nonNegativeCents(expense.amount),
    frequency: isKnownFrequency(expense.frequency) ? expense.frequency : 'monthly',
  }
}

/**
 * Rebuild what-if investment/debt rows from a saved forecast's inputs (story
 * 100.2, AC-13).
 *
 * A v3 forecast carries its rows. A v1/v2 forecast carries only the
 * `investments` total, which reloads as ONE `Investments` row with no
 * contribution (or no row at all when it is 0), so it projects exactly as before.
 * A negative v1/v2 total is kept, not clamped: the row's field flags it from the
 * start (`useMoneyDraft`), as 100.1 decided for savings.
 *
 * Defensive on its own (100.1 review): a caller that skips `mapToSavedForecast`
 * cannot crash it with a non-array or a `null` entry. An entry that is neither an
 * investment nor a debt is dropped (its sign is unknowable).
 *
 * Rates (story 100.3): an investment row's saved `annualReturn` goes through
 * `annualReturnFromSaved` (no usable rate → 6%, D3; finite out-of-range kept and
 * flagged, D9). A debt row's saved rate is ignored (debts are saved without one,
 * D8) and the row starts at the default, like a seeded debt.
 *
 * Debt flag (story 102.2, D1): a forecast saved before version 5 (`version`
 * absent or below 5) computed its debts under 100.2 D4, with the payment still an
 * Expenses row among its `newExpenses`. Each of its debt rows therefore reloads
 * FLAGGED ("Payment already in Expenses"), so it projects exactly as saved and
 * the payment is not counted twice. A v5 debt keeps its saved flag (`=== true`).
 * `paidByExpenseName` (D6) is kept when it is a non-empty string, on debts only.
 */
function balanceFromSaved(
  inputs: ScenarioInputs | undefined,
  version: unknown
): LocalBalanceAccount[] {
  const legacyDebts = !(typeof version === 'number' && version >= 5)
  const saved: unknown = inputs?.balanceAccounts
  if (Array.isArray(saved)) {
    const rows: LocalBalanceAccount[] = []
    for (const entry of saved as unknown[]) {
      const account =
        typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
      const type = balanceRowType(account['type'])
      if (type === null) continue
      const frequency = account['frequency']
      const paidBy = account['paidByExpenseName']
      const flagged =
        (type === 'debt' && legacyDebts) || account['contributionRecordedAsExpense'] === true
      // A labelled debt row never shows its flag (code review 102.2), so a row
      // that is flagged (legacy, or a corrupt save) drops the label instead of
      // hiding a ticked box: the label means "the payment is this row's own".
      const paidByName =
        type === 'debt' && !flagged && typeof paidBy === 'string' ? paidBy.trim() : ''
      rows.push({
        id: `balance-loaded-${rows.length}`,
        name: typeof account['name'] === 'string' ? account['name'] : '',
        type,
        balance: nonNegativeCents(account['balance']),
        contribution: nonNegativeCents(account['contribution']),
        frequency: isKnownFrequency(frequency) ? frequency : 'monthly',
        contributionRecordedAsExpense: flagged,
        annualReturn:
          type === 'investment'
            ? annualReturnFromSaved(account['annualReturn'])
            : DEFAULT_INVESTMENT_RETURN,
        ...(paidByName !== '' ? { paidByExpenseName: paidByName } : {}),
      })
    }
    return rows
  }
  if (inputs && Number.isFinite(inputs.investments) && inputs.investments !== 0) {
    return [
      {
        id: 'balance-loaded-0',
        name: 'Investments',
        type: 'investment',
        balance: inputs.investments,
        contribution: 0,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
        // A v1/v2 forecast saved no rate: it reloads at 6% (D3), not the 7% it
        // was computed at, so it reopens LOWER than it was saved (accepted).
        annualReturn: DEFAULT_INVESTMENT_RETURN,
      },
    ]
  }
  return []
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
    // Coerced like `itemsFromSaved` (story 77.1). JSON has no NaN/Infinity, so a
    // saved non-finite amount comes back as `null`. The engine used to add `null`
    // as 0; it now REFUSES any non-finite amount, so without this a forecast that
    // opened fine before 77.1 would open to an error banner. A fraction is rounded,
    // which is exactly what the engine does to it.
    amount: Number.isFinite(event.amount) ? Math.round(event.amount) : 0,
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
  saveAvailability = { kind: 'ready' },
  onSavingChange,
}: ScenarioBuilderProps): React.ReactElement {
  // Display amounts respect the user's currency mode (currency-less vs symbols).
  const formatCurrency = useFormattedAmount()
  // (Story 100.2 removed the last `parseFromInput` money field, Current
  // Investments, and with it the builder's read of the currency locale. Every
  // money field is now a `type="number"` row field, parsed by `useMoneyDraft`.)
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
          incomeGrowthRate: growthRateFromSaved(initialForecast.scenario.incomeGrowthRate),
          expenseGrowthRate: growthRateFromSaved(initialForecast.scenario.expenseGrowthRate),
          years: initialForecast.inputs?.years ?? DEFAULT_FORM.years,
        }
      : DEFAULT_FORM
  )
  /**
   * The projection period the builder last saw that the ENGINE accepts (story
   * 77.1). `formData.years` keeps exactly what the user typed, so they can see
   * and fix it; this is what everything downstream of the field reads while the
   * typed value is out of range. Today that is only the one-time event rows'
   * `maxYear`, which would otherwise clamp every event year against 0 or 1e9.
   */
  const [lastValidYears, setLastValidYears] = useState<number>(() =>
    isValidForecastYears(formData.years) ? formData.years : DEFAULT_FORM.years
  )
  const yearsValid = isValidForecastYears(formData.years)
  // The growth-rate fields keep what the user TYPED (InputField's own display
  // string); what the builder validates is the parsed value (story 81.1, D8).
  const incomeGrowthValid = isValidGrowthRate(formData.incomeGrowthRate)
  const expenseGrowthValid = isValidGrowthRate(formData.expenseGrowthRate)

  /**
   * The fields currently holding a value that was NOT written to state (story
   * 81.1, D4): income, expense and event amounts keyed by row id, and the what-if
   * rows' fields keyed `<rowId>:<field>` (balance, contribution, and since story
   * 100.3 an investment row's `annualReturn`). Each row reports
   * from its own change handler — synchronously, in the same batch as any write —
   * so the debounced recompute below never runs with a bad value it cannot see.
   * A row that unmounts (removed, or re-keyed by a load) withdraws its key.
   */
  const [invalidAmountRows, setInvalidAmountRows] = useState<ReadonlySet<string>>(() => new Set())
  const setAmountRowValidity = useCallback((rowId: string, valid: boolean) => {
    setInvalidAmountRows((prev) => {
      if (valid !== prev.has(rowId)) return prev
      const next = new Set(prev)
      if (valid) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }, [])
  // Any invalid field other than the period. Kept apart from `yearsValid` only for
  // the Save reason's wording (see FIELDS_INVALID_SHORT).
  const otherFieldInvalid = !incomeGrowthValid || !expenseGrowthValid || invalidAmountRows.size > 0

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
  // A fresh builder therefore seeds from the savings ROWS (story 100.1, which
  // replaced the single `useTotalSavings()` figure) and from the investment/debt
  // ROWS (story 100.2, which replaced `useTotalInvestmentBalance()`) in the
  // hydration effect below. Empty / `0` here
  // is the pre-seed value, and it is also the final value for a LOADED forecast
  // whose saved row predates persisted `inputs` — reading the live stores in that
  // case would silently re-baseline a forecast saved months ago, which is exactly
  // what AC-7 forbids.
  const [savingsAccounts, setSavingsAccounts] = useState<LocalSavingsAccount[]>(() =>
    initialForecast ? savingsFromSaved(initialForecast.inputs) : []
  )
  // The starting savings is the rows' sum (story 100.1, AC-2). Derived, never
  // stored, so the total and the rows cannot disagree; the engine also refuses a
  // mismatch (`SAVINGS_ROWS_MISMATCH`).
  const savings = useMemo(
    () => savingsAccounts.reduce((sum, account) => sum + account.balance, 0),
    [savingsAccounts]
  )
  const [balanceAccounts, setBalanceAccounts] = useState<LocalBalanceAccount[]>(() =>
    initialForecast ? balanceFromSaved(initialForecast.inputs, initialForecast.version) : []
  )
  // The starting investments are the investment rows' sum (story 100.2, AC-2),
  // derived like `savings`; the engine refuses a mismatch (`BALANCE_ROWS_MISMATCH`).
  const investments = useMemo(
    () =>
      balanceAccounts.reduce(
        (sum, account) => (account.type === 'investment' ? sum + account.balance : sum),
        0
      ),
    [balanceAccounts]
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
  const storeSavingsGoals = useSavingsGoals()
  // Profile-scoped (`balanceStore.ts` selector docblock); never `state.entries`.
  const storeBalanceEntries = useBalanceEntries()
  // The in-scope rows (story 100.2, D1): investments and debts, not assets.
  const storeBalanceRowCount = useMemo(
    () => storeBalanceEntries.filter((entry) => balanceRowType(entry.type) !== null).length,
    [storeBalanceEntries]
  )
  // The solver inputs /savings uses, built by the SAME mapping (story 100.1, AC-3).
  const storeInvestmentEntries = useInvestmentEntries()
  const storeContributionItems = useMemo(
    () => investmentContributionItems(storeInvestmentEntries),
    [storeInvestmentEntries]
  )

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
    // ROWS, not the total (story 100.1): a goal with a 0 balance is still a row
    // to seed.
    storeSavingsGoals.length === 0 &&
    // ROWS again (story 100.2), not the investment total: a debt-only user, or an
    // investment at 0, is still something to seed.
    storeBalanceRowCount === 0
  const isInitialSyncPending = useIsInitialSyncPending(nothingToSeed)
  const readyToSeed = storesHydrated && !isInitialSyncPending

  const [hasSeeded, setHasSeeded] = useState<boolean>(() => Boolean(initialForecast))
  // Whether the user has edited each seeded part. The seed waits for
  // `!isInitialSyncPending`, which on a paid user's first device can land
  // seconds after hydration, and anything the user did in that window must
  // survive it: a typed money value is neither replaced nor remounted (which
  // would drop focus mid-edit), and income/expense rows they added, edited or
  // deleted are not swapped for the store's. Set by the user-facing handlers
  // only, never by the seed. (Story 100.2 removed the last money `InputField`,
  // Current Investments: every money field is now a keyed row, so there is no
  // money typed BEFORE hydration to adopt or refuse.)
  const incomeRowsTouched = useRef(false)
  const expenseRowsTouched = useRef(false)
  // Savings rows (story 100.1): any row edit, add or remove marks the list, so the
  // seed leaves it alone, exactly as for income/expense rows (D8). Rows are keyed
  // by id, so the seed remounts them and they need no seed key.
  const savingsRowsTouched = useRef(false)
  // Investment/debt rows (story 100.2): the same rule, through `editBalanceAccounts`.
  const balanceRowsTouched = useRef(false)

  useEffect(() => {
    if (hasSeeded || !readyToSeed) return
    if (!incomeRowsTouched.current) setIncomeItems(itemsFromStore(storeIncome, 'income'))
    // Investment/debt rows (story 100.2). Each balance is coerced per row in
    // `balanceFromStore` (a corrupt one seeds 0), which also closes the 62.1
    // review hazard of one non-finite row turning the old single total into NaN.
    // Story 102.1: debts seed their payment from the linked expense.
    // Story 102.2 (D5): that expense MOVES into the debt row, so it leaves the
    // Expenses rows, but ONLY in this same pass: when the balance rows were
    // touched first no debt row carries it, and removing it would make the
    // payment vanish from the scenario. Seeded BEFORE the Expenses rows so the
    // consumed ids are known; ids are by index, so filter before mapping.
    let consumedExpenseIds: ReadonlySet<string> = new Set()
    if (!balanceRowsTouched.current) {
      const seeded = balanceFromStore(storeBalanceEntries, storeExpenses)
      setBalanceAccounts(seeded.rows)
      consumedExpenseIds = seeded.consumedExpenseIds
    }
    if (!expenseRowsTouched.current) {
      setExpenseItems(
        itemsFromStore(
          storeExpenses.filter((row) => !consumedExpenseIds.has(row.id)),
          'expense'
        )
      )
    }
    if (!savingsRowsTouched.current) {
      // The solver throws on a corrupt persisted amount (`normalizeToMonthly`).
      // It keeps the FULL `storeExpenses` (story 102.2): it mirrors /savings,
      // where the linked expense is still an ordinary expense.
      // Automatic rows then seed 0; the builder must still render (AC-3).
      let allocations: Record<string, number> | null = null
      try {
        allocations = solveAutomaticAllocations({
          incomeSources: storeIncome,
          expenses: storeExpenses,
          investmentContributions: storeContributionItems,
          savingsAccounts: storeSavingsGoals,
        }).allocations
      } catch {
        allocations = null
      }
      setSavingsAccounts(savingsFromStore(storeSavingsGoals, allocations))
    }
    setHasSeeded(true)
  }, [
    hasSeeded,
    readyToSeed,
    storeIncome,
    storeExpenses,
    storeSavingsGoals,
    storeContributionItems,
    storeBalanceEntries,
  ])

  // State for results — seed from the loaded forecast so its summary shows
  // immediately, before the debounced recompute runs.
  const [result, setResult] = useState<ForecastingResult | null>(
    () => initialForecast?.result ?? null
  )
  /**
   * The savings row ids the current `result` was computed for, in engine input
   * order (story 100.1). The engine reports per-row balances by INDEX; mapping
   * them back by id means a row removed or added since the last recompute can
   * never show another row's figure while the debounce is pending.
   */
  //
  // A loaded forecast whose SAVED result already covers its rows (same count)
  // starts mapped, so its per-row lines show before the first recompute (code
  // review 100.1). `savingsFromSaved` ids are deterministic, so they match.
  const [resultSavingsRowIds, setResultSavingsRowIds] = useState<readonly string[]>(() => {
    if (!initialForecast) return []
    const rows = savingsFromSaved(initialForecast.inputs)
    const saved = initialForecast.result?.projection?.at(-1)?.savingsAccounts
    return Array.isArray(saved) && saved.length === rows.length ? rows.map((row) => row.id) : []
  })
  /**
   * The investment/debt row ids the current `result` was computed for (story
   * 100.2), mapped back by id for the same reason as `resultSavingsRowIds`, and
   * seeded the same way from a loaded forecast whose saved result covers its rows.
   */
  const [resultBalanceRowIds, setResultBalanceRowIds] = useState<readonly string[]>(() => {
    if (!initialForecast) return []
    const rows = balanceFromSaved(initialForecast.inputs, initialForecast.version)
    const saved = initialForecast.result?.projection?.at(-1)?.balanceAccounts
    return Array.isArray(saved) && saved.length === rows.length ? rows.map((row) => row.id) : []
  })
  const [isCalculating, setIsCalculating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * The outcome of the last SAVE attempt — a separate slot from `error`, which
   * belongs to the calculation (story 62.2, AC-9).
   *
   * ⚠️ They cannot share one slot. `calculateForecast` runs `setError(null)` on
   * every debounced recompute, 500 ms after any input change — and 62.1's seeding
   * effect fires one such recompute at hydration. A save outcome parked in `error`
   * would be erased by the user's next keystroke, at the moment they most need it.
   *
   * Cleared alongside `error` in `calculateForecast` so a fresh calculation error
   * can never sit beside a stale save error and contradict it. Editing a field
   * after a failed save therefore dismisses the failure, which is correct: the
   * user is acting on it.
   *
   * ⚠️ Failures only. A SUCCESS confirmation does not belong here — the page
   * switches to the "saved" tab on success, which CSS-hides this whole component
   * (`routes/forecasting.tsx:534`), so a success message rendered here would be
   * invisible exactly when it is needed while still being findable in jsdom.
   */
  const [saveOutcome, setSaveOutcome] = useState<string | null>(null)
  const saveOutcomeRef = useRef<HTMLDivElement>(null)
  const savingsHeadingId = useId()
  const balanceHeadingId = useId()
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Move focus onto the failure message once it mounts.
   *
   * ⚠️ `role="alert"` announces on INSERTION, not on content change. This node is
   * NOT keyed, so React reuses it and swaps its text — which is exactly why
   * `handleSave` clears `saveOutcome` before each attempt: that unmounts the alert
   * in the "saving" commit so the post-await set REMOUNTS it, re-firing both the
   * announcement and this effect.
   *
   * ⚠️⚠️ An earlier revision of this docblock claimed the node "is mounted fresh
   * rather than having its text swapped". That was FALSE on both the same-text and
   * changed-text paths, and without the clear-on-attempt a retry failing with the
   * IDENTICAL message was an `Object.is` bail-out: no re-render, no re-insertion,
   * no focus move — measured twice in code review 62.2, silent for screen readers.
   *
   * The focus move is what a keyboard user gets: the message sits immediately
   * BEFORE the Save button in DOM order, so one Tab returns them to Save to retry.
   */
  useEffect(() => {
    if (saveOutcome) {
      saveOutcomeRef.current?.focus()
    }
  }, [saveOutcome])

  /**
   * A change of availability retires any save outcome (code review 62.2).
   * Clicking Save during `loading` parks "Still checking your financial
   * profiles. Try again in a moment." in `saveOutcome`; when the arm then
   * resolves to `none`/`error` that message would otherwise sit there forever,
   * telling the user to retry beside a permanently disabled button.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed deliberately on the arm alone — re-running when `saveOutcome` changes would erase the outcome the moment it is set.
  useEffect(() => {
    setSaveOutcome(null)
  }, [saveAvailability.kind])

  /**
   * `none` and `error` both mean a save cannot succeed, so the affordance is
   * disabled and says why. `loading` deliberately does NOT block: the window is a
   * few hundred milliseconds, a disabled control with no explanation is worse than
   * none, and the page's own save guard still refuses with an accurate message.
   */
  //
  // ⚠️ An invalid Projection Period blocks too (story 77.1). The on-screen
  // `result` is the last VALID one, so saving now would persist an out-of-range
  // `inputs.years` beside a result computed for a different period — and a saved
  // row with such a `years` has its inputs dropped to the defaults by
  // `mapToSavedForecast` on load.
  //
  // ⚠️ So does ANY other invalid field (story 81.1, D4), for the same reason: the
  // bad value never reached the engine, so the result on screen does not describe
  // what the form shows. The period alone keeps its own reason; any other bad
  // field, with or without the period, gets the general one.
  const saveBlockedReason =
    saveAvailability.kind === 'none'
      ? NO_PROFILE_SHORT
      : saveAvailability.kind === 'error'
        ? PROFILE_ERROR_SHORT
        : otherFieldInvalid
          ? FIELDS_INVALID_SHORT
          : !yearsValid
            ? YEARS_INVALID_SHORT
            : null

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
  }, [
    incomeItems,
    expenseItems,
    formData,
    savingsAccounts,
    balanceAccounts,
    oneTimeEvents,
    invalidAmountRows,
  ])

  /**
   * Calculate forecast based on current inputs
   */
  const calculateForecast = useCallback(async () => {
    // ⚠️ The field's guard (story 77.1, FR124). An out-of-range `years` never
    // reaches the engine: `1e9` would freeze the tab (the engine now refuses it,
    // but the builder must not rely on that throw to report a typing mistake).
    // The last valid RESULT stays on screen and the inline message under the
    // field says why it is not updating.
    //
    // ⚠️ But a calculation ERROR is cleared (77.1 code review, P3): it described
    // a computation of inputs that have since changed, and leaving it up would
    // show a banner whose cause may already be fixed. If the cause remains, the
    // next valid period recomputes and raises it again. `saveOutcome` is left
    // alone — Save is blocked with its own reason while the period is invalid.
    //
    // ⚠️ The same holds for every other field that can hold a bad value (story
    // 81.1, FR132): either growth rate, and any amount a row has reported invalid.
    // Each shows its own message; the engine's banner is not the place to learn
    // which field is wrong.
    if (
      !isValidForecastYears(formData.years) ||
      !isValidGrowthRate(formData.incomeGrowthRate) ||
      !isValidGrowthRate(formData.expenseGrowthRate) ||
      invalidAmountRows.size > 0
    ) {
      setError(null)
      return
    }
    setIsCalculating(true)
    setError(null)
    // AC-9: a recompute retires the previous save outcome, so the user never sees
    // a stale save error beside a fresh calculation error.
    setSaveOutcome(null)

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
        // Story 100.1: the rows split `savings` (their balances sum to it by
        // construction). They change no total, only the per-row figures.
        savingsAccounts: savingsAccounts.map(({ balance, monthlyContribution }) => ({
          balance,
          monthlyContribution,
        })),
        // Story 100.2: investment and debt rows. `investments` above is the
        // investment rows' sum by construction. Unlike the savings rows these DO
        // move totals: contributions move money from savings into investments,
        // debts lower net worth and fall by their payment.
        // Story 100.3: each investment row's own rate. A debt row's hidden rate is
        // not sent (the engine would ignore it anyway).
        balanceAccounts: balanceAccounts.map(
          ({
            type,
            balance,
            contribution,
            frequency,
            contributionRecordedAsExpense,
            annualReturn,
          }) => ({
            type,
            balance,
            contribution,
            frequency,
            contributionRecordedAsExpense,
            ...(type === 'investment' ? { annualReturn } : {}),
          })
        ),
      }

      const newResult = calculateFinancialForecast(currentData, scenario, formData.years)
      setResult(newResult)
      setResultSavingsRowIds(savingsAccounts.map((account) => account.id))
      setResultBalanceRowIds(balanceAccounts.map((account) => account.id))
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
  }, [
    incomeItems,
    expenseItems,
    formData,
    savings,
    savingsAccounts,
    investments,
    balanceAccounts,
    oneTimeEvents,
    invalidAmountRows,
  ])

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
   * Handle a Projection Period change (story 77.1). The typed value is stored
   * as-is — the field must show what the user typed — and remembered as the last
   * valid period only when the engine would accept it.
   */
  const handleYearsChange = useCallback(
    (value: string | number) => {
      const years = Number(value)
      handleFormChange('years', years)
      if (isValidForecastYears(years)) setLastValidYears(years)
    },
    [handleFormChange]
  )

  /**
   * Add new income item
   */
  // The user-facing row setters: same as the raw ones, but they record that the
  // user changed the list, so the store seed leaves it alone.
  const editIncomeItems: React.Dispatch<React.SetStateAction<LocalFinancialItem[]>> = useCallback(
    (update) => {
      incomeRowsTouched.current = true
      setIncomeItems(update)
    },
    []
  )
  const editExpenseItems: React.Dispatch<React.SetStateAction<LocalFinancialItem[]>> = useCallback(
    (update) => {
      expenseRowsTouched.current = true
      setExpenseItems(update)
    },
    []
  )

  const addIncomeItem = useCallback(() => {
    editIncomeItems((prev) => [
      ...prev,
      {
        id: generateId('income'),
        name: 'New Income',
        amount: 0,
        frequency: 'monthly',
      },
    ])
  }, [editIncomeItems])

  /**
   * Add new expense item
   */
  const addExpenseItem = useCallback(() => {
    editExpenseItems((prev) => [
      ...prev,
      {
        id: generateId('expense'),
        name: 'New Expense',
        amount: 0,
        frequency: 'monthly',
      },
    ])
  }, [editExpenseItems])

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

  // Savings rows (story 100.1). Every handler goes through this setter, so any
  // edit, add or remove marks the list touched and the seed leaves it alone.
  // None of them touches the savings store (D0): the rows are what-if only.
  const editSavingsAccounts: React.Dispatch<React.SetStateAction<LocalSavingsAccount[]>> =
    useCallback((update) => {
      savingsRowsTouched.current = true
      setSavingsAccounts(update)
    }, [])

  const addSavingsAccount = useCallback(() => {
    editSavingsAccounts((prev) => [
      ...prev,
      { id: generateId('savings'), name: 'New Account', balance: 0, monthlyContribution: 0 },
    ])
  }, [editSavingsAccounts])

  const updateSavingsAccount = useCallback(
    (id: string, field: 'name' | 'balance' | 'monthlyContribution', value: string | number) => {
      editSavingsAccounts((prev) =>
        prev.map((account) => (account.id === id ? { ...account, [field]: value } : account))
      )
    },
    [editSavingsAccounts]
  )

  // No "at least one item" rule, unlike income/expenses (AC-5): a scenario with
  // no savings accounts is legitimate.
  const deleteSavingsAccount = useCallback(
    (id: string) => {
      editSavingsAccounts((prev) => prev.filter((account) => account.id !== id))
    },
    [editSavingsAccounts]
  )

  // Investment/debt rows (story 100.2): the same single setter, so every edit,
  // add and remove marks the list touched. None touches the balance store (D0).
  const editBalanceAccounts: React.Dispatch<React.SetStateAction<LocalBalanceAccount[]>> =
    useCallback((update) => {
      balanceRowsTouched.current = true
      setBalanceAccounts(update)
    }, [])

  const addBalanceAccount = useCallback(() => {
    editBalanceAccounts((prev) => [
      ...prev,
      {
        id: generateId('balance'),
        name: 'New Investment',
        type: 'investment',
        balance: 0,
        contribution: 0,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
        annualReturn: DEFAULT_INVESTMENT_RETURN,
      },
    ])
  }, [editBalanceAccounts])

  const updateBalanceAccount = useCallback(
    <K extends Exclude<keyof LocalBalanceAccount, 'id'>>(
      id: string,
      field: K,
      value: LocalBalanceAccount[K]
    ) => {
      editBalanceAccounts((prev) =>
        prev.map((account) => {
          if (account.id !== id) return account
          const next = { ...account, [field]: value }
          // Any type change clears the flag, both ways (story 102.2, D8; was
          // "switching to Debt clears it", 100.2 AC-8): "is this money already in
          // Expenses" means something different for each type and must be
          // answered again. Its annual return is KEPT, hidden (story 100.3, D8):
          // back to Investment shows it again. So is `paidByExpenseName` (shown
          // on debt rows only).
          if (next.type !== account.type) next.contributionRecordedAsExpense = false
          return next
        })
      )
    },
    [editBalanceAccounts]
  )

  // No "at least one item" rule: a scenario with no investments or debts is fine.
  const deleteBalanceAccount = useCallback(
    (id: string) => {
      editBalanceAccounts((prev) => prev.filter((account) => account.id !== id))
    },
    [editBalanceAccounts]
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
    // The button is already disabled in this state; this is the belt to that
    // braces, so a programmatic click cannot fire a save that is known to fail.
    if (saveBlockedReason) {
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

    // ⚠️ Clear BEFORE the attempt (code review 62.2). Without this, a retry that
    // fails with the identical message is an `Object.is` bail-out: the alert node
    // is reused, nothing re-mounts, and neither the announcement nor the focus
    // effect fires. Clearing here unmounts it for the "saving" commit so the
    // post-await set is a genuine re-insertion.
    setSaveOutcome(null)
    setIsSaving(true)
    onSavingChange?.(true)
    try {
      const saveResult = await onSave({
        name: formData.name,
        description: formData.description || undefined,
        scenario,
        result,
        // Persist the inputs that ForecastingScenario does not carry, so the
        // forecast can be reopened faithfully (story bug-3).
        // `savings` stays alongside the rows (story 100.1, D4): an older cached
        // client that reads only `inputs.savings` still reopens the forecast at
        // the right starting figure. `investments` likewise stays beside the
        // investment/debt rows (story 100.2), as the investment rows' sum.
        inputs: {
          savings,
          investments,
          years: formData.years,
          savingsAccounts: savingsAccounts.map(({ name, balance, monthlyContribution }) => ({
            name,
            balance,
            monthlyContribution,
          })),
          // `annualReturn` on investment rows only (story 100.3, D8): a debt is
          // saved without one, so a later debt-interest story owns its own field.
          // Story 102.2 (version 5): a debt's flag is saved as it stands, and its
          // `paidByExpenseName` when it has one (D6).
          balanceAccounts: balanceAccounts.map(
            ({
              name,
              type,
              balance,
              contribution,
              frequency,
              contributionRecordedAsExpense,
              annualReturn,
              paidByExpenseName,
            }) => ({
              name,
              type,
              balance,
              contribution,
              frequency,
              contributionRecordedAsExpense,
              ...(type === 'investment' ? { annualReturn } : {}),
              ...(type === 'debt' && paidByExpenseName ? { paidByExpenseName } : {}),
            })
          ),
        },
      })
      // Failures land in `saveOutcome`, beside the button. Successes are reported
      // by the PAGE, outside this component, because the page hides this component
      // on success — see the `saveOutcome` docblock.
      setSaveOutcome(
        saveResult && !saveResult.success ? saveResult.error || FALLBACK_SAVE_ERROR : null
      )
    } catch (err) {
      // `onSave` is a caller-supplied async function. Before this story a rejection
      // propagated out of the click handler as an unhandled rejection and the user
      // saw nothing at all — the page's own catch only covers ITS implementation,
      // not a caller that throws before returning a result.
      // ⚠️ `|| FALLBACK_SAVE_ERROR` covers an Error with an EMPTY message, which
      // would otherwise be falsy and render no alert at all — the resolved-result
      // arm above already guards this; the catch arm did not (code review 62.2).
      setSaveOutcome((err instanceof Error && err.message) || FALLBACK_SAVE_ERROR)
    } finally {
      setIsSaving(false)
      // Same `finally` as `isSaving`, so the page's tab lock cannot latch on any
      // exit path — resolve, reject, or a caller that throws synchronously.
      onSavingChange?.(false)
    }
  }, [
    result,
    isSaving,
    saveBlockedReason,
    onSavingChange,
    formData,
    incomeItems,
    expenseItems,
    oneTimeEvents,
    savings,
    savingsAccounts,
    investments,
    balanceAccounts,
    onSave,
  ])

  /**
   * Per-row outcome lines (story 100.1, D5): each row's closing balance in the
   * last projection year, keyed by row id, plus the unassigned remainder. Empty
   * for a result computed without rows (a v1 forecast's saved result, before its
   * first recompute).
   */
  const savingsOutcome = useMemo(() => {
    if (!result) return null
    const last = result.projection.at(-1)
    if (!last?.savingsAccounts || last.unallocatedSavings === undefined) return null
    const byRowId = new Map<string, number>()
    resultSavingsRowIds.forEach((id, index) => {
      const balance = last.savingsAccounts?.[index]
      if (balance !== undefined) byRowId.set(id, balance)
    })
    // The section-level line describes the WHOLE list, so it shows only while the
    // result was computed for exactly the rows on screen (code review 100.1):
    // never under an empty list, and never with a stale year count while a
    // debounced recompute for an added/removed row is pending.
    const currentIds = savingsAccounts.map((account) => account.id)
    const coversRows =
      currentIds.length > 0 &&
      currentIds.length === resultSavingsRowIds.length &&
      currentIds.every((id, index) => id === resultSavingsRowIds.at(index))
    // Contributions are what the amber line blames, so it needs some (code
    // review 100.1): a negative remainder with nothing contributed is a deficit
    // in the income itself, not over-contribution. Since story 100.2 a COUNTED
    // investment contribution reduces the left-over too, so it counts here.
    const contributing =
      savingsAccounts.some((account) => account.monthlyContribution > 0) ||
      balanceAccounts.some(
        (account) =>
          account.type === 'investment' &&
          !account.contributionRecordedAsExpense &&
          account.contribution > 0
      )
    return {
      years: result.projection.length,
      byRowId,
      unallocated: last.unallocatedSavings,
      coversRows,
      contributing,
    }
  }, [result, resultSavingsRowIds, savingsAccounts, balanceAccounts])

  /**
   * Per-row outcome lines for the investment/debt rows (story 100.2, D9): each
   * row's closing balance in the last projection year, keyed by row id.
   */
  const balanceOutcome = useMemo(() => {
    if (!result) return null
    const closing = result.projection.at(-1)?.balanceAccounts
    if (!closing) return null
    const byRowId = new Map<string, number>()
    resultBalanceRowIds.forEach((id, index) => {
      const balance = closing[index]
      if (balance !== undefined) byRowId.set(id, balance)
    })
    return { years: result.projection.length, byRowId }
  }, [result, resultBalanceRowIds])

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

      {/* Saving is impossible before the user starts — say so here, not on submit.
          ⚠️ This is the point of story 62.2: the condition is known at mount, and
          reporting it only when the user presses Save (after building a whole
          scenario) is the defect. The remedy is one click away on the `none` arm.
          ⚠️ The `error` arm must NOT offer "create a profile" — an account whose
          fetch merely failed already has profiles, and sending it to make another
          is wrong advice about the user's own data. */}
      {saveAvailability.kind === 'none' || saveAvailability.kind === 'error' ? (
        <div
          data-testid="save-blocked-notice"
          className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 px-4 py-3 rounded-lg text-sm"
        >
          {saveAvailability.kind === 'none' ? (
            <p>
              {NO_PROFILE_NOTICE}{' '}
              <Link to="/profiles" className="font-medium underline hover:no-underline">
                Create a profile
              </Link>
            </p>
          ) : (
            <p>{PROFILE_ERROR_NOTICE}</p>
          )}
        </div>
      ) : null}

      {/* Calculation Error Message.
          ⚠️ THIS SLOT IS THE CALCULATION'S, NOT THE SAVE'S (story 62.2, AC-9). A
          save failure renders beside the Save button instead — roughly 250 lines
          further down the form, which is exactly why it could not stay here. */}
      {error && (
        <div
          data-testid="calculation-error"
          className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 px-4 py-3 rounded-lg text-sm"
        >
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
            onChange={handleYearsChange}
            type="number"
            min={MIN_FORECAST_YEARS}
            max={MAX_FORECAST_YEARS}
            step={1}
            error={yearsValid ? undefined : YEARS_INVALID_MESSAGE}
          />
          {/* ⚠️ `min`/`max` are HTML hints: they gate the spinner and form
              validation, never a typed value. The guard is `isValidForecastYears`
              in `calculateForecast` and in the engine (story 77.1).
              MEASURED in Chromium (throwaway Playwright probe on a bare
              `<input type="number" min=1 max=30 step=1>`, 77.1): typing
              `1e999` gives `value=""`, `badInput=true`, so it reaches the parent
              as 0 (InputField maps a NaN parse to 0), never as Infinity. `1e9`,
              `2.5`, `-3` and `31` all arrive verbatim, and `1e9` is the one the
              engine could not finish (the bounded harness timed out on it). jsdom also reports `1e999` as `""`. */}

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
              `handleFormChange`". It does NOT — that handler is a pass-through,
              and nothing CLAMPS a growth rate. Nothing is LOST by dropping
              `min`/`max` (they never clamped a typed value on a number input
              either; they gate the spinner and form validation only). Caught
              re-reading my own comment during code review 62.1.
              ⚠️ Since story 81.1 the rate is BOUNDED, though still not clamped:
              `isValidGrowthRate` (−100%..+100%) marks the field invalid, the
              recompute and Save are held, and the engine refuses it too. The
              field keeps what was typed so it can be fixed. */}
          <InputField
            label="Income Growth Rate"
            value={formData.incomeGrowthRate}
            onChange={(v) => handleFormChange('incomeGrowthRate', Number(v))}
            type="text"
            inputMode="decimal"
            formatValue={formatPercentage}
            parseValue={parsePercentText}
            error={incomeGrowthValid ? undefined : GROWTH_INVALID_MESSAGE}
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
              `handleFormChange`". It does NOT — that handler is a pass-through,
              and nothing CLAMPS a growth rate. Nothing is LOST by dropping
              `min`/`max` (they never clamped a typed value on a number input
              either; they gate the spinner and form validation only). Caught
              re-reading my own comment during code review 62.1.
              ⚠️ Since story 81.1 the rate is BOUNDED, though still not clamped:
              `isValidGrowthRate` (−100%..+100%) marks the field invalid, the
              recompute and Save are held, and the engine refuses it too. The
              field keeps what was typed so it can be fixed. */}
          <InputField
            label="Expense Growth Rate"
            value={formData.expenseGrowthRate}
            onChange={(v) => handleFormChange('expenseGrowthRate', Number(v))}
            type="text"
            inputMode="decimal"
            formatValue={formatPercentage}
            parseValue={parsePercentText}
            error={expenseGrowthValid ? undefined : GROWTH_INVALID_MESSAGE}
          />
          {/* Story 100.2 replaced Current Investments (the last money
              `InputField`, with its seed-key remount and pre-hydration refusal)
              with the Investments & Debts rows below. Rows are keyed by id, so the
              seed remounts them, and no money field is server-rendered any more. */}
        </div>
      </section>

      {/* Savings Accounts (story 100.1, FR164) */}
      <section
        className="surface-inset rounded-xl p-6 space-y-4"
        aria-labelledby={savingsHeadingId}
      >
        {/* The note sits BELOW the heading row, at full width: beside the
            heading it squeezed the row at 320px and pushed the button past the
            section's edge (CI screenshot, story 100.1). */}
        <div className="flex items-center justify-between">
          <h3 id={savingsHeadingId} className="text-lg font-semibold text-subheading">
            Savings Accounts
          </h3>
          <button
            type="button"
            onClick={addSavingsAccount}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Account
          </button>
        </div>
        <p className="text-muted text-sm">{SAVINGS_WHAT_IF_NOTE}</p>

        {savingsAccounts.length === 0 ? (
          <p className="text-muted text-sm">{NO_SAVINGS_ACCOUNTS}</p>
        ) : (
          <div className="space-y-4">
            {savingsAccounts.map((account, index) => {
              const closing = savingsOutcome?.byRowId.get(account.id)
              return (
                <SavingsAccountRow
                  key={account.id}
                  account={account}
                  position={index + 1}
                  onUpdate={updateSavingsAccount}
                  onDelete={deleteSavingsAccount}
                  onValidityChange={setAmountRowValidity}
                  outcome={
                    savingsOutcome && closing !== undefined
                      ? {
                          label: `After ${yearsLabel(savingsOutcome.years)}:`,
                          amount: formatCurrency(closing),
                        }
                      : null
                  }
                />
              )
            })}
          </div>
        )}

        {savingsOutcome?.coversRows &&
          (savingsOutcome.unallocated < 0 && savingsOutcome.contributing ? (
            <p
              data-testid="savings-unassigned"
              className="text-sm text-amber-800 dark:text-amber-200"
            >
              Your contributions are{' '}
              <GroupedAmount text={formatCurrency(-savingsOutcome.unallocated)} /> more than you
              have left over by year {savingsOutcome.years}
            </p>
          ) : (
            <p data-testid="savings-unassigned" className="text-sm text-body">
              Not assigned to an account after {yearsLabel(savingsOutcome.years)}:{' '}
              <GroupedAmount text={formatCurrency(savingsOutcome.unallocated)} />
            </p>
          ))}
      </section>

      {/* Investments & Debts (story 100.2, FR165) */}
      <section
        className="surface-inset rounded-xl p-6 space-y-4"
        aria-labelledby={balanceHeadingId}
      >
        {/* The note sits below the heading row, at full width (100.1's 320px lesson). */}
        <div className="flex items-center justify-between">
          <h3 id={balanceHeadingId} className="text-lg font-semibold text-subheading">
            Investments &amp; Debts
          </h3>
          <button
            type="button"
            onClick={addBalanceAccount}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Balance
          </button>
        </div>
        <p className="text-muted text-sm">{BALANCE_WHAT_IF_NOTE}</p>

        {balanceAccounts.length === 0 ? (
          <p className="text-muted text-sm">{NO_BALANCE_ACCOUNTS}</p>
        ) : (
          <div className="space-y-4">
            {balanceAccounts.map((account, index) => {
              const closing = balanceOutcome?.byRowId.get(account.id)
              return (
                <BalanceAccountRow
                  key={account.id}
                  account={account}
                  position={index + 1}
                  onUpdate={updateBalanceAccount}
                  onDelete={deleteBalanceAccount}
                  onValidityChange={setAmountRowValidity}
                  outcome={
                    balanceOutcome && closing !== undefined
                      ? // A debt that STARTS at 0 was never owed, so it is not
                        // "paid off" (code review 100.2): it reads After N years: 0.
                        account.type === 'debt' && closing === 0 && account.balance > 0
                        ? { label: `Paid off within ${yearsLabel(balanceOutcome.years)}` }
                        : {
                            label: `After ${yearsLabel(balanceOutcome.years)}:`,
                            amount: formatCurrency(closing),
                          }
                      : null
                  }
                />
              )
            })}
          </div>
        )}
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
                updateFinancialItem(incomeItems, editIncomeItems, item.id, field, value)
              }
              onDelete={() => deleteFinancialItem(incomeItems, editIncomeItems, item.id)}
              onValidityChange={setAmountRowValidity}
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
                updateFinancialItem(expenseItems, editExpenseItems, item.id, field, value)
              }
              onDelete={() => deleteFinancialItem(expenseItems, editExpenseItems, item.id)}
              onValidityChange={setAmountRowValidity}
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
                maxYear={lastValidYears}
                onValidityChange={setAmountRowValidity}
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

          {/* The save outcome renders HERE, not at the top of the form.
              ⚠️ Adjacency is structural, not cosmetic: the message shares this
              immediate parent with the Save button, so a user who just pressed
              Save cannot miss it, and it sits BEFORE the button in DOM order so a
              single Tab from the focused message returns to Save to retry. */}
          <div className="mt-6 space-y-3">
            {saveOutcome && (
              <div
                ref={saveOutcomeRef}
                data-testid="save-outcome"
                role="alert"
                tabIndex={-1}
                className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 px-4 py-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {saveOutcome}
              </div>
            )}
            {saveBlockedReason && (
              <p
                data-testid="save-blocked-reason"
                className="text-sm text-amber-800 dark:text-amber-200 text-right"
              >
                {saveBlockedReason}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isCalculating || isSaving || saveBlockedReason !== null}
              >
                {isCalculating ? 'Calculating...' : isSaving ? 'Saving...' : 'Save Forecast'}
              </button>
            </div>
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
   * name must keep accepting letters. Only the two money fields passed it; since
   * story 100.2 neither exists (savings and investments are rows), so no call
   * site passes it today. Kept, not deleted, for the next text money field.
   */
  sanitize?: (raw: string) => string
  /**
   * A validation message for this field (story 77.1). When set, it renders under
   * the input, which gets `aria-invalid` and an `aria-describedby` pointing at it.
   * When unset, NEITHER attribute is rendered, so the other call sites stay
   * byte-identical.
   */
  error?: string
  /**
   * Adopt text typed into the server-rendered input before hydration (default
   * true). A money field must opt out (the hydration render parses with the
   * default locale, so a de-DE `1234,56` would be saved 100x; decided 2026-10-05).
   * No money `InputField` exists since story 100.2.
   */
  adoptPreHydrationValue?: boolean
  autoComplete?: 'off'
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
  error,
  adoptPreHydrationValue = true,
  autoComplete,
}: InputFieldProps): React.ReactElement {
  const [internalValue, setInternalValue] = useState<string>(() => {
    // `formatValue` here is the symbol-bearing display formatter, so a money field
    // would otherwise mount holding "$5,000.00" and lose the symbol the instant the
    // user types. Seed through the same filter the field enforces, so what mounts
    // is already a legal value for it.
    const seeded = formatValue ? formatValue(value) : String(value)
    return sanitize ? sanitize(seeded) : seeded
  })

  const inputRef = useRef<HTMLInputElement>(null)

  const commit = (rawValue: string) => {
    setInternalValue(rawValue)

    if (parseValue) {
      onChange(parseValue(rawValue))
    } else if (type === 'number') {
      const numValue = parseFloat(rawValue)
      // `isFinite`, not `isNaN` (story 81.1, D7): no raw Infinity is ever lifted to
      // the parent. Only the Projection Period uses this arm, and it already refuses
      // 0 and Infinity alike, so no user sees a difference; the parent simply never
      // receives a value no field means.
      onChange(Number.isFinite(numValue) ? numValue : 0)
    } else {
      onChange(rawValue)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Filter first, so the displayed value and the value lifted to the parent are
    // derived from the same string. There is no blur re-formatter on this surface,
    // which makes onChange the only filter point. `sanitizeWithCaret` also keeps
    // the cursor in place when a character is rejected mid-string.
    commit(sanitize ? sanitizeWithCaret(e.target, sanitize) : e.target.value)
  }

  // Keep what the user typed BEFORE hydration. The server-rendered input is live
  // as soon as it paints, and on a cold load that can be seconds before React
  // takes over. Hydration leaves the typed DOM value in place but fires no
  // onChange, so state still holds the server value, and the next re-render of
  // this field (the store seed is one) writes that back over the user's text.
  // Adopting the DOM value on mount closes that window. On an ordinary client
  // mount the two are equal and this does nothing.
  // Compare AFTER filtering: text the filter rejects outright (`0.00a` -> `0.00`)
  // is no edit, so it only cleans the DOM and fires no `onChange`. (Today the only
  // filtered fields, the money ones, opt out of adoption entirely.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input || !adoptPreHydrationValue) return
    const adopted = sanitize ? sanitize(input.value) : input.value
    if (adopted !== internalValue) {
      commit(adopted)
    } else if (input.value !== adopted) {
      input.value = adopted
    }
  }, [])

  // Associate the label with its control (story `forecast-2`). `useId` keeps the
  // pairing unique across the seven call sites without threading an id prop.
  const inputId = useId()
  const errorId = `${inputId}-error`

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-label mb-1">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type={type}
        value={internalValue}
        onChange={handleChange}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
      />
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
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
  /** Reports whether this row's amount field holds a usable value (story 81.1). */
  onValidityChange: (rowId: string, valid: boolean) => void
}

/**
 * Why an entry in an amount field cannot be used, or `null` when it can (story
 * 81.1, FR132). Shared by the income/expense and one-time event rows.
 *
 * ⚠️ `cents` is checked, not `value`: `1e308` is a finite number the input accepts,
 * and `Math.round(1e308 * 100)` is Infinity. Checking before the ×100 lets exactly
 * that case through (it did, at every site, before 81.1).
 */
function amountProblem(badInput: boolean, cents: number): string | null {
  if (badInput || Number.isNaN(cents)) return AMOUNT_NOT_A_NUMBER_MESSAGE
  if (!Number.isFinite(cents)) return AMOUNT_TOO_LARGE_MESSAGE
  return null
}

/**
 * Withdraws a row's invalid-amount report when the row unmounts (removed, or
 * re-keyed by a load or the store seed), so a row that no longer exists can never
 * keep Save blocked (story 81.1, D4).
 */
function useWithdrawValidityOnUnmount(
  rowId: string,
  onValidityChange: (rowId: string, valid: boolean) => void
): void {
  useEffect(() => () => onValidityChange(rowId, true), [rowId, onValidityChange])
}

function FinancialItemRow({
  item,
  frequencyOptions,
  onUpdate,
  onDelete,
  onValidityChange,
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

  /**
   * ⚠️ The field shows a DRAFT string, not `item.amount / 100` (story 81.1, D5).
   * A bad entry is no longer written to state, so a controlled `value` would
   * reconcile the input back to the last good amount on the very re-render that
   * shows the message — the user would lose what they typed at the moment they
   * are told it is wrong. The draft keeps it on screen until they fix it.
   * Nothing outside this input changes `item.amount` while the row is mounted:
   * seeding and loading re-key the row, which remounts it with a fresh draft.
   */
  const [draft, setDraft] = useState<string>(() => String(item.amount / 100))
  const [amountError, setAmountError] = useState<string | null>(null)
  useWithdrawValidityOnUnmount(item.id, onValidityChange)

  /**
   * Before story 81.1 this wrote `0` for anything it could not use — a negative,
   * text the browser rejected — and passed `Infinity` for `1e308`, which the
   * engine refused with a banner naming no field. Now a bad entry is reported
   * HERE and nothing is written, so the last good amount stays in the forecast.
   * An EMPTY field is still 0: a cleared amount means nothing, not a mistake.
   */
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setDraft(raw)
    // `validity` is optional-chained: jsdom never reports badInput (MEASURED,
    // 81.1), while Chromium reports it for text a number input cannot hold.
    const badInput = e.target.validity?.badInput === true
    let problem: string | null = null
    if (!badInput && raw.trim() === '') {
      onUpdate('amount', 0)
    } else {
      const value = parseFloat(raw)
      const cents = Math.round(value * 100)
      problem = amountProblem(badInput, cents)
      if (problem === null && value < 0) problem = AMOUNT_NEGATIVE_MESSAGE
      if (problem === null) onUpdate('amount', cents)
    }
    setAmountError(problem)
    onValidityChange(item.id, problem === null)
  }
  const amountErrorId = `${amountId}-error`

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
              value={draft}
              onChange={handleAmountChange}
              min={0}
              step={0.01}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? amountErrorId : undefined}
              className={`w-full ${
                mode === 'symbol' ? 'px-6' : 'px-2'
              } py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm`}
              placeholder="0.00"
            />
          </div>
          {amountError && (
            <p id={amountErrorId} className="mt-1 text-xs text-red-600 dark:text-red-300">
              {amountError}
            </p>
          )}
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
  /** Reports whether this row's amount field holds a usable value (story 81.1). */
  onValidityChange: (rowId: string, valid: boolean) => void
}

function OneTimeEventRow({
  event,
  onUpdate,
  onDelete,
  maxYear,
  onValidityChange,
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

  /**
   * The field shows a DRAFT magnitude string (story 81.1, D6), for the reason
   * `FinancialItemRow` gives: a refused entry is not written to state, and a
   * controlled `value` would snap the input back to the last good amount on the
   * re-render that shows the message. Flipping direction re-signs the stored
   * amount without changing its magnitude, so the draft stays correct.
   */
  const [draft, setDraft] = useState<string>(() => String(Math.abs(event.amount) / 100))
  const [amountError, setAmountError] = useState<string | null>(null)
  useWithdrawValidityOnUnmount(event.id, onValidityChange)

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    const value = parseFloat(raw)
    // A typed minus selects "Money out" (below) and the field shows the magnitude,
    // as it did when the input was controlled by `Math.abs(event.amount)`.
    setDraft(value < 0 ? raw.replace(/^\s*-/, '') : raw)

    if (Number.isNaN(value)) {
      /**
       * ⚠️ 81.1 code review (R1, Lucas: parity with `FinancialItemRow`). Two
       * arms used to share this silent branch, and both left the forecast on the
       * LAST amount while the field showed something else:
       *   - text the browser cannot hold (`1e999`, a half-typed `1e`, a lone "-"
       *     in Chromium) arrives as `""` with `badInput`. It is now REPORTED and
       *     held, exactly as an income/expense row reports it. A lone "-" shows
       *     the message for one keystroke; the next digit resolves it (below).
       *   - an EMPTIED field now writes 0, as an income/expense row does. That was
       *     unsafe while the input was controlled by the amount (see the ⚠️
       *     below), and is safe since the draft: the input renders exactly what
       *     the DOM reports, so a 0 in state resets nothing on screen.
       */
      const badInput = e.target.validity?.badInput === true
      if (badInput) {
        setAmountError(AMOUNT_NOT_A_NUMBER_MESSAGE)
        onValidityChange(event.id, false)
        return
      }
      setAmountError(null)
      onValidityChange(event.id, true)
      if (raw.trim() === '') {
        // Keep the chosen direction through the zero, where the sign cannot hold it.
        if (pendingDirection !== direction) setPendingDirection(direction)
        onUpdate(event.id, 'amount', 0)
        return
      }
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
       *
       * (Story 81.1: the `setDraft` above IS a state write, but a safe one. The
       * input now renders the draft, which is exactly what the DOM reports, so
       * the re-render has nothing to reset. The hazard was writing the AMOUNT.)
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
    /**
     * ⚠️ A finite entry can still overflow once scaled to cents (story 77.1):
     * `1e308` is a valid number here, and `1e308 * 100` is `Infinity`. The engine
     * refuses a non-finite event amount, and a saved one would come back as JSON
     * `null`, so write nothing and keep the last good amount. (`1e999` itself
     * most likely never gets here: a throwaway Chromium probe in 77.1 found a
     * GENERIC `<input type="number">` reports it as `""` with `badInput` —
     * measured on a bare input, not on this field.)
     *
     * ⚠️ Since story 81.1 (FR132) the refusal is REPORTED on this field. Before,
     * it returned silently, so the field showed a number the forecast was not using.
     */
    // The minus is honoured BEFORE the overflow check (81.1 code review, P2): a
    // typed `-1e308` is refused, but its "Money out" intent must survive to the
    // corrected entry, or `5` would be stored as money in.
    const nextDirection = value < 0 ? 'out' : direction
    if (nextDirection !== direction) setPendingDirection(nextDirection)
    const problem = amountProblem(false, cents)
    setAmountError(problem)
    onValidityChange(event.id, problem === null)
    if (problem !== null) {
      // A NON-zero amount's sign IS the direction (see `direction` above), so
      // `pendingDirection` alone would be ignored: re-sign the kept amount, as the
      // direction control does. The magnitude is unchanged, and the row is invalid,
      // so nothing is recomputed until the entry is fixed.
      if (nextDirection !== direction && event.amount !== 0) {
        onUpdate(event.id, 'amount', signed(Math.abs(event.amount), nextDirection))
      }
      return
    }
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
  const yearCalendarId = `${yearId}-calendar`
  const yearHelpId = `${yearId}-help`
  // The calendar year the value lands in (story 108.1, D6): year 1 is the first
  // projected year, so in 2026 it is 2027. Read at render: an event row only
  // exists after a client-side add or load (a fresh builder SSRs with no
  // events), so this never renders on the server and cannot mismatch hydration.
  const calendarYear = new Date().getFullYear() + event.year

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const year = Math.max(1, Math.min(maxYear, parseInt(e.target.value, 10) || 1))
    onUpdate(event.id, 'year', year)
  }

  return (
    <div className="surface rounded-lg p-4 shadow-sm border border-default">
      {/* `items-start` since story 108.1: the year cell carries two lines under its
          input, and `items-end` would have pushed every other input up out of
          line with it. Labels are one line at md+, so tops align the inputs. */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
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
              value={draft}
              onChange={handleAmountChange}
              min={0}
              step={0.01}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? `${amountId}-error` : undefined}
              className={`w-full ${
                mode === 'symbol' ? 'px-6' : 'px-2'
              } py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm`}
              placeholder="0.00"
            />
          </div>
          {amountError && (
            <p id={`${amountId}-error`} className="mt-1 text-xs text-red-600 dark:text-red-300">
              {amountError}
            </p>
          )}
        </div>

        {/* Year (story 108.1, FR176, D6). It was labelled just "Year", which
            reads as a calendar year (2027) as easily as a count. It is a count
            from the start of the forecast — the engine applies the event in
            loop year `event.year` — so the label says so, the help line says
            where counting starts, and the calendar year sits beside the value.
            The stored value and its clamp are unchanged (1..`maxYear`). */}
        <div>
          {/* `whitespace-nowrap` (108.1 review): under DejaVu Sans (CI, many Linux
              desktops) this label is 107.3 px, wider than a column at 768-776 px
              (105 px), so it wrapped to two lines and dropped this input 20 px
              below the others in a top-aligned row. MEASURED; unwrapped it
              overhangs ≤ 3 px into the 12 px gap. */}
          <label
            htmlFor={yearId}
            className="block whitespace-nowrap text-sm font-medium text-label mb-1"
          >
            Years from now
          </label>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <input
              id={yearId}
              type="number"
              value={event.year}
              onChange={handleYearChange}
              min={1}
              max={maxYear}
              step={1}
              aria-describedby={`${yearCalendarId} ${yearHelpId}`}
              className="w-20 shrink-0 px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
            />
            <span id={yearCalendarId} className="text-sm text-muted whitespace-nowrap">
              Year {event.year} ({calendarYear})
            </span>
          </div>
          <p id={yearHelpId} className="mt-1 text-xs text-muted">
            1 = the first year of your forecast
          </p>
        </div>

        {/* Delete. `md:pt-6` (the label's line + margin) lines it up with the
            inputs now that the row aligns to the top (108.1). */}
        <div className="flex justify-end md:pt-6">
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
 * Savings Account Row Component (story 100.1, FR164)
 */
interface SavingsAccountRowProps {
  account: LocalSavingsAccount
  /** 1-based place in the list, so the name field is told apart even when two rows share a name. */
  position: number
  onUpdate: (
    id: string,
    field: 'name' | 'balance' | 'monthlyContribution',
    value: string | number
  ) => void
  onDelete: (id: string) => void
  /**
   * Reports whether ONE money field holds a usable value (story 81.1). Each field
   * reports under its own key (`<rowId>:balance`, `<rowId>:contribution`), so two
   * bad fields in a row both block Save and fixing one cannot unblock the other.
   */
  onValidityChange: (key: string, valid: boolean) => void
  /** The `After N years: <amount>` line, or `null` while there is no result for this row. */
  outcome: { label: string; amount: string } | null
}

/**
 * One money field of a what-if row (savings rows, story 100.1; investment/debt
 * rows, story 100.2): a DRAFT string, validated on every change
 * with the 81.1 rules, and written as cents only when usable — the same contract
 * as `FinancialItemRow`'s amount (see its docblock for why the draft exists).
 *
 * ⚠️ Deliberately NOT `InputField` + `parseFromInput` (story 100.1): rows remount
 * by key when the seed lands, so the `InputField` seed-key / pre-hydration
 * machinery is not needed, and mixing the two parsing paths in one row would show
 * a de-DE user two different number formats side by side.
 */
function useMoneyDraft(
  cents: number,
  validityKey: string,
  onValidityChange: (key: string, valid: boolean) => void,
  write: (cents: number) => void
) {
  const [draft, setDraft] = useState<string>(() => String(cents / 100))
  // A negative value can ARRIVE, not only be typed: a forecast saved when the old
  // Current Savings field accepted `-5` (Lucas, code review 100.1). Flag it from
  // the first render and report it, exactly as if typed, so Save and the
  // recompute are held until it is fixed.
  const [error, setError] = useState<string | null>(() =>
    cents < 0 ? AMOUNT_NEGATIVE_MESSAGE : null
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — reports the value the row ARRIVED with; later changes report from `onChange`.
  useEffect(() => {
    if (cents < 0) onValidityChange(validityKey, false)
  }, [])
  useWithdrawValidityOnUnmount(validityKey, onValidityChange)
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setDraft(raw)
    // jsdom never reports `badInput`; Chromium does for text a number input
    // cannot hold (MEASURED, 81.1).
    const badInput = e.target.validity?.badInput === true
    let problem: string | null = null
    if (!badInput && raw.trim() === '') {
      write(0)
    } else {
      const value = parseFloat(raw)
      const parsed = Math.round(value * 100)
      problem = amountProblem(badInput, parsed)
      if (problem === null && value < 0) problem = AMOUNT_NEGATIVE_MESSAGE
      if (problem === null) write(parsed)
    }
    setError(problem)
    onValidityChange(validityKey, problem === null)
  }
  return { draft, error, onChange }
}

/**
 * The Annual return field of an investment row (story 100.3, D6), modelled on
 * `useMoneyDraft`: a DRAFT string, and the parsed rate written to the row only
 * when usable. Parsed like the growth-rate fields (`parseFloat(raw) / 100`, so
 * `7`, `7%` and `7.00%` all mean 0.07), but only when the WHOLE text is a number
 * (`PERCENT_TEXT`), and bounded by the same rule (`isValidGrowthRate`). Empty,
 * not a number (`abc`, `5abc`, `1,5`, `1e2`) or outside −100%..100% shows
 * `RETURN_INVALID_MESSAGE`, is NOT written, and reports invalid under its own key,
 * which holds the recompute and Save. A finite out-of-range rate can ARRIVE from a
 * saved forecast (D9): flagged from the first render, as `useMoneyDraft` flags a
 * negative amount. The draft opens as `formatPercentage(rate)` (`6.00%`).
 */
/** A plain decimal, optionally signed, optionally ending in `%` (story 100.3 review). */
const PERCENT_TEXT = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*%?\s*$/

/**
 * A typed percentage as a decimal rate (`5`, `5%`, `5.00%` → 0.05), or NaN when the
 * WHOLE text is not a plain number with an optional `%`. `parseFloat` alone reads a
 * PREFIX: `5abc` → 5, `1,5` → 1 (a decimal comma silently dropped), `1e2` → 100.
 * Shared by the Annual return field and both growth-rate fields; the caller's
 * `isValidGrowthRate` turns the NaN into the field's message.
 */
function parsePercentText(raw: string): number {
  return PERCENT_TEXT.test(raw) ? parseFloat(raw) / 100 : Number.NaN
}

function usePercentDraft(
  rate: number,
  validityKey: string,
  onValidityChange: (key: string, valid: boolean) => void,
  write: (rate: number) => void
) {
  const [draft, setDraft] = useState<string>(() => formatPercentage(rate))
  const [error, setError] = useState<string | null>(() =>
    isValidGrowthRate(rate) ? null : RETURN_INVALID_MESSAGE
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — reports the value the row ARRIVED with; later changes report from `onChange`.
  useEffect(() => {
    if (!isValidGrowthRate(rate)) onValidityChange(validityKey, false)
  }, [])
  useWithdrawValidityOnUnmount(validityKey, onValidityChange)
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setDraft(raw)
    // The whole text must be a plain number with an optional `%` (code review
    // 100.3), else it is refused, never written.
    const parsed = parsePercentText(raw)
    const problem = isValidGrowthRate(parsed) ? null : RETURN_INVALID_MESSAGE
    if (problem === null) write(parsed)
    setError(problem)
    onValidityChange(validityKey, problem === null)
  }
  return { draft, error, onChange }
}

/**
 * The Annual return field (story 100.3), the percent twin of `RowMoneyField`:
 * same label, error markup and `<label> for <row>` accessible name. `type="text"`
 * with `inputMode="decimal"`, like the growth-rate fields, because it shows `%`.
 */
function RowPercentField({
  label,
  rowLabel,
  field,
}: {
  label: string
  rowLabel: string
  field: ReturnType<typeof usePercentDraft>
}): React.ReactElement {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-label mb-1">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={field.draft}
        onChange={field.onChange}
        aria-label={`${label} for ${rowLabel}`}
        autoComplete="off"
        aria-invalid={field.error ? true : undefined}
        aria-describedby={field.error ? `${id}-error` : undefined}
        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
      />
      {field.error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600 dark:text-red-300">
          {field.error}
        </p>
      )}
    </div>
  )
}

/**
 * One money field of a what-if row (savings rows, story 100.1; balance rows,
 * story 100.2), driven by `useMoneyDraft`. The visible label is the same on
 * every row, so the accessible name adds the row (`<label> for <row>`).
 */
function RowMoneyField({
  label,
  rowLabel,
  field,
}: {
  label: string
  rowLabel: string
  field: ReturnType<typeof useMoneyDraft>
}): React.ReactElement {
  const { mode, currency } = useCurrencyPreferences()
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-label mb-1">
        {label}
      </label>
      <div className="relative">
        {mode === 'symbol' && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
            {currencySymbol(currency)}
          </span>
        )}
        <input
          id={id}
          type="number"
          value={field.draft}
          onChange={field.onChange}
          min={0}
          step={0.01}
          aria-label={`${label} for ${rowLabel}`}
          autoComplete="off"
          aria-invalid={field.error ? true : undefined}
          aria-describedby={field.error ? `${id}-error` : undefined}
          className={`w-full ${
            mode === 'symbol' ? 'px-6' : 'px-2'
          } py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm`}
          placeholder="0.00"
        />
      </div>
      {field.error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600 dark:text-red-300">
          {field.error}
        </p>
      )}
    </div>
  )
}

function SavingsAccountRow({
  account,
  position,
  onUpdate,
  onDelete,
  onValidityChange,
  outcome,
}: SavingsAccountRowProps): React.ReactElement {
  const nameId = useId()
  const balance = useMoneyDraft(account.balance, `${account.id}:balance`, onValidityChange, (c) =>
    onUpdate(account.id, 'balance', c)
  )
  const contribution = useMoneyDraft(
    account.monthlyContribution,
    `${account.id}:contribution`,
    onValidityChange,
    (c) => onUpdate(account.id, 'monthlyContribution', c)
  )
  // Every row has the same three visible labels, so each control's accessible
  // name also carries the row's name, or a screen reader hears "Balance" N times.
  const rowName = account.name.trim()
  const rowLabel = rowName === '' ? 'account' : rowName

  return (
    <div className="surface rounded-lg p-4 shadow-sm border border-default">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        {/* Name */}
        <div className="min-w-0">
          <label htmlFor={nameId} className="block text-sm font-medium text-label mb-1">
            Account Name
          </label>
          <input
            id={nameId}
            type="text"
            value={account.name}
            onChange={(e) => onUpdate(account.id, 'name', e.target.value)}
            // The visible label is the same on every row; its position tells
            // them apart (AC-16, code review 100.1). Not the row name itself:
            // this field IS the name, so it would rename itself while typed in.
            aria-label={`Account Name, row ${position}`}
            autoComplete="off"
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
            placeholder="Savings account or goal"
          />
        </div>

        <RowMoneyField label="Balance" rowLabel={rowLabel} field={balance} />
        <RowMoneyField label="Monthly Contribution" rowLabel={rowLabel} field={contribution} />

        {/* Delete */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onDelete(account.id)}
            // Unique per row (AC-5): "Remove" alone would name every row's button
            // the same, and `getByRole` names are full-string.
            aria-label={rowName === '' ? 'Remove account' : `Remove ${rowName}`}
            className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
      {/* Plain text, not a live region (AC-16): it changes on every recompute. */}
      {outcome && (
        <p className="mt-3 text-sm text-body">
          {outcome.label} <GroupedAmount text={outcome.amount} />
        </p>
      )}
    </div>
  )
}

/**
 * Investment/debt Row Component (story 100.2, FR165)
 */
interface BalanceAccountRowProps {
  account: LocalBalanceAccount
  /** 1-based place in the list, so the name field is told apart even when two rows share a name. */
  position: number
  onUpdate: <K extends Exclude<keyof LocalBalanceAccount, 'id'>>(
    id: string,
    field: K,
    value: LocalBalanceAccount[K]
  ) => void
  onDelete: (id: string) => void
  /**
   * Per field, under `<rowId>:balance` / `<rowId>:contribution` (100.2 AC-9) and
   * `<rowId>:annualReturn` (story 100.3).
   */
  onValidityChange: (key: string, valid: boolean) => void
  /**
   * `After N years: <amount>`, `Paid off within N years` (a debt at 0, no
   * amount), or `null` while there is no result for this row.
   */
  outcome: { label: string; amount?: string } | null
}

function BalanceAccountRow({
  account,
  position,
  onUpdate,
  onDelete,
  onValidityChange,
  outcome,
}: BalanceAccountRowProps): React.ReactElement {
  const nameId = useId()
  const typeId = useId()
  const frequencyId = useId()
  const flagId = useId()
  const balance = useMoneyDraft(account.balance, `${account.id}:balance`, onValidityChange, (c) =>
    onUpdate(account.id, 'balance', c)
  )
  const contribution = useMoneyDraft(
    account.contribution,
    `${account.id}:contribution`,
    onValidityChange,
    (c) => onUpdate(account.id, 'contribution', c)
  )
  // Each control's accessible name carries the row, as on the savings rows.
  const rowName = account.name.trim()
  const rowLabel = rowName === '' ? 'unnamed balance' : rowName
  const isInvestment = account.type === 'investment'
  const flagLabel = isInvestment ? NOT_FROM_LEFT_OVER_LABEL : PAYMENT_IN_EXPENSES_LABEL
  const showFlag = isInvestment || !account.paidByExpenseName
  const selectClass =
    'w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm'

  return (
    <div className="surface rounded-lg p-4 shadow-sm border border-default">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        {/* Name */}
        <div className="min-w-0">
          <label htmlFor={nameId} className="block text-sm font-medium text-label mb-1">
            Name
          </label>
          <input
            id={nameId}
            type="text"
            value={account.name}
            onChange={(e) => onUpdate(account.id, 'name', e.target.value)}
            // By position, not by name: this field IS the name (100.1 review).
            aria-label={`Balance Name, row ${position}`}
            autoComplete="off"
            className={selectClass}
            placeholder="Investment or debt"
          />
        </div>

        {/* Type */}
        <div>
          <label htmlFor={typeId} className="block text-sm font-medium text-label mb-1">
            Type
          </label>
          <select
            id={typeId}
            value={account.type}
            onChange={(e) =>
              onUpdate(account.id, 'type', e.target.value === 'debt' ? 'debt' : 'investment')
            }
            aria-label={`Type for ${rowLabel}`}
            autoComplete="off"
            className={selectClass}
          >
            {BALANCE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <RowMoneyField label="Balance" rowLabel={rowLabel} field={balance} />
        <RowMoneyField label="Contribution" rowLabel={rowLabel} field={contribution} />

        {/* Frequency */}
        <div>
          <label htmlFor={frequencyId} className="block text-sm font-medium text-label mb-1">
            Frequency
          </label>
          <select
            id={frequencyId}
            value={account.frequency}
            onChange={(e) =>
              onUpdate(
                account.id,
                'frequency',
                isKnownFrequency(e.target.value) ? e.target.value : 'monthly'
              )
            }
            aria-label={`Frequency for ${rowLabel}`}
            autoComplete="off"
            className={selectClass}
          >
            {FREQUENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Annual return (story 100.3): investment rows only. Its own component,
            so switching to Debt UNMOUNTS it and withdraws its validity key (AC-10). */}
        {isInvestment && (
          <AnnualReturnField
            account={account}
            rowLabel={rowLabel}
            onUpdate={onUpdate}
            onValidityChange={onValidityChange}
          />
        )}

        {/* Delete. `md:col-start-3` keeps it in the last column when an investment
            row's seventh field (Annual return) pushes it onto a row of its own. */}
        <div className="flex justify-end md:col-start-3">
          <button
            type="button"
            onClick={() => onDelete(account.id)}
            // Unique per row (AC-8): `getByRole` names are full-string.
            aria-label={rowName === '' ? 'Remove balance' : `Remove ${rowName}`}
            className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
      {/* Story 102.2 (D6): where a seeded debt's payment came from. Debt rows
          only; kept in state while the row is an investment. `break-words` so a
          long expense name wraps at 320 px instead of scrolling. */}
      {!isInvestment && account.paidByExpenseName && (
        <p className="mt-3 text-sm text-faint break-words min-w-0">
          from Expenses: {account.paidByExpenseName}
        </p>
      )}
      {/* The one flag, labelled per type. Hidden on a debt row that carries a
          "from Expenses" label (code review 102.2, Lucas): its payment visibly is
          the row's own, and ticking it would count that payment NOWHERE (the
          expense left the Expenses rows when the row was seeded). Investment (story 45.1, as on
          `/balance`): the contribution is already out of take-home pay or an
          Expenses line, so the forecast does not take it from the money left over
          a second time. Debt (story 102.2, D2): the payment is already an
          Expenses line, so the row takes nothing from cash (100.2 D4 math). */}
      {showFlag && (
        <div className="mt-3 flex items-start gap-2">
          <input
            id={flagId}
            type="checkbox"
            checked={account.contributionRecordedAsExpense}
            onChange={(e) =>
              onUpdate(account.id, 'contributionRecordedAsExpense', e.target.checked)
            }
            aria-label={`${flagLabel}, for ${rowLabel}`}
            autoComplete="off"
            className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600"
          />
          <label htmlFor={flagId} className="text-sm text-label">
            {flagLabel}
          </label>
        </div>
      )}
      {/* Plain text, not a live region: it changes on every recompute. */}
      {outcome && (
        <p className="mt-3 text-sm text-body">
          {outcome.label}
          {outcome.amount !== undefined && (
            <>
              {' '}
              <GroupedAmount text={outcome.amount} />
            </>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * The Annual return field of one investment row (story 100.3). A component of its
 * own, not a hook call in `BalanceAccountRow`, so it mounts and unmounts with the
 * row's type: a Debt row has no field, and leaving Investment withdraws the
 * field's validity report (`useWithdrawValidityOnUnmount`), so a bad rate typed
 * before the switch never keeps Save blocked. The row keeps its last VALID rate
 * in state (D8); remounting shows it.
 */
function AnnualReturnField({
  account,
  rowLabel,
  onUpdate,
  onValidityChange,
}: {
  account: LocalBalanceAccount
  rowLabel: string
  onUpdate: BalanceAccountRowProps['onUpdate']
  onValidityChange: (key: string, valid: boolean) => void
}): React.ReactElement {
  const rate = usePercentDraft(
    account.annualReturn,
    `${account.id}:annualReturn`,
    onValidityChange,
    (r) => onUpdate(account.id, 'annualReturn', r)
  )
  return <RowPercentField label="Annual return" rowLabel={rowLabel} field={rate} />
}

/**
 * Stat Card Component
 *
 * `value` is a `formatCurrency` string and renders as a `GroupedAmount` (story
 * 88.4, FR142, D1): in the four-column grid under CI's font the seed's
 * `$310,100,483.69` (171 px at `text-lg` semibold) overran its card by 63 px
 * at 768 and 3 px at 1024, so it may break after a group separator and
 * nowhere else. Before the first forecast computes, every card shows `$0.00`
 * (no separator), so server and first client render agree.
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
        <GroupedAmount text={value} />
      </dd>
    </div>
  )
}
