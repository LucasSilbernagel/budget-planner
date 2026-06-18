import React, { useState, useCallback, useEffect, useRef } from 'react'
import SavingsGoalsList from '../components/SavingsGoalsList'
import AddSavingsGoalForm from '../components/AddSavingsGoalForm'
import EditSavingsGoalForm from '../components/EditSavingsGoalForm'
import type { ClientSavingsGoal, ClientNewSavingsGoal } from '@budget-planner/core/services/savingsGoals'
import {
  useSavingsGoals,
  useSavingsGoalsWithProgress,
  useTotalSavings,
  useTotalTargetAmount,
  useOverallSavingsProgress,
  useSavingsActions,
} from '../stores/savingsStore'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { formatCurrency } from '@budget-planner/core/format/currency'

/**
 * Savings Goals Page
 * 
 * Main page for managing savings goals.
 * Uses TanStack Start file-based routing (route: /savings-goals)
 * 
 * Features:
 * - List of savings goals with progress display
 * - Add new savings goal form
 * - Edit existing savings goal form
 * - Success/error message display
 * - Loading states
 * - Full accessibility compliance
 * 
 * AC 2: When viewing the savings goals list, all goals are displayed sorted by creation date (newest first)
 */
export function SavingsGoalsPage() {
  // Get currency preferences from store
  const { mode, currency } = useCurrencyPreferences()

  // Format amount using current currency preferences
  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency })

  // Store data
  const savingsGoals = useSavingsGoals()
  const savingsGoalsWithProgress = useSavingsGoalsWithProgress()
  const totalSavings = useTotalSavings()
  const totalTarget = useTotalTargetAmount()
  const overallProgress = useOverallSavingsProgress()

  // Store actions
  const { addSavingsGoal, updateSavingsGoal, deleteSavingsGoal } = useSavingsActions()

  // Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<ClientSavingsGoal | null>(null)

  // Handle Escape key for modals
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

  // Open add modal
  const openAddModal = useCallback(() => {
    setIsAddModalOpen(true)
    setIsEditModalOpen(false)
    setEditingGoal(null)
  }, [])

  // Open edit modal
  const openEditModal = useCallback((goal: ClientSavingsGoal) => {
    setEditingGoal(goal)
    setIsEditModalOpen(true)
    setIsAddModalOpen(false)
  }, [])

  // Close all modals
  const closeModals = useCallback(() => {
    setIsAddModalOpen(false)
    setIsEditModalOpen(false)
    setEditingGoal(null)
  }, [])

  // Timer ref for cleanup
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Show notification with cleanup
  const showNotification = useCallback((type: 'success' | 'error', message: string) => {
    // Clear any existing timer
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current)
    }
    
    setNotification({ type, message })
    // Auto-hide after 5 seconds
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

  // Handle add savings goal
  const handleAddSavingsGoal = async (data: ClientNewSavingsGoal) => {
    setIsSubmitting(true)
    try {
      addSavingsGoal(data)
      showNotification('success', 'Savings goal created successfully!')
      closeModals()
    } catch (error) {
      showNotification('error', 'Failed to create savings goal')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle update savings goal
  const handleUpdateSavingsGoal = async (data: ClientNewSavingsGoal & { id: number }) => {
    setIsSubmitting(true)
    try {
      const result = updateSavingsGoal(data.id, {
        name: data.name,
        targetAmount: data.targetAmount,
        currentBalance: data.currentBalance,
      })

      if (result) {
        showNotification('success', 'Savings goal updated successfully!')
        closeModals()
      } else {
        showNotification('error', 'Failed to update savings goal - not found')
      }
    } catch (error) {
      showNotification('error', 'Failed to update savings goal')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle delete savings goal
  const handleDeleteSavingsGoal = async (id: number) => {
    if (!confirm('Are you sure you want to delete this savings goal? This action cannot be undone.')) {
      return
    }

    try {
      const result = deleteSavingsGoal(id)
      if (result) {
        showNotification('success', 'Savings goal deleted successfully!')
      } else {
        showNotification('error', 'Failed to delete savings goal - not found')
      }
    } catch (error) {
      showNotification('error', 'Failed to delete savings goal')
    }
  }

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-900"
      data-testid="savings-goals-page"
    >
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Notification */}
        {notification && (
          <div
            className={`mb-6 p-4 rounded-md ${notification.type === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}
            role="alert"
            aria-live="polite"
            data-testid="savings-goals-notification"
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
            data-testid="savings-goals-title"
          >
            Savings Goals
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Track, manage, and achieve your savings targets
          </p>
        </header>

        {/* Stats Overview */}
        <section
          className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6"
          aria-label="Savings statistics"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Total Savings */}
            <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">
                Total Saved
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatAmount(totalSavings)}
              </p>
            </div>

            {/* Total Target */}
            <div className="text-center p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <p className="text-sm text-purple-600 dark:text-purple-400 font-medium mb-1">
                Total Target
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatAmount(totalTarget)}
              </p>
            </div>

            {/* Overall Progress */}
            <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <p className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">
                Overall Progress
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {overallProgress}%
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2 dark:bg-gray-700">
                <div
                  className="bg-green-600 h-2 rounded-full"
                  style={{ width: `${overallProgress}%` }}
                  role="progressbar"
                  aria-valuenow={overallProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Add Button */}
        <div className="flex justify-end mb-6">
          <button
            onClick={openAddModal}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-400"
            aria-label="Add new savings goal"
            data-testid="savings-goals-add-button"
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
            Add Savings Goal
          </button>
        </div>

        {/* Savings Goals List */}
        <section
          className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6"
          aria-label="Savings goals list"
        >
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
            Your Savings Goals
          </h2>
          
          <SavingsGoalsList
            goals={savingsGoalsWithProgress}
            onEdit={openEditModal}
            onDelete={handleDeleteSavingsGoal}
            isFreeTier={true}
            emptyMessage="No savings goals yet. Click the 'Add Savings Goal' button to get started!"
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
        </nav>
      </div>

      {/* Add Modal */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={(e) => e.target === e.currentTarget && closeModals()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-savings-goal-title"
          data-testid="add-savings-goal-modal"
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h3
                id="add-savings-goal-title"
                className="text-lg font-medium text-gray-900 dark:text-white"
              >
                Add Savings Goal
              </h3>
              <button
                onClick={closeModals}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                aria-label="Close modal"
                data-testid="add-savings-goal-close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <AddSavingsGoalForm
              onSubmit={handleAddSavingsGoal}
              onCancel={closeModals}
              isSubmitting={isSubmitting}
              isFreeTier={true}
            />
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && editingGoal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={(e) => e.target === e.currentTarget && closeModals()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-savings-goal-title"
          data-testid="edit-savings-goal-modal"
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h3
                id="edit-savings-goal-title"
                className="text-lg font-medium text-gray-900 dark:text-white"
              >
                Edit Savings Goal
              </h3>
              <button
                onClick={closeModals}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                aria-label="Close modal"
                data-testid="edit-savings-goal-close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <EditSavingsGoalForm
              goal={editingGoal}
              onSubmit={handleUpdateSavingsGoal}
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

export default SavingsGoalsPage
