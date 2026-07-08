import {
  currencySymbol,
  formatForInputDisplay,
  parseFromInput,
} from '@budget-planner/core/format/currency'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  useBalanceEntries,
  useBalanceStore,
  useNetBalance as useNetWorth,
  useTotalDebtBalance as useTotalDebts,
  useTotalInvestmentBalance as useTotalInvestments,
} from '../stores'
import type { FinanceType } from '../stores/balanceStore'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Modal } from './ui/Modal'

// Type options for the select dropdown
const TYPE_OPTIONS: { value: FinanceType; label: string; color: string }[] = [
  {
    value: 'investment',
    label: 'Investment',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
  {
    value: 'debt',
    label: 'Debt',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
]

export function BalancePage() {
  const balanceEntries = useBalanceEntries()
  const totalInvestments = useTotalInvestments()
  const totalDebts = useTotalDebts()
  const netWorth = useNetWorth()
  const { addBalanceEntry, updateBalanceEntry, deleteBalanceEntry } = useBalanceStore()
  // Amounts are stored in cents; the formatter respects the user's currency
  // display preference (currency-less vs explicit symbols) from the store.
  const formatAmount = useFormattedAmount()
  // Currency preferences drive the input symbol affordance and locale-aware
  // grouping/parsing (story 14-3). Currency-less mode shows no symbol and groups
  // with the neutral en-US locale (per the store).
  const { mode, currency, locale } = useCurrencyPreferences()

  // Re-echo an amount field in grouped, locale-aware form on blur. Leave an empty
  // field empty, and do NOT clobber non-numeric garbage to "0.00" (a value with no
  // digit is left as typed so the typo stays visible for inline validation).
  const reformatAmountOnBlur = (value: string, setter: (v: string) => void) => {
    if (value.trim() === '' || !/\d/.test(value)) return
    setter(formatForInputDisplay(parseFromInput(value, locale), locale))
  }

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [type, setType] = useState<FinanceType>('investment')
  const [name, setName] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')
  const [maxContributionLimit, setMaxContributionLimit] = useState('')
  const [monthlyContribution, setMonthlyContribution] = useState('')

  // Inline field-validation error state (replaces browser alert() popups).
  // Mirrors the app's canonical inline-validation pattern: an errors map plus
  // hasFieldError/getFieldError helpers and re-validate-on-change after the
  // first submit attempt.
  type FieldName = 'name' | 'currentBalance' | 'maxContributionLimit' | 'monthlyContribution'
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const hasFieldError = (field: FieldName): boolean => Boolean(errors[field])
  const getFieldError = (field: FieldName): string | undefined => errors[field]

  // Compute inline validation errors from the current field values, preserving
  // the exact conditions, optional-field semantics and messages that previously
  // drove the alert() popups.
  const computeErrors = useCallback((): Partial<Record<FieldName, string>> => {
    const next: Partial<Record<FieldName, string>> = {}
    if (!name.trim()) {
      next.name = 'Please enter a name for the balance entry'
    }
    const balanceInCents = parseFromInput(currentBalance, locale)
    if (balanceInCents < 0) {
      next.currentBalance = 'Please enter a valid non-negative current balance'
    }
    // Max contribution limit is optional: empty is valid, only validate a
    // provided value.
    if (maxContributionLimit && maxContributionLimit.trim() !== '') {
      const parsed = parseFromInput(maxContributionLimit, locale)
      if (parsed < 0) {
        next.maxContributionLimit = 'Please enter a valid non-negative max contribution limit'
      }
    }
    const monthlyInCents = parseFromInput(monthlyContribution, locale)
    if (monthlyInCents < 0) {
      next.monthlyContribution = 'Please enter a valid non-negative monthly contribution'
    }
    return next
  }, [name, currentBalance, maxContributionLimit, monthlyContribution, locale])

  const clearErrors = () => {
    setErrors({})
    setSubmitAttempted(false)
  }

  // Reset form state when modal opens or editingId changes
  useEffect(() => {
    if (isModalOpen) {
      if (editingId === null) {
        // Adding new: reset all fields
        setType('investment')
        setName('')
        setCurrentBalance('')
        setMaxContributionLimit('')
        setMonthlyContribution('')
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

  // Ref for the "Add Balance Entry" trigger so the modal can restore focus to
  // it on close (accessibility), matching the sibling money pages.
  const addButtonRef = useRef<HTMLButtonElement>(null)

  // Open modal for adding new balance entry
  const openAddModal = () => {
    setEditingId(null)
    clearErrors()
    setIsModalOpen(true)
  }

  // Open modal for editing existing balance entry
  const openEditModal = (entry: {
    id: number
    type: FinanceType
    name: string
    currentBalance: number
    maxContributionLimit: number | null
    monthlyContribution: number
  }) => {
    setEditingId(entry.id)
    setType(entry.type)
    setName(entry.name)
    setCurrentBalance(formatForInputDisplay(entry.currentBalance, locale))
    setMaxContributionLimit(
      entry.maxContributionLimit !== null
        ? formatForInputDisplay(entry.maxContributionLimit, locale)
        : ''
    )
    setMonthlyContribution(formatForInputDisplay(entry.monthlyContribution, locale))
    clearErrors()
    setIsModalOpen(true)
  }

  // Close modal
  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setType('investment')
    setName('')
    setCurrentBalance('')
    setMaxContributionLimit('')
    setMonthlyContribution('')
    clearErrors()
  }

  // Loading state to prevent duplicate submissions
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Delete confirmation state (themed dialog replaces browser confirm()). Focus
  // returns to the list heading after a confirmed delete removes the triggering
  // row (the Add button is a separate focus target used on modal close).
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const pendingDeleteName = balanceEntries.find((e) => e.id === pendingDeleteId)?.name ?? ''

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

      const maxLimitInCents =
        maxContributionLimit && maxContributionLimit.trim() !== ''
          ? parseFromInput(maxContributionLimit, locale)
          : null

      const newEntry = {
        type,
        name: name.trim(),
        currentBalance: parseFromInput(currentBalance, locale),
        maxContributionLimit: maxLimitInCents,
        monthlyContribution: parseFromInput(monthlyContribution, locale),
      }

      if (editingId !== null) {
        updateBalanceEntry(editingId, newEntry)
      } else {
        addBalanceEntry(newEntry)
      }

      closeModal()
    } finally {
      setIsSubmitting(false)
    }
  }

  // Open the themed delete confirmation for a balance entry
  const handleDelete = (id: number) => {
    setPendingDeleteId(id)
  }

  // Confirm and execute the pending delete
  const confirmDelete = () => {
    if (pendingDeleteId !== null) {
      deleteBalanceEntry(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }

  // Get type label and color for display
  const getTypeDisplay = (type: FinanceType) => {
    const option = TYPE_OPTIONS.find((o) => o.value === type)
    return option
      ? option
      : { label: type, color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' }
  }

  return (
    <div className="surface-sunken p-4 sm:p-8 min-h-screen">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <div>
            <h1 className="font-bold text-heading text-3xl">Balance Tracking</h1>
            <p className="mt-2 text-body">Monitor your investments and debts</p>
          </div>
        </header>

        <main className="space-y-6">
          {/* Stats Cards */}
          <section className="surface shadow-md p-6 rounded-lg">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-semibold text-subheading text-xl">Financial Overview</h2>
              <button
                ref={addButtonRef}
                type="button"
                onClick={openAddModal}
                data-testid="balance-add-button"
                className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-md text-white transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
              >
                + Add Balance Entry
              </button>
            </div>
            <div className="gap-4 grid grid-cols-1 md:grid-cols-3">
              <div className="surface-inset p-4 rounded-lg">
                <p className="text-muted text-sm">Total Investments</p>
                <p className="mt-1 font-bold text-green-600 dark:text-green-400 text-2xl">
                  {formatAmount(totalInvestments)}
                </p>
              </div>
              <div className="surface-inset p-4 rounded-lg">
                <p className="text-muted text-sm">Total Debts</p>
                <p className="mt-1 font-bold text-red-600 dark:text-red-400 text-2xl">
                  {formatAmount(totalDebts)}
                </p>
              </div>
              <div className="surface-inset p-4 rounded-lg">
                <p className="text-muted text-sm">Net Worth</p>
                <p
                  className={`text-2xl font-bold mt-1 ${
                    netWorth >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatAmount(netWorth)}
                </p>
              </div>
            </div>
          </section>

          {/* Balance Entries List */}
          <section className="surface shadow-md p-6 rounded-lg">
            <h2
              ref={listHeadingRef}
              tabIndex={-1}
              className="mb-6 font-semibold text-subheading text-xl rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Your Balance Entries
            </h2>

            {balanceEntries.length === 0 ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">No balance entries recorded yet</p>
                <p className="text-faint text-sm">Click "Add Balance Entry" to get started</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="divide-y divide-gray-200 dark:divide-gray-700 min-w-full">
                  <thead className="surface-inset">
                    <tr>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Current Balance
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Max Contribution
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Monthly Contribution
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-right uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="surface divide-y divide-gray-200 dark:divide-gray-700">
                    {balanceEntries.map((entry) => {
                      const typeDisplay = getTypeDisplay(entry.type)
                      return (
                        <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${typeDisplay.color}`}
                            >
                              {typeDisplay.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-medium text-heading text-sm">{entry.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-muted text-sm">
                              {formatAmount(entry.currentBalance)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-muted text-sm">
                              {entry.maxContributionLimit !== null
                                ? formatAmount(entry.maxContributionLimit)
                                : 'None'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-muted text-sm">
                              {formatAmount(entry.monthlyContribution)}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openEditModal(entry)}
                              className="mr-4 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(entry.id)}
                              className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>

        {/* Add/Edit Modal */}
        <Modal
          isOpen={isModalOpen}
          onClose={closeModal}
          labelledBy="balance-modal-title"
          finalFocusRef={addButtonRef}
          className="bg-white dark:bg-gray-800 dark:text-gray-100 shadow-xl p-6 rounded-lg w-full max-w-md"
        >
          <div className="flex justify-between items-center mb-6">
            <h3 id="balance-modal-title" className="font-medium text-heading text-lg">
              {editingId !== null ? 'Edit Balance Entry' : 'Add Balance Entry'}
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
              <label htmlFor="type" className="block mb-1 font-medium text-label text-sm">
                Type *
              </label>
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as FinanceType)}
                className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-purple-500 w-full"
                required
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="name" className="block mb-1 font-medium text-label text-sm">
                Name *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., 401k, Student Loan, Credit Card"
                className={`shadow-sm px-3 py-2 border rounded-md focus:outline-none w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                  hasFieldError('name')
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                }`}
                aria-invalid={hasFieldError('name')}
                aria-required
                aria-describedby={hasFieldError('name') ? 'balance-name-error' : undefined}
                data-testid="balance-name-input"
              />
              {hasFieldError('name') && (
                <p
                  id="balance-name-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="balance-name-error"
                >
                  {getFieldError('name')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="currentBalance" className="block mb-1 font-medium text-label text-sm">
                Current Balance *
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
                  onChange={(e) => setCurrentBalance(e.target.value)}
                  onBlur={(e) => reformatAmountOnBlur(e.target.value, setCurrentBalance)}
                  placeholder="0.00"
                  className={`shadow-sm px-3 py-2 ${
                    mode === 'symbol' ? 'pl-7' : ''
                  } border rounded-md focus:outline-none w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                    hasFieldError('currentBalance')
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                  }`}
                  aria-invalid={hasFieldError('currentBalance')}
                  aria-required
                  aria-describedby={
                    hasFieldError('currentBalance') ? 'balance-current-balance-error' : undefined
                  }
                  data-testid="balance-current-balance-input"
                />
              </div>
              {hasFieldError('currentBalance') && (
                <p
                  id="balance-current-balance-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="balance-current-balance-error"
                >
                  {getFieldError('currentBalance')}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="maxContributionLimit"
                className="block mb-1 font-medium text-label text-sm"
              >
                Max Contribution Limit (Optional)
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
                  id="maxContributionLimit"
                  value={maxContributionLimit}
                  onChange={(e) => setMaxContributionLimit(e.target.value)}
                  onBlur={(e) => reformatAmountOnBlur(e.target.value, setMaxContributionLimit)}
                  placeholder="0.00"
                  className={`shadow-sm px-3 py-2 ${
                    mode === 'symbol' ? 'pl-7' : ''
                  } border rounded-md focus:outline-none w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                    hasFieldError('maxContributionLimit')
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                  }`}
                  aria-invalid={hasFieldError('maxContributionLimit')}
                  aria-describedby={
                    hasFieldError('maxContributionLimit')
                      ? 'balance-max-contribution-error'
                      : undefined
                  }
                  data-testid="balance-max-contribution-input"
                />
              </div>
              {hasFieldError('maxContributionLimit') && (
                <p
                  id="balance-max-contribution-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="balance-max-contribution-error"
                >
                  {getFieldError('maxContributionLimit')}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="monthlyContribution"
                className="block mb-1 font-medium text-label text-sm"
              >
                Monthly Contribution *
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
                  id="monthlyContribution"
                  value={monthlyContribution}
                  onChange={(e) => setMonthlyContribution(e.target.value)}
                  onBlur={(e) => reformatAmountOnBlur(e.target.value, setMonthlyContribution)}
                  placeholder="0.00"
                  className={`shadow-sm px-3 py-2 ${
                    mode === 'symbol' ? 'pl-7' : ''
                  } border rounded-md focus:outline-none w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                    hasFieldError('monthlyContribution')
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                  }`}
                  aria-invalid={hasFieldError('monthlyContribution')}
                  aria-required
                  aria-describedby={
                    hasFieldError('monthlyContribution')
                      ? 'balance-monthly-contribution-error'
                      : undefined
                  }
                  data-testid="balance-monthly-contribution-input"
                />
              </div>
              {hasFieldError('monthlyContribution') && (
                <p
                  id="balance-monthly-contribution-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="balance-monthly-contribution-error"
                >
                  {getFieldError('monthlyContribution')}
                </p>
              )}
            </div>

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
                    : 'Add Balance Entry'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Delete confirmation */}
        <ConfirmDialog
          isOpen={pendingDeleteId !== null}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDeleteId(null)}
          finalFocusRef={listHeadingRef}
          message={
            <>
              Are you sure you want to delete
              {pendingDeleteName ? ` "${pendingDeleteName}"` : ' this balance entry'}? This cannot
              be undone.
            </>
          }
        />
      </div>
    </div>
  )
}
