// Money is integer cents. Callers pass the MONTHLY-equivalent contribution, not the raw
// `monthlyContribution`, since an entry may carry another frequency.

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

export function calculateProjectedBalance(
  currentBalance: number,
  monthlyContribution: number,
  months: number
): number {
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

export function formatProgress(progress: number | null): string {
  if (progress === null) {
    return 'No limit'
  }
  return `${progress}%`
}

export type DebtSubType = 'credit-card' | 'mortgage' | 'loan' | 'other'

export interface DebtCalculationResult {
  progress: number | null
  progressLabel: string
  timeline: number | null
  timelineLabel: string
}

/** Dormant in the app today: nothing sets `debtSubType`. */
export function calculateDebtMetrics(
  currentBalance: number,
  monthlyContribution: number | null | undefined,
  debtSubType: DebtSubType,
  originalBalance?: number
): DebtCalculationResult {
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

  let timeline: number | null = null
  let timelineLabel = 'No payment set'

  if (monthly > 0) {
    timeline = Math.ceil(absCurrent / monthly)
    timelineLabel = timeline === 1 ? '1 month to pay off' : `${timeline} months to pay off`
  }

  let progress: number | null = null
  let progressLabel = 'No limit'

  switch (debtSubType) {
    case 'mortgage':
    case 'loan':
      if (originalBalance !== undefined && originalBalance > 0) {
        const paidOff = originalBalance - absCurrent
        progress = Math.min(100, Math.round((paidOff / originalBalance) * 100))
        progressLabel = `${progress}% paid off`
      } else {
        progress = null
        progressLabel = timeline !== null ? timelineLabel : 'No limit'
      }
      break
    default:
      // No credit limit is recorded, so there is no proportion to express.
      break
  }

  return {
    progress,
    progressLabel,
    timeline,
    timelineLabel,
  }
}
