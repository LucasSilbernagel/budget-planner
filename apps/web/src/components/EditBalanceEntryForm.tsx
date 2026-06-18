import React, { useState, useEffect } from 'react'
import type { ClientBalanceTracking, ClientNewBalanceTracking, ValidationError } from '@budget-planner/core/services/balanceTracking'
import { validateBalanceTracking } from '@budget-planner/core/services/balanceTracking'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { formatCurrency, currencySymbol } from '@budget-planner/core/format/currency'
import type { FinanceType } from '@budget-planner/db'

/**
 * Parse currency string to cents
 */
function parseCurrencyToCents(value: string): number {
  if (!value || value.trim() === '') return 0
  
  const cleaned = value.replace(/[^\d.-]/g, '')
  if ((cleaned.match(/\./g) || []).length > 1) return 0
  if (cleaned.includes('e') || cleaned.includes('E')) return 0
  
  const amount = parseFloat(cleaned)
  if (isNaN(amount) || !isFinite(amount)) return 0
  
  if (cleaned.includes('.')) {
    const [whole, decimal] = cleaned.split('.')
    const paddedDecimal = decimal.padEnd(2, '0').slice(0, 2)
    return parseInt(whole + paddedDecimal, 10) || 0
  }
  
  return parseInt(cleaned + '00', 10) || 0
}

/**
 * Format cents to currency string for input display
 */
function formatCentsToCurrency(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Props for EditBalanceEntryForm component
 */
export interface EditBalanceEntryFormProps {
  entry: ClientBalanceTracking
  onSubmit: (data: ClientNewBalanceTracking & { id: number }) => void | Promise<void>
  onCancel: () => void
  isSubmitting?: boolean
  isFreeTier?: boolean
}

/**
 * EditBalanceEntryForm component
 * 
 * Form for editing an existing balance tracking entry.
 * Includes validation and error display.
 * Pre-fills with existing entry data.
 * 
 * @param props - Component props
 * @param props.entry - Balance tracking entry to edit
 * @param props.onSubmit - Callback when form is submitted with valid data
 * @param props.onCancel - Callback when form is cancelled
 * @param props.isSubmitting - Whether form is currently submitting
 * @param props.isFreeTier - Whether this is free tier (affects UI text)
 */
export function EditBalanceEntryForm({
  entry,
  onSubmit,
  onCancel,
  isSubmitting = false,
  isFreeTier = true,
}: EditBalanceEntryFormProps) {
  // Get currency preferences from store
  const { mode, currency } = useCurrencyPreferences()
  const currencySymbolValue = currencySymbol(currency)

  // Format amount using current currency preferences
  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency })

  // Form state - pre-fill with existing entry data
  const [name, setName] = useState(entry.name)
  const [type, setType] = useState<FinanceType>(entry.type)
  const [currentBalance, setCurrentBalance] = useState(formatCentsToCurrency(entry.currentBalance))
  const [maxContributionLimit, setMaxContributionLimit] = useState(
    entry.maxContributionLimit ? formatCentsToCurrency(entry.maxContributionLimit) : ''
  )
  const [monthlyContribution, setMonthlyContribution] = useState(
    formatCentsToCurrency(entry.monthlyContribution)
  )

  // Validation and error state
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [submitAttempted, setSubmitAttempted] = useState(false)

  // Calculate amounts in cents for validation
  const currentBalanceCents = parseCurrencyToCents(currentBalance)
  const maxContributionLimitCents = parseCurrencyToCents(maxContributionLimit)
  const monthlyContributionCents = parseCurrencyToCents(monthlyContribution)

  // Validate form on change
  useEffect(() => {
    if (submitAttempted) {
      const newErrors = validateBalanceTracking({
        name,
        type,
        currentBalance: currentBalanceCents,
        maxContributionLimit: maxContributionLimitCents || undefined,
        monthlyContribution: monthlyContributionCents,
      })
      setErrors(newErrors)
    }
  }, [name, type, currentBalance, maxContributionLimit, monthlyContribution, submitAttempted])

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitAttempted(true)

    const newErrors = validateBalanceTracking({
      name,
      type,
      currentBalance: currentBalanceCents,
      maxContributionLimit: maxContributionLimitCents || undefined,
      monthlyContribution: monthlyContributionCents,
    })
    setErrors(newErrors)

    if (newErrors.length > 0) {
      return
    }

    // Submit form with ID for update
    await onSubmit({
      id: entry.id,
      name: name.trim(),
      type,
      currentBalance: currentBalanceCents,
      maxContributionLimit: maxContributionLimitCents || undefined,
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
      data-testid="edit-balance-entry-form"
    >
      {/* Name Field */}
      <div>
        <label
          htmlFor="edit-balance-entry-name"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Entry Name *
        </label>
        <input
          id="edit-balance-entry-name"
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
          aria-describedby={hasFieldError('name') ? 'edit-balance-entry-name-error' : undefined}
          data-testid="edit-balance-entry-name-input"
        />
        {hasFieldError('name') && (
          <p
            id="edit-balance-entry-name-error"
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
          htmlFor="edit-balance-entry-type"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Type *
        </label>
        <select
          id="edit-balance-entry-type"
          value={type}
          onChange={(e) => setType(e.target.value as FinanceType)}
          className={`w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white dark:border-gray-600 ${
            hasFieldError('type')
              ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
              : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
          }`}
          aria-invalid={hasFieldError('type')}
          aria-describedby={hasFieldError('type') ? 'edit-balance-entry-type-error' : undefined}
          data-testid="edit-balance-entry-type-select"
        >
          <option value="investment">Investment</option>
          <option value="debt">Debt</option>
        </select>
        {hasFieldError('type') && (
          <p
            id="edit-balance-entry-type-error"
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
          htmlFor="edit-balance-entry-current-balance"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Current Balance *
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 dark:text-gray-400">
            {currencySymbolValue}
          </span>
          <input
            id="edit-balance-entry-current-balance"
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
            aria-describedby={hasFieldError('currentBalance') ? 'edit-balance-entry-current-balance-error' : 'edit-balance-entry-current-balance-help'}
            data-testid="edit-balance-entry-current-balance-input"
          />
        </div>
        {hasFieldError('currentBalance') && (
          <p
            id="edit-balance-entry-current-balance-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('currentBalance')}
          </p>
        )}
        {currentBalanceCents !== 0 && !hasFieldError('currentBalance') && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            = {currencySymbolValue}{formatAmount(currentBalanceCents)}
          </p>
        )}
      </div>

      {/* Max Contribution Limit Field */}
      <div>
        <label
          htmlFor="edit-balance-entry-max-limit"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Max Contribution Limit (Optional)
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 dark:text-gray-400">
            {currencySymbolValue}
          </span>
          <input
            id="edit-balance-entry-max-limit"
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
            aria-describedby={hasFieldError('maxContributionLimit') ? 'edit-balance-entry-max-limit-error' : 'edit-balance-entry-max-limit-help'}
            data-testid="edit-balance-entry-max-limit-input"
          />
        </div>
        {hasFieldError('maxContributionLimit') && (
          <p
            id="edit-balance-entry-max-limit-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('maxContributionLimit')}
          </p>
        )}
        {maxContributionLimitCents > 0 && !hasFieldError('maxContributionLimit') && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            = {currencySymbolValue}{formatAmount(maxContributionLimitCents)}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Leave blank if no limit
        </p>
      </div>

      {/* Monthly Contribution Field */}
      <div>
        <label
          htmlFor="edit-balance-entry-monthly-contribution"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Monthly Contribution *
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 dark:text-gray-400">
            {currencySymbolValue}
          </span>
          <input
            id="edit-balance-entry-monthly-contribution"
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
            aria-describedby={hasFieldError('monthlyContribution') ? 'edit-balance-entry-monthly-contribution-error' : 'edit-balance-entry-monthly-contribution-help'}
            data-testid="edit-balance-entry-monthly-contribution-input"
          />
        </div>
        {hasFieldError('monthlyContribution') && (
          <p
            id="edit-balance-entry-monthly-contribution-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('monthlyContribution')}
          </p>
        )}
        {monthlyContributionCents > 0 && !hasFieldError('monthlyContribution') && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            = {currencySymbolValue}{formatAmount(monthlyContributionCents)}
          </p>
        )}
      </div>

      {/* Timeline Preview */}
      {maxContributionLimitCents > 0 && monthlyContributionCents > 0 && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md dark:bg-blue-900/20 dark:border-blue-800">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Timeline Preview:
            <span className="font-medium ml-1">
              {Math.ceil((maxContributionLimitCents - currentBalanceCents) / monthlyContributionCents)} months to limit
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
          data-testid="edit-balance-entry-submit"
        >
          {isSubmitting ? (
            <>
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white border-t-transparent mr-2 inline-block" />
              Updating...
            </>
          ) : (
            'Update Balance Entry'
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:focus:ring-gray-400"
          data-testid="edit-balance-entry-cancel"
        >
          Cancel
        </button>
      </div>

      {isFreeTier && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center pt-2 border-t border-gray-200 dark:border-gray-700">
          * Changes are saved to your browser's local storage
        </p>
      )}
    </form>
  )
}

export default EditBalanceEntryForm
