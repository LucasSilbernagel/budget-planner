/**
 * Balance Tracking Calculations
 * 
 * Provides utilities for calculating timeline and progress for balance tracking entries.
 * Works with investment and debt types.
 * 
 * Architecture Requirement: All monetary values in cents (integers) to avoid floating-point precision issues.
 */

/**
 * Calculate months to max contribution limit
 * 
 * @param currentBalance - Current balance in cents (can be negative for debts)
 * @param maxContributionLimit - Maximum contribution limit in cents (optional)
 * @param monthlyContribution - Monthly contribution in cents (optional)
 * @returns Number of months to reach limit, or null if calculation not possible
 * 
 * AC 6: Given a balance entry with maxContributionLimit = $5000 and monthlyContribution = $500,
 *      when viewed, shows it will reach the limit in 10 months at current rate
 * 
 * Calculation:
 * - If no limit or no contribution: return null
 * - If contribution <= 0: return null (cannot make progress)
 * - If current >= limit: return 0 (already at or past limit)
 * - Otherwise: ceil((limit - current) / monthlyContribution)
 */
export function calculateMonthsToLimit(
  currentBalance: number,
  maxContributionLimit: number | undefined,
  monthlyContribution: number | undefined
): number | null {
  // Cannot calculate without both values
  if (maxContributionLimit === undefined || monthlyContribution === undefined) {
    return null
  }

  // Cannot make progress with zero or negative contribution
  if (monthlyContribution <= 0) {
    return null
  }

  // Calculate remaining amount to reach limit
  const remaining = maxContributionLimit - currentBalance

  // Already at or past the limit
  if (remaining <= 0) {
    return 0
  }

  // Calculate months needed (ceiling to ensure we round up)
  return Math.ceil(remaining / monthlyContribution)
}

/**
 * Format timeline for display
 * 
 * @param months - Number of months (or null)
 * @returns Formatted string for display
 */
export function formatTimeline(months: number | null): string {
  if (months === null) {
    return 'No limit set'
  }
  if (months === 0) {
    return 'Limit reached'
  }
  if (months === 1) {
    return '1 month to limit'
  }
  return `${months} months to limit`
}

/**
 * Calculate projected balance at a future date
 * 
 * @param currentBalance - Current balance in cents
 * @param monthlyContribution - Monthly contribution in cents
 * @param months - Number of months in the future
 * @returns Projected balance in cents
 */
export function calculateProjectedBalance(
  currentBalance: number,
  monthlyContribution: number,
  months: number
): number {
  if (months < 0) {
    return currentBalance
  }
  return currentBalance + monthlyContribution * months
}

/**
 * Calculate contribution progress percentage
 * 
 * @param currentBalance - Current balance in cents
 * @param maxContributionLimit - Maximum contribution limit in cents (optional)
 * @returns Progress percentage (0-100) or null if no limit
 */
export function calculateContributionProgress(
  currentBalance: number,
  maxContributionLimit: number | undefined
): number | null {
  if (maxContributionLimit === undefined || maxContributionLimit <= 0) {
    return null
  }

  // Cap at 100% if current exceeds limit
  const progress = (currentBalance / maxContributionLimit) * 100
  return Math.min(100, Math.round(progress))
}

/**
 * Format progress percentage for display
 * 
 * @param progress - Progress percentage (0-100) or null
 * @returns Formatted string for display
 */
export function formatProgress(progress: number | null): string {
  if (progress === null) {
    return 'No limit'
  }
  return `${progress}%`
}
