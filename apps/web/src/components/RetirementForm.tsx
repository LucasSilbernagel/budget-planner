import { formatCurrency } from '@budget-planner/core/format/currency'
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useFinancialCalculations } from '../hooks/useFinancialCalculations'
import { useBalanceStore } from '../stores/balanceStore'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { useIncomeStore } from '../stores/incomeStore'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * Props for RetirementForm component
 */
export interface RetirementFormProps {
  onCalculate?: (requiredAssets: number, monthlyIncome: number, annualReturnRate: number) => void
  preFillFromExistingData?: boolean
  /**
   * Savings rate as decimal (e.g., 0.5 for 50%)
   * Default: 0.5 (50% of income saved annually)
   */
  savingsRate?: number
}

/**
 * Parse percentage string to decimal
 * Converts "6%" or "6" to 0.06
 * Handles decimal percentages like "6.5%" -> 0.065
 *
 * @param value - Percentage string input from user
 * @returns Decimal value (e.g., 0.06 for 6%) or 0 for empty string
 * @throws Error for invalid percentage format (null/undefined, multiple decimal points, negative values,
 *        non-numeric characters, scientific notation, Infinity)
 */
function parsePercentageToDecimal(value: string): number {
  // Handle null/undefined
  if (value == null) {
    throw new Error('Invalid percentage: value cannot be null or undefined')
  }

  if (value.trim() === '') {
    return 0
  }

  const trimmed = value.trim()

  // Check for multiple decimal points
  const decimalCount = (trimmed.match(/\./g) || []).length
  if (decimalCount > 1) {
    throw new Error('Invalid percentage: multiple decimal points not allowed')
  }

  // Check for negative values
  if (trimmed.startsWith('-')) {
    throw new Error('Percentage cannot be negative')
  }

  // Reject scientific notation
  if (trimmed.includes('e') || trimmed.includes('E')) {
    throw new Error('Invalid percentage: scientific notation not allowed')
  }

  // Remove % sign and whitespace
  const cleaned = trimmed.replace(/%/g, '').trim()

  // Validate that cleaned string contains only valid numeric characters
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error('Invalid percentage: contains non-numeric characters')
  }

  // Parse as number
  const num = parseFloat(cleaned)

  // Validate
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new Error('Invalid percentage: must be a valid finite number')
  }

  // Convert to decimal (e.g., 6 -> 0.06)
  return num / 100
}

/**
 * Parse currency string to cents
 * Removes $, commas, and multiplies by 100
 * Handles decimal values properly without truncation
 *
 * @param value - Currency string input from user (e.g., "123.45", "$1,000.00")
 * @returns Amount in cents as integer, or 0 for empty string
 * @throws Error for invalid currency format (null/undefined, multiple decimal points, negative values,
 *        non-numeric characters, scientific notation, Infinity, or values exceeding safe integer)
 */
function parseCurrencyToCents(value: string): number {
  // Handle null/undefined
  if (value == null) {
    throw new Error('Invalid currency: value cannot be null or undefined')
  }

  if (value.trim() === '') {
    return 0
  }

  const trimmed = value.trim()

  // Check for negative values
  if (trimmed.startsWith('-')) {
    throw new Error('Currency amount cannot be negative')
  }

  // Remove all non-numeric characters except decimal point
  const cleaned = trimmed.replace(/[^\d.]/g, '')

  // Reject if multiple decimal points
  if ((cleaned.match(/\./g) || []).length > 1) {
    throw new Error('Invalid currency: multiple decimal points not allowed')
  }

  // Reject scientific notation
  if (cleaned.includes('e') || cleaned.includes('E')) {
    throw new Error('Invalid currency: scientific notation not allowed')
  }

  // Validate that cleaned string contains only valid numeric characters
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error('Invalid currency: contains non-numeric characters')
  }

  const amount = parseFloat(cleaned)

  // Validate
  if (Number.isNaN(amount) || !Number.isFinite(amount)) {
    throw new Error('Invalid currency: must be a valid finite number')
  }

  // Convert to cents with proper rounding (not truncation)
  const cents = Math.round(amount * 100)

  // Validate safe integer
  if (!Number.isSafeInteger(cents)) {
    throw new Error('Invalid currency: value exceeds safe integer limit')
  }

  return cents
}

/**
 * RetirementForm component
 *
 * Form for calculating retirement requirements using Safe Withdrawal Model.
 * Formula: FV = Ir × (12 / r)
 *
 * Features:
 * - Input for desired monthly retirement income
 * - Input for annual return rate (as percentage)
 * - Real-time calculation of required assets
 * - Server-side calculations for paid tier, client-side for free tier
 * - Clear result display
 * - Accessible form with proper labels
 * - Mobile-responsive layout
 */
function RetirementFormInner({
  onCalculate,
  preFillFromExistingData = true,
  savingsRate = 0.5,
}: RetirementFormProps) {
  const { mode, currency, locale } = useCurrencyPreferences()
  const { calculateRetirement, retirement } = useFinancialCalculations()

  // Access existing financial data from stores
  const balanceEntries = useBalanceStore((state) => state.entries)
  const _incomeSources = useIncomeStore((state) => state.incomeSources)
  const getTotalIncome = useIncomeStore((state) => state.getTotalIncome)

  // Calculate total investment assets from balance tracking
  const totalInvestmentAssets = useMemo(() => {
    return balanceEntries
      .filter((entry) => entry.type === 'investment' && entry.currentBalance >= 0)
      .reduce((sum, entry) => sum + Math.max(entry.currentBalance, 0), 0)
  }, [balanceEntries])

  // Calculate total monthly income from all sources (normalized to monthly)
  const totalMonthlyIncome = useMemo(() => {
    return getTotalIncome()
  }, [getTotalIncome])

  // Validate savingsRate prop
  const validatedSavingsRate = Math.min(Math.max(savingsRate, 0), 1)

  // Pre-fill values from existing data if enabled
  // Calculate default monthly income based on total income and savings rate
  const defaultMonthlyIncome = useMemo(() => {
    if (preFillFromExistingData && totalMonthlyIncome > 0) {
      // Use configurable savings rate as default retirement income target
      return (totalMonthlyIncome * validatedSavingsRate).toFixed(0)
    }
    return ''
  }, [preFillFromExistingData, totalMonthlyIncome, validatedSavingsRate])

  // Initialize state with the default value
  const [monthlyIncomeInput, setMonthlyIncomeInput] = useState<string>(defaultMonthlyIncome)
  const [annualReturnRateInput, setAnnualReturnRateInput] = useState('6.0')

  // Update state when dependencies change
  useEffect(() => {
    if (preFillFromExistingData) {
      setMonthlyIncomeInput(defaultMonthlyIncome)
    }
  }, [preFillFromExistingData, defaultMonthlyIncome])

  // Result state
  const [requiredAssets, setRequiredAssets] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isLoading = retirement.isLoading

  // Sync hook result to local state
  useEffect(() => {
    if (retirement.isSuccess && retirement.data) {
      setRequiredAssets(retirement.data.requiredAssets)
      setError(null)
    } else if (retirement.error) {
      setError(retirement.error)
      setRequiredAssets(null)
    }
  }, [retirement])

  // Configurable savings rate for time-to-goal calculation
  // Passed via props with default of 0.5 (50% of income saved annually)

  // Calculate time to goal based on compound growth
  // Uses actual return rate from input, strict validation (Decision A)
  const calculateYearsToGoal = useCallback(
    (
      requiredAssetsCents: number,
      currentAssetsCents: number,
      monthlyIncomeCents: number,
      annualReturnRate: number
    ): number | null => {
      // If already on track, return 0
      if (currentAssetsCents >= requiredAssetsCents) {
        return 0
      }

      // If zero or negative assets, cannot calculate meaningful time
      if (currentAssetsCents <= 0) {
        return null
      }

      // If no income to save, cannot calculate
      if (monthlyIncomeCents <= 0) {
        return null
      }

      // If required assets is 0, something is wrong
      if (requiredAssetsCents <= 0) {
        return null
      }

      // Calculate annual savings using configurable rate
      const annualSavingsCents = monthlyIncomeCents * 12 * validatedSavingsRate

      // Calculate annual return on current assets using actual rate
      const annualReturnOnAssets = currentAssetsCents * annualReturnRate

      // Total annual growth = savings + investment returns
      const annualGrowthCents = annualSavingsCents + annualReturnOnAssets

      if (annualGrowthCents <= 0) {
        return null
      }

      // Use iterative approach for compound growth calculation
      let years = 0
      let current = currentAssetsCents
      const maxYears = 100

      while (current < requiredAssetsCents && years < maxYears) {
        years++
        // Calculate growth for this year
        const growth = current * annualReturnRate
        // Add annual savings
        current = current + growth + annualSavingsCents

        // Check for overflow
        if (!Number.isSafeInteger(current)) {
          return null // Overflow, cannot calculate
        }
      }

      // If we reached the goal
      if (current >= requiredAssetsCents && years <= maxYears) {
        return years
      }

      // If we exceeded max years
      return null
    },
    [validatedSavingsRate]
  )

  // Retirement insights based on existing data
  const retirementInsights = useMemo(() => {
    if (requiredAssets === null) {
      return null
    }

    const gap = requiredAssets - totalInvestmentAssets

    // Calculate gap percentage, handling edge cases
    // If we have assets and a non-zero goal, calculate percentage
    // If gap is <= 0, we're on track (0%)
    // If we have no goal (requiredAssets === 0), consider it achieved (0%)
    const gapPercentage =
      requiredAssets > 0 && totalInvestmentAssets > 0
        ? (gap / requiredAssets) * 100
        : gap <= 0
          ? 0
          : 100

    // Calculate years to goal using current savings rate
    // Parse the annual return rate and monthly income with error handling
    let parsedReturnRate = 0
    let monthlyIncomeCents = 0

    try {
      parsedReturnRate = parsePercentageToDecimal(annualReturnRateInput)
    } catch (_e) {
      // If parsing fails, we cannot calculate years to goal
      parsedReturnRate = 0
    }

    try {
      monthlyIncomeCents = parseCurrencyToCents(monthlyIncomeInput)
    } catch (_e) {
      // If parsing fails, we cannot calculate years to goal
      monthlyIncomeCents = 0
    }

    // Calculate years to goal if we have valid inputs
    const yearsToGoal =
      monthlyIncomeCents > 0 && parsedReturnRate > 0
        ? calculateYearsToGoal(
            requiredAssets,
            totalInvestmentAssets,
            monthlyIncomeCents,
            parsedReturnRate
          )
        : null

    // Fix: zero assets should NOT be "on track" unless gap <= 0
    const isOnTrack = gap <= 0

    return {
      currentAssets: totalInvestmentAssets,
      gap: gap,
      gapPercentage: Math.round(gapPercentage),
      onTrack: isOnTrack,
      yearsToGoalAtCurrentRate: yearsToGoal,
    }
  }, [
    requiredAssets,
    totalInvestmentAssets,
    monthlyIncomeInput,
    annualReturnRateInput,
    calculateYearsToGoal,
  ])

  // Format amount using current currency preferences
  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency, locale })

  // Sanitize error messages for display to users
  const sanitizeDisplayError = useCallback((error: unknown): string => {
    if (!(error instanceof Error)) {
      return 'An error occurred during calculation'
    }

    // Map known error messages to user-friendly versions
    const userFriendlyMessages: Record<string, string> = {
      'Annual return rate must be positive (greater than 0)':
        'Please enter a valid return rate (must be greater than 0%)',
      'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.':
        'Please enter a valid return rate (must be greater than 0%)',
      'Annual return rate must be at least 0.1% to avoid precision issues in calculations.':
        'Return rate must be at least 0.1% to ensure accurate calculations',
      'Calculation overflow: Required assets exceeds safe integer limit. Try a smaller income or higher return rate.':
        'The calculated amount is too large. Please try smaller values.',
      'Calculation overflow: Withdrawal amount exceeds safe integer limit.':
        'The calculated amount is too large. Please try smaller values.',
      'Number of years must not exceed 100 to prevent performance issues and calculation overflow.':
        'Please enter a projection period of 100 years or less',
    }

    return (
      userFriendlyMessages[error.message] ||
      'An error occurred during calculation. Please check your inputs.'
    )
  }, [])

  // Track the latest calculation inputs to prevent race conditions
  // Uses unique calculation ID to reliably match results with inputs
  const calculationInputsRef = useRef<{
    id: string
    monthlyIncome: number
    returnRate: number
  } | null>(null)

  // Calculate required assets using hook (server-side for paid, client-side for free)
  const calculate = useCallback(() => {
    setError(null)

    // If inputs are empty, show appropriate error
    if (!monthlyIncomeInput || monthlyIncomeInput.trim() === '') {
      setError('Please enter a monthly income')
      setRequiredAssets(null)
      return
    }

    if (!annualReturnRateInput || annualReturnRateInput.trim() === '') {
      setError('Please enter a return rate')
      setRequiredAssets(null)
      return
    }

    try {
      // Strict validation: if parsing fails, show error (Decision A)
      const monthlyIncomeCents = parseCurrencyToCents(monthlyIncomeInput)
      const annualReturnRate = parsePercentageToDecimal(annualReturnRateInput)

      // Validate that we got valid numbers
      if (monthlyIncomeCents === 0) {
        setError('Please enter a valid monthly income (must be greater than 0)')
        setRequiredAssets(null)
        return
      }

      if (annualReturnRate === 0) {
        setError('Please enter a valid return rate (must be greater than 0%)')
        setRequiredAssets(null)
        return
      }

      // Generate unique ID for this calculation to track it reliably
      const calculationId = Math.random().toString(36).substring(2, 11)

      // Store inputs with calculation ID for reliable matching
      calculationInputsRef.current = {
        id: calculationId,
        monthlyIncome: monthlyIncomeCents,
        returnRate: annualReturnRate,
      }

      // Use hook for calculation (handles tier detection automatically)
      // For free tier: uses client-side calculateRequiredAssets
      // For paid tier: calls server function
      void calculateRetirement({ monthlyIncome: monthlyIncomeCents, annualReturnRate }).then(() => {
        // When calculation completes, check if this is still the latest calculation
        if (calculationInputsRef.current?.id === calculationId && onCalculate) {
          onCalculate(
            retirement.data?.requiredAssets ?? 0,
            calculationInputsRef.current.monthlyIncome,
            calculationInputsRef.current.returnRate
          )
        }
      })
    } catch (e) {
      // Sanitize error message for display (Decision A - strict validation, no silent defaults)
      const errorMessage = sanitizeDisplayError(e)
      setError(errorMessage)
      setRequiredAssets(null)
    }
  }, [
    monthlyIncomeInput,
    annualReturnRateInput,
    calculateRetirement,
    onCalculate,
    retirement.data,
    sanitizeDisplayError,
  ])

  // Trigger onCalculate when hook succeeds (fallback for cases where promise doesn't resolve)
  useEffect(() => {
    if (retirement.isSuccess && retirement.data && calculationInputsRef.current && onCalculate) {
      onCalculate(
        retirement.data.requiredAssets,
        calculationInputsRef.current.monthlyIncome,
        calculationInputsRef.current.returnRate
      )
    }
  }, [retirement, onCalculate])

  // Handle form submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      calculate()
    },
    [calculate]
  )

  // Calculate on input change (auto-calculate)
  const handleMonthlyIncomeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMonthlyIncomeInput(e.target.value)
  }, [])

  const handleReturnRateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAnnualReturnRateInput(e.target.value)
  }, [])

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-6" noValidate>
      <div className="space-y-4">
        {/* Monthly Income Input */}
        <div>
          <label htmlFor="monthlyIncome" className="block text-sm font-medium text-label mb-2">
            Desired Monthly Retirement Income
            <span className="text-orange-500 ml-1">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
              {currency === 'USD' ? '$' : currency}
            </span>
            <input
              type="number"
              id="monthlyIncome"
              name="monthlyIncome"
              value={monthlyIncomeInput}
              onChange={handleMonthlyIncomeChange}
              onBlur={calculate}
              inputMode="decimal"
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg transition-colors"
              aria-required="true"
              aria-label="Desired monthly retirement income"
              disabled={isLoading}
            />
          </div>
          <p className="text-sm text-muted mt-1">Enter the monthly income you want in retirement</p>
        </div>

        {/* Annual Return Rate Input */}
        <div>
          <label htmlFor="annualReturnRate" className="block text-sm font-medium text-label mb-2">
            Expected Annual Return Rate
            <span className="text-orange-500 ml-1">*</span>
          </label>
          <div className="relative">
            <input
              type="number"
              id="annualReturnRate"
              name="annualReturnRate"
              value={annualReturnRateInput}
              onChange={handleReturnRateChange}
              onBlur={calculate}
              inputMode="decimal"
              placeholder="6.0"
              min="0"
              step="0.01"
              className="w-full pr-10 pl-4 py-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg transition-colors"
              aria-required="true"
              aria-label="Expected annual return rate"
              disabled={isLoading}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
              %
            </span>
          </div>
          <p className="text-sm text-muted mt-1">
            Enter the expected annual rate of return on your investments
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div
            className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg text-red-700 dark:text-red-300"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Result Display */}
        {requiredAssets !== null && !error && (
          <div className="space-y-4">
            {/* Main Result */}
            <div className="p-6 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-xl">
              <h3 className="text-lg font-semibold text-green-800 dark:text-green-300 mb-2">
                Required Retirement Assets
              </h3>
              <div className="text-4xl font-bold text-green-700 dark:text-green-300">
                {formatAmount(requiredAssets)}
              </div>
              <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                You need <strong>{formatAmount(requiredAssets)}</strong> in retirement assets to
                safely withdraw
                <strong>{formatAmount(parseCurrencyToCents(monthlyIncomeInput))}/month</strong>
                at a <strong>{parsePercentageToDecimal(annualReturnRateInput) * 100}%</strong>{' '}
                annual return rate.
              </p>
              <p className="text-xs text-green-500 dark:text-green-400 mt-2">
                Calculation uses Safe Withdrawal Model: FV = Ir × (12 / r)
              </p>
            </div>

            {/* Retirement Insights - Integration with existing data */}
            {preFillFromExistingData && retirementInsights && (
              <div className="p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg">
                <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-3">
                  Your Retirement Progress
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-blue-700 dark:text-blue-300">
                      Current Investment Assets:
                    </span>
                    <span className="font-medium text-blue-800 dark:text-blue-200">
                      {formatAmount(retirementInsights.currentAssets)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-blue-700 dark:text-blue-300">Gap to Goal:</span>
                    <span
                      className={`font-medium ${
                        retirementInsights.gap >= 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-green-600 dark:text-green-400'
                      }`}
                    >
                      {retirementInsights.gap >= 0
                        ? formatAmount(retirementInsights.gap)
                        : '✓ Goal achieved!'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-blue-700 dark:text-blue-300">Status:</span>
                    <span
                      className={`font-medium ${
                        retirementInsights.onTrack
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-orange-600 dark:text-orange-400'
                      }`}
                    >
                      {retirementInsights.onTrack ? '✓ On Track' : '⚠ Needs Attention'}
                    </span>
                  </div>
                  {retirementInsights.yearsToGoalAtCurrentRate !== null &&
                    retirementInsights.yearsToGoalAtCurrentRate > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-blue-700 dark:text-blue-300">
                          Years to Goal:
                        </span>
                        <span className="font-medium text-blue-800 dark:text-blue-200">
                          ≈ {retirementInsights.yearsToGoalAtCurrentRate} years
                        </span>
                      </div>
                    )}
                  {!retirementInsights.onTrack && retirementInsights.gapPercentage > 0 && (
                    <p className="text-xs text-blue-600 dark:text-blue-300 mt-2">
                      You need {retirementInsights.gapPercentage}% more to reach your goal.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              Calculating...
            </>
          ) : (
            'Calculate Required Assets'
          )}
        </button>
      </div>
    </form>
  )
}

// Wrap with ErrorBoundary
export function RetirementForm(props: RetirementFormProps) {
  return (
    <ErrorBoundary>
      <RetirementFormInner {...props} />
    </ErrorBoundary>
  )
}

export default RetirementForm
