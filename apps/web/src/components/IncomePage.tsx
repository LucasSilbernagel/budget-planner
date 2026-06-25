import type { Frequency } from '@budget-planner/db'
import React, { useState, useEffect } from 'react'
import { useIncomeSources, useIncomeStore, useTotalIncome } from '../stores'

// Frequency options for the select dropdown
const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
]

const FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

// Amounts are stored in cents (integer) for precision
// but displayed to users in dollars with decimal formatting
function formatAmount(cents: number): string {
  return FORMATTER.format(cents / 100)
}

export function IncomePage() {
  const incomeSources = useIncomeSources()
  const totalIncome = useTotalIncome()
  const { addIncomeSource, updateIncomeSource, deleteIncomeSource } = useIncomeStore()

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('monthly')

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

  // Open modal for adding new income source
  const openAddModal = () => {
    setEditingId(null)
    setIsModalOpen(true)
  }

  // Open modal for editing existing income source
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
    setIsModalOpen(true)
  }

  // Close modal
  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setName('')
    setAmount('')
    setFrequency('monthly')
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
        alert('Please enter a name for the income source')
        return
      }

      // Validate amount
      const amountInCents = Math.round(parseFloat(amount) * 100)
      if (Number.isNaN(amountInCents) || amountInCents <= 0) {
        alert('Please enter a valid positive amount')
        return
      }

      const newSource = {
        name: trimmedName,
        amount: amountInCents,
        frequency,
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

  // Handle delete
  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this income source? This cannot be undone.')) {
      deleteIncomeSource(id)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Income Sources</h1>
          <p className="text-gray-600 mt-2">Manage your income streams and track your earnings</p>
        </header>

        <main className="space-y-6">
          {/* Stats Card */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Total Income</h2>
                <p className="text-3xl font-bold text-green-600 mt-2">
                  {formatAmount(totalIncome)}
                </p>
              </div>
              <button
                type="button"
                onClick={openAddModal}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors whitespace-nowrap"
              >
                + Add Income Source
              </button>
            </div>
          </section>

          {/* Income Sources List */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">Your Income Sources</h2>

            {incomeSources.length === 0 ? (
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-4">No income sources yet</p>
                <p className="text-sm text-gray-400">Click "Add Income Source" to get started</p>
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
                    {incomeSources.map((source) => (
                      <tr key={source.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{source.name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">{formatAmount(source.amount)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                            {source.frequency}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button
                            type="button"
                            onClick={() => openEditModal(source)}
                            className="text-blue-600 hover:text-blue-900 mr-4"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(source.id)}
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
        {isModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-medium text-gray-900">
                  {editingId !== null ? 'Edit Income Source' : 'Add Income Source'}
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
                    placeholder="e.g., Salary, Freelance, Investment"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
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
                      min="0"
                      className="w-full px-3 py-2 pl-7 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="frequency"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Frequency *
                  </label>
                  <select
                    id="frequency"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as Frequency)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
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
