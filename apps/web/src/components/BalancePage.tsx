import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  useBalanceEntries,
  useBalanceStore,
  useNetBalance as useNetWorth,
  useTotalDebtBalance as useTotalDebts,
  useTotalInvestmentBalance as useTotalInvestments,
} from '../stores'
import type { FinanceType } from '../stores/balanceStore'
import { useFormattedAmount } from '../stores/currencyStore'
import { CurrencyToggle } from './settings/currency-toggle'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Modal } from './ui/Modal'

// Format amount for input display (without currency symbol)
function formatAmountForInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

// Type options for the select dropdown
const TYPE_OPTIONS: { value: FinanceType; label: string; color: string }[] = [
  { value: 'investment', label: 'Investment', color: 'bg-green-100 text-green-800' },
  { value: 'debt', label: 'Debt', color: 'bg-red-100 text-red-800' },
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

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [type, setType] = useState<FinanceType>('investment')
  const [name, setName] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')
  const [maxContributionLimit, setMaxContributionLimit] = useState('')
  const [monthlyContribution, setMonthlyContribution] = useState('')

  // Inline field-validation error state (replaces browser alert() popups).
  // Mirrors the canonical pattern in AddSavingsGoalForm: an errors map plus
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
    const balanceInCents = Math.round(parseFloat(currentBalance || '0') * 100)
    if (Number.isNaN(balanceInCents) || balanceInCents < 0) {
      next.currentBalance = 'Please enter a valid non-negative current balance'
    }
    // Max contribution limit is optional: empty is valid, only validate a
    // provided value.
    if (maxContributionLimit && maxContributionLimit.trim() !== '') {
      const parsed = Math.round(parseFloat(maxContributionLimit) * 100)
      if (Number.isNaN(parsed) || parsed < 0) {
        next.maxContributionLimit = 'Please enter a valid non-negative max contribution limit'
      }
    }
    const monthlyInCents = Math.round(parseFloat(monthlyContribution || '0') * 100)
    if (Number.isNaN(monthlyInCents) || monthlyInCents < 0) {
      next.monthlyContribution = 'Please enter a valid non-negative monthly contribution'
    }
    return next
  }, [name, currentBalance, maxContributionLimit, monthlyContribution])

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
    setCurrentBalance(formatAmountForInput(entry.currentBalance))
    setMaxContributionLimit(
      entry.maxContributionLimit !== null ? formatAmountForInput(entry.maxContributionLimit) : ''
    )
    setMonthlyContribution(formatAmountForInput(entry.monthlyContribution))
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
          ? Math.round(parseFloat(maxContributionLimit) * 100)
          : null

      const newEntry = {
        type,
        name: name.trim(),
        currentBalance: Math.round(parseFloat(currentBalance || '0') * 100),
        maxContributionLimit: maxLimitInCents,
        monthlyContribution: Math.round(parseFloat(monthlyContribution || '0') * 100),
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
    return option ? option : { label: type, color: 'bg-gray-100 text-gray-800' }
  }

  return (
    <div className="bg-gray-50 p-4 sm:p-8 min-h-screen">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-bold text-gray-900 text-3xl">Balance Tracking</h1>
            <p className="mt-2 text-gray-600">Monitor your investments and debts</p>
          </div>
          <CurrencyToggle className="mt-1 flex-shrink-0" />
        </header>

        <main className="space-y-6">
          {/* Stats Cards */}
          <section className="bg-white shadow-md p-6 rounded-lg">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-semibold text-gray-800 text-xl">Financial Overview</h2>
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
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-500 text-sm">Total Investments</p>
                <p className="mt-1 font-bold text-green-600 text-2xl">
                  {formatAmount(totalInvestments)}
                </p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-500 text-sm">Total Debts</p>
                <p className="mt-1 font-bold text-red-600 text-2xl">{formatAmount(totalDebts)}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-500 text-sm">Net Worth</p>
                <p
                  className={`text-2xl font-bold mt-1 ${
                    netWorth >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {formatAmount(netWorth)}
                </p>
              </div>
            </div>
          </section>

          {/* Balance Entries List */}
          <section className="bg-white shadow-md p-6 rounded-lg">
            <h2
              ref={listHeadingRef}
              tabIndex={-1}
              className="mb-6 font-semibold text-gray-800 text-xl rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Your Balance Entries
            </h2>

            {balanceEntries.length === 0 ? (
              <div className="bg-gray-50 p-8 rounded-lg text-center">
                <p className="mb-4 text-gray-500">No balance entries recorded yet</p>
                <p className="text-gray-400 text-sm">Click "Add Balance Entry" to get started</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="divide-y divide-gray-200 min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 font-medium text-gray-500 text-xs text-left uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-xs text-left uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-xs text-left uppercase tracking-wider">
                        Current Balance
                      </th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-xs text-left uppercase tracking-wider">
                        Max Contribution
                      </th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-xs text-left uppercase tracking-wider">
                        Monthly Contribution
                      </th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-xs text-right uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {balanceEntries.map((entry) => {
                      const typeDisplay = getTypeDisplay(entry.type)
                      return (
                        <tr key={entry.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${typeDisplay.color}`}
                            >
                              {typeDisplay.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-medium text-gray-900 text-sm">{entry.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-gray-500 text-sm">
                              {formatAmount(entry.currentBalance)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-gray-500 text-sm">
                              {entry.maxContributionLimit !== null
                                ? formatAmount(entry.maxContributionLimit)
                                : 'None'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-gray-500 text-sm">
                              {formatAmount(entry.monthlyContribution)}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openEditModal(entry)}
                              className="mr-4 text-blue-600 hover:text-blue-900"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(entry.id)}
                              className="text-red-600 hover:text-red-900"
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
          className="bg-white shadow-xl p-6 rounded-lg w-full max-w-md"
        >
          <div className="flex justify-between items-center mb-6">
            <h3 id="balance-modal-title" className="font-medium text-gray-900 text-lg">
              {editingId !== null ? 'Edit Balance Entry' : 'Add Balance Entry'}
            </h3>
            <button
              type="button"
              onClick={closeModal}
              className="text-gray-400 hover:text-gray-600"
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
              <label htmlFor="type" className="block mb-1 font-medium text-gray-700 text-sm">
                Type *
              </label>
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as FinanceType)}
                className="shadow-sm px-3 py-2 border border-gray-300 focus:border-purple-500 rounded-md focus:outline-none focus:ring-purple-500 w-full"
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
              <label htmlFor="name" className="block mb-1 font-medium text-gray-700 text-sm">
                Name *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., 401k, Student Loan, Credit Card"
                className={`shadow-sm px-3 py-2 border rounded-md focus:outline-none w-full ${
                  hasFieldError('name')
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'
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
              <label
                htmlFor="currentBalance"
                className="block mb-1 font-medium text-gray-700 text-sm"
              >
                Current Balance *
              </label>
              <div className="relative shadow-sm rounded-md">
                <div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
                  <span className="text-gray-500 text-sm">$</span>
                </div>
                <input
                  type="number"
                  id="currentBalance"
                  value={currentBalance}
                  onChange={(e) => setCurrentBalance(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className={`shadow-sm px-3 py-2 pl-7 border rounded-md focus:outline-none w-full ${
                    hasFieldError('currentBalance')
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'
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
                className="block mb-1 font-medium text-gray-700 text-sm"
              >
                Max Contribution Limit (Optional)
              </label>
              <div className="relative shadow-sm rounded-md">
                <div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
                  <span className="text-gray-500 text-sm">$</span>
                </div>
                <input
                  type="number"
                  id="maxContributionLimit"
                  value={maxContributionLimit}
                  onChange={(e) => setMaxContributionLimit(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className={`shadow-sm px-3 py-2 pl-7 border rounded-md focus:outline-none w-full ${
                    hasFieldError('maxContributionLimit')
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'
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
                className="block mb-1 font-medium text-gray-700 text-sm"
              >
                Monthly Contribution *
              </label>
              <div className="relative shadow-sm rounded-md">
                <div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
                  <span className="text-gray-500 text-sm">$</span>
                </div>
                <input
                  type="number"
                  id="monthlyContribution"
                  value={monthlyContribution}
                  onChange={(e) => setMonthlyContribution(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className={`shadow-sm px-3 py-2 pl-7 border rounded-md focus:outline-none w-full ${
                    hasFieldError('monthlyContribution')
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'
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
                className="hover:bg-gray-50 px-4 py-2 border border-gray-300 rounded-md text-gray-700"
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

        {/* Navigation */}
        <div className="flex flex-wrap gap-4 mt-8">
          <a
            href="/"
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-md text-gray-800 transition-colors"
          >
            Back to Home
          </a>
          <a
            href="/income"
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-md text-gray-800 transition-colors"
          >
            View Income
          </a>
          <a
            href="/expenses"
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-md text-gray-800 transition-colors"
          >
            View Expenses
          </a>
          <a
            href="/savings"
            className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-md text-gray-800 transition-colors"
          >
            View Savings
          </a>
        </div>
      </div>
    </div>
  )
}
