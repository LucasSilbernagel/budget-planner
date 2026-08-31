import {
  currencySymbol,
  formatForInputDisplay,
  parseFromInput,
} from '@budget-planner/core/format/currency'
import type { Frequency } from '@budget-planner/db'
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useCategoryNameMap } from '../hooks/useCategoryLabels'
import { usePremiumAccess } from '../hooks/usePremiumAccess'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { useTableSort } from '../hooks/useTableSort'
import { summarizeReadableRows } from '../lib/readable-rows'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { type FlowSortKey, createFlowSortExtractors } from '../lib/table-sort-keys'
import { useExpenseStore, useExpenses, useTotalExpenses } from '../stores'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import { CategoryBadge } from './categories/CategoryBadge'
import { CategoryPicker } from './categories/CategoryPicker'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Modal } from './ui/Modal'
import { PeriodTotal } from './ui/PeriodTotal'
import {
  FieldLabel,
  RESPONSIVE_ACTIONS_CELL_CLASS,
  RESPONSIVE_ACTIONS_GROUP_CLASS,
  RESPONSIVE_ACTION_BUTTON_CLASS,
  RESPONSIVE_CELL_CLASS,
  RESPONSIVE_HEADER_CELL_RIGHT_CLASS,
  RESPONSIVE_ROW_CLASS,
  RESPONSIVE_SCROLL_SHADOW_CLASS,
  RESPONSIVE_TABLE_CLASS,
  RESPONSIVE_TBODY_CLASS,
  RESPONSIVE_THEAD_CLASS,
  RESPONSIVE_WRAPPER_CLASS,
} from './ui/ResponsiveTable'
import { EmptyStateSkeleton, LoadingStatus } from './ui/Skeleton'
import { SortableColumnHeader } from './ui/SortableColumnHeader'
import { TableSortControl } from './ui/TableSortControl'

// Frequency options for the select dropdown
const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
]

/**
 * Column labels for the sortable header cells and for the mobile sort control's
 * options, so the two can never drift apart (story 34.2; the mobile consumer
 * became `TableSortControl` in story 48.1).
 * Module scope, like every other component and constant in this layer.
 */
const SORT_COLUMN_LABELS: Record<FlowSortKey, string> = {
  name: 'Name',
  amount: 'Amount',
  frequency: 'Frequency',
  category: 'Category',
}

export function ExpensesPage() {
  const expenses = useExpenses()
  // Amounts are stored in cents; the formatter respects the user's currency
  // display preference (currency-less vs explicit symbols) from the store.
  const formatAmount = useFormattedAmount()
  // Rows store a category uuid, never a name (story 30.4b). Resolving here
  // means a rename is reflected in this table with no per-row edit.
  //
  // ⚠️ Called UNCONDITIONALLY, deliberately. Gating this behind the tier check
  // would be a conditional hook call. It is a pure `useCategoryStore` read plus
  // a `useMemo` — no network — so the cost on the free path is a wasted empty
  // Map, not a request.
  const categoryNames = useCategoryNameMap()
  // The Category column is Premium-only (story 33.3, FR57). Before this story it
  // always rendered, showing an em-dash for every free-tier row — advertising a
  // feature as a permanently empty column instead of a locked, discoverable one.
  //
  // ⚠️ `status.hasAccess` ALONE is the whole gate; do NOT write
  // `!status.isLoading && status.hasAccess`.
  //
  // On the INITIAL unresolved state — the only unresolved state either page can
  // reach, since neither calls `refresh()` — `hasAccess` is already `false`, as
  // are the errored, free, past_due, canceled and signed-out states. So the
  // `!isLoading` term buys nothing here.
  //
  // It would also be actively worse. `checkAccess()` sets `isLoading: true`
  // while PRESERVING the previous `hasAccess` (`usePremiumAccess.ts:119`), so
  // for an already-entitled user a re-check makes the state
  // `{isLoading: true, hasAccess: true}` — which the `!isLoading &&` form would
  // render as NO column, ripping it out mid-session. That state is unreachable
  // from these two pages today; the point is that `hasAccess` alone stays
  // correct if `refresh()` is ever wired in, and the two-term form does not.
  //
  // Consequence, stated rather than hidden: within a mount this gate is
  // MONOTONE — the column can appear once (when a no-seed check resolves
  // entitled) but can never disappear. On the seeded path production actually
  // serves it never changes at all. See `deferred-work.md` for the measured
  // no-seed late-appearance.
  //
  // ⚠️ This must stay CONDITIONAL JSX, never a CSS `hidden` class. `max-sm:` is
  // a WIDTH query evaluated against the PAPER width when printing (Letter/A4
  // both land above the 640px `sm` breakpoint), so a class-based hide would leak
  // the column onto printed output. DOM absence carries through to print for
  // free.
  const { status: premiumStatus } = usePremiumAccess()
  const showCategoryColumn = premiumStatus.hasAccess

  // Column sorting (story 34.2, FR61). A VIEW-level projection: it never writes
  // `sortOrder` and never enqueues a sync operation, so clearing it returns the
  // table to the default order untouched.
  //
  // ⚠️ The extractors are memoised on `categoryNames` because the Category key
  // resolves a uuid through that map: renaming a category must re-sort this
  // table even though no row changed. A projection memoised only on the rows
  // would keep the stale order with no error anywhere.
  const sortExtractors = useMemo(
    () => createFlowSortExtractors(categoryNames, showCategoryColumn),
    [categoryNames, showCategoryColumn]
  )

  /**
   * The sortable columns offered by the mobile control (story 48.1), in header
   * order.
   *
   * ⚠️⚠️ GATED ON `showCategoryColumn` — THE SAME EXPRESSION THE `<th>` USES,
   * and not on `Object.entries(SORT_COLUMN_LABELS)`, which always contains
   * `category`. `createFlowSortExtractors` OMITS the Category extractor for an
   * unentitled user, so a Category option offered to a free user would write
   * `{ key: 'category' }` to storage and `useTableSort`'s `effectiveState`
   * would immediately degrade it back to manual order: a control that visibly
   * does nothing, with no error anywhere to say why.
   */
  const sortColumns = useMemo<readonly { key: FlowSortKey; label: string }[]>(
    () => [
      { key: 'name', label: SORT_COLUMN_LABELS.name },
      { key: 'amount', label: SORT_COLUMN_LABELS.amount },
      { key: 'frequency', label: SORT_COLUMN_LABELS.frequency },
      ...(showCategoryColumn
        ? [{ key: 'category' as const, label: SORT_COLUMN_LABELS.category }]
        : []),
    ],
    [showCategoryColumn]
  )
  const sort = useTableSort('expenses', expenses, sortExtractors)
  const sortedRows = sort.rows
  // Currency preferences drive the input's symbol affordance and locale-aware
  // grouping/parsing (story 14-3). In currency-less mode no symbol is shown and
  // grouping uses the neutral en-US locale (per the store).
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
  // Monthly-normalized cents (story 32.1) — `PeriodTotal` denormalizes it to the
  // selected period. `summarizeReadableRows` supplies the disclosure inputs from
  // READABLE rows only: a raw total that never quotes excluded money, and a
  // `conversionApplied` flag that asks whether conversion happened rather than
  // inferring it from two totals being unequal (code review 32.1).
  const totalExpenses = useTotalExpenses()
  const {
    rawTotalCents: rawTotalExpenses,
    unreadableCount: unreadableExpenseCount,
    conversionApplied,
  } = summarizeReadableRows(expenses)
  const { addExpense, updateExpense, deleteExpense } = useExpenseStore()

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  // ⚠️ `string`, not `number`. `ClientExpense.id` has been a client-generated uuid
  // since story 5-14; this state and `openEditModal` below kept the pre-uuid
  // `number` typing, so `updateExpense(editingId, …)` — whose store signature is
  // `(id: string, …)` — was a type error that only `any`-adjacent slack hid.
  // Runtime was always correct: JS passed the uuid straight through.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('monthly')
  // `null` is a first-class, always-valid value here (AC-1): leaving a row
  // uncategorized must stay possible, so this field is never `required`.
  const [categoryId, setCategoryId] = useState<string | null>(null)

  // Inline field-validation error state (replaces browser alert() popups).
  // Mirrors the app's canonical inline-validation pattern: an errors map plus
  // hasFieldError/getFieldError helpers and re-validate-on-change after the
  // first submit attempt.
  type FieldName = 'name' | 'amount'
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const hasFieldError = (field: FieldName): boolean => Boolean(errors[field])
  const getFieldError = (field: FieldName): string | undefined => errors[field]

  // Compute inline validation errors from the current field values, preserving
  // the exact conditions and messages that previously drove the alert() popups.
  const computeErrors = useCallback((): Partial<Record<FieldName, string>> => {
    const next: Partial<Record<FieldName, string>> = {}
    if (!name.trim()) {
      next.name = 'Please enter a name for the expense'
    }
    const amountInCents = parseFromInput(amount, locale)
    if (amountInCents <= 0) {
      next.amount = 'Please enter a valid positive amount'
    }
    return next
  }, [name, amount, locale])

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
        setAmount('')
        setFrequency('monthly')
        setCategoryId(null)
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

  // Open modal for adding new expense
  const openAddModal = () => {
    setEditingId(null)
    clearErrors()
    setIsModalOpen(true)
  }

  // Open modal for editing existing expense
  const openEditModal = (source: {
    id: string
    name: string
    amount: number
    frequency: Frequency
    categoryId?: string | null
  }) => {
    setEditingId(source.id)
    setName(source.name)
    // Seed the field the same way the blur re-echo does, so an edit opens on a
    // grouped, locale-aware value the locale-aware parser reads back identically.
    // A bare `.toString()` emits ungrouped en-US-shaped text (and can produce
    // scientific notation or long float tails) that a comma-decimal locale misreads.
    setAmount(formatForInputDisplay(source.amount, locale))
    setFrequency(source.frequency)
    // ⚠️ Load-bearing (code review 30.4b). `closeModal` always resets this to
    // null, so without seeding it here the edit form opens on "Uncategorized"
    // for a categorized row and `handleSubmit` — which sends `categoryId`
    // unconditionally — writes null back. Editing an amount would silently
    // destroy the row's category, with the picker showing no sign of it.
    setCategoryId(source.categoryId ?? null)
    clearErrors()
    setIsModalOpen(true)
  }

  // Close modal
  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setName('')
    setAmount('')
    setFrequency('monthly')
    setCategoryId(null)
    clearErrors()
  }

  // Loading state to prevent duplicate submissions
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Delete confirmation state (themed dialog replaces browser confirm()). The
  // "Add" button is a stable focus target after a confirmed delete (AC-5).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const pendingDeleteName = expenses.find((e) => e.id === pendingDeleteId)?.name ?? ''

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

      const newExpense = {
        name: name.trim(),
        amount: parseFromInput(amount, locale),
        frequency,
        categoryId,
      }

      if (editingId !== null) {
        updateExpense(editingId, newExpense)
      } else {
        addExpense(newExpense)
      }

      closeModal()
    } finally {
      setIsSubmitting(false)
    }
  }

  // Open the themed delete confirmation for an expense
  const handleDelete = (id: string) => {
    setPendingDeleteId(id)
  }

  // Confirm and execute the pending delete
  const confirmDelete = () => {
    if (pendingDeleteId !== null) {
      deleteExpense(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }

  // Story 38.2 (UX-DR43): three states — pending, resolved-with-data,
  // resolved-empty. See `hooks/useStoresHydrated` for why this is a mount gate
  // and NOT `persist.hasHydrated()`.
  const hydrated = useStoresHydrated()

  return (
    <div className="min-h-screen surface-sunken p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Story 38.2, AC-8: ONE announced region per page. Every skeleton on
            this page is `aria-hidden`, so without this a screen reader gets a
            heading followed by nothing; one region per skeleton would announce
            several times instead. */}
        {!hydrated && <LoadingStatus />}
        <header className="mb-8">
          <div>
            <h1 className="text-3xl font-bold text-heading">Expenses</h1>
            <p className="text-body mt-2">Track and categorize your spending</p>
          </div>
        </header>

        <main className="space-y-6">
          {/* Stats Card */}
          <section className="surface rounded-lg shadow-md p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              {/* Story 32.1 (FR58): this figure used to be a raw sum of amounts
                  across mixed frequencies, so it disagreed with the Overview on
                  the same data. It is now the store's monthly-normalized total,
                  re-expressed at the shared app-wide duration. */}
              <PeriodTotal
                label="Total Expenses"
                monthlyTotalCents={totalExpenses}
                rawTotalCents={rawTotalExpenses}
                conversionApplied={conversionApplied}
                unreadableCount={unreadableExpenseCount}
                amountClassName="text-red-600 dark:text-red-400 mt-2"
                tooltipLabel="More information about the expenses figure"
                selectorLabel="Show expenses per"
              />
              <button
                ref={addButtonRef}
                type="button"
                onClick={openAddModal}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors whitespace-nowrap"
              >
                + Add Expense
              </button>
            </div>
          </section>

          {/* Expenses List */}
          <section className="surface rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-subheading mb-6">Your Expenses</h2>

            {/* Story 38.2 (UX-DR43): pending is a THIRD state. Before this gate
                the server sent a returning user "No expenses recorded yet" — the store has not
                rehydrated, so the list is empty and the page said so with
                confidence. The skeleton mirrors this card's exact box model, so
                a user who genuinely has nothing sees no shift when it resolves. */}
            {!hydrated ? (
              <EmptyStateSkeleton testId="expenses-list-skeleton" />
            ) : expenses.length === 0 ? (
              <div className="surface-inset rounded-lg p-8 text-center">
                <p className="text-muted mb-4">No expenses recorded yet</p>
                <p className="text-sm text-faint">Click "Add Expense" to get started</p>
              </div>
            ) : (
              <>
                {/* The mobile sort control (story 48.1, UX-DR53).

                    ⚠️ This REPLACES `TableSortNotice`, and it renders
                    UNCONDITIONALLY where the notice rendered only while a sort
                    was active. Story 34.2's ratified decision 1 scoped sorting
                    to >= 640px because the `<thead>` is `display: none` below
                    `sm`, so the notice could only ever EXPLAIN and ESCAPE a sort
                    a desktop interaction had already started. This control is
                    the first affordance that can START one on a phone, and
                    manual order is precisely the state it has to be reachable
                    in. `deferred-work.md`'s "Sorting cannot be STARTED below
                    640px" is closed by this story.

                    It drives `sort.select`, the same store slice the headers
                    drive through `sort.toggle` — one source of truth, so a sort
                    chosen on a phone and one chosen on a desktop cannot
                    disagree, and it persists exactly as a header click does. */}
                <TableSortControl
                  label="Sort expenses"
                  columns={sortColumns}
                  state={sort.state}
                  onSelect={sort.select}
                />
                {/* Story 42.2 (UX-DR46): the wrapper is a scrollable REGION, not just a
                    scroll container. `tabindex`/`role`/`aria-label` are unconditional —
                    a region named for its table is meaningful whether or not it happens
                    to be scrolling right now, and making them conditional would need a
                    measurement this layer deliberately does not take. */}
                {/* ⚠️ The suppression below is load-bearing, and its AUTOFIX IS THE HAZARD:
                    biome would DELETE this tabIndex, silently removing the only keyboard
                    route to the Actions column when the table overflows. A scrollable
                    region must be a focus stop (WCAG 2.1.1); the rule does not model
                    scroll containers. role=region + aria-label is the paired carve-out. */}
                <div
                  className={`${RESPONSIVE_WRAPPER_CLASS} ${RESPONSIVE_SCROLL_SHADOW_CLASS}`}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region needs a focus stop (WCAG 2.1.1) — see the comment above; the autofix would remove keyboard access
                  tabIndex={0}
                  role="region"
                  aria-label="Expenses table"
                >
                  <table className={RESPONSIVE_TABLE_CLASS}>
                    <thead className={RESPONSIVE_THEAD_CLASS}>
                      <tr>
                        {/* Sortable headers (story 34.2). Each `<th>`'s text
                          content stays EXACTLY the column label — the direction
                          indicator is an aria-hidden <svg> — because
                          `category-assignment.test.tsx` pins these as an exact
                          array on both pages. */}
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.name}
                          ariaSort={sort.ariaSort('name')}
                          onToggle={() => sort.toggle('name')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.amount}
                          ariaSort={sort.ariaSort('amount')}
                          onToggle={() => sort.toggle('amount')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.frequency}
                          ariaSort={sort.ariaSort('frequency')}
                          onToggle={() => sort.toggle('frequency')}
                        />
                        {/* Premium-only (story 33.3). Gated on the SAME expression
                          as the matching <td> below — if the two ever disagree
                          every column shifts at >= 640px. Story 34.2 reuses that
                          one identifier for the sort target too, so a column a
                          free user cannot see is not offered as a sort key. */}
                        {showCategoryColumn && (
                          <SortableColumnHeader
                            label={SORT_COLUMN_LABELS.category}
                            ariaSort={sort.ariaSort('category')}
                            onToggle={() => sort.toggle('category')}
                          />
                        )}
                        {/* Not sortable: no button, and no `aria-sort` at all
                          (`none` would advertise a sortable column). */}
                        <th className={RESPONSIVE_HEADER_CELL_RIGHT_CLASS}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className={RESPONSIVE_TBODY_CLASS}>
                      {sortedRows.map((expense) => (
                        <tr key={expense.id} className={RESPONSIVE_ROW_CLASS}>
                          <td className={RESPONSIVE_CELL_CLASS}>
                            <FieldLabel>Name</FieldLabel>
                            <div className="text-sm font-medium text-heading">{expense.name}</div>
                          </td>
                          <td className={RESPONSIVE_CELL_CLASS}>
                            <FieldLabel>Amount</FieldLabel>
                            <div className="text-sm text-muted">{formatAmount(expense.amount)}</div>
                          </td>
                          <td className={RESPONSIVE_CELL_CLASS}>
                            <FieldLabel>Frequency</FieldLabel>
                            <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                              {expense.frequency}
                            </span>
                          </td>
                          {/* Removing this <td> removes the desktop cell AND the
                            mobile card field in one edit — below `sm` the same
                            cell becomes the labelled row via <FieldLabel>. */}
                          {showCategoryColumn && (
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Category</FieldLabel>
                              <CategoryBadge
                                categoryId={expense.categoryId}
                                names={categoryNames}
                                idPrefix="expense"
                              />
                            </td>
                          )}
                          <td className={RESPONSIVE_ACTIONS_CELL_CLASS}>
                            <FieldLabel>Actions</FieldLabel>
                            <div className={RESPONSIVE_ACTIONS_GROUP_CLASS}>
                              <button
                                type="button"
                                onClick={() => openEditModal(expense)}
                                aria-label={`Edit ${expense.name}`}
                                className={`text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 mr-4 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(expense.id)}
                                aria-label={`Delete ${expense.name}`}
                                className={`text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </main>

        {/* Add/Edit Modal */}
        <Modal isOpen={isModalOpen} onClose={closeModal} labelledBy="expense-modal-title">
          <div className="flex justify-between items-center mb-6">
            <h3 id="expense-modal-title" className="text-lg font-medium text-heading">
              {editingId !== null ? 'Edit Expense' : 'Add Expense'}
            </h3>
            <button
              type="button"
              onClick={closeModal}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Close"
            >
              <svg
                aria-hidden="true"
                className="h-6 w-6"
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
              <label htmlFor="name" className="block text-sm font-medium text-label mb-1">
                Name *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Rent, Groceries, Utilities"
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                  hasFieldError('name')
                    ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                    : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
                }`}
                aria-invalid={hasFieldError('name')}
                aria-required
                aria-describedby={hasFieldError('name') ? 'expense-name-error' : undefined}
                data-testid="expense-name-input"
              />
              {hasFieldError('name') && (
                <p
                  id="expense-name-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="expense-name-error"
                >
                  {getFieldError('name')}
                </p>
              )}
              {/* Story 36.3 (UX-DR40). A mortgage is the one entry that belongs
                  in two places at once: the payment is an expense, the amount
                  still owed is a Debt on the Balance Tracking page. Plain prose, not a
                  `<Link>` — this page is rendered without a router in three test
                  suites, and a hint is not worth rewiring them. Not wired via
                  `aria-describedby` either: every such attribute in this app is
                  a single id, and joining one here breaks an exact-match
                  assertion. `text-muted` (not `text-faint`) because gray-400 on
                  the white modal card measures 2.54:1, below WCAG AA. */}
              <p className="mt-1 text-xs text-muted" data-testid="expense-mortgage-hint">
                Paying off a loan or mortgage? Enter the payment here, and the amount still owed on
                the Balance Tracking page.
              </p>
            </div>

            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-label mb-1">
                Amount *
              </label>
              <div className="relative rounded-md shadow-sm">
                {mode === 'symbol' && (
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-muted text-sm">{currencySymbol(currency)}</span>
                  </div>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  id="amount"
                  value={amount}
                  onChange={(e) => setAmount(sanitizeMoneyChange(e.target, locale))}
                  onBlur={(e) => reformatAmountOnBlur(e.target.value, setAmount)}
                  placeholder="0.00"
                  className={`w-full px-3 py-2 ${
                    mode === 'symbol' ? 'pl-7' : ''
                  } border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                    hasFieldError('amount')
                      ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                      : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
                  }`}
                  aria-invalid={hasFieldError('amount')}
                  aria-required
                  aria-describedby={hasFieldError('amount') ? 'expense-amount-error' : undefined}
                  data-testid="expense-amount-input"
                />
              </div>
              {hasFieldError('amount') && (
                <p
                  id="expense-amount-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="expense-amount-error"
                >
                  {getFieldError('amount')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="frequency" className="block text-sm font-medium text-label mb-1">
                Frequency *
              </label>
              <select
                id="frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <CategoryPicker
              kind="expense"
              value={categoryId}
              onChange={setCategoryId}
              idPrefix="expense"
            />

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Saving...' : editingId !== null ? 'Save Changes' : 'Add Expense'}
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
              {pendingDeleteName ? ` "${pendingDeleteName}"` : ' this expense'}? This cannot be
              undone.
            </>
          }
        />
      </div>
    </div>
  )
}
