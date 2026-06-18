import React, { useState, useEffect } from 'react'
import type { FinanceType } from '../stores/balanceStore'
import {
  useBalanceStore,
  useBalanceEntries,
  useTotalInvestments,
  useTotalDebts,
  useNetWorth,
} from '../stores'

const FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

// Amounts are stored in cents (integer) for precision
// but displayed to users in dollars with decimal formatting
function formatAmount(cents: number): string {
  return FORMATTER.format(cents / 100)
}

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
  const {
    addBalanceEntry,
    updateBalanceEntry,
    deleteBalanceEntry,
  } = useBalanceStore()

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [type, setType] = useState<FinanceType>('investment')
  const [name, setName] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')
  const [maxContributionLimit, setMaxContributionLimit] = useState('')
  const [monthlyContribution, setMonthlyContribution] = useState('')

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

  // Open modal for adding new balance entry
  const openAddModal = () => {
    setEditingId(null)
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
      entry.maxContributionLimit !== null
        ? formatAmountForInput(entry.maxContributionLimit)
        : ''
    )
    setMonthlyContribution(formatAmountForInput(entry.monthlyContribution))
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
  }

  // Loading state to prevent duplicate submissions
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Handle form submission (add or update)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      // Validate name
      const trimmedName = name.trim()
      if (!trimmedName) {
        alert('Please enter a name for the balance entry')
        return
      }

      // Validate current balance
      const balanceInCents = Math.round(parseFloat(currentBalance || '0') * 100)
      if (isNaN(balanceInCents) || balanceInCents < 0) {
        alert('Please enter a valid non-negative current balance')
        return
      }

      // Validate and parse max contribution limit (optional)
      let maxLimitInCents: number | null = null
      if (maxContributionLimit && maxContributionLimit.trim() !== '') {
        const parsed = Math.round(parseFloat(maxContributionLimit) * 100)
        if (isNaN(parsed) || parsed < 0) {
          alert('Please enter a valid non-negative max contribution limit')
          return
        }
        maxLimitInCents = parsed
      }

      // Validate monthly contribution
      const monthlyInCents = Math.round(
        parseFloat(monthlyContribution || '0') * 100
      )
      if (isNaN(monthlyInCents) || monthlyInCents < 0) {
        alert('Please enter a valid non-negative monthly contribution')
        return
      }

      const newEntry = {
        type,
        name: trimmedName,
        currentBalance: balanceInCents,
        maxContributionLimit: maxLimitInCents,
        monthlyContribution: monthlyInCents,
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

  // Handle delete
  const handleDelete = (id: number) => {
    if (
      confirm(
        'Are you sure you want to delete this balance entry? This cannot be undone.'
      )
    ) {
      deleteBalanceEntry(id)
    }
  }

  // Get type label and color for display
  const getTypeDisplay = (type: FinanceType) => {
    const option = TYPE_OPTIONS.find((o) => o.value === type)
    return option ? option : { label: type, color: 'bg-gray-100 text-gray-800' }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Balance Tracking</h1>
          <p className="text-gray-600 mt-2">
            Monitor your investments and debts
          </p>
        </header>

        <main className="space-y-6">
          {/* Stats Cards */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Financial Overview
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Total Investments</p>
                <p className="text-2xl font-bold text-green-600 mt-1">
                  {formatAmount(totalInvestments)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Total Debts</p>
                <p className="text-2xl font-bold text-red-600 mt-1">
                  {formatAmount(totalDebts)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Net Worth</p>
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
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">
              Your Balance Entries
            </h2>

            {balanceEntries.length === 0 ? (
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-4">
                  No balance entries recorded yet
                </p>
                <p className="text-sm text-gray-400">
                  Click "Add Balance Entry" to get started
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Current Balance
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Max Contribution
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Monthly Contribution
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
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
                            <div className="text-sm font-medium text-gray-900">
                              {entry.name}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {formatAmount(entry.currentBalance)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {entry.maxContributionLimit !== null
                                ? formatAmount(entry.maxContributionLimit)
                                : 'None'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {formatAmount(entry.monthlyContribution)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                            <button
                              onClick={() => openEditModal(entry)}
                              className="text-blue-600 hover:text-blue-900 mr-4"
                            >
                              Edit
                            </button>
                            <button
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
        {isModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-medium text-gray-900">
                  {editingId !== null
                    ? 'Edit Balance Entry'
                    : 'Add Balance Entry'}
                </h3>
                <button
                  onClick={closeModal}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Close"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                  <label
                    htmlFor="type"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Type *
                  </label>
                  <select
                    id="type"
                    value={type}
                    onChange={(e) => setType(e.target.value as FinanceType)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
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
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Name *
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., 401k, Student Loan, Credit Card"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="currentBalance"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Current Balance *
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
                      required
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="maxContributionLimit"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Max Contribution Limit (Optional)
                  </label>
                  <div className="relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500 text-sm">$</span>
                    </div>
                    <input
                      type="number"
                      id="maxContributionLimit"
                      value={maxContributionLimit}
                      onChange={(e) => setMaxContributionLimit(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-2 pl-7 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="monthlyContribution"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Monthly Contribution *
                  </label>
                  <div className="relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500 text-sm">$</span>
                    </div>
                    <input
                      type="number"
                      id="monthlyContribution"
                      value={monthlyContribution}
                      onChange={(e) => setMonthlyContribution(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-2 pl-7 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                      required
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
                      : 'Add Balance Entry'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Keyboard shortcut: Escape to close modal */}
        {isModalOpen && (
          <div
            className="fixed inset-0 pointer-events-none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeModal()
            }}
            tabIndex={-1}
          />
        )}

        {/* Navigation */}
        <div className="mt-8 flex gap-4">
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
          <a
            href="/savings"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            View Savings
          </a>
        </div>
      </div>
    </div>
  )
}
