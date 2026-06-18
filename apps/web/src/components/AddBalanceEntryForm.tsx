import React, { useState, useEffect } from 'react'
import type { ClientNewBalanceTracking, ValidationError } from '@budget-planner/core/services/balanceTracking'
import { validateBalanceTracking } from '@budget-planner/core/services/balanceTracking'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { formatCurrency, formatForInput, parseCurrencyToCents, currencySymbol } from '@budget-planner/core/format/currency'
import type { FinanceType } from '@budget-planner/db'

/**
 * Props for AddBalanceEntryForm component
 */
export interface AddBalanceEntryFormProps {
  onSubmit: (data: ClientNewBalanceTracking) => void | Promise<void>
  onCancel: () => void
  isSubmitting?: boolean
  isFreeTier?: boolean
}

/**
 * AddBalanceEntryForm component
 * 
 * Form for adding a new balance tracking entry.
 * Includes validation and error display.
 * 
 * Form Validation (from Dev Notes):
 * - name: Required, max 100 characters
 * - type: Required, must be 'investment' or 'debt'
 * - currentBalance: Required, integer (in cents, can be negative)
 * - maxContributionLimit: Optional, non-negative integer (in cents)
 * - monthlyContribution: Optional, non-negative integer (in cents)
 * 
 * @param props - Component props
 * @param props.onSubmit - Callback when form is submitted with valid data
 * @param props.onCancel - Callback when form is cancelled
 * @param props.isSubmitting - Whether form is currently submitting
 * @param props.isFreeTier - Whether this is free tier (affects UI text)
 */
export function AddBalanceEntryForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
  isFreeTier = true,
}: AddBalanceEntryFormProps) {
  // Get currency preferences from store
  const { mode, currency } = useCurrencyPreferences()
  const currencySymbolValue = currencySymbol(currency)

  // Format amount using current currency preferences
  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency })

  // Valid finance types
  const validTypes: FinanceType[] = ['investment', 'debt']

  // Form state
  const [name, setName] = useState('')
  const [type, setType] = useState<FinanceType>('investment')
  const [currentBalance, setCurrentBalance] = useState('')
  const [maxContributionLimit, setMaxContributionLimit] = useState('')
  const [monthlyContribution, setMonthlyContribution] = useState('')

  // Validation and error state
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [submitAttempted, setSubmitAttempted] = useState(false)

  // Calculate amounts in cents for display
  const currentBalanceCents = parseCurrencyToCents(currentBalance)
  const maxContributionLimitCents = parseCurrencyToCents(maxContributionLimit)
  const monthlyContributionCents = parseCurrencyToCents(monthlyContribution)

  // Validate form on change
  useEffect(() => {
    if (submitAttempted) {
      // Re-validate on change after first submit attempt
      const newErrors = validateBalanceTracking({
        name,
        type,
        currentBalance: currentBalanceCents,
        maxContributionLimit: maxContributionLimitCents !== 0 ? maxContributionLimitCents : undefined,
        monthlyContribution: monthlyContributionCents,
      })
      setErrors(newErrors)
    }
  }, [name, type, currentBalance, maxContributionLimit, monthlyContribution, currentBalanceCents, maxContributionLimitCents, monthlyContributionCents, submitAttempted])

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitAttempted(true)

    // Validate form
    const newErrors = validateBalanceTracking({
      name,
      type,
      currentBalance: currentBalanceCents,
      maxContributionLimit: maxContributionLimitCents !== 0 ? maxContributionLimitCents : undefined,
      monthlyContribution: monthlyContributionCents,
    })
    setErrors(newErrors)

    if (newErrors.length > 0) {
      return
    }

    // Submit form
    await onSubmit({
      name: name.trim(),
      type,
      currentBalance: currentBalanceCents,
      maxContributionLimit: maxContributionLimitCents !== 0 ? maxContributionLimitCents : undefined,
      monthlyContribution: monthlyContributionCents,
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
      data-testid="add-balance-entry-form"
    >
      {/* Name Field */}
      <div>
        <label
          htmlFor="balance-entry-name"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Entry Name *
        </label>
        <input
          id="balance-entry-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., 401k, Student Loan"
          maxLength={100}
          className={`w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white dark:border-gray-600 ${
            hasFieldError('name')
              ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
              : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
          }`}
          aria-invalid={hasFieldError('name')}
          aria-describedby={hasFieldError('name') ? 'balance-entry-name-error' : undefined}
          data-testid="balance-entry-name-input"
        />
        {hasFieldError('name') && (
          <p
            id="balance-entry-name-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('name')}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Max 100 characters
        </p>
      </div>

      {/* Type Field */}
      <div>
        <label
          htmlFor="balance-entry-type"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Type *
        </label>
        <select
          id="balance-entry-type"
          value={type}
          onChange={(e) => {
            const value = e.target.value as FinanceType
            if (validTypes.includes(value)) {
              setType(value)
            }
          }}
          className={`w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white dark:border-gray-600 ${
            hasFieldError('type')
              ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
              : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
          }`}
          aria-invalid={hasFieldError('type')}
          aria-describedby={hasFieldError('type') ? 'balance-entry-type-error' : undefined}
          data-testid="balance-entry-type-select"
        >
          <option value="investment">Investment</option>
          <option value="debt">Debt</option>
        </select>
        {hasFieldError('type') && (
          <p
            id="balance-entry-type-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('type')}
          </p>
        )}
      </div>

      {/* Current Balance Field */}
      <div>
        <label
          htmlFor="balance-entry-current-balance"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Current Balance *
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 dark:text-gray-400">
            {currencySymbolValue}
          </span>
          <input
            id="balance-entry-current-balance"
            type="text"
            inputMode="decimal"
            value={currentBalance}
            onChange={(e) => setCurrentBalance(e.target.value)}
            placeholder="e.g., 5000.00"
            className={`w-full pl-7 pr-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white dark:border-gray-600 ${
              hasFieldError('currentBalance')
                ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
            }`}
            aria-invalid={hasFieldError('currentBalance')}
            aria-describedby={hasFieldError('currentBalance') ? 'balance-entry-current-balance-error' : 'balance-entry-current-balance-help'}
            data-testid="balance-entry-current-balance-input"
          />
        </div>
        {hasFieldError('currentBalance') && (
          <p
            id="balance-entry-current-balance-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('currentBalance')}
          </p>
        )}
        {currentBalanceCents !== 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            = {formatAmount(currentBalanceCents)}
          </p>
        )}
      </div>

      {/* Max Contribution Limit Field */}
      <div>
        <label
          htmlFor="balance-entry-max-limit"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Max Contribution Limit (Optional)
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 dark:text-gray-400">
            {currencySymbolValue}
          </span>
          <input
            id="balance-entry-max-limit"
            type="text"
            inputMode="decimal"
            value={maxContributionLimit}
            onChange={(e) => setMaxContributionLimit(e.target.value)}
            placeholder="e.g., 50000.00"
            className={`w-full pl-7 pr-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white dark:border-gray-600 ${
              hasFieldError('maxContributionLimit')
                ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
            }`}
            aria-invalid={hasFieldError('maxContributionLimit')}
            aria-describedby={hasFieldError('maxContributionLimit') ? 'balance-entry-max-limit-error' : 'balance-entry-max-limit-help'}
            data-testid="balance-entry-max-limit-input"
          />
        </div>
        {hasFieldError('maxContributionLimit') && (
          <p
            id="balance-entry-max-limit-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('maxContributionLimit')}
          </p>
        )}
        {maxContributionLimitCents > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            = {formatAmount(maxContributionLimitCents)}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Leave blank if no limit (required for timeline calculation)
        </p>
      </div>

      {/* Monthly Contribution Field */}
      <div>
        <label
          htmlFor="balance-entry-monthly-contribution"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Monthly Contribution *
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 dark:text-gray-400">
            {currencySymbolValue}
          </span>
          <input
            id="balance-entry-monthly-contribution"
            type="text"
            inputMode="decimal"
            value={monthlyContribution}
            onChange={(e) => setMonthlyContribution(e.target.value)}
            placeholder="e.g., 500.00"
            className={`w-full pl-7 pr-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white dark:border-gray-600 ${
              hasFieldError('monthlyContribution')
                ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
            }`}
            aria-invalid={hasFieldError('monthlyContribution')}
            aria-describedby={hasFieldError('monthlyContribution') ? 'balance-entry-monthly-contribution-error' : 'balance-entry-monthly-contribution-help'}
            data-testid="balance-entry-monthly-contribution-input"
          />
        </div>
        {hasFieldError('monthlyContribution') && (
          <p
            id="balance-entry-monthly-contribution-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('monthlyContribution')}
          </p>
        )}
        {monthlyContributionCents > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            = {formatAmount(monthlyContributionCents)}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Required for timeline calculation
        </p>
      </div>

      {/* Timeline Preview */}
      {maxContributionLimitCents > 0 && monthlyContributionCents > 0 && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md dark:bg-blue-900/20 dark:border-blue-800">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Timeline Preview:
            <span className="font-medium ml-1">
              {monthlyContributionCents !== 0
                ? Math.max(0, Math.ceil((maxContributionLimitCents - currentBalanceCents) / monthlyContributionCents))
                : 0}
              months to limit
            </span>
          </p>
        </div>
      )}

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
          data-testid="balance-entry-submit"
        >
          {isSubmitting ? (
            <>
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white border-t-transparent mr-2 inline-block" />
              Creating...
            </>
          ) : (
            'Create Balance Entry'
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:focus:ring-gray-400"
          data-testid="balance-entry-cancel"
        >
          Cancel
        </button>
      </div>

      {isFreeTier && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center pt-2 border-t border-gray-200 dark:border-gray-700">
          * Balance entries are stored in your browser's local storage
        </p>
      )}
    </form>
  )
}

export default AddBalanceEntryForm
