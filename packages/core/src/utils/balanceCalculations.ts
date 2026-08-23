/**
 * Balance Tracking Calculations
 *
 * Provides utilities for calculating timeline and progress for balance tracking entries.
 * Works with investment and debt types.
 *
 * Architecture Requirement: All monetary values in cents (integers) to avoid floating-point precision issues.
 *
 * Story 16-2: these functions operate on a MONTHLY contribution basis. Since a
 * balance-tracking entry can now carry a non-monthly frequency, callers MUST pass
 * the monthly-equivalent (via `monthlyContributionCents` in services/balanceTracking),
 * NOT the raw `monthlyContribution`. Keeping normalization at the call site leaves
 * these pure per-month calculators unchanged.
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
 * - If any parameter is null/undefined/NaN/Infinity: return null
 * - If no limit or no contribution: return null
 * - If contribution <= 0: return null (cannot make progress)
 * - If current >= limit: return 0 (already at or past limit)
 * - Otherwise: ceil((limit - current) / monthlyContribution)
 */
export function calculateMonthsToLimit(
  currentBalance: number,
  // ⚠️ `| null` because that is what the app persists for "no limit" — see
  // `ClientBalanceTracking.maxContributionLimit`. The `!= null` checks below treat
  // null and undefined identically, which is what "optional" was always meant to
  // mean here. (Behaviour is unchanged: null already returned `null` from the
  // finiteness check, and undefined from the completeness check.)
  maxContributionLimit: number | null | undefined,
  monthlyContribution: number | null | undefined
): number | null {
  // Validate all parameters are finite numbers
  if (
    !Number.isFinite(currentBalance) ||
    (maxContributionLimit != null && !Number.isFinite(maxContributionLimit)) ||
    (monthlyContribution != null && !Number.isFinite(monthlyContribution))
  ) {
    return null
  }

  // Cannot calculate without both values
  if (maxContributionLimit == null || monthlyContribution == null) {
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
 * @returns Projected balance in cents, or currentBalance if overflow detected
 */
export function calculateProjectedBalance(
  currentBalance: number,
  monthlyContribution: number,
  months: number
): number {
  // Validate inputs are finite
  if (
    !Number.isFinite(currentBalance) ||
    !Number.isFinite(monthlyContribution) ||
    !Number.isFinite(months)
  ) {
    return currentBalance
  }

  if (months < 0) {
    return currentBalance
  }

  // Check for potential arithmetic overflow
  const result = currentBalance + monthlyContribution * months
  if (
    !Number.isFinite(result) ||
    result > Number.MAX_SAFE_INTEGER ||
    result < Number.MIN_SAFE_INTEGER
  ) {
    return currentBalance
  }

  return result
}

/**
 * Calculate contribution progress percentage
 *
 * @param currentBalance - Current balance in cents (positive for investments, negative for debts)
 * @param maxContributionLimit - Maximum contribution limit in cents (optional)
 * @param isDebt - Whether this is a debt entry (uses absolute value for calculation)
 * @returns Progress percentage (0-100) or null if no limit
 */
export function calculateContributionProgress(
  currentBalance: number,
  maxContributionLimit: number | undefined,
  isDebt = false
): number | null {
  // Validate inputs
  if (
    maxContributionLimit === undefined ||
    !Number.isFinite(maxContributionLimit) ||
    maxContributionLimit <= 0
  ) {
    return null
  }

  if (!Number.isFinite(currentBalance)) {
    return null
  }

  // For debts, use absolute value of currentBalance
  const balance = isDebt ? Math.abs(currentBalance) : currentBalance

  // Cap at 100% if current exceeds limit, clamp negative values to 0
  const progress = (balance / maxContributionLimit) * 100
  return Math.min(100, Math.max(0, Math.round(progress)))
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

// ============================================================================
// Debt-Specific Types and Calculations
// ============================================================================

/**
 * Debt sub-types for different calculation strategies
 */
export type DebtSubType = 'credit-card' | 'mortgage' | 'loan' | 'other'

/**
 * Result of debt-specific calculations
 */
export interface DebtCalculationResult {
  progress: number | null
  progressLabel: string
  timeline: number | null
  timelineLabel: string
}

/**
 * Calculate debt-specific metrics based on debt type
 *
 * For credit cards (C1 strategy):
 * - Progress = utilization percentage (abs(current) / limit * 100)
 * - Timeline = months to pay off (abs(current) / monthlyContribution)
 *
 * For mortgages/loans (C strategy):
 * - Progress = percentage paid off (requires originalBalance for full accuracy)
 * - Timeline = months to pay off (abs(current) / monthlyContribution)
 *
 * @param currentBalance - Current balance in cents (negative for debts)
 * @param maxContributionLimit - Credit limit or original loan amount in cents
 * @param monthlyContribution - Monthly payment in cents
 * @param debtSubType - Type of debt for calculation strategy
 * @param originalBalance - Original loan amount for mortgage/loan progress (optional)
 * @returns Debt-specific calculation result
 */
export function calculateDebtMetrics(
  currentBalance: number,
  // ⚠️ `| null` for the same reason as `calculateMonthsToLimit`, but note this one
  // was NOT merely a typing gap: `maxContributionLimit !== undefined &&
  // !Number.isFinite(null)` is TRUE, so a null limit fell into the "Invalid data"
  // branch below while undefined fell through to "No limit". `!= null` makes the
  // two agree, which is the documented intent ("optional").
  //
  // Reachability, checked before changing it: `withTimeline` only calls this when
  // `entry.type === 'debt' && entry.debtSubType`, and `debtSubType` is set NOWHERE
  // in `apps/web/src` — so this path is dormant in the app today and no test passed
  // null. The change is a consistency fix, not a live behaviour change.
  maxContributionLimit: number | null | undefined,
  monthlyContribution: number | null | undefined,
  debtSubType: DebtSubType,
  originalBalance?: number
): DebtCalculationResult {
  // Validate inputs
  if (
    !Number.isFinite(currentBalance) ||
    (maxContributionLimit != null && !Number.isFinite(maxContributionLimit)) ||
    (monthlyContribution != null && !Number.isFinite(monthlyContribution))
  ) {
    return {
      progress: null,
      progressLabel: 'Invalid data',
      timeline: null,
      timelineLabel: 'Invalid data',
    }
  }

  const absCurrent = Math.abs(currentBalance)
  const monthly = monthlyContribution ?? 0

  // Calculate timeline (months to pay off) - same for all debt types
  let timeline: number | null = null
  let timelineLabel = 'No payment set'

  if (monthly > 0) {
    timeline = Math.ceil(absCurrent / monthly)
    timelineLabel = timeline === 1 ? '1 month to pay off' : `${timeline} months to pay off`
  }

  // Calculate progress based on debt type
  let progress: number | null = null
  let progressLabel = 'No limit'

  if (maxContributionLimit != null && maxContributionLimit > 0) {
    switch (debtSubType) {
      case 'credit-card':
        // C1 Strategy: Utilization percentage
        progress = Math.min(100, Math.round((absCurrent / maxContributionLimit) * 100))
        progressLabel = `${progress}% utilized`
        break

      case 'mortgage':
      case 'loan':
        // C Strategy: Percentage paid off
        if (originalBalance !== undefined && originalBalance > 0) {
          const paidOff = originalBalance - absCurrent
          progress = Math.min(100, Math.round((paidOff / originalBalance) * 100))
          progressLabel = `${progress}% paid off`
        } else {
          // Without original balance, show months to pay off as progress
          progress = null
          progressLabel = timeline !== null ? timelineLabel : 'No limit'
        }
        break
      default:
        // Default to utilization for other debt types
        progress = Math.min(100, Math.round((absCurrent / maxContributionLimit) * 100))
        progressLabel = `${progress}% utilized`
    }
  }

  return {
    progress,
    progressLabel,
    timeline,
    timelineLabel,
  }
}
