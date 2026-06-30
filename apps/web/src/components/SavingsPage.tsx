import React, { useState, useEffect, useRef } from 'react'
import { useSavingsGoals, useSavingsStore, useTotalSavings } from '../stores'
import { useFormattedAmount } from '../stores/currencyStore'
import { CurrencyToggle } from './settings/currency-toggle'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Modal } from './ui/Modal'

// Format amount for input display (without currency symbol)
function formatAmountForInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function SavingsPage() {
  const savingsGoals = useSavingsGoals()
  const totalSavings = useTotalSavings()
  const { addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, getSavingsProgress } =
    useSavingsStore()
  // Amounts are stored in cents; the formatter respects the user's currency
  // display preference (currency-less vs explicit symbols) from the store.
  const formatAmount = useFormattedAmount()

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')

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

  // Open modal for adding new savings goal
  const openAddModal = () => {
    setEditingId(null)
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
    setTargetAmount(formatAmountForInput(goal.targetAmount))
    setCurrentBalance(formatAmountForInput(goal.currentBalance))
    setIsModalOpen(true)
  }

  // Close modal
  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setName('')
    setTargetAmount('')
    setCurrentBalance('')
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
    setIsSubmitting(true)

    try {
      // Validate name
      const trimmedName = name.trim()
      if (!trimmedName) {
        alert('Please enter a name for the savings goal')
        return
      }

      // Validate target amount
      const targetInCents = Math.round(parseFloat(targetAmount) * 100)
      if (Number.isNaN(targetInCents) || targetInCents <= 0) {
        alert('Please enter a valid positive target amount')
        return
      }

      // Validate current balance
      const balanceInCents = Math.round(parseFloat(currentBalance || '0') * 100)
      if (Number.isNaN(balanceInCents) || balanceInCents < 0) {
        alert('Please enter a valid non-negative current balance')
        return
      }

      const newGoal = {
        name: trimmedName,
        targetAmount: targetInCents,
        currentBalance: balanceInCents,
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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Savings Goals</h1>
            <p className="text-gray-600 mt-2">Track and manage your savings targets</p>
          </div>
          <CurrencyToggle className="mt-1 flex-shrink-0" />
        </header>

        <main className="space-y-6">
          {/* Stats Card */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Total Savings</h2>
                <p className="text-3xl font-bold text-purple-600 mt-2">
                  {formatAmount(totalSavings)}
                </p>
              </div>
              <button
                ref={addButtonRef}
                type="button"
                onClick={openAddModal}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors whitespace-nowrap"
              >
                + Add Savings Goal
              </button>
            </div>
          </section>

          {/* Savings Goals List */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">Your Savings Goals</h2>

            {savingsGoals.length === 0 ? (
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-4">No savings goals recorded yet</p>
                <p className="text-sm text-gray-400">Click "Add Savings Goal" to get started</p>
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
                        Target
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Current Balance
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Progress
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {savingsGoals.map((goal) => {
                      const progress = getSavingsProgress(goal.id)
                      return (
                        <tr key={goal.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{goal.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {formatAmount(goal.targetAmount)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {formatAmount(goal.currentBalance)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-purple-600 h-2 rounded-full"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-500 text-center mt-1">
                              {progress}%
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                            <button
                              type="button"
                              onClick={() => openEditModal(goal)}
                              className="text-blue-600 hover:text-blue-900 mr-4"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(goal.id)}
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
        <Modal isOpen={isModalOpen} onClose={closeModal} labelledBy="savings-modal-title">
          <div className="flex justify-between items-center mb-6">
            <h3 id="savings-modal-title" className="text-lg font-medium text-gray-900">
              {editingId !== null ? 'Edit Savings Goal' : 'Add Savings Goal'}
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Name *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Emergency Fund, Vacation, New Car"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="targetAmount"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Target Amount *
              </label>
              <div className="relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 text-sm">$</span>
                </div>
                <input
                  type="number"
                  id="targetAmount"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  className="w-full px-3 py-2 pl-7 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                  required
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="currentBalance"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Current Balance
              </label>
              <div className="relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 text-sm">$</span>
                </div>
                <input
                  type="number"
                  id="currentBalance"
                  value={currentBalance}
                  onChange={(e) => setCurrentBalance(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 pl-7 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
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
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* Navigation */}
        <div className="mt-8 flex flex-wrap gap-4">
          <a
            href="/"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            Back to Home
          </a>
          <a
            href="/income"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            View Income
          </a>
          <a
            href="/expenses"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            View Expenses
          </a>
        </div>
      </div>
    </div>
  )
}
