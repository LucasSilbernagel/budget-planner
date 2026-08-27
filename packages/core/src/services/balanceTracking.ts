/**
 * Balance Tracking Service
 *
 * Core service layer for balance tracking operations.
 * Provides type definitions, validation, and business logic for investment, debt
 * and asset tracking.
 *
 * Architecture:
 * - Pure TypeScript functions, no side effects
 * - Works with both client-side (free tier) and server-side (paid tier) data
 * - Database types imported from @budget-planner/db
 */

import type { BalanceTracking as DbBalanceTracking, FinanceType } from '@budget-planner/db'
import { type Frequency, normalizeToMonthly } from '../finance/normalization'
import {
  DebtCalculationResult,
  DebtSubType,
  calculateDebtMetrics,
  calculateMonthsToLimit,
} from '../utils/balanceCalculations'
import { generateUuid } from '../utils/uuid'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The finance-type values as a RUNTIME list, client-safe.
 *
 * ⚠️ Why this is restated here rather than imported from `@budget-planner/db`:
 * that package's barrel (`src/index.ts`) re-exports `./client`, which THROWS at
 * module scope when `window` is defined ("SERVER-ONLY package"). `packages/core`
 * is client-bundled, so a VALUE import of the barrel would ship that throw into
 * the browser. The `FinanceType` import above is `import type` and is erased at
 * compile time, so it is safe.
 *
 * Drift is prevented at COMPILE time in both directions by `_financeTypeCoverage`
 * below, and pinned against `financeTypeEnum.enumValues` by the gates test.
 */
export const FINANCE_TYPES = [
  'investment',
  'debt',
  'asset',
] as const satisfies readonly FinanceType[]

/**
 * Compile-time proof that `FINANCE_TYPES` covers EVERY member of `FinanceType`.
 *
 * ⚠️ `satisfies readonly FinanceType[]` alone is NOT enough — a SHORT tuple is
 * assignable to it, so a missing member compiles clean. `satisfies` catches
 * invalid/misspelled members; this `Exclude` catches OMISSIONS. Both directions
 * are needed, which is the whole lesson of story 43.4: adding a third enum value
 * produced exactly ONE compiler error across the monorepo.
 */
type _FinanceTypeCoverage = Exclude<FinanceType, (typeof FINANCE_TYPES)[number]> extends never
  ? true
  : never
const _financeTypeCoverage: _FinanceTypeCoverage = true
void _financeTypeCoverage

/**
 * Client-side Balance Tracking interface for free tier
 * Uses number IDs (for localStorage/IndexedDB) and string timestamps
 * Omits userId for free tier (no authentication)
 */
export interface ClientBalanceTracking {
  // Client-generatable uuid PK (Story 5-14): the row carries the SAME id on every
  // device, so a server pull reconciles by this id with no duplicates. Replaces
  // the old negative-integer temp id.
  id: string
  type: FinanceType
  name: string
  currentBalance: number // In cents (can be negative for debts)
  // ⚠️ `| null` is not cosmetic. `BalancePage` deliberately persists `null` for "no
  // limit" — it is how a new debt, an investment->debt switch, or saving a legacy
  // debt that had a limit all clear it (`BalancePage.tsx:301-304`). The type said
  // `?: number` and was simply lying about what this field has held in
  // localStorage since story 16-2.
  maxContributionLimit?: number | null // In cents, optional
  monthlyContribution: number // In cents (default 0) — amount at `frequency` cadence (Story 16-2)
  frequency: Frequency // Cadence of monthlyContribution (Story 16-2); normalize before aggregating
  createdAt: string // ISO string for localStorage serialization
  updatedAt: string // ISO string for localStorage serialization
  // Explicit display order (Story 34.1a, FR60); see ClientSavingsGoal.sortOrder in
  // ./savingsGoals.ts for why this is optional rather than required (the
  // `toClient*` factory has no list access and so cannot compute a position).
  sortOrder?: number
  // Optional UI display fields
  monthsToLimit?: number | null
  // Story 45.1 (FR72): the user's statement that this row's `monthlyContribution`
  // is ALREADY recorded as an expense line, so the savings distributable pool must
  // not subtract it twice. Absent/`false` ⇒ deduct (today's arithmetic, unchanged).
  // ⚠️ USER-SUPPLIED, never inferred. The same-money and different-money users are
  // byte-identical in every other field, so no rule computed from row content can
  // tell them apart — see `finance/savingsAllocation.ts` and FR72.
  contributionRecordedAsExpense?: boolean
  // Debt-specific fields
  debtSubType?: DebtSubType // Sub-type for debt entries (credit-card, mortgage, loan, other)
  originalBalance?: number // Original loan amount in cents (for mortgage/loan progress calculation)
}

/**
 * Client-side new Balance Tracking (without ID and timestamps)
 */
export interface ClientNewBalanceTracking {
  type: FinanceType
  name: string
  currentBalance: number // In cents
  maxContributionLimit?: number | null // In cents, optional
  monthlyContribution: number // In cents (default 0) — amount at `frequency` cadence (Story 16-2)
  frequency: Frequency // Cadence of monthlyContribution (Story 16-2)
  contributionRecordedAsExpense?: boolean // Story 45.1 (FR72); see ClientBalanceTracking
  // Debt-specific fields
  debtSubType?: DebtSubType // Sub-type for debt entries
  originalBalance?: number // Original loan amount in cents (for mortgage/loan)
}

/**
 * Balance Tracking with timeline calculation
 * Used for display purposes
 */
export interface BalanceTrackingWithTimeline extends ClientBalanceTracking {
  monthsToLimit: number | null
  // Debt-specific display fields
  debtProgress?: number | null
  debtProgressLabel?: string
  debtTimeline?: number | null
  debtTimelineLabel?: string
}

/**
 * Database Balance Tracking type (re-exported for convenience)
 * Uses serial IDs (positive integers) from PostgreSQL sequence
 * Note: Differs from ClientBalanceTracking which uses negative IDs for client-side storage
 */
export type DatabaseBalanceTracking = DbBalanceTracking

/**
 * Input type for creating a new balance tracking entry in the database
 */
export interface CreateBalanceTrackingInput {
  type: FinanceType
  name: string
  currentBalance: number // In cents
  maxContributionLimit?: number // In cents, optional
  monthlyContribution: number // In cents — amount at `frequency` cadence (Story 16-2)
  frequency: Frequency // Cadence of monthlyContribution (Story 16-2)
  contributionRecordedAsExpense?: boolean // Story 45.1 (FR72); see ClientBalanceTracking
  userId?: number // Optional for free tier (null), required for paid tier
}

/**
 * Input type for updating an existing balance tracking entry
 * Uses number IDs to align with database serial and client-side negative IDs
 */
export interface UpdateBalanceTrackingInput {
  id: string // uuid PK (Story 5-14) — shared client/server identity
  type?: FinanceType
  name?: string
  currentBalance?: number // In cents
  maxContributionLimit?: number // In cents, optional
  monthlyContribution?: number // In cents — amount at `frequency` cadence (Story 16-2)
  frequency?: Frequency // Cadence of monthlyContribution (Story 16-2)
  contributionRecordedAsExpense?: boolean // Story 45.1 (FR72); see ClientBalanceTracking
}

/**
 * Result type for balance tracking operations
 */
export interface BalanceTrackingResult {
  success: boolean
  data?: ClientBalanceTracking | DatabaseBalanceTracking
  error?: string
}

/**
 * Filter options for querying balance tracking entries
 */
export interface BalanceTrackingFilter {
  type?: FinanceType
  search?: string // Search by name
}

// ============================================================================
// Timeline Calculation
// ============================================================================

/**
 * Calculate months to max contribution limit
 * Re-exports from balanceCalculations for convenience
 */
export { calculateMonthsToLimit } from '../utils/balanceCalculations'

/**
 * The valid contribution cadences (Story 16-2), mirroring the DB `frequencyEnum`.
 * Single source shared by validation and the normalization chokepoint.
 */
export const VALID_FREQUENCIES: readonly Frequency[] = ['weekly', 'biweekly', 'monthly', 'annually']

/**
 * Monthly-equivalent of an entry's contribution, in cents (Story 16-2).
 *
 * This is the SINGLE place a balance-tracking contribution is normalized to a
 * monthly base. Every timeline/projection/aggregation consumer MUST route through
 * it instead of reading `monthlyContribution` raw — the stored value is the amount
 * at `frequency` cadence, not necessarily monthly.
 *
 * An unrecognized frequency (null/undefined from a legacy pre-migration row, or a
 * corrupt value from user-editable localStorage / a future enum-rollback) is coerced
 * to `'monthly'`. `normalizeToMonthly` THROWS on an invalid frequency, and this runs
 * inside `withTimeline` during render (no ErrorBoundary), so a bad value must degrade
 * to the sane default rather than crash the page.
 *
 * @param entry - Object carrying the raw contribution and its cadence
 * @returns The monthly-equivalent contribution in cents (rounded)
 */
export function monthlyContributionCents(
  entry: Pick<ClientBalanceTracking, 'monthlyContribution' | 'frequency'>
): number {
  const frequency = VALID_FREQUENCIES.includes(entry.frequency) ? entry.frequency : 'monthly'
  return normalizeToMonthly(entry.monthlyContribution, frequency)
}

/**
 * Remaining contribution room for a balance-tracking account, in cents (Story 26-4).
 *
 * Returns `null` when no *usable* contribution limit is set — the caller shows a
 * placeholder (e.g. "—"), NOT "0" (FR41: "Accounts with no limit show no room
 * figure (not '0')"). "No usable limit" covers a persisted `null`, a legacy row
 * where the field is absent (`undefined` — the type declares
 * `maxContributionLimit?: number` and the persist migrate never backfills it),
 * AND a corrupt non-number/non-finite value (localStorage is user-editable): a
 * corrupt limit must degrade to "—", not slip through to `Math.max(0, NaN)` = NaN
 * which the display formatter would coerce to a misleading "0.00". Mirrors the
 * finite/type guard `monthlyContributionCents` applies at this same data boundary.
 *
 * Otherwise `max(0, maxContributionLimit − currentBalance)`, so an at-/over-limit
 * account reads 0, never negative. A non-finite `currentBalance` (also possible
 * from corrupt storage) is coerced to 0 so a valid limit still yields a finite
 * room rather than NaN. Frequency-free — never touches the `normalizeToMonthly`
 * throw path.
 *
 * @param entry - Object carrying the contribution limit and current balance (cents)
 * @returns Remaining room in cents, or `null` when no usable limit is set
 */
export function remainingContributionRoom(
  entry: Pick<ClientBalanceTracking, 'maxContributionLimit' | 'currentBalance'>
): number | null {
  const { maxContributionLimit, currentBalance } = entry
  if (typeof maxContributionLimit !== 'number' || !Number.isFinite(maxContributionLimit)) {
    return null
  }
  const balance = Number.isFinite(currentBalance) ? currentBalance : 0
  return Math.max(0, maxContributionLimit - balance)
}

/**
 * Determine display type properties based on FinanceType
 *
 * @param type - Finance type ('investment' or 'debt')
 * @returns Display properties for theming, or undefined if type is invalid
 */
export function getTypeDisplayProperties(type: FinanceType):
  | {
      theme: 'success' | 'danger'
      icon: string
      label: string
      colorClass: string
      bgColorClass: string
    }
  | undefined {
  // Validate type parameter
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
      // Story 43.4 / FR70. An owned asset is a positive holding, so it reuses the
      // 'success' theme rather than widening the union to a third value — the
      // theme encodes "counts toward you / counts against you", and an asset is
      // unambiguously the former.
      // The ICON differs from investment's '↗' on purpose: an asset is HELD, not
      // growing by contribution, so it gets a static marker rather than an arrow.
      theme: 'success' as const,
      icon: '◆',
      label: 'Asset',
      colorClass: 'text-amber-600 dark:text-amber-400',
      bgColorClass: 'bg-amber-100 dark:bg-amber-900/30',
    },
  }
  return properties[type]
}

/**
 * Calculate months to limit and create display object
 * For debts, also calculates debt-specific metrics based on debtSubType
 *
 * @param entry - Balance tracking entry
 * @returns BalanceTrackingWithTimeline with calculated fields
 */
export function withTimeline(entry: ClientBalanceTracking): BalanceTrackingWithTimeline {
  // Story 16-2: normalize the contribution to its monthly equivalent before feeding
  // the monthly-math timeline/debt calculators (they stay purely "per month").
  const monthlyContribution = monthlyContributionCents(entry)

  const monthsToLimit = calculateMonthsToLimit(
    entry.currentBalance,
    entry.maxContributionLimit,
    monthlyContribution
  )

  // Calculate debt-specific metrics if this is a debt
  let debtProgress: number | null = null
  let debtProgressLabel = 'No limit'
  let debtTimeline: number | null = null
  let debtTimelineLabel = 'No payment set'

  if (entry.type === 'debt' && entry.debtSubType) {
    const result = calculateDebtMetrics(
      entry.currentBalance,
      entry.maxContributionLimit,
      monthlyContribution,
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
    monthsToLimit,
    debtProgress,
    debtProgressLabel,
    debtTimeline,
    debtTimelineLabel,
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validation errors for balance tracking inputs
 */
export interface ValidationError {
  field: string
  message: string
  value: unknown
}

/**
 * Validate balance tracking input
 *
 * @param input - Balance tracking input to validate
 * @returns Array of validation errors (empty if valid)
 *
 * Form Validation (from Dev Notes):
 * - name: Required, max 100 characters
 * - type: Required, must be 'investment' or 'debt'
 * - currentBalance: Required, integer (in cents, can be negative)
 * - maxContributionLimit: Optional, non-negative integer (in cents)
 * - monthlyContribution: Optional, non-negative integer (in cents)
 */
export function validateBalanceTracking(
  input: Partial<ClientNewBalanceTracking>
): ValidationError[] {
  const errors: ValidationError[] = []

  // Name validation
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

  // Type validation
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

  // Story 43.4 (D2): an asset carries no contribution. Enforced HERE, not only in
  // the form, because this runs on every write path the store has — `addBalanceEntry`
  // and `updateBalanceEntry` both call it — whereas the form's zeroing covers only
  // rows a user typed. Without this, a row reaching the store by any other route
  // could hold a contribution that `SavingsPage`'s investment-only pool filter
  // never deducts, overstating the distributable pool and inflating every
  // automatic allocation.
  // ⚠️ RESIDUAL, pre-existing and NOT closed by this rule: `applyServerChanges`
  // writes pulled rows straight into the store WITHOUT validation, and
  // `moveBalanceEntry` deliberately bypasses it. A synced or hand-edited asset row
  // carrying a contribution is therefore still reachable. This narrows the hole to
  // the pull path; it does not eliminate it.
  if (input.type === 'asset' && typeof input.monthlyContribution === 'number') {
    if (input.monthlyContribution !== 0) {
      errors.push({
        field: 'monthlyContribution',
        message: 'An asset has no contribution — record recurring saving on the Savings page',
        value: input.monthlyContribution,
      })
    }
  }

  // Story 45.1 (D8): `contributionRecordedAsExpense` is only meaningful on an
  // `investment` row, because that is the only type the distributable pool reads
  // (`SavingsPage` filters on `type === 'investment'`). A `debt` or `asset` row
  // carrying `true` would claim an effect that does not exist, so reject it here —
  // on every store write path, not just the form, for the same reason the asset
  // contribution rule above is enforced here.
  // ⚠️ Same RESIDUAL as above: `applyServerChanges` and `moveBalanceEntry` bypass
  // this, so a synced or hand-edited non-investment row can still carry the flag.
  // ⚠️ SCOPE OF "harmless", stated precisely rather than generally: it is inert
  // for the DISTRIBUTABLE POOL and for the duplicate detector, because both read
  // `useInvestmentEntries()` and so never see a debt/asset row. That is a claim
  // about those two consumers as they exist TODAY — it is NOT a claim that the
  // field is harmless everywhere. Any future consumer that iterates entries by id
  // rather than through a type-filtered selector would see it. Writing this as
  // "it is inert" full stop is the same true-for-the-case-it-names-and-false-as-
  // written mistake that `epics.md:373` / FR72 exists to correct; re-check the
  // consumer list before reusing this reassurance.
  if (input.contributionRecordedAsExpense === true && input.type !== 'investment') {
    errors.push({
      field: 'contributionRecordedAsExpense',
      message: 'Only an investment contribution can be marked as already recorded as an expense',
      value: input.contributionRecordedAsExpense,
    })
  }

  // Frequency validation (Story 16-2): required, must be a valid cadence
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

  // Current balance validation
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
  }

  // Max contribution limit validation (optional)
  if (input.maxContributionLimit !== undefined && input.maxContributionLimit !== null) {
    if (
      typeof input.maxContributionLimit !== 'number' ||
      !Number.isFinite(input.maxContributionLimit)
    ) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit must be a finite number (in cents)',
        value: input.maxContributionLimit,
      })
    } else if (!Number.isInteger(input.maxContributionLimit)) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit must be an integer (in cents, not a float)',
        value: input.maxContributionLimit,
      })
    } else if (input.maxContributionLimit < 0) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit cannot be negative',
        value: input.maxContributionLimit,
      })
    } else if (Math.abs(input.maxContributionLimit) > Number.MAX_SAFE_INTEGER / 100) {
      errors.push({
        field: 'maxContributionLimit',
        message: 'Max contribution limit exceeds safe integer bounds',
        value: input.maxContributionLimit,
      })
    }
  }

  // Monthly contribution validation
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
    } else if (Math.abs(input.monthlyContribution) > Number.MAX_SAFE_INTEGER / 100) {
      errors.push({
        field: 'monthlyContribution',
        message: 'Monthly contribution exceeds safe integer bounds',
        value: input.monthlyContribution,
      })
    }
  }

  // Bounds validation for currentBalance (already validated as integer above)
  if (
    input.currentBalance !== undefined &&
    Math.abs(input.currentBalance) > Number.MAX_SAFE_INTEGER / 100
  ) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance exceeds safe integer bounds',
      value: input.currentBalance,
    })
  }

  return errors
}

/**
 * Check if balance tracking input is valid
 *
 * @param input - Balance tracking input to validate
 * @returns true if valid, false otherwise
 */
export function isValidBalanceTracking(input: Partial<ClientNewBalanceTracking>): boolean {
  return validateBalanceTracking(input).length === 0
}

// ============================================================================
// Sorting and Filtering
// ============================================================================

/**
 * Sort balance tracking entries by creation date (newest first)
 *
 * AC 2: When viewing the balance tracking list, all entries are displayed sorted by creation date (newest first)
 *
 * @param entries - Array of balance tracking entries to sort
 * @returns New array sorted by createdAt (descending), or empty array if entries is null/undefined
 */
export function sortByCreationDate(entries: ClientBalanceTracking[]): ClientBalanceTracking[] {
  // Handle null/undefined entries
  if (!entries) {
    return []
  }

  return [...entries].sort((a, b) => {
    // Validate dates
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()

    // Handle invalid dates - push to end
    if (!Number.isFinite(dateA)) return 1
    if (!Number.isFinite(dateB)) return -1

    return dateB - dateA // Newest first
  })
}

/**
 * Filter balance tracking entries by type and/or search
 *
 * @param entries - Array of balance tracking entries with timeline
 * @param filter - Filter options
 * @returns Filtered array of balance tracking entries, or empty array if entries is null/undefined
 */
export function filterBalanceTracking(
  entries: BalanceTrackingWithTimeline[],
  filter: BalanceTrackingFilter
): BalanceTrackingWithTimeline[] {
  // Handle null/undefined entries or filter
  if (!entries || !filter) {
    return []
  }

  return entries.filter((entry) => {
    if (filter.type && entry.type !== filter.type) return false
    if (filter.search) {
      // If search is not a string, return false (exclude entry)
      if (typeof filter.search !== 'string') return false
      const searchLower = filter.search.toLowerCase()
      const entryName = typeof entry.name === 'string' ? entry.name.toLowerCase() : ''
      if (!entryName.includes(searchLower)) return false
    }
    return true
  })
}

// ============================================================================
// ID Generation for Client-side Storage
// ============================================================================

/**
 * Generate a client-generatable uuid for a balance tracking entry (Story 5-14).
 *
 * Replaces the old localStorage-backed negative-integer counter: the id is now a
 * uuid the client mints up front so a row created offline has the SAME id on every
 * device and a server pull reconciles by id (no duplicates). Being stateless, it
 * also drops the cross-tab counter coordination the old scheme needed. Name kept
 * for call-site stability.
 *
 * @returns A uuid string
 */
export function generateBalanceTrackingTempId(): string {
  return generateUuid()
}

/**
 * No-op retained for backward compatibility (Story 5-14).
 *
 * uuid generation is stateless, so there is no counter to reset. Kept so existing
 * test/setup call sites compile unchanged.
 */
export function resetBalanceTrackingTempId(): void {
  // Intentionally empty — uuid ids are stateless (no counter to reset).
}

/**
 * Convert new balance tracking input to client balance tracking (add ID and timestamps)
 *
 * @param input - New balance tracking input
 * @returns Client balance tracking with ID and timestamps
 */
export function toClientBalanceTracking(input: ClientNewBalanceTracking): ClientBalanceTracking {
  const now = new Date().toISOString()
  return {
    ...input,
    id: generateBalanceTrackingTempId(),
    createdAt: now,
    updatedAt: now,
  }
}

// ============================================================================
// Exports
// ============================================================================

// Re-export debt calculation types
export type { DebtSubType, DebtCalculationResult }
export { calculateDebtMetrics }

export {
  calculateMonthsToLimit as calculateBalanceTimeline,
  calculateMonthsToLimit as calculateBalanceMonthsToLimit,
  withTimeline as withBalanceTrackingTimeline,
}
