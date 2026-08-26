import { type AllocationMode, solveAutomaticAllocations } from '@budget-planner/core'
import {
  currencySymbol,
  formatForInputDisplay,
  parseFromInput,
} from '@budget-planner/core/format/currency'
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { useTableSort } from '../hooks/useTableSort'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { buildSavingsChartRows, hasPlottableData } from '../lib/savings-chart-data'
import { type SavingsSortKey, createSavingsSortExtractors } from '../lib/table-sort-keys'
import {
  useExpenses,
  useIncomeSources,
  useInvestmentEntries,
  useSavingsGoals,
  useSavingsStore,
  useTotalSavings,
} from '../stores'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import { SavingsChart } from './SavingsChart'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Modal } from './ui/Modal'
import {
  FieldLabel,
  RESPONSIVE_ACTIONS_CELL_CLASS,
  RESPONSIVE_ACTIONS_GROUP_CLASS,
  RESPONSIVE_ACTION_BUTTON_CLASS,
  RESPONSIVE_CELL_CLASS,
  RESPONSIVE_HEADER_CELL_RIGHT_CLASS,
  RESPONSIVE_ROW_CLASS,
  RESPONSIVE_STACKED_CELL_CLASS,
  RESPONSIVE_TABLE_CLASS,
  RESPONSIVE_TBODY_CLASS,
  RESPONSIVE_THEAD_CLASS,
  RESPONSIVE_WRAPPER_CLASS,
} from './ui/ResponsiveTable'
import { RowMoveControls } from './ui/RowMoveControls'
import { EmptyStateSkeleton, LoadingStatus, PendingFigure } from './ui/Skeleton'
import { SortableColumnHeader, TableSortNotice } from './ui/SortableColumnHeader'

// Valid contribution cadences (mirrors the core Frequency enum). A persisted
// investment `frequency` can be a corrupt/legacy non-null string — localStorage is
// user-editable and the balance-store migrate only backfills *nullish* frequency —
// and the solver's normalizer throws on an unknown frequency. Coerce a bad value to
// 'monthly' at this boundary so it degrades instead of crashing the page, mirroring
// the Balance page's `monthlyContributionCents`.
const KNOWN_FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly', 'annually'])

/**
 * Column labels for the sortable header cells and the mobile "Sorted by
 * {Column}" notice, so the two cannot drift apart (story 34.2).
 */
const SORT_COLUMN_LABELS: Record<SavingsSortKey, string> = {
  name: 'Name',
  target: 'Target',
  currentBalance: 'Current Balance',
  monthlyAllocation: 'Monthly Allocation',
  progress: 'Progress',
}

export function SavingsPage() {
  const savingsGoals = useSavingsGoals()
  const totalSavings = useTotalSavings()
  const {
    addSavingsGoal,
    updateSavingsGoal,
    deleteSavingsGoal,
    moveSavingsGoal,
    getSavingsProgress,
  } = useSavingsStore()

  // Leftover-allocation solver inputs (Story 26.3). Read the three other stores
  // the pool depends on; investment contributions are the `type === 'investment'`
  // balance entries mapped to { amount, frequency } (the solver normalizes them).
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()
  // ⚠️ Story 43.4 (FR70) deliberately does NOT add an asset arm here. Assets
  // carry no contribution at all (D2: the form hides the field and the save path
  // writes 0), so there is nothing for the distributable pool to double-count.
  // ⚠️ That argument is FORM-DEEP only: `applyServerChanges.ts` writes pulled
  // rows into the store with no validation, and `moveBalanceEntry` bypasses it
  // too, so an asset row carrying a non-zero contribution IS reachable from sync
  // or hand-edited localStorage. It would be excluded from this filter and the
  // pool would be overstated by that amount. Pinned by the asset case in
  // `SavingsPage.test.tsx`.
  const investmentEntries = useInvestmentEntries()

  // Recompute only when an input changes. `allocations` maps each AUTOMATIC
  // account's id to its computed even-share (cents); manual accounts are absent,
  // so membership discriminates the two modes for the per-row display below.
  const { distributablePool, automaticAccountCount, allocations } = useMemo(
    () =>
      solveAutomaticAllocations({
        incomeSources,
        expenses,
        investmentContributions: investmentEntries.map((entry) => ({
          amount: entry.monthlyContribution,
          // Degrade a corrupt persisted cadence to 'monthly' rather than letting the
          // solver's validating normalizer throw during render (see KNOWN_FREQUENCIES).
          frequency: KNOWN_FREQUENCIES.has(entry.frequency) ? entry.frequency : 'monthly',
        })),
        savingsAccounts: savingsGoals,
      }),
    [incomeSources, expenses, investmentEntries, savingsGoals]
  )

  // Column sorting (story 34.2, FR61). A VIEW-level projection only: it never
  // writes `sortOrder`, never calls a move action and never enqueues a sync
  // operation, so clearing it returns the table to the manual order untouched.
  //
  // ⚠️ Memoised on `allocations` and `getSavingsProgress` as well as the rows,
  // because two of the five keys read data the row does not carry: the Monthly
  // Allocation column reads the solver's pool (which is recomputed when ANY
  // other goal changes) and Progress is a store selector. A projection memoised
  // on the rows alone would keep a stale order with no error anywhere.
  //
  // ⚠️ Neither money column is frequency-normalized. A savings balance is a
  // point-in-time STOCK, not a per-period flow — story 32.1 (FR58) settled that,
  // and `ClientSavingsGoal` has no `frequency` field to normalize by.
  const sortExtractors = useMemo(
    () => createSavingsSortExtractors(allocations, getSavingsProgress),
    [allocations, getSavingsProgress]
  )
  const sort = useTableSort(savingsGoals, sortExtractors)
  const sortedRows = sort.rows
  // ⚠️ Built from `sortedRows`, NOT `savingsGoals`: the chart must show the same
  // entries in the same order as the table beside it, so a column sort re-orders
  // both together and the two can never disagree.
  // Memoised on `sortedRows`: without this every keystroke in the Add/Edit modal
  // re-renders the page, hands `BarChart` a fresh array identity, and re-runs the
  // whole Recharts axis/rect computation while the user is only typing.
  const chartRows = useMemo(() => buildSavingsChartRows(sortedRows), [sortedRows])
  // Amounts are stored in cents; the formatter respects the user's currency
  // display preference (currency-less vs explicit symbols) from the store.
  const formatAmount = useFormattedAmount()
  // Currency preferences drive the input symbol affordance and locale-aware
  // grouping/parsing (story 14-3). Currency-less mode shows no symbol and groups
  // with the neutral en-US locale (per the store).
  const { mode, currency, locale } = useCurrencyPreferences()

  // Re-echo an amount field in grouped, locale-aware form on blur. Both guard arms
  // are load-bearing and must stay: the empty arm keeps "not filled in" from
  // becoming "entered zero", and the no-digit arm keeps the digit-free partials
  // sanitizeMoneyInput deliberately allows through (story 28-1) VISIBLE — without
  // it a half-typed "-" would silently become "0.00" under the user's cursor.
  const reformatAmountOnBlur = (value: string, setter: (v: string) => void) => {
    if (value.trim() === '' || !/\d/.test(value)) return
    setter(formatForInputDisplay(parseFromInput(value, locale), locale))
  }

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  // ids are uuid strings (Story 5-14); keep this typed as string.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  // Goal-less "savings account" toggle (Story 16-1): when true, there is no target
  // and the target field is hidden and not validated; the entry saves with targetAmount: null.
  const [isAccount, setIsAccount] = useState(false)
  const [targetAmount, setTargetAmount] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')
  // Per-account allocation (Story 26.1). 'automatic' (default) gets an even share
  // of the leftover pool (computed in Story 26.2); 'manual' holds a fixed amount.
  const [allocationMode, setAllocationMode] = useState<AllocationMode>('automatic')
  const [monthlyAllocation, setMonthlyAllocation] = useState('')

  // Inline field-validation error state (replaces browser alert() popups).
  // Mirrors the app's canonical inline-validation pattern: an errors map plus
  // hasFieldError/getFieldError helpers and re-validate-on-change after the
  // first submit attempt.
  type FieldName = 'name' | 'targetAmount' | 'currentBalance' | 'monthlyAllocation'
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const hasFieldError = (field: FieldName): boolean => Boolean(errors[field])
  const getFieldError = (field: FieldName): string | undefined => errors[field]

  // Compute inline validation errors from the current field values, preserving
  // the exact conditions and messages that previously drove the alert() popups.
  const computeErrors = useCallback((): Partial<Record<FieldName, string>> => {
    const next: Partial<Record<FieldName, string>> = {}
    if (!name.trim()) {
      next.name = 'Please enter a name for the savings goal'
    }
    // A savings account has no target, so the target check is skipped entirely.
    if (!isAccount) {
      const targetInCents = parseFromInput(targetAmount, locale)
      if (targetInCents <= 0) {
        next.targetAmount = 'Please enter a valid positive target amount'
      }
    }
    const balanceInCents = parseFromInput(currentBalance, locale)
    if (balanceInCents < 0) {
      next.currentBalance = 'Please enter a valid non-negative current balance'
    }
    // Manual allocation must be non-negative. An automatic account ignores any
    // amount, so the check is skipped entirely in automatic mode.
    if (allocationMode === 'manual') {
      const allocationInCents = parseFromInput(monthlyAllocation, locale)
      if (allocationInCents < 0) {
        next.monthlyAllocation = 'Please enter a valid non-negative monthly allocation'
      }
    }
    return next
  }, [name, isAccount, targetAmount, currentBalance, allocationMode, monthlyAllocation, locale])

  const clearErrors = () => {
    setErrors({})
    setSubmitAttempted(false)
  }

  // Reset form state when modal opens or editingId changes
  useEffect(() => {
    if (isModalOpen) {
      if (editingId === null) {
        // Adding new: reset all fields
        setName('')
        setIsAccount(false)
        setTargetAmount('')
        setCurrentBalance('')
        setAllocationMode('automatic')
        setMonthlyAllocation('')
      }
      // Editing: fields are set by openEditModal
    }
  }, [isModalOpen, editingId])

  // After the first submit attempt, re-validate as the user edits so errors
  // clear on correction (AC-3).
  useEffect(() => {
    if (submitAttempted) {
      setErrors(computeErrors())
    }
  }, [submitAttempted, computeErrors])

  // Open modal for adding new savings goal
  const openAddModal = () => {
    setEditingId(null)
    clearErrors()
    setIsModalOpen(true)
  }

  // Open modal for editing existing savings goal (or account)
  const openEditModal = (goal: {
    id: string
    name: string
    targetAmount: number | null
    currentBalance: number
    allocationMode?: AllocationMode
    monthlyAllocation?: number | null
  }) => {
    setEditingId(goal.id)
    setName(goal.name)
    // null target ⇒ account: hide the target field and leave it blank.
    const account = goal.targetAmount == null
    setIsAccount(account)
    setTargetAmount(account ? '' : formatForInputDisplay(goal.targetAmount as number, locale))
    setCurrentBalance(formatForInputDisplay(goal.currentBalance, locale))
    // Allocation (Story 26.1): default a legacy row (no mode) to 'automatic'; only
    // prefill the amount for a manual account with a stored value.
    const mode = goal.allocationMode ?? 'automatic'
    setAllocationMode(mode)
    setMonthlyAllocation(
      mode === 'manual' && goal.monthlyAllocation != null
        ? formatForInputDisplay(goal.monthlyAllocation, locale)
        : ''
    )
    clearErrors()
    setIsModalOpen(true)
  }

  // Close modal
  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setName('')
    setIsAccount(false)
    setTargetAmount('')
    setCurrentBalance('')
    setAllocationMode('automatic')
    setMonthlyAllocation('')
    clearErrors()
  }

  // Loading state to prevent duplicate submissions
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Delete confirmation state (themed dialog replaces browser confirm()). The
  // "Add" button is a stable focus target after a confirmed delete (AC-5).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const pendingDeleteName = savingsGoals.find((g) => g.id === pendingDeleteId)?.name ?? ''

  // Handle form submission (add or update)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitAttempted(true)
    setIsSubmitting(true)

    try {
      // Validate all fields inline; block submission if any errors exist.
      const validationErrors = computeErrors()
      setErrors(validationErrors)
      if (Object.keys(validationErrors).length > 0) {
        return
      }

      const newGoal = {
        name: name.trim(),
        // Account (Story 16-1): persist an absent target as null, never 0.
        targetAmount: isAccount ? null : parseFromInput(targetAmount, locale),
        currentBalance: parseFromInput(currentBalance, locale),
        // Allocation (Story 26.1): store the mode; a manual account persists its
        // fixed amount (cents), an automatic account persists null (the leftover
        // share is computed, never stored) — ignoring any stale typed value.
        allocationMode,
        monthlyAllocation:
          allocationMode === 'manual' ? parseFromInput(monthlyAllocation, locale) : null,
      }

      if (editingId !== null) {
        updateSavingsGoal(editingId, newGoal)
      } else {
        addSavingsGoal(newGoal)
      }

      closeModal()
    } finally {
      setIsSubmitting(false)
    }
  }

  // Open the themed delete confirmation for a savings goal
  const handleDelete = (id: string) => {
    setPendingDeleteId(id)
  }

  // Confirm and execute the pending delete
  const confirmDelete = () => {
    if (pendingDeleteId !== null) {
      deleteSavingsGoal(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }

  // Story 38.2 (UX-DR43): three states — pending, resolved-with-data,
  // resolved-empty. See `hooks/useStoresHydrated` for why this is a mount gate
  // and NOT `persist.hasHydrated()`.
  const hydrated = useStoresHydrated()

  return (
    <div className="surface-sunken p-4 sm:p-8 min-h-screen">
      <div className="mx-auto max-w-4xl">
        {/* Story 38.2, AC-8: ONE announced region per page. Every skeleton on
            this page is `aria-hidden`, so without this a screen reader gets a
            heading followed by nothing; one region per skeleton would announce
            several times instead. */}
        {!hydrated && <LoadingStatus />}
        <header className="mb-8">
          <div>
            <h1 className="font-bold text-heading text-3xl">Savings Goals</h1>
            <p className="mt-2 text-body">Track and manage your savings targets</p>
          </div>
        </header>

        <main className="space-y-6">
          {/* Stats Card */}
          <section className="surface shadow-md p-6 rounded-lg">
            <div className="flex md:flex-row flex-col md:justify-between md:items-center gap-4">
              {/* ⚠️ Story 32.1 (FR58) deliberately did NOT normalize this figure.
                  A savings goal has no `frequency` — `currentBalance` is a
                  point-in-time BALANCE (a stock), not a per-period FLOW like the
                  Income and Expenses totals, so re-expressing it "per week" would
                  be arithmetic on a quantity that has no period. Hence no duration
                  selector here; the sub-line says what the number is instead. */}
              <div>
                <h2 className="font-semibold text-subheading text-xl">Total Savings</h2>
                {/* ⚠️ This is the page's HEADLINE figure and it carries no
                    `data-testid`, so it was missing from story 38.2's own
                    scope table — found only because the server-response
                    assertion looks for the VALUE (`$0.00`) rather than for a
                    list of testids it already knew about. A testid-shaped
                    sweep would have shipped without it. */}
                <p className="mt-2 font-bold text-purple-600 dark:text-purple-400 text-3xl">
                  {hydrated ? (
                    formatAmount(totalSavings)
                  ) : (
                    <PendingFigure testId="savings-total-skeleton" widthClass="w-40" />
                  )}
                </p>
                <p className="mt-1 text-muted text-xs">
                  What you have saved right now — the sum of your current balances, not a per-period
                  amount.
                </p>
              </div>
              <button
                ref={addButtonRef}
                type="button"
                onClick={openAddModal}
                className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-md text-white whitespace-nowrap transition-colors"
              >
                + Add Savings Goal
              </button>
            </div>

            {/* Leftover split summary (Story 26.3). Shows the distributable pool
                and how many automatic accounts share it; a calm note covers the
                over-committed case (pool floored to 0 with automatic accounts). */}
            <div className="mt-4 pt-4 border-gray-200 dark:border-gray-700 border-t">
              {/* Story 38.2: pending → one placeholder line. This sentence is
                  entirely store-derived (the pool AND the account count), so
                  before the gate it read "$0.00/mo is left over" to a user whose
                  savings had simply not loaded. */}
              <p className="text-body text-sm" data-testid="savings-leftover-summary">
                {!hydrated ? (
                  /* ⚠️ FOUR word-shaped bars, not one `w-full` bar — and the
                     difference was MEASURED at 320px in code review. The resolved
                     content here is a SENTENCE, so it wraps: one full-width bar
                     is always exactly one line, while the resolved text is 1 line
                     at 1280px, 2 lines with data at 320px and 4 lines empty at
                     320px (20 / 40 / 80px). A single bar therefore shipped a
                     20–60px downward shift on phones.
                     Separate inline bars wrap through the SAME line-breaking the
                     text does, so the placeholder now tracks the viewport instead
                     of ignoring it. Sized to the with-data sentence (the case this
                     story exists for); the resolved-EMPTY sentence is longer still
                     and its residual is recorded in the story rather than claimed
                     away. */
                  <>
                    <PendingFigure testId="savings-leftover-summary-skeleton" widthClass="w-24" />{' '}
                    <PendingFigure widthClass="w-20" /> <PendingFigure widthClass="w-28" />{' '}
                    <PendingFigure widthClass="w-16" />
                  </>
                ) : automaticAccountCount === 0 ? (
                  <>
                    <span className="font-semibold">{formatAmount(distributablePool)}/mo</span> is
                    left over — no automatic accounts to split it. Set an account to “Automatic” to
                    divide it up.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">{formatAmount(distributablePool)}/mo</span>{' '}
                    split across {automaticAccountCount} automatic{' '}
                    {automaticAccountCount === 1 ? 'account' : 'accounts'}
                  </>
                )}
              </p>
              {distributablePool === 0 && automaticAccountCount > 0 && (
                <p className="mt-1 text-muted text-xs" data-testid="savings-overcommitted-note">
                  There’s nothing left to distribute right now — automatic accounts receive $0 until
                  your income exceeds your expenses, contributions, and fixed allocations.
                </p>
              )}
            </div>
          </section>

          {/* Savings at a Glance (Story 37.1, FR64 / UX-DR42). Sits BETWEEN the
              summary and the detail table: summary → shape → detail. */}
          <section data-testid="savings-chart-section" className="surface shadow-md p-6 rounded-lg">
            <h2 className="mb-6 font-semibold text-subheading text-xl">Savings at a Glance</h2>

            {/* ⚠️ Story 38.2 CODE REVIEW: this section was originally left
                OUT of the gate, on the stated grounds that it "already carries
                its own empty label". That reasoning was backwards — the empty
                label IS the confident empty. Pre-rehydration `savingsGoals` is the
                default `[]`, so the server served a returning user
                "Add a savings goal to see it charted here".
                MEASURED with `renderToString` against a seeded store. */}
            {!hydrated ? (
              <EmptyStateSkeleton testId="savings-chart-skeleton" lines={1} />
            ) : hasPlottableData(chartRows) ? (
              <SavingsChart
                rows={chartRows}
                formatAmount={formatAmount}
                mode={mode}
                currency={currency}
              />
            ) : (
              /* ⚠️ `text-muted` (4.83:1 on white), never `text-faint` (2.54:1 —
                 FAILS WCAG AA in light mode). Two `text-faint` hints already sit
                 on this page; do not copy the wrong neighbour. */
              <div
                data-testid="savings-chart-empty"
                className="surface-inset p-8 rounded-lg text-center"
              >
                {/* ⚠️ Two different unplottable states, two different truths. With
                    no goals at all, "add one" is the right instruction. With goals
                    that are all zero and target-less, the table below is already
                    listing them — telling that user to add a savings goal is
                    simply false, and adding a second empty one would change
                    nothing. */}
                <p className="text-muted">
                  {savingsGoals.length === 0
                    ? 'Add a savings goal to see it charted here'
                    : 'Nothing to chart yet — add a balance or a target to a savings goal'}
                </p>
              </div>
            )}
          </section>

          {/* Savings Goals List */}
          <section className="surface shadow-md p-6 rounded-lg">
            <h2 className="mb-6 font-semibold text-subheading text-xl">Your Savings Goals</h2>

            {/* Story 38.2 (UX-DR43): pending is a THIRD state. Before this gate
                the server sent a returning user "No savings goals recorded yet" — the store has not
                rehydrated, so the list is empty and the page said so with
                confidence. The skeleton mirrors this card's exact box model, so
                a user who genuinely has nothing sees no shift when it resolves. */}
            {!hydrated ? (
              <EmptyStateSkeleton testId="savings-list-skeleton" />
            ) : savingsGoals.length === 0 ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">No savings goals recorded yet</p>
                <p className="text-faint text-sm">Click "Add Savings Goal" to get started</p>
              </div>
            ) : (
              <>
                {/* The mobile escape hatch (story 34.2, decision 7): a sort can
                    only be STARTED at >= 640px but survives a narrow, where the
                    `<thead>` is `display: none` and the move arrows are
                    disabled. Rendered only when a sort exists. */}
                {sort.state !== null && (
                  <TableSortNotice
                    columnLabel={SORT_COLUMN_LABELS[sort.state.key]}
                    onClear={sort.clear}
                  />
                )}
                <div className={RESPONSIVE_WRAPPER_CLASS}>
                  <table className={RESPONSIVE_TABLE_CLASS}>
                    <thead className={RESPONSIVE_THEAD_CLASS}>
                      <tr>
                        {/* Sortable headers (story 34.2). Each `<th>`'s text
                          content stays EXACTLY the column label — the direction
                          indicator is an aria-hidden <svg>. */}
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.name}
                          ariaSort={sort.ariaSort('name')}
                          onToggle={() => sort.toggle('name')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.target}
                          ariaSort={sort.ariaSort('target')}
                          onToggle={() => sort.toggle('target')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.currentBalance}
                          ariaSort={sort.ariaSort('currentBalance')}
                          onToggle={() => sort.toggle('currentBalance')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.monthlyAllocation}
                          ariaSort={sort.ariaSort('monthlyAllocation')}
                          onToggle={() => sort.toggle('monthlyAllocation')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.progress}
                          ariaSort={sort.ariaSort('progress')}
                          onToggle={() => sort.toggle('progress')}
                        />
                        {/* Not sortable: no button, and no `aria-sort` at all
                          (`none` would advertise a sortable column). */}
                        <th className={RESPONSIVE_HEADER_CELL_RIGHT_CLASS}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className={RESPONSIVE_TBODY_CLASS}>
                      {sortedRows.map((goal, index) => {
                        // Account (Story 16-1): null target ⇒ absent progress (not 0%).
                        const isAccountRow = goal.targetAmount == null
                        const progress = getSavingsProgress(goal.id)
                        // Allocation (Story 26.3): an account is automatic iff the
                        // solver placed it in `allocations` (every automatic account
                        // is present, value may be 0); manual accounts are absent and
                        // show their stored fixed amount. (`in` rather than
                        // Object.hasOwn to stay within the tsconfig lib target; ids
                        // are uuids, so no Object.prototype key can collide.)
                        const isAutomatic = goal.id in allocations
                        // Clamp a (corrupt-data) negative manual amount to 0 so the row
                        // matches the solver, which floors manual allocations at 0.
                        const effectiveAllocation = isAutomatic
                          ? allocations[goal.id] ?? 0
                          : Math.max(0, goal.monthlyAllocation ?? 0)
                        return (
                          <tr key={goal.id} className={RESPONSIVE_ROW_CLASS}>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Name</FieldLabel>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-heading text-sm">
                                  {goal.name}
                                </span>
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium text-xs ${
                                    isAccountRow
                                      ? 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200'
                                      : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                                  }`}
                                  data-testid={`savings-badge-${goal.id}`}
                                >
                                  {isAccountRow ? 'Account' : 'Goal'}
                                </span>
                              </div>
                            </td>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Target</FieldLabel>
                              <div className="text-muted text-sm">
                                {goal.targetAmount == null
                                  ? 'No target'
                                  : formatAmount(goal.targetAmount)}
                              </div>
                            </td>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Current Balance</FieldLabel>
                              <div className="text-muted text-sm">
                                {formatAmount(goal.currentBalance)}
                              </div>
                            </td>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Monthly Allocation</FieldLabel>
                              <div className="flex items-center gap-2">
                                <span
                                  className="text-muted text-sm"
                                  data-testid={`savings-allocation-${goal.id}`}
                                >
                                  {formatAmount(effectiveAllocation)}
                                </span>
                                <span
                                  className="inline-flex items-center bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full font-medium text-gray-600 dark:text-gray-300 text-xs"
                                  data-testid={`savings-allocation-mode-${goal.id}`}
                                >
                                  {isAutomatic ? 'Auto' : 'Fixed'}
                                </span>
                              </div>
                            </td>
                            <td className={RESPONSIVE_STACKED_CELL_CLASS}>
                              {/* Stacked, not label-left/value-right: the progress
                                bar is full-width, so squeezing it beside its
                                label at 320px would leave a ~150px track. */}
                              <FieldLabel>Progress</FieldLabel>
                              {progress == null ? (
                                <div
                                  className="text-muted text-sm text-center"
                                  data-testid={`savings-progress-na-${goal.id}`}
                                >
                                  N/A
                                </div>
                              ) : (
                                <>
                                  <div className="bg-gray-200 dark:bg-gray-700 rounded-full w-full h-2">
                                    <div
                                      className="bg-purple-600 rounded-full h-2"
                                      style={{ width: `${progress}%` }}
                                    />
                                  </div>
                                  <div className="mt-1 text-muted text-xs text-center">
                                    {progress}%
                                  </div>
                                </>
                              )}
                            </td>
                            <td className={RESPONSIVE_ACTIONS_CELL_CLASS}>
                              <FieldLabel>Actions</FieldLabel>
                              <div className={RESPONSIVE_ACTIONS_GROUP_CLASS}>
                                <RowMoveControls
                                  label={goal.name}
                                  isFirst={index === 0}
                                  isLast={index === sortedRows.length - 1}
                                  disabled={sort.state !== null}
                                  onMove={(direction) => moveSavingsGoal(goal.id, direction)}
                                />
                                <button
                                  type="button"
                                  onClick={() => openEditModal(goal)}
                                  aria-label={`Edit ${goal.name}`}
                                  className={`mr-4 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(goal.id)}
                                  aria-label={`Delete ${goal.name}`}
                                  className={`text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </main>

        {/* Add/Edit Modal */}
        <Modal isOpen={isModalOpen} onClose={closeModal} labelledBy="savings-modal-title">
          <div className="flex justify-between items-center mb-6">
            <h3 id="savings-modal-title" className="font-medium text-heading text-lg">
              {editingId !== null ? 'Edit Savings Goal' : 'Add Savings Goal'}
            </h3>
            <button
              type="button"
              onClick={closeModal}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Close"
            >
              <svg
                aria-hidden="true"
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="name" className="block mb-1 font-medium text-label text-sm">
                Name *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Emergency Fund, Vacation, New Car"
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                  hasFieldError('name')
                    ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                    : 'border-gray-300 dark:border-gray-600 focus:ring-purple-500 focus:border-purple-500'
                }`}
                aria-invalid={hasFieldError('name')}
                aria-required
                aria-describedby={hasFieldError('name') ? 'savings-name-error' : undefined}
                data-testid="savings-name-input"
              />
              {hasFieldError('name') && (
                <p
                  id="savings-name-error"
                  className="mt-1 text-red-600 dark:text-red-400 text-sm"
                  role="alert"
                  data-testid="savings-name-error"
                >
                  {getFieldError('name')}
                </p>
              )}
            </div>

            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="isAccount"
                checked={isAccount}
                onChange={(e) => setIsAccount(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-2 focus:ring-purple-500"
                data-testid="savings-is-account-toggle"
              />
              <label htmlFor="isAccount" className="text-label text-sm">
                This is just an account balance (no target)
              </label>
            </div>

            {!isAccount && (
              <div>
                <label htmlFor="targetAmount" className="block mb-1 font-medium text-label text-sm">
                  Target Amount *
                </label>
                <div className="relative shadow-sm rounded-md">
                  {mode === 'symbol' && (
                    <div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
                      <span className="text-muted text-sm">{currencySymbol(currency)}</span>
                    </div>
                  )}
                  <input
                    type="text"
                    inputMode="decimal"
                    id="targetAmount"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(sanitizeMoneyChange(e.target, locale))}
                    onBlur={(e) => reformatAmountOnBlur(e.target.value, setTargetAmount)}
                    placeholder="0.00"
                    className={`w-full px-3 py-2 ${
                      mode === 'symbol' ? 'pl-7' : ''
                    } border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                      hasFieldError('targetAmount')
                        ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 dark:border-gray-600 focus:ring-purple-500 focus:border-purple-500'
                    }`}
                    aria-invalid={hasFieldError('targetAmount')}
                    aria-required
                    aria-describedby={
                      hasFieldError('targetAmount') ? 'savings-target-amount-error' : undefined
                    }
                    data-testid="savings-target-amount-input"
                  />
                </div>
                {hasFieldError('targetAmount') && (
                  <p
                    id="savings-target-amount-error"
                    className="mt-1 text-red-600 dark:text-red-400 text-sm"
                    role="alert"
                    data-testid="savings-target-amount-error"
                  >
                    {getFieldError('targetAmount')}
                  </p>
                )}
              </div>
            )}

            <div>
              <label htmlFor="currentBalance" className="block mb-1 font-medium text-label text-sm">
                Current Balance
              </label>
              <div className="relative shadow-sm rounded-md">
                {mode === 'symbol' && (
                  <div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
                    <span className="text-muted text-sm">{currencySymbol(currency)}</span>
                  </div>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  id="currentBalance"
                  value={currentBalance}
                  onChange={(e) => setCurrentBalance(sanitizeMoneyChange(e.target, locale))}
                  onBlur={(e) => reformatAmountOnBlur(e.target.value, setCurrentBalance)}
                  placeholder="0.00"
                  className={`w-full px-3 py-2 ${
                    mode === 'symbol' ? 'pl-7' : ''
                  } border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                    hasFieldError('currentBalance')
                      ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                      : 'border-gray-300 dark:border-gray-600 focus:ring-purple-500 focus:border-purple-500'
                  }`}
                  aria-invalid={hasFieldError('currentBalance')}
                  aria-describedby={
                    hasFieldError('currentBalance') ? 'savings-current-balance-error' : undefined
                  }
                  data-testid="savings-current-balance-input"
                />
              </div>
              {hasFieldError('currentBalance') && (
                <p
                  id="savings-current-balance-error"
                  className="mt-1 text-red-600 dark:text-red-400 text-sm"
                  role="alert"
                  data-testid="savings-current-balance-error"
                >
                  {getFieldError('currentBalance')}
                </p>
              )}
            </div>

            {/* Monthly allocation mode (Story 26.1) */}
            <div>
              <label htmlFor="allocationMode" className="block mb-1 font-medium text-label text-sm">
                Monthly Allocation
              </label>
              <select
                id="allocationMode"
                value={allocationMode}
                onChange={(e) => setAllocationMode(e.target.value as AllocationMode)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
                data-testid="savings-allocation-mode-select"
              >
                <option value="automatic">Automatic (even share of leftover funds)</option>
                <option value="manual">Manual (a fixed amount each month)</option>
              </select>
              <p className="mt-1 text-faint text-xs">
                {allocationMode === 'automatic'
                  ? 'This account receives an even share of whatever is left over each month.'
                  : 'This account gets the fixed amount you set below each month.'}
              </p>
            </div>

            {allocationMode === 'manual' && (
              <div>
                <label
                  htmlFor="monthlyAllocation"
                  className="block mb-1 font-medium text-label text-sm"
                >
                  Monthly Allocation Amount
                </label>
                <div className="relative shadow-sm rounded-md">
                  {mode === 'symbol' && (
                    <div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
                      <span className="text-muted text-sm">{currencySymbol(currency)}</span>
                    </div>
                  )}
                  <input
                    type="text"
                    inputMode="decimal"
                    id="monthlyAllocation"
                    value={monthlyAllocation}
                    onChange={(e) => setMonthlyAllocation(sanitizeMoneyChange(e.target, locale))}
                    onBlur={(e) => reformatAmountOnBlur(e.target.value, setMonthlyAllocation)}
                    placeholder="0.00"
                    className={`w-full px-3 py-2 ${
                      mode === 'symbol' ? 'pl-7' : ''
                    } border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                      hasFieldError('monthlyAllocation')
                        ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 dark:border-gray-600 focus:ring-purple-500 focus:border-purple-500'
                    }`}
                    aria-invalid={hasFieldError('monthlyAllocation')}
                    aria-describedby={
                      hasFieldError('monthlyAllocation')
                        ? 'savings-monthly-allocation-error'
                        : undefined
                    }
                    data-testid="savings-monthly-allocation-input"
                  />
                </div>
                {hasFieldError('monthlyAllocation') && (
                  <p
                    id="savings-monthly-allocation-error"
                    className="mt-1 text-red-600 dark:text-red-400 text-sm"
                    role="alert"
                    data-testid="savings-monthly-allocation-error"
                  >
                    {getFieldError('monthlyAllocation')}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={closeModal}
                className="hover:bg-gray-50 dark:hover:bg-gray-700 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-4 py-2 rounded-md text-white disabled:cursor-not-allowed"
              >
                {isSubmitting
                  ? 'Saving...'
                  : editingId !== null
                    ? 'Save Changes'
                    : 'Add Savings Goal'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Delete confirmation */}
        <ConfirmDialog
          isOpen={pendingDeleteId !== null}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDeleteId(null)}
          finalFocusRef={addButtonRef}
          message={
            <>
              Are you sure you want to delete
              {pendingDeleteName ? ` "${pendingDeleteName}"` : ' this savings goal'}? This cannot be
              undone.
            </>
          }
        />
      </div>
    </div>
  )
}
