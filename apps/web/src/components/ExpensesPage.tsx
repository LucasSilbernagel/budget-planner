import type { Frequency } from '@budget-planner/db'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useExpenseStore, useExpenses, useTotalExpenses } from '../stores'
import { useFormattedAmount } from '../stores/currencyStore'
import { CurrencyToggle } from './settings/currency-toggle'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Modal } from './ui/Modal'

// Frequency options for the select dropdown
const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
]

export function ExpensesPage() {
  const expenses = useExpenses()
  // Amounts are stored in cents; the formatter respects the user's currency
  // display preference (currency-less vs explicit symbols) from the store.
  const formatAmount = useFormattedAmount()
  const totalExpenses = useTotalExpenses()
  const { addExpense, updateExpense, deleteExpense } = useExpenseStore()

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('monthly')

  // Inline field-validation error state (replaces browser alert() popups).
  // Mirrors the canonical pattern in AddSavingsGoalForm: an errors map plus
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
    const amountInCents = Math.round(parseFloat(amount) * 100)
    if (Number.isNaN(amountInCents) || amountInCents <= 0) {
      next.amount = 'Please enter a valid positive amount'
    }
    return next
  }, [name, amount])

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
    id: number
    name: string
    amount: number
    frequency: Frequency
  }) => {
    setEditingId(source.id)
    setName(source.name)
    setAmount((source.amount / 100).toString())
    setFrequency(source.frequency)
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
        amount: Math.round(parseFloat(amount) * 100),
        frequency,
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

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Expenses</h1>
            <p className="text-gray-600 mt-2">Track and categorize your spending</p>
          </div>
          <CurrencyToggle className="mt-1 flex-shrink-0" />
        </header>

        <main className="space-y-6">
          {/* Stats Card */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Total Expenses</h2>
                <p className="text-3xl font-bold text-red-600 mt-2">
                  {formatAmount(totalExpenses)}
                </p>
              </div>
              <button
                ref={addButtonRef}
                type="button"
                onClick={openAddModal}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors whitespace-nowrap"
              >
                + Add Expense
              </button>
            </div>
          </section>

          {/* Expenses List */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">Your Expenses</h2>

            {expenses.length === 0 ? (
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-4">No expenses recorded yet</p>
                <p className="text-sm text-gray-400">Click "Add Expense" to get started</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Frequency
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {expenses.map((expense) => (
                      <tr key={expense.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{expense.name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {formatAmount(expense.amount)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                            {expense.frequency}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button
                            type="button"
                            onClick={() => openEditModal(expense)}
                            className="text-blue-600 hover:text-blue-900 mr-4"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(expense.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Delete
                          </button>
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
        <Modal isOpen={isModalOpen} onClose={closeModal} labelledBy="expense-modal-title">
          <div className="flex justify-between items-center mb-6">
            <h3 id="expense-modal-title" className="text-lg font-medium text-gray-900">
              {editingId !== null ? 'Edit Expense' : 'Add Expense'}
            </h3>
            <button
              type="button"
              onClick={closeModal}
              className="text-gray-400 hover:text-gray-600"
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
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Name *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Rent, Groceries, Utilities"
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none ${
                  hasFieldError('name')
                    ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                    : 'border-gray-300 focus:ring-red-500 focus:border-red-500'
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
            </div>

            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
                Amount *
              </label>
              <div className="relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 text-sm">$</span>
                </div>
                <input
                  type="number"
                  id="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className={`w-full px-3 py-2 pl-7 border rounded-md shadow-sm focus:outline-none ${
                    hasFieldError('amount')
                      ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:ring-red-500 focus:border-red-500'
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
              <label htmlFor="frequency" className="block text-sm font-medium text-gray-700 mb-1">
                Frequency *
              </label>
              <select
                id="frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500"
                required
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
