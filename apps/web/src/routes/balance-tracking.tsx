import React, { useState, useCallback, useEffect, useRef } from 'react'
import BalanceTrackingList from '../components/BalanceTrackingList'
import AddBalanceEntryForm from '../components/AddBalanceEntryForm'
import EditBalanceEntryForm from '../components/EditBalanceEntryForm'
import type { ClientBalanceTracking, ClientNewBalanceTracking } from '@budget-planner/core/services/balanceTracking'
import {
  useBalanceEntriesWithTimeline,
  useInvestmentEntries,
  useDebtEntries,
  useTotalInvestmentBalance,
  useTotalDebtBalance,
  useNetBalance,
  useBalanceActions,
} from '../stores/balanceStore'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { formatCurrency, currencySymbol } from '@budget-planner/core/format/currency'

/**
 * Balance Tracking Page
 * 
 * Main page for managing balance tracking entries.
 * Uses TanStack Start file-based routing (route: /balance-tracking)
 * 
 * Features:
 * - List of balance entries with timeline display
 * - Add new balance entry form
 * - Edit existing balance entry form
 * - Success/error message display
 * - Loading states
 * - Full accessibility compliance
 * - Grouped display by type (investments vs debts)
 * 
 * AC 2: When viewing the balance tracking list, all entries are displayed sorted by creation date (newest first)
 * AC 2: Entries are grouped by type (investments vs debts)
 * AC 5: Investment entries displayed with positive growth indicators, debt entries with negative balance indicators
 */
export function BalanceTrackingPage() {
  // Get currency preferences from store
  const { mode, currency } = useCurrencyPreferences()
  const currencySymbolValue = currencySymbol(currency)

  // Format amount using current currency preferences
  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency })

  // Store data
  const balanceEntriesWithTimeline = useBalanceEntriesWithTimeline()
  const investmentEntries = useInvestmentEntries()
  const debtEntries = useDebtEntries()
  const totalInvestmentBalance = useTotalInvestmentBalance()
  const totalDebtBalance = useTotalDebtBalance()
  const netBalance = useNetBalance()

  // Store actions
  const { addBalanceEntry, updateBalanceEntry, deleteBalanceEntry } = useBalanceActions()

  // Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<ClientBalanceTracking | null>(null)

  // Handle Escape key for modals
  const closeModals = useCallback(() => {
    setIsAddModalOpen(false)
    setIsEditModalOpen(false)
    setEditingEntry(null)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (isAddModalOpen || isEditModalOpen)) {
        closeModals()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAddModalOpen, isEditModalOpen, closeModals])

  // Loading/submitting states
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Timer ref for cleanup
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Show notification with cleanup
  const showNotification = useCallback((type: 'success' | 'error', message: string) => {
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current)
    }

    setNotification({ type, message })
    notificationTimerRef.current = setTimeout(() => setNotification(null), 5000)
  }, [])

  // Clean up notification timer on unmount
  useEffect(() => {
    return () => {
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current)
      }
    }
  }, [])

  // Open add modal
  const openAddModal = useCallback(() => {
    setIsAddModalOpen(true)
    setIsEditModalOpen(false)
    setEditingEntry(null)
  }, [])

  // Open edit modal
  const openEditModal = useCallback((entry: ClientBalanceTracking) => {
    setEditingEntry(entry)
    setIsEditModalOpen(true)
    setIsAddModalOpen(false)
  }, [])

  // Handle add balance entry
  const handleAddBalanceEntry = async (data: ClientNewBalanceTracking) => {
    setIsSubmitting(true)
    try {
      const result = addBalanceEntry(data)
      if (result) {
        showNotification('success', 'Balance entry created successfully!')
        closeModals()
      } else {
        showNotification('error', 'Failed to create balance entry - validation error')
      }
    } catch (error) {
      showNotification('error', 'Failed to create balance entry')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle update balance entry
  const handleUpdateBalanceEntry = async (data: ClientNewBalanceTracking & { id: number }) => {
    setIsSubmitting(true)
    try {
      const result = updateBalanceEntry(data.id, {
        name: data.name,
        type: data.type,
        currentBalance: data.currentBalance,
        maxContributionLimit: data.maxContributionLimit,
        monthlyContribution: data.monthlyContribution,
      })

      if (result) {
        showNotification('success', 'Balance entry updated successfully!')
        closeModals()
      } else {
        showNotification('error', 'Failed to update balance entry - not found')
      }
    } catch (error) {
      showNotification('error', 'Failed to update balance entry')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle delete balance entry
  const handleDeleteBalanceEntry = async (id: number) => {
    if (!confirm('Are you sure you want to delete this balance entry? This action cannot be undone.')) {
      return
    }

    try {
      const result = deleteBalanceEntry(id)
      if (result) {
        showNotification('success', 'Balance entry deleted successfully!')
      } else {
        showNotification('error', 'Failed to delete balance entry - not found')
      }
    } catch (error) {
      showNotification('error', 'Failed to delete balance entry')
    }
  }

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-900"
      data-testid="balance-tracking-page"
    >
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Notification */}
        {notification && (
          <div
            className={`mb-6 p-4 rounded-md ${notification.type === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}
            role="alert"
            aria-live="polite"
            data-testid="balance-tracking-notification"
          >
            <span className="font-medium">
              {notification.type === 'success' ? '✓ ' : '✗ '}
            </span>
            {notification.message}
          </div>
        )}

        {/* Header */}
        <header className="mb-8">
          <h1
            className="text-3xl font-bold text-gray-900 dark:text-white mb-2"
            data-testid="balance-tracking-title"
          >
            Balance Tracking
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Track your investments and debts with contribution timelines
          </p>
        </header>

        {/* Stats Overview */}
        <section
          className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6"
          aria-label="Balance statistics"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Total Investments */}
            <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <p className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">
                Total Investments
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {currencySymbolValue}{formatAmount(totalInvestmentBalance)}
              </p>
            </div>

            {/* Total Debts */}
            <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">
                Total Debts
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {currencySymbolValue}{formatAmount(totalDebtBalance)}
              </p>
            </div>

            {/* Net Balance */}
            <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">
                Net Balance
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {currencySymbolValue}{formatAmount(netBalance)}
              </p>
            </div>
          </div>
        </section>

        {/* Add Button */}
        <div className="flex justify-end mb-6">
          <button
            onClick={openAddModal}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-400"
            aria-label="Add new balance entry"
            data-testid="balance-tracking-add-button"
          >
            <svg
              className="w-5 h-5 inline-block mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
            Add Balance Entry
          </button>
        </div>

        {/* Balance Tracking List */}
        <section
          className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6"
          aria-label="Balance tracking list"
        >
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
            Your Balance Entries
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {investmentEntries.length} investments, {debtEntries.length} debts
          </p>
          
          <BalanceTrackingList
            entries={balanceEntriesWithTimeline}
            onEdit={openEditModal}
            onDelete={handleDeleteBalanceEntry}
            isFreeTier={true}
            emptyMessage="No balance entries yet. Click the 'Add Balance Entry' button to get started!"
          />
        </section>

        {/* Navigation */}
        <nav className="mt-8 flex flex-wrap gap-4" aria-label="Page navigation">
          <a
            href="/"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Home
          </a>
          <a
            href="/income"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Income
          </a>
          <a
            href="/expenses"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Expenses
          </a>
          <a
            href="/savings-goals"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Savings Goals
          </a>
        </nav>
      </div>

      {/* Add Modal */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={(e) => e.target === e.currentTarget && closeModals()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-balance-entry-title"
          data-testid="add-balance-entry-modal"
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h3
                id="add-balance-entry-title"
                className="text-lg font-medium text-gray-900 dark:text-white"
              >
                Add Balance Entry
              </h3>
              <button
                onClick={closeModals}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                aria-label="Close modal"
                data-testid="add-balance-entry-close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <AddBalanceEntryForm
              onSubmit={handleAddBalanceEntry}
              onCancel={closeModals}
              isSubmitting={isSubmitting}
              isFreeTier={true}
            />
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && editingEntry && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={(e) => e.target === e.currentTarget && closeModals()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-balance-entry-title"
          data-testid="edit-balance-entry-modal"
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h3
                id="edit-balance-entry-title"
                className="text-lg font-medium text-gray-900 dark:text-white"
              >
                Edit Balance Entry
              </h3>
              <button
                onClick={closeModals}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                aria-label="Close modal"
                data-testid="edit-balance-entry-close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <EditBalanceEntryForm
              entry={editingEntry}
              onSubmit={handleUpdateBalanceEntry}
              onCancel={closeModals}
              isSubmitting={isSubmitting}
              isFreeTier={true}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default BalanceTrackingPage
