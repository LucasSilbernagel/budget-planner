import {
  currencySymbol,
  formatForInputDisplay,
  parseFromInput,
} from '@budget-planner/core/format/currency'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSavingsGoals, useSavingsStore, useTotalSavings } from '../stores'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Modal } from './ui/Modal'

export function SavingsPage() {
  const savingsGoals = useSavingsGoals()
  const totalSavings = useTotalSavings()
  const { addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, getSavingsProgress } =
    useSavingsStore()
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
  const [name, setName] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')

  // Inline field-validation error state (replaces browser alert() popups).
  // Mirrors the app's canonical inline-validation pattern: an errors map plus
  // hasFieldError/getFieldError helpers and re-validate-on-change after the
  // first submit attempt.
  type FieldName = 'name' | 'targetAmount' | 'currentBalance'
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
    const targetInCents = parseFromInput(targetAmount, locale)
    if (targetInCents <= 0) {
      next.targetAmount = 'Please enter a valid positive target amount'
    }
    const balanceInCents = parseFromInput(currentBalance, locale)
    if (balanceInCents < 0) {
      next.currentBalance = 'Please enter a valid non-negative current balance'
    }
    return next
  }, [name, targetAmount, currentBalance, locale])

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
        setTargetAmount('')
        setCurrentBalance('')
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

  // Open modal for editing existing savings goal
  const openEditModal = (goal: {
    id: number
    name: string
    targetAmount: number
    currentBalance: number
  }) => {
    setEditingId(goal.id)
    setName(goal.name)
    setTargetAmount(formatForInputDisplay(goal.targetAmount, locale))
    setCurrentBalance(formatForInputDisplay(goal.currentBalance, locale))
    clearErrors()
    setIsModalOpen(true)
  }

  // Close modal
  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setName('')
    setTargetAmount('')
    setCurrentBalance('')
    clearErrors()
  }

  // Loading state to prevent duplicate submissions
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Delete confirmation state (themed dialog replaces browser confirm()). The
  // "Add" button is a stable focus target after a confirmed delete (AC-5).
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
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
        targetAmount: parseFromInput(targetAmount, locale),
        currentBalance: parseFromInput(currentBalance, locale),
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
  const handleDelete = (id: number) => {
    setPendingDeleteId(id)
  }

  // Confirm and execute the pending delete
  const confirmDelete = () => {
    if (pendingDeleteId !== null) {
      deleteSavingsGoal(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }

  return (
    <div className="surface-sunken p-4 sm:p-8 min-h-screen">
      <div className="mx-auto max-w-4xl">
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
              <div>
                <h2 className="font-semibold text-subheading text-xl">Total Savings</h2>
                <p className="mt-2 font-bold text-purple-600 dark:text-purple-400 text-3xl">
                  {formatAmount(totalSavings)}
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
          </section>

          {/* Savings Goals List */}
          <section className="surface shadow-md p-6 rounded-lg">
            <h2 className="mb-6 font-semibold text-subheading text-xl">Your Savings Goals</h2>

            {savingsGoals.length === 0 ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">No savings goals recorded yet</p>
                <p className="text-faint text-sm">Click "Add Savings Goal" to get started</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="divide-y divide-gray-200 dark:divide-gray-700 min-w-full">
                  <thead className="surface-inset">
                    <tr>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Target
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Current Balance
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Progress
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-right uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="surface divide-y divide-gray-200 dark:divide-gray-700">
                    {savingsGoals.map((goal) => {
                      const progress = getSavingsProgress(goal.id)
                      return (
                        <tr key={goal.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-medium text-heading text-sm">{goal.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-muted text-sm">
                              {formatAmount(goal.targetAmount)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-muted text-sm">
                              {formatAmount(goal.currentBalance)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="bg-gray-200 dark:bg-gray-700 rounded-full w-full h-2">
                              <div
                                className="bg-purple-600 rounded-full h-2"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <div className="mt-1 text-muted text-xs text-center">{progress}%</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openEditModal(goal)}
                              className="mr-4 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(goal.id)}
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
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
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
                  onChange={(e) => setTargetAmount(e.target.value)}
                  onBlur={(e) => reformatAmountOnBlur(e.target.value, setTargetAmount)}
                  placeholder="0.00"
                  className={`w-full px-3 py-2 ${
                    mode === 'symbol' ? 'pl-7' : ''
                  } border rounded-md shadow-sm focus:outline-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
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
                  onChange={(e) => setCurrentBalance(e.target.value)}
                  onBlur={(e) => reformatAmountOnBlur(e.target.value, setCurrentBalance)}
                  placeholder="0.00"
                  className={`w-full px-3 py-2 ${
                    mode === 'symbol' ? 'pl-7' : ''
                  } border rounded-md shadow-sm focus:outline-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
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
