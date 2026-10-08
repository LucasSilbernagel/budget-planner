import type { FinanceType } from '@budget-planner/db'
import { MAX_MONEY_CENTS } from '../finance/money-limits'
import { type Frequency, normalizeToAnnual, normalizeToMonthly } from '../finance/normalization'
import { DebtSubType, calculateDebtMetrics } from '../utils/balanceCalculations'
import { generateUuid } from '../utils/uuid'

// Restated rather than imported from @budget-planner/db: that barrel throws when bundled
// for the browser. `_FinanceTypeCoverage` keeps the two in sync.
export const FINANCE_TYPES = [
  'investment',
  'debt',
  'asset',
] as const satisfies readonly FinanceType[]

// `satisfies` catches misspelled members; this Exclude catches omitted ones.
type _FinanceTypeCoverage = Exclude<FinanceType, (typeof FINANCE_TYPES)[number]> extends never
  ? true
  : never
const _financeTypeCoverage: _FinanceTypeCoverage = true
void _financeTypeCoverage

export interface ClientBalanceTracking {
  id: string
  // Null/absent means unscoped (visible under every profile). Not on ClientNew*: an edit
  // must never re-home a row.
  profileId?: string | null
  type: FinanceType
  name: string
  currentBalance: number // In cents, >= 0; a legacy negative debt is read via `debtOwedCents`
  monthlyContribution: number // Cents per `frequency` period, not necessarily monthly
  frequency: Frequency
  createdAt: string
  updatedAt: string
  // Optional: `toClient*` has no list access to compute a position.
  sortOrder?: number
  // User-supplied, never inferred: rows that are and aren't already expensed look identical.
  contributionRecordedAsExpense?: boolean
  // No foreign key: may name an expense this device doesn't hold. Read only via
  // `resolveDebtPaymentExpense`; localStorage is user-editable.
  paymentExpenseId?: string | null
  debtSubType?: DebtSubType
  originalBalance?: number
}

export interface ClientNewBalanceTracking {
  type: FinanceType
  name: string
  currentBalance: number
  monthlyContribution: number
  frequency: Frequency
  contributionRecordedAsExpense?: boolean
  paymentExpenseId?: string | null
  debtSubType?: DebtSubType
  originalBalance?: number
}

export interface BalanceTrackingWithTimeline extends ClientBalanceTracking {
  debtProgress?: number | null
  debtProgressLabel?: string
  debtTimeline?: number | null
  debtTimelineLabel?: string
}

export interface BalanceTrackingFilter {
  type?: FinanceType
  search?: string
}

const VALID_FREQUENCIES: readonly Frequency[] = ['weekly', 'biweekly', 'monthly', 'annually']

/** Unknown frequency is coerced to 'monthly': `normalizeToMonthly` throws, and this runs
 * during render with no error boundary. */
export function monthlyContributionCents(
  entry: Pick<ClientBalanceTracking, 'monthlyContribution' | 'frequency'>
): number {
  const frequency = VALID_FREQUENCIES.includes(entry.frequency) ? entry.frequency : 'monthly'
  return normalizeToMonthly(entry.monthlyContribution, frequency)
}

/** Exact contribution × periods per year; `monthlyContributionCents × 12` is off by up to
 * 6 cents a year for non-monthly cadences. */
export function annualContributionCents(
  entry: Pick<ClientBalanceTracking, 'monthlyContribution' | 'frequency'>
): number {
  const frequency = VALID_FREQUENCIES.includes(entry.frequency) ? entry.frequency : 'monthly'
  return normalizeToAnnual(entry.monthlyContribution, frequency)
}

export function getTypeDisplayProperties(type: FinanceType):
  | {
      theme: 'success' | 'danger'
      icon: string
      label: string
      colorClass: string
      bgColorClass: string
    }
  | undefined {
  if (!FINANCE_TYPES.includes(type)) {
    return undefined
  }

  const properties: Record<
    FinanceType,
    {
      theme: 'success' | 'danger'
      icon: string
      label: string
      colorClass: string
      bgColorClass: string
    }
  > = {
    investment: {
      theme: 'success' as const,
      icon: '↗',
      label: 'Investment',
      colorClass: 'text-green-600 dark:text-green-400',
      bgColorClass: 'bg-green-100 dark:bg-green-900/30',
    },
    debt: {
      theme: 'danger' as const,
      icon: '↓',
      label: 'Debt',
      colorClass: 'text-red-600 dark:text-red-400',
      bgColorClass: 'bg-red-100 dark:bg-red-900/30',
    },
    asset: {
      // An asset reuses 'success': the theme means counts for vs against you.
      theme: 'success' as const,
      icon: '◆',
      label: 'Asset',
      colorClass: 'text-amber-600 dark:text-amber-400',
      bgColorClass: 'bg-amber-100 dark:bg-amber-900/30',
    },
  }
  return properties[type]
}

/** Debt branch only runs when `debtSubType` is set, which the web app never does today. */
export function withTimeline(entry: ClientBalanceTracking): BalanceTrackingWithTimeline {
  let debtProgress: number | null = null
  let debtProgressLabel = 'No limit'
  let debtTimeline: number | null = null
  let debtTimelineLabel = 'No payment set'

  if (entry.type === 'debt' && entry.debtSubType) {
    // Normalized only here: the normalizer throws on a non-finite contribution, and this maps
    // over every row during render, so a corrupt non-debt row must never reach it.
    const result = calculateDebtMetrics(
      entry.currentBalance,
      monthlyContributionCents(entry),
      entry.debtSubType,
      entry.originalBalance
    )
    debtProgress = result.progress
    debtProgressLabel = result.progressLabel
    debtTimeline = result.timeline
    debtTimelineLabel = result.timelineLabel
  }

  return {
    ...entry,
    debtProgress,
    debtProgressLabel,
    debtTimeline,
    debtTimelineLabel,
  }
}

export interface ValidationError {
  field: string
  message: string
  value: unknown
}

export function validateBalanceTracking(
  input: Partial<ClientNewBalanceTracking>
): ValidationError[] {
  const errors: ValidationError[] = []

  if (input.name === undefined || input.name === null || input.name.trim() === '') {
    errors.push({
      field: 'name',
      message: 'Name is required',
      value: input.name,
    })
  } else if (input.name.length > 100) {
    errors.push({
      field: 'name',
      message: 'Name must be 100 characters or less',
      value: input.name,
    })
  }

  const validTypes: readonly FinanceType[] = FINANCE_TYPES
  if (input.type === undefined || input.type === null) {
    errors.push({
      field: 'type',
      message: 'Type is required',
      value: input.type,
    })
  } else if (!validTypes.includes(input.type)) {
    errors.push({
      field: 'type',
      message: `Type must be one of: ${FINANCE_TYPES.map((t) => `"${t}"`).join(', ')}`,
      value: input.type,
    })
  }

  // Enforced here, not just in the form: every store write path calls this, and a stray
  // contribution on an asset would inflate the distributable pool.
  if (input.type === 'asset' && typeof input.monthlyContribution === 'number') {
    if (input.monthlyContribution !== 0) {
      errors.push({
        field: 'monthlyContribution',
        message: 'An asset has no contribution — record recurring saving on the Savings page',
        value: input.monthlyContribution,
      })
    }
  }

  // Only investment rows feed the distributable pool, so the flag on any other type
  // would claim an effect that doesn't exist.
  if (input.contributionRecordedAsExpense === true && input.type !== 'investment') {
    errors.push({
      field: 'contributionRecordedAsExpense',
      message: 'Only an investment contribution can be marked as already recorded as an expense',
      value: input.contributionRecordedAsExpense,
    })
  }

  // Uuid shape is not checked here: the sync gates check it, and a free-tier row must
  // never be blocked by it.
  if (
    input.paymentExpenseId !== undefined &&
    input.paymentExpenseId !== null &&
    typeof input.paymentExpenseId !== 'string'
  ) {
    errors.push({
      field: 'paymentExpenseId',
      message: 'The linked expense must be an expense id or empty',
      value: input.paymentExpenseId,
    })
  } else if (typeof input.paymentExpenseId === 'string' && input.type !== 'debt') {
    errors.push({
      field: 'paymentExpenseId',
      message: 'Only a debt can be paid by an expense',
      value: input.paymentExpenseId,
    })
  }

  if (input.frequency === undefined || input.frequency === null) {
    errors.push({
      field: 'frequency',
      message: 'Frequency is required',
      value: input.frequency,
    })
  } else if (!VALID_FREQUENCIES.includes(input.frequency)) {
    errors.push({
      field: 'frequency',
      message: 'Frequency must be one of: weekly, biweekly, monthly, annually',
      value: input.frequency,
    })
  }

  if (input.currentBalance === undefined || input.currentBalance === null) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance is required',
      value: input.currentBalance,
    })
  } else if (typeof input.currentBalance !== 'number' || !Number.isFinite(input.currentBalance)) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance must be a finite number (in cents)',
      value: input.currentBalance,
    })
  } else if (!Number.isInteger(input.currentBalance)) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance must be an integer (in cents, not a float)',
      value: input.currentBalance,
    })
  } else if (input.currentBalance < 0) {
    // The only sign check, on purpose: it runs before enqueue, where a refusal can't deadlock
    // sync. Legacy or pulled negative debts are read via `debtOwedCents`.
    errors.push({
      field: 'currentBalance',
      message: 'Current balance cannot be negative',
      value: input.currentBalance,
    })
  }

  if (input.monthlyContribution !== undefined && input.monthlyContribution !== null) {
    if (
      typeof input.monthlyContribution !== 'number' ||
      !Number.isFinite(input.monthlyContribution)
    ) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution must be a finite number (in cents)',
        value: input.monthlyContribution,
      })
    } else if (!Number.isInteger(input.monthlyContribution)) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution must be an integer (in cents, not a float)',
        value: input.monthlyContribution,
      })
    } else if (input.monthlyContribution < 0) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution cannot be negative',
        value: input.monthlyContribution,
      })
    } else if (input.monthlyContribution > MAX_MONEY_CENTS) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution exceeds the largest amount that can sync',
        value: input.monthlyContribution,
      })
    }
  }

  // `Math.abs` keeps a huge negative value refused too.
  if (
    typeof input.currentBalance === 'number' &&
    Math.abs(input.currentBalance) > MAX_MONEY_CENTS
  ) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance exceeds the largest amount that can sync',
      value: input.currentBalance,
    })
  }

  return errors
}

export function isValidBalanceTracking(input: Partial<ClientNewBalanceTracking>): boolean {
  return validateBalanceTracking(input).length === 0
}

export function sortByCreationDate(entries: ClientBalanceTracking[]): ClientBalanceTracking[] {
  if (!entries) {
    return []
  }

  return [...entries].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()

    if (!Number.isFinite(dateA)) return 1
    if (!Number.isFinite(dateB)) return -1

    return dateB - dateA
  })
}

export function filterBalanceTracking(
  entries: BalanceTrackingWithTimeline[],
  filter: BalanceTrackingFilter
): BalanceTrackingWithTimeline[] {
  if (!entries || !filter) {
    return []
  }

  return entries.filter((entry) => {
    if (filter.type && entry.type !== filter.type) return false
    if (filter.search) {
      if (typeof filter.search !== 'string') return false
      const searchLower = filter.search.toLowerCase()
      const entryName = typeof entry.name === 'string' ? entry.name.toLowerCase() : ''
      if (!entryName.includes(searchLower)) return false
    }
    return true
  })
}

export function generateBalanceTrackingTempId(): string {
  return generateUuid()
}

export function resetBalanceTrackingTempId(): void {
  // Intentionally empty: uuid ids are stateless.
}

export function toClientBalanceTracking(input: ClientNewBalanceTracking): ClientBalanceTracking {
  const now = new Date().toISOString()
  return {
    ...input,
    id: generateBalanceTrackingTempId(),
    createdAt: now,
    updatedAt: now,
  }
}

/** `expenses` must be the active profile's: profile scope is what makes another profile's
 * expense a miss. A dangling link returns null. */
export function resolveDebtPaymentExpense<E extends { id: string }>(
  entry: { type: unknown; paymentExpenseId?: unknown },
  expenses: readonly E[]
): E | null {
  if (entry.type !== 'debt') return null
  const id = entry.paymentExpenseId
  if (typeof id !== 'string' || id === '') return null
  return expenses.find((expense) => expense.id === id) ?? null
}

/** A negative debt can still arrive via paths that skip the validator. Non-finite input is
 * returned unchanged so the NaN guards downstream still see it. */
export function debtOwedCents(raw: number): number {
  return Number.isFinite(raw) ? Math.abs(raw) : raw
}
