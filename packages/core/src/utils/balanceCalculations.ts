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
 * Timeline (all debt types) = months to pay off (abs(current) / monthlyContribution).
 *
 * Progress:
 * - mortgage / loan (C strategy) = percentage paid off, from `originalBalance`
 * - every other sub-type = null ("No limit")
 *
 * ⚠️ Story 49.1 (FR75) removed `maxContributionLimit`, which this function used as
 * a CREDIT LIMIT for the credit-card utilisation branch — one column carrying two
 * unrelated meanings (a contribution ceiling on an investment, a credit limit on a
 * debt). That conflation is why the branch read a field the form hid for debts.
 * Utilisation is therefore gone rather than re-pointed: reinstating it needs its
 * own `creditLimit` field, recorded in `deferred-work.md` alongside the still-open
 * `debtSubType` question.
 *
 * ⚠️ SECOND, LESS OBVIOUS CHANGE, flagged by code review because this docblock
 * originally claimed only the utilisation branch moved. The whole `switch` used to
 * sit inside `if (maxContributionLimit != null && maxContributionLimit > 0)`, so
 * removing the field UN-GATED the mortgage/loan arm too: a loan carrying an
 * `originalBalance` but no limit previously reported `null` / 'No limit', and now
 * reports its real "% paid off". That arm never used the limit — it reads
 * `originalBalance` — so gating it on one was incoherent, and the new behaviour is
 * the more correct of the two. Recorded as an intended consequence rather than
 * left to look like an accident. (Dormant either way: nothing sets `debtSubType`.)
 *
 * ⚠️ Reachability, unchanged by 49.1: `withTimeline` calls this only when
 * `entry.type === 'debt' && entry.debtSubType`, and `debtSubType` is set NOWHERE in
 * `apps/web/src` — so this whole function is dormant in the app today.
 *
 * @param currentBalance - Current balance in cents (negative for debts)
 * @param monthlyContribution - Monthly payment in cents
 * @param debtSubType - Type of debt for calculation strategy
 * @param originalBalance - Original loan amount for mortgage/loan progress (optional)
 * @returns Debt-specific calculation result
 */
export function calculateDebtMetrics(
  currentBalance: number,
  monthlyContribution: number | null | undefined,
  debtSubType: DebtSubType,
  originalBalance?: number
): DebtCalculationResult {
  // Validate inputs
  if (
    !Number.isFinite(currentBalance) ||
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

  // ⚠️ Story 49.1: only the mortgage/loan arm survives. The credit-card and
  // `default` arms computed UTILISATION against `maxContributionLimit`, which no
  // longer exists — see the docblock. They are removed rather than defaulted to
  // 0%, because "0% utilized" is a claim about a limit nobody recorded.
  switch (debtSubType) {
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
      // credit-card / other: no limit is recorded any more, so there is nothing
      // to express a proportion against. `progress` stays null, label 'No limit'.
      break
  }

  return {
    progress,
    progressLabel,
    timeline,
    timelineLabel,
  }
}
