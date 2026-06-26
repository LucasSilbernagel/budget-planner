import { formatCurrency } from '@budget-planner/core/format/currency'
import type {
  BalanceTrackingWithTimeline,
  ClientBalanceTracking,
} from '@budget-planner/core/services/balanceTracking'
import { getTypeDisplayProperties } from '@budget-planner/core/services/balanceTracking'
import {
  calculateContributionProgress,
  formatProgress,
  formatTimeline,
} from '@budget-planner/core/utils/balanceCalculations'
import React from 'react'
import { useCurrencyPreferences } from '../stores/currencyStore'

/**
 * BalanceEntryCard component props
 */
export interface BalanceEntryCardProps {
  entry: ClientBalanceTracking | BalanceTrackingWithTimeline
  onEdit: (entry: ClientBalanceTracking) => void
  onDeleteConfirm: (entry: ClientBalanceTracking | BalanceTrackingWithTimeline) => void
  isFreeTier?: boolean
}

/**
 * BalanceEntryCard component
 *
 * Displays a single balance tracking entry with its timeline and provides edit/delete actions.
 * Handles both investment and debt types with appropriate styling.
 *
 * AC 5: Investment entries displayed with positive growth indicators, debt entries with negative balance indicators
 *
 * @param props - Component props
 * @param props.entry - Balance tracking entry data to display
 * @param props.onEdit - Callback when edit button is clicked
 * @param props.onDelete - Callback when delete button is clicked
 * @param props.isFreeTier - Whether this is free tier (affects UI text)
 */
export function BalanceEntryCard({
  entry,
  onEdit,
  onDeleteConfirm,
  isFreeTier = true,
}: BalanceEntryCardProps) {
  // Get currency preferences from store
  const { mode, currency } = useCurrencyPreferences()

  // Format amount using current currency preferences
  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency })

  // Get display properties based on type
  const typeProps = getTypeDisplayProperties(entry.type)

  // Calculate timeline and progress if not already present
  const monthsToLimit = 'monthsToLimit' in entry ? entry.monthsToLimit : null
  const progress =
    entry.maxContributionLimit !== undefined && entry.maxContributionLimit > 0
      ? calculateContributionProgress(entry.currentBalance, entry.maxContributionLimit)
      : null

  // Format dates for display - guard against invalid dates
  let createdDate = 'Invalid Date'
  try {
    const date = new Date(entry.createdAt)
    if (!Number.isNaN(date.getTime())) {
      createdDate = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    }
  } catch {
    createdDate = 'Invalid Date'
  }

  // Determine if this is a debt (negative balance indicator)
  const isDebt = entry.type === 'debt'
  const displayBalance = isDebt ? -entry.currentBalance : entry.currentBalance
  const balanceSign = isDebt ? '-' : ''

  return (
    <div
      className="bg-white rounded-lg shadow-md p-6 border border-gray-200 dark:bg-gray-800 dark:border-gray-700"
      role="article"
      aria-labelledby={`balance-entry-${entry.id}-name`}
      data-testid={`balance-entry-card-${entry.id}`}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3
              id={`balance-entry-${entry.id}-name`}
              className="text-lg font-semibold text-gray-900 dark:text-white truncate"
            >
              {entry.name}
            </h3>
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${typeProps.bgColorClass} ${typeProps.colorClass}`}
              role="status"
              aria-label={`Type: ${entry.type}`}
            >
              {typeProps.icon} {typeProps.label}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Created: {createdDate}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onEdit(entry)}
            className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-100 rounded-md hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400 dark:bg-blue-900/30 dark:hover:bg-blue-900/50"
            aria-label={`Edit balance entry ${entry.name}`}
            data-testid={`balance-entry-edit-${entry.id}`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDeleteConfirm(entry)}
            className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-100 rounded-md hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500 dark:text-red-400 dark:bg-red-900/30 dark:hover:bg-red-900/50"
            aria-label={`Delete balance entry ${entry.name}`}
            data-testid={`balance-entry-delete-${entry.id}`}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Current Balance */}
        <div className="flex justify-between text-sm">
          <span className="text-gray-600 dark:text-gray-400">Current Balance</span>
          <span
            className={`font-semibold ${
              isDebt ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
            }`}
          >
            {balanceSign}
            {formatAmount(displayBalance)}
          </span>
        </div>

        {/* Monthly Contribution */}
        <div className="flex justify-between text-sm">
          <span className="text-gray-600 dark:text-gray-400">Monthly Contribution</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {formatAmount(entry.monthlyContribution)}
          </span>
        </div>

        {/* Max Contribution Limit */}
        {entry.maxContributionLimit !== undefined && entry.maxContributionLimit > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">Max Limit</span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {formatAmount(entry.maxContributionLimit)}
            </span>
          </div>
        )}

        {/* Progress Bar (if limit is set) */}
        {progress !== null && (
          <div className="space-y-1 pt-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">{formatProgress(progress)}</span>
              <span className="text-gray-600 dark:text-gray-400">
                {formatTimeline(monthsToLimit)}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
              <div
                className={`h-2.5 rounded-full ${isDebt ? 'bg-red-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(progress || 0, 100)}%` }}
                role="progressbar"
                aria-valuenow={progress || 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progress: ${progress || 0}%`}
                data-testid={`balance-entry-progress-${entry.id}`}
              />
            </div>
          </div>
        )}

        {isFreeTier && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center pt-2 border-t border-gray-200 dark:border-gray-700">
            Balance entries are stored in your browser's local storage
          </p>
        )}
      </div>
    </div>
  )
}

export default BalanceEntryCard
