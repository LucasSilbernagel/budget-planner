import React, { useState, useEffect, useCallback } from 'react'
import BalanceEntryCard from './BalanceEntryCard'
import type { ClientBalanceTracking, BalanceTrackingWithTimeline } from '@budget-planner/core/services/balanceTracking'

/**
 * Props for BalanceTrackingList component
 */
export interface BalanceTrackingListProps {
  entries: (ClientBalanceTracking | BalanceTrackingWithTimeline)[]
  onEdit: (entry: ClientBalanceTracking) => void
  onDelete: (id: number) => void
  isLoading?: boolean
  isFreeTier?: boolean
  emptyMessage?: string
}

/**
 * BalanceTrackingList component
 * 
 * Displays a list of balance tracking entries using BalanceEntryCard components.
 * Supports empty state, loading state, and free/paid tier indicators.
 * 
 * AC 2: When viewing the balance tracking list, all entries are displayed sorted by creation date (newest first)
 * AC 2: Entries are grouped by type (investments vs debts)
 * 
 * @param props - Component props
 * @param props.entries - Array of balance tracking entries to display
 * @param props.onEdit - Callback when edit button is clicked
 * @param props.onDelete - Callback when delete button is clicked
 * @param props.isLoading - Whether data is currently loading
 * @param props.isFreeTier - Whether this is free tier (affects UI text)
 * @param props.emptyMessage - Custom message to display when list is empty
 */
export function BalanceTrackingList({
  entries,
  onEdit,
  onDelete,
  isLoading = false,
  isFreeTier = true,
  emptyMessage = 'No balance entries yet. Add your first entry to get started!',
}: BalanceTrackingListProps) {
  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState<string>('')

  // Close delete confirmation
  const handleCloseDeleteConfirm = useCallback(() => {
    setDeletingId(null)
    setDeleteConfirmName('')
  }, [])

  // Open delete confirmation
  const handleOpenDeleteConfirm = useCallback((entry: ClientBalanceTracking | BalanceTrackingWithTimeline) => {
    setDeletingId(entry.id)
    setDeleteConfirmName(entry.name)
  }, [])

  // Confirm and execute delete
  const handleConfirmDelete = useCallback(() => {
    if (deletingId !== null) {
      onDelete(deletingId)
      handleCloseDeleteConfirm()
    }
  }, [deletingId, onDelete, handleCloseDeleteConfirm])

  // Handle Escape key to close dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && deletingId !== null) {
        handleCloseDeleteConfirm()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deletingId, handleCloseDeleteConfirm])

  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 px-4"
        role="status"
        aria-live="polite"
        data-testid="balance-tracking-loading"
      >
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4" />
        <p className="text-gray-600 dark:text-gray-400">Loading balance entries...</p>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div
        className="text-center py-12 px-4 bg-gray-50 rounded-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700"
        role="status"
        aria-live="polite"
        data-testid="balance-tracking-empty"
      >
        <svg
          className="w-16 h-16 text-gray-400 mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Balance scale"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No Balance Entries
        </h3>
        <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          {emptyMessage}
        </p>
        {isFreeTier && (
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-4">
            Balance entries are stored in your browser's local storage
          </p>
        )}
      </div>
    )
  }

  // Sort entries by creation date (newest first) as per AC 2
  const sortedEntries = [...entries].sort((a, b) => {
    // Handle null/undefined createdAt by placing them at the end
    if (a.createdAt == null) return 1
    if (b.createdAt == null) return -1
    
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    // Handle invalid dates by placing them at the end
    if (isNaN(dateA)) return 1
    if (isNaN(dateB)) return -1
    return dateB - dateA // Newest first
  })

  // Group entries by type: investments first, then debts
  const investmentEntries = sortedEntries.filter((e) => e.type === 'investment')
  const debtEntries = sortedEntries.filter((e) => e.type === 'debt')

  return (
    <div
      className="space-y-4"
      role="list"
      aria-label="Balance tracking entries"
      data-testid="balance-tracking-list"
    >
      {/* Investment Entries Section */}
      {investmentEntries.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-green-700 dark:text-green-300 border-b border-green-200 dark:border-green-800 pb-2">
            Investments
          </h3>
          {investmentEntries.map((entry) => (
            <BalanceEntryCard
              key={entry.id}
              entry={entry}
              onEdit={onEdit}
              onDeleteConfirm={handleOpenDeleteConfirm}
              isFreeTier={isFreeTier}
            />
          ))}
        </section>
      )}

      {/* Debt Entries Section */}
      {debtEntries.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-red-700 dark:text-red-300 border-b border-red-200 dark:border-red-800 pb-2">
            Debts
          </h3>
          {debtEntries.map((entry) => (
            <BalanceEntryCard
              key={entry.id}
              entry={entry}
              onEdit={onEdit}
              onDeleteConfirm={handleOpenDeleteConfirm}
              isFreeTier={isFreeTier}
            />
          ))}
        </section>
      )}

      {/* Delete Confirmation Dialog (shared across all cards) */}
      {deletingId !== null && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
          aria-describedby="delete-confirm-description"
          onClick={handleCloseDeleteConfirm}
        >
          <div
            className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full max-w-[90vw] dark:bg-gray-800 dark:border dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-confirm-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Confirm Delete
            </h3>
            <p id="delete-confirm-description" className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to delete "{deleteConfirmName.length > 50 ? `${deleteConfirmName.slice(0, 47)}...` : deleteConfirmName}"? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCloseDeleteConfirm}
                className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                data-testid="delete-confirm-cancel"
                autoFocus
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 text-white font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 dark:bg-red-500 dark:hover:bg-red-600"
                data-testid="delete-confirm-confirm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BalanceTrackingList
