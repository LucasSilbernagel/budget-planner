import { formatCurrency } from '@budget-planner/core/format/currency'
import type {
  ClientSavingsGoal,
  SavingsGoalWithProgress,
} from '@budget-planner/core/services/savingsGoals'
import * as RadixDialog from '@radix-ui/react-dialog'
import React from 'react'
import { useCurrencyPreferences } from '../stores/currencyStore'

/**
 * SavingsGoalCard component props
 */
export interface SavingsGoalCardProps {
  goal: ClientSavingsGoal | SavingsGoalWithProgress
  onEdit: (goal: ClientSavingsGoal) => void
  onDelete: (id: number) => void
  isFreeTier?: boolean
}

/**
 * Format percentage for display
 */
function formatPercentage(percentage: number): string {
  return `${Math.round(percentage)}%`
}

/**
 * Get progress bar color based on progress percentage
 */
function getProgressColor(progress: number): string {
  if (progress >= 100) return 'bg-green-500'
  if (progress >= 75) return 'bg-blue-500'
  if (progress >= 50) return 'bg-purple-500'
  if (progress >= 25) return 'bg-orange-500'
  return 'bg-red-500'
}

/**
 * SavingsGoalCard component
 *
 * Displays a single savings goal with its progress and provides edit/delete actions.
 * Used in SavingsGoalsList.
 *
 * @param props - Component props
 * @param props.goal - Savings goal data to display
 * @param props.onEdit - Callback when edit button is clicked
 * @param props.onDelete - Callback when delete button is clicked
 * @param props.isFreeTier - Whether this is free tier (affects UI text)
 */
export function SavingsGoalCard({
  goal,
  onEdit,
  onDelete,
  isFreeTier = true,
}: SavingsGoalCardProps) {
  // Get currency preferences from store
  const { mode, currency } = useCurrencyPreferences()

  // Format amount using current currency preferences
  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency })

  // Calculate progress if not already present
  // Guard against division by zero and cap at 100%
  const progress =
    'progress' in goal
      ? goal.progress
      : goal.targetAmount <= 0
        ? 0
        : Math.min(100, Math.round((goal.currentBalance / goal.targetAmount) * 100))
  const status =
    'status' in goal
      ? goal.status
      : progress >= 100
        ? 'complete'
        : progress > 0
          ? 'on-track'
          : 'not-started'

  // Format dates for display - guard against invalid dates
  let createdDate = 'Invalid Date'
  try {
    const date = new Date(goal.createdAt)
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

  return (
    <div
      className="bg-white rounded-lg shadow-md p-6 border border-gray-200 dark:bg-gray-800 dark:border-gray-700"
      role="article"
      aria-labelledby={`savings-goal-${goal.id}-name`}
      data-testid={`savings-goal-card-${goal.id}`}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3
            id={`savings-goal-${goal.id}-name`}
            className="text-lg font-semibold text-gray-900 dark:text-white truncate"
          >
            {goal.name}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Created: {createdDate}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onEdit(goal)}
            className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-100 rounded-md hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400 dark:bg-blue-900/30 dark:hover:bg-blue-900/50"
            aria-label={`Edit savings goal ${goal.name}`}
            data-testid={`savings-goal-edit-${goal.id}`}
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(goal.id)}
            className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-100 rounded-md hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500 dark:text-red-400 dark:bg-red-900/30 dark:hover:bg-red-900/50"
            aria-label={`Delete savings goal ${goal.name}`}
            data-testid={`savings-goal-delete-${goal.id}`}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              {formatPercentage(progress)} Complete
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              {formatAmount(goal.targetAmount)} Target
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
            <div
              className={`h-2.5 rounded-full ${getProgressColor(progress)}`}
              style={{ width: `${Math.min(progress, 100)}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progress: ${progress}%`}
              data-testid={`savings-goal-progress-${goal.id}`}
            />
          </div>
        </div>

        {/* Amount Details */}
        <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">Current Balance</p>
            <p className="text-lg font-semibold text-green-600 dark:text-green-400">
              {formatAmount(goal.currentBalance)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">Target Amount</p>
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
              {formatAmount(goal.targetAmount)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">Remaining</p>
            <p className="text-lg font-semibold text-orange-600 dark:text-orange-400">
              {formatAmount(Math.max(0, goal.targetAmount - goal.currentBalance))}
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex justify-end">
          <span
            className={`px-2 py-1 text-xs font-medium rounded-full ${
              status === 'complete'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                : status === 'on-track'
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                  : status === 'not-started'
                    ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                    : status === 'behind'
                      ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
                      : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
            }`}
            role="status"
            aria-live="polite"
          >
            {status === 'complete' && '✓ Complete'}
            {status === 'on-track' && '↗ On Track'}
            {status === 'not-started' && '○ Not Started'}
            {status === 'behind' && '⚠ Behind'}
          </span>
        </div>

        {isFreeTier && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center pt-2 border-t border-gray-200 dark:border-gray-700">
            Data stored locally in your browser
          </p>
        )}
      </div>
    </div>
  )
}

export default SavingsGoalCard
