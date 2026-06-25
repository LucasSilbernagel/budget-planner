import { currencySymbol, formatCurrency } from '@budget-planner/core/format/currency'
import type {
  ClientNewSavingsGoal,
  ValidationError,
} from '@budget-planner/core/services/savingsGoals'
import { validateSavingsGoal } from '@budget-planner/core/services/savingsGoals'
import React, { useState, useEffect } from 'react'
import { useCurrencyPreferences } from '../stores/currencyStore'

/**
 * Parse currency string to cents
 * Removes $, commas, and multiplies by 100
 * Rejects negative values, multiple decimal points, and invalid inputs
 */
function parseCurrencyToCents(value: string): number {
  if (!value || value.trim() === '') return 0

  // Remove all non-numeric characters except decimal point and minus sign
  const cleaned = value.replace(/[^\d.-]/g, '')

  // Reject if multiple decimal points
  if ((cleaned.match(/\./g) || []).length > 1) return 0

  // Reject if starts with minus sign (negative values)
  if (cleaned.startsWith('-')) return 0

  // Reject scientific notation
  if (cleaned.includes('e') || cleaned.includes('E')) return 0

  const amount = parseFloat(cleaned)

  // Reject NaN, Infinity, or negative values
  if (Number.isNaN(amount) || !Number.isFinite(amount) || amount < 0) return 0

  // Handle floating point precision by working with the string
  // Convert to cents directly from string to avoid IEEE 754 issues
  if (cleaned.includes('.')) {
    const [whole, decimal] = cleaned.split('.')
    const paddedDecimal = decimal.padEnd(2, '0').slice(0, 2)
    return parseInt(whole + paddedDecimal, 10) || 0
  }

  return parseInt(`${cleaned}00`, 10) || 0
}

/**
 * Props for AddSavingsGoalForm component
 */
export interface AddSavingsGoalFormProps {
  onSubmit: (data: ClientNewSavingsGoal) => void | Promise<void>
  onCancel: () => void
  isSubmitting?: boolean
  isFreeTier?: boolean
}

/**
 * AddSavingsGoalForm component
 *
 * Form for adding a new savings goal.
 * Includes validation and error display.
 *
 * Form Validation (from Dev Notes):
 * - name: Required, max 100 characters
 * - targetAmount: Required, positive integer (in cents)
 * - currentBalance: Required, non-negative integer (in cents), <= targetAmount
 *
 * @param props - Component props
 * @param props.onSubmit - Callback when form is submitted with valid data
 * @param props.onCancel - Callback when form is cancelled
 * @param props.isSubmitting - Whether form is currently submitting
 * @param props.isFreeTier - Whether this is free tier (affects UI text)
 */
export function AddSavingsGoalForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
  isFreeTier = true,
}: AddSavingsGoalFormProps) {
  // Get currency preferences from store
  const { mode, currency } = useCurrencyPreferences()
  const currencySymbolValue = currencySymbol(currency)

  // Format amount using current currency preferences
  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency })

  // Form state
  const [name, setName] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')

  // Validation and error state
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [submitAttempted, setSubmitAttempted] = useState(false)

  // Calculate amounts in cents for display
  const targetAmountCents = parseCurrencyToCents(targetAmount)
  const currentBalanceCents = parseCurrencyToCents(currentBalance)

  // Validate form on change
  useEffect(() => {
    if (submitAttempted) {
      // Re-validate on change after first submit attempt
      const newErrors = validateSavingsGoal({
        name,
        targetAmount: targetAmountCents,
        currentBalance: currentBalanceCents,
      })
      setErrors(newErrors)
    }
  }, [name, targetAmountCents, currentBalanceCents, submitAttempted])

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitAttempted(true)

    // Validate form
    const newErrors = validateSavingsGoal({
      name,
      targetAmount: targetAmountCents,
      currentBalance: currentBalanceCents,
    })
    setErrors(newErrors)

    if (newErrors.length > 0) {
      return
    }

    // Submit form
    await onSubmit({
      name: name.trim(),
      targetAmount: targetAmountCents,
      currentBalance: currentBalanceCents,
    })
  }

  /**
   * Get error message for a specific field
   */
  const getFieldError = (field: string): string | undefined => {
    const error = errors.find((e) => e.field === field)
    return error?.message
  }

  /**
   * Check if a field has an error
   */
  const hasFieldError = (field: string): boolean => {
    return errors.some((e) => e.field === field)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      noValidate
      data-testid="add-savings-goal-form"
    >
      {/* Name Field */}
      <div>
        <label
          htmlFor="savings-goal-name"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Savings Goal Name *
        </label>
        <input
          id="savings-goal-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Vacation Fund, Emergency Savings"
          maxLength={100}
          className={`w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white dark:border-gray-600 ${
            hasFieldError('name')
              ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
              : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
          }`}
          aria-invalid={hasFieldError('name')}
          aria-describedby={hasFieldError('name') ? 'savings-goal-name-error' : undefined}
          data-testid="savings-goal-name-input"
        />
        {hasFieldError('name') && (
          <p
            id="savings-goal-name-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('name')}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Max 100 characters</p>
      </div>

      {/* Target Amount Field */}
      <div>
        <label
          htmlFor="savings-goal-target-amount"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Target Amount *
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 dark:text-gray-400">
            {currencySymbolValue}
          </span>
          <input
            id="savings-goal-target-amount"
            type="text"
            inputMode="decimal"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            placeholder="e.g., 5000.00"
            className={`w-full pl-7 pr-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white dark:border-gray-600 ${
              hasFieldError('targetAmount')
                ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
            }`}
            aria-invalid={hasFieldError('targetAmount')}
            aria-describedby={
              hasFieldError('targetAmount') ? 'savings-goal-target-amount-error' : undefined
            }
            data-testid="savings-goal-target-amount-input"
          />
        </div>
        {hasFieldError('targetAmount') && (
          <p
            id="savings-goal-target-amount-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('targetAmount')}
          </p>
        )}
        {targetAmountCents > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            = {formatAmount(targetAmountCents)}
          </p>
        )}
      </div>

      {/* Current Balance Field */}
      <div>
        <label
          htmlFor="savings-goal-current-balance"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Current Balance *
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 dark:text-gray-400">
            {currencySymbolValue}
          </span>
          <input
            id="savings-goal-current-balance"
            type="text"
            inputMode="decimal"
            value={currentBalance}
            onChange={(e) => setCurrentBalance(e.target.value)}
            placeholder="e.g., 1000.00"
            className={`w-full pl-7 pr-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white dark:border-gray-600 ${
              hasFieldError('currentBalance')
                ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
            }`}
            aria-invalid={hasFieldError('currentBalance')}
            aria-describedby={
              hasFieldError('currentBalance')
                ? 'savings-goal-current-balance-error'
                : 'savings-goal-current-balance-help'
            }
            data-testid="savings-goal-current-balance-input"
          />
        </div>
        {hasFieldError('currentBalance') && (
          <p
            id="savings-goal-current-balance-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('currentBalance')}
          </p>
        )}
        {currentBalanceCents > 0 && !hasFieldError('currentBalance') && (
          <p
            id="savings-goal-current-balance-help"
            className="text-xs text-gray-500 dark:text-gray-400 mt-1"
          >
            = {formatAmount(currentBalanceCents)}
          </p>
        )}
        {targetAmountCents > 0 &&
          currentBalanceCents > 0 &&
          currentBalanceCents <= targetAmountCents && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              {Math.round((currentBalanceCents / targetAmountCents) * 100)}% of target
            </p>
          )}
      </div>

      {/* Form Validation Summary */}
      {errors.length > 0 && submitAttempted && (
        <div
          className="p-3 bg-red-50 border border-red-200 rounded-md dark:bg-red-900/30 dark:border-red-800"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-sm text-red-700 dark:text-red-300">
            Please fix the errors above to continue.
          </p>
        </div>
      )}

      {/* Form Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting || (submitAttempted && errors.length > 0)}
          className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-400"
          data-testid="savings-goal-submit"
        >
          {isSubmitting ? (
            <>
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white border-t-transparent mr-2 inline-block" />
              Creating...
            </>
          ) : (
            'Create Savings Goal'
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:focus:ring-gray-400"
          data-testid="savings-goal-cancel"
        >
          Cancel
        </button>
      </div>

      {isFreeTier && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center pt-2 border-t border-gray-200 dark:border-gray-700">
          * Savings goals are stored in your browser for free tier
        </p>
      )}
    </form>
  )
}

export default AddSavingsGoalForm
