import {
  currencySymbol,
  formatForInputDisplay,
  parseFromInput,
} from '@budget-planner/core/format/currency'
import type { Frequency } from '@budget-planner/db'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useCategoryNameMap } from '../hooks/useCategoryLabels'
import { usePremiumAccess } from '../hooks/usePremiumAccess'
import { summarizeReadableRows } from '../lib/readable-rows'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { useIncomeSources, useIncomeStore, useTotalIncome } from '../stores'
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
  RESPONSIVE_ROW_CLASS,
  RESPONSIVE_TABLE_CLASS,
  RESPONSIVE_TBODY_CLASS,
  RESPONSIVE_THEAD_CLASS,
  RESPONSIVE_WRAPPER_CLASS,
} from './ui/ResponsiveTable'

// Frequency options for the select dropdown
const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
]

export function IncomePage() {
  const incomeSources = useIncomeSources()
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
  const totalIncome = useTotalIncome()
  const {
    rawTotalCents: rawTotalIncome,
    unreadableCount: unreadableIncomeCount,
    conversionApplied,
  } = summarizeReadableRows(incomeSources)
  const { addIncomeSource, updateIncomeSource, deleteIncomeSource } = useIncomeStore()

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
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
      next.name = 'Please enter a name for the income source'
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

  // Open modal for adding new income source
  const openAddModal = () => {
    setEditingId(null)
    clearErrors()
    setIsModalOpen(true)
  }

  // Open modal for editing existing income source
  const openEditModal = (source: {
    id: string
    name: string
    amount: number
    frequency: Frequency
    // Widened for the new field only — `id` is deliberately untouched (AC-10).
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
    // ⚠️ LOAD-BEARING (story 30.4b review; the same warning ExpensesPage carries).
    // Seeding from the row is what makes an edit round-trip the category rather
    // than destroy it. Since story 33.3 a non-entitled user cannot SEE this
    // value, so dropping it here would silently wipe a lapsed premium user's
    // assignment with nothing on screen to reveal it. Pinned by the
    // "preserves a lapsed user's category" tests in category-assignment.test.tsx.
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

  // Delete confirmation state. Holds the id pending deletion (themed dialog
  // replaces the old browser confirm()). The "Add" button is a stable focus
  // target after a confirmed delete removes the triggering row (AC-5).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const pendingDeleteName = incomeSources.find((s) => s.id === pendingDeleteId)?.name ?? ''

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

      const newSource = {
        name: name.trim(),
        amount: parseFromInput(amount, locale),
        frequency,
        categoryId,
      }

      if (editingId !== null) {
        updateIncomeSource(editingId, newSource)
      } else {
        addIncomeSource(newSource)
      }

      closeModal()
    } finally {
      setIsSubmitting(false)
    }
  }

  // Open the themed delete confirmation for an income source
  const handleDelete = (id: string) => {
    setPendingDeleteId(id)
  }

  // Confirm and execute the pending delete
  const confirmDelete = () => {
    if (pendingDeleteId !== null) {
      deleteIncomeSource(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }

  return (
    <div className="min-h-screen surface-sunken p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <div>
            <h1 className="text-3xl font-bold text-heading">Income Sources</h1>
            <p className="text-body mt-2">Manage your income streams and track your earnings</p>
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
                label="Total Income"
                monthlyTotalCents={totalIncome}
                rawTotalCents={rawTotalIncome}
                conversionApplied={conversionApplied}
                unreadableCount={unreadableIncomeCount}
                amountClassName="text-green-600 dark:text-green-400 mt-2"
                tooltipLabel="More information about the income figure"
                selectorLabel="Show income per"
              />
              <button
                ref={addButtonRef}
                type="button"
                onClick={openAddModal}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors whitespace-nowrap"
              >
                + Add Income Source
              </button>
            </div>
          </section>

          {/* Income Sources List */}
          <section className="surface rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-subheading mb-6">Your Income Sources</h2>

            {incomeSources.length === 0 ? (
              <div className="surface-inset rounded-lg p-8 text-center">
                <p className="text-muted mb-4">No income sources yet</p>
                <p className="text-sm text-faint">Click "Add Income Source" to get started</p>
              </div>
            ) : (
              <div className={RESPONSIVE_WRAPPER_CLASS}>
                <table className={RESPONSIVE_TABLE_CLASS}>
                  <thead className={RESPONSIVE_THEAD_CLASS}>
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                        Frequency
                      </th>
                      {/* Premium-only (story 33.3). Gated on the SAME expression
                          as the matching <td> below — if the two ever disagree
                          every column shifts at >= 640px. */}
                      {showCategoryColumn && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                          Category
                        </th>
                      )}
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className={RESPONSIVE_TBODY_CLASS}>
                    {incomeSources.map((source) => (
                      <tr key={source.id} className={RESPONSIVE_ROW_CLASS}>
                        <td className={RESPONSIVE_CELL_CLASS}>
                          <FieldLabel>Name</FieldLabel>
                          <div className="text-sm font-medium text-heading">{source.name}</div>
                        </td>
                        <td className={RESPONSIVE_CELL_CLASS}>
                          <FieldLabel>Amount</FieldLabel>
                          <div className="text-sm text-muted">{formatAmount(source.amount)}</div>
                        </td>
                        <td className={RESPONSIVE_CELL_CLASS}>
                          <FieldLabel>Frequency</FieldLabel>
                          <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                            {source.frequency}
                          </span>
                        </td>
                        {/* Removing this <td> removes the desktop cell AND the
                            mobile card field in one edit — below `sm` the same
                            cell becomes the labelled row via <FieldLabel>. */}
                        {showCategoryColumn && (
                          <td className={RESPONSIVE_CELL_CLASS}>
                            <FieldLabel>Category</FieldLabel>
                            <CategoryBadge
                              categoryId={source.categoryId}
                              names={categoryNames}
                              idPrefix="income"
                            />
                          </td>
                        )}
                        <td className={RESPONSIVE_ACTIONS_CELL_CLASS}>
                          <FieldLabel>Actions</FieldLabel>
                          <div className={RESPONSIVE_ACTIONS_GROUP_CLASS}>
                            <button
                              type="button"
                              onClick={() => openEditModal(source)}
                              aria-label={`Edit ${source.name}`}
                              className={`text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 mr-4 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(source.id)}
                              aria-label={`Delete ${source.name}`}
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
            )}
          </section>
        </main>

        {/* Add/Edit Modal */}
        <Modal isOpen={isModalOpen} onClose={closeModal} labelledBy="income-modal-title">
          <div className="flex justify-between items-center mb-6">
            <h3 id="income-modal-title" className="text-lg font-medium text-heading">
              {editingId !== null ? 'Edit Income Source' : 'Add Income Source'}
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
                placeholder="e.g., Salary, Freelance, Investment"
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                  hasFieldError('name')
                    ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                    : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
                }`}
                aria-invalid={hasFieldError('name')}
                aria-required
                aria-describedby={hasFieldError('name') ? 'income-name-error' : undefined}
                data-testid="income-name-input"
              />
              {hasFieldError('name') && (
                <p
                  id="income-name-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="income-name-error"
                >
                  {getFieldError('name')}
                </p>
              )}
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
                  aria-describedby={hasFieldError('amount') ? 'income-amount-error' : undefined}
                  data-testid="income-amount-input"
                />
              </div>
              {hasFieldError('amount') && (
                <p
                  id="income-amount-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="income-amount-error"
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
              kind="income"
              value={categoryId}
              onChange={setCategoryId}
              idPrefix="income"
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
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting
                  ? 'Saving...'
                  : editingId !== null
                    ? 'Save Changes'
                    : 'Add Income Source'}
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
              {pendingDeleteName ? ` "${pendingDeleteName}"` : ' this income source'}? This cannot
              be undone.
            </>
          }
        />
      </div>
    </div>
  )
}
