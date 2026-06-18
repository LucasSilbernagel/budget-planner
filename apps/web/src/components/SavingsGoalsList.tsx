import React from 'react'
import SavingsGoalCard from './SavingsGoalCard'
import type { ClientSavingsGoal, SavingsGoalWithProgress } from '@budget-planner/core/services/savingsGoals'

/**
 * Props for SavingsGoalsList component
 */
export interface SavingsGoalsListProps {
  goals: (ClientSavingsGoal | SavingsGoalWithProgress)[]
  onEdit: (goal: ClientSavingsGoal) => void
  onDelete: (id: number) => void
  isLoading?: boolean
  isFreeTier?: boolean
  emptyMessage?: string
}

/**
 * SavingsGoalsList component
 * 
 * Displays a list of savings goals using SavingsGoalCard components.
 * Supports empty state, loading state, and free/paid tier indicators.
 * 
 * AC 2: When viewing the savings goals list, all goals are displayed sorted by creation date (newest first)
 * 
 * @param props - Component props
 * @param props.goals - Array of savings goals to display
 * @param props.onEdit - Callback when edit button is clicked
 * @param props.onDelete - Callback when delete button is clicked
 * @param props.isLoading - Whether data is currently loading
 * @param props.isFreeTier - Whether this is free tier (affects UI text)
 * @param props.emptyMessage - Custom message to display when list is empty
 */
export function SavingsGoalsList({
  goals,
  onEdit,
  onDelete,
  isLoading = false,
  isFreeTier = true,
  emptyMessage = 'No savings goals yet. Add your first goal to get started!',
}: SavingsGoalsListProps) {
  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 px-4"
        role="status"
        aria-live="polite"
        data-testid="savings-goals-loading"
      >
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4" />
        <p className="text-gray-600 dark:text-gray-400">Loading savings goals...</p>
      </div>
    )
  }

  if (goals.length === 0) {
    return (
      <div
        className="text-center py-12 px-4 bg-gray-50 rounded-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700"
        role="status"
        aria-live="polite"
        data-testid="savings-goals-empty"
      >
        <svg
          className="w-16 h-16 text-gray-400 mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Piggy bank"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
        </svg>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No Savings Goals
        </h3>
        <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          {emptyMessage}
        </p>
        {isFreeTier && (
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-4">
            Savings goals will be stored in your browser's local storage.
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className="space-y-4"
      role="list"
      aria-label="Savings goals"
      data-testid="savings-goals-list"
    >
      {goals.map((goal) => (
        <SavingsGoalCard
          key={goal.id}
          goal={goal}
          onEdit={onEdit}
          onDelete={onDelete}
          isFreeTier={isFreeTier}
        />
      ))}
    </div>
  )
}

export default SavingsGoalsList
