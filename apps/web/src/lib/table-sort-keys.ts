import { getNormalizationMultiplier, normalizeToMonthly } from '@budget-planner/core'
import { remainingContributionRoom } from '@budget-planner/core'
import { resolveCategoryName } from '../hooks/useCategoryLabels'
import { isKnownFrequency, isReadableRow } from './readable-rows'
import type { SortKeyExtractors } from './table-sort'

/**
 * The per-column sort keys for the four financial tables (Story 34.2, FR61).
 *
 * ## Two rules every extractor here obeys
 *
 *   1. **Return `null`, never `NaN` and never a throw.** Core's normalizers
 *      throw (`validateAmount` / `validateFrequency`), and a comparator that
 *      throws during render blanks the page rather than mis-ordering one row.
 *      `getNormalizationMultiplier` is the subtler half of the same trap: it
 *      does NOT throw, it returns `undefined`, so an unguarded cadence key
 *      silently yields `NaN`. Every path below is guarded.
 *   2. **Sort by what the CELL SHOWS.** Where a cell suppresses a stored value,
 *      the key suppresses it too. `remainingContributionRoom` never reads
 *      `type`, so a debt row carrying a legacy `maxContributionLimit` would sort
 *      among the numbers while its cell renders an em-dash; the `type` branch
 *      below is what keeps the order and the rendering in agreement.
 *
 * ## What is deliberately NOT normalized
 *
 * Only two columns in the whole app pair an amount with a cadence: Income and
 * Expenses **Amount**, and Balance **Contribution**. Savings has no `frequency`
 * field at all, and a `currentBalance` is a point-in-time stock rather than a
 * per-period flow — story 32.1 (FR58) settled that a balance must not be
 * normalized, and normalizing it here would contradict the figure the same page
 * prints above the table.
 */

/** Money-like fields are integer cents; reject anything a comparator could not
 * order (`NaN`, `Infinity`, a persisted string). */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A displayed name. An absent or non-string name has no alphabetical position. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * A cadence's position on the "how often" axis.
 *
 * The multiplier is monthly-occurrences-per-period, so it DESCENDS as the period
 * lengthens (weekly 4.33 -> annually 0.083). Negating it makes ascending order
 * read the way a user expects a Frequency column to: weekly, biweekly, monthly,
 * annually. Alphabetical order (annually, biweekly, monthly, weekly) would be
 * noise.
 */
function cadenceKey(frequency: unknown): number | null {
  if (!isKnownFrequency(frequency)) {
    return null
  }
  return -getNormalizationMultiplier(frequency)
}

/** The monthly-equivalent of an amount + cadence pair, or `null` if core would
 * refuse the row. */
function normalizedOrNull(amount: unknown, frequency: unknown): number | null {
  const candidate = { amount, frequency }
  if (!isReadableRow(candidate)) {
    return null
  }
  return normalizeToMonthly(candidate.amount, candidate.frequency)
}

/** Income and Expenses share a row shape and therefore a sortable column set. */
export type FlowSortKey = 'name' | 'amount' | 'frequency' | 'category'

interface FlowRow {
  name: string
  amount: number
  frequency: string
  categoryId: string | null
}

/**
 * Income / Expenses.
 *
 * ⚠️ `categoryNames` is why the caller must memoise the returned object on
 * `[categoryNames]`: renaming a category changes this table's order without any
 * row changing, and a projection memoised only on the rows would keep the stale
 * order with no error anywhere.
 *
 * Category sorts by `resolveCategoryName`, the SAME resolver `CategoryBadge`
 * renders through — not a raw map lookup. The resolver collapses "no category",
 * "dangling id" and "blank name" to `null`, so all three sort last exactly as
 * they all render as the uncategorized placeholder. A raw lookup would return
 * `'   '` for the blank-name case and sort it near the top.
 */
export function createFlowSortExtractors(
  categoryNames: ReadonlyMap<string, string>,
  includeCategory: boolean
): SortKeyExtractors<FlowRow, FlowSortKey> {
  const base = {
    name: (row: FlowRow) => textOrNull(row.name),
    amount: (row: FlowRow) => normalizedOrNull(row.amount, row.frequency),
    frequency: (row: FlowRow) => cadenceKey(row.frequency),
  }
  // ⚠️ The Category key is OMITTED, not merely unused, when the column is not
  // rendered. Leaving it in place would let a sort outlive its column: an
  // entitled user sorts by Category, entitlement lapses, and the table stays
  // ordered by a key nothing on screen explains, with the move arrows disabled
  // and no desktop control to clear it. `useTableSort` degrades a sort whose key
  // has no extractor, so the unreachable state stops being representable.
  return includeCategory
    ? {
        ...base,
        category: (row: FlowRow) => resolveCategoryName(row.categoryId, categoryNames),
      }
    : base
}

export type SavingsSortKey = 'name' | 'target' | 'currentBalance' | 'monthlyAllocation' | 'progress'

interface SavingsRow {
  id: string
  name: string
  targetAmount: number | null
  currentBalance: number
  monthlyAllocation?: number | null
}

/**
 * Savings.
 *
 * `allocations` and `getProgress` are both inputs the row does not carry, so the
 * caller memoises on `[allocations, getProgress]` alongside the rows.
 *
 * `monthlyAllocation` reproduces the cell's own expression exactly (story 26.3):
 * an account is AUTOMATIC iff the solver placed it in `allocations` — membership
 * is what discriminates the two modes, and a manual amount is floored at 0 to
 * match the solver. Sorting by the stored field instead would order automatic
 * accounts by a number their row never displays.
 */
export function createSavingsSortExtractors(
  allocations: Readonly<Record<string, number>>,
  getProgress: (id: string) => number | null
): SortKeyExtractors<SavingsRow, SavingsSortKey> {
  return {
    name: (row) => textOrNull(row.name),
    target: (row) => finiteOrNull(row.targetAmount),
    currentBalance: (row) => finiteOrNull(row.currentBalance),
    monthlyAllocation: (row) =>
      finiteOrNull(
        row.id in allocations ? allocations[row.id] ?? 0 : Math.max(0, row.monthlyAllocation ?? 0)
      ),
    progress: (row) => finiteOrNull(getProgress(row.id)),
  }
}

export type BalanceSortKey =
  | 'type'
  | 'name'
  | 'currentBalance'
  | 'maxContribution'
  | 'remainingRoom'
  | 'contribution'

interface BalanceRow {
  type: string
  name: string
  currentBalance: number
  // `| null` matches `ClientBalanceTracking`: the app persists null for "no limit".
  // Both readers below already cope — `finiteOrNull` is a `typeof === 'number'`
  // check and `remainingContributionRoom` guards the same way.
  maxContributionLimit?: number | null
  monthlyContribution: number
  frequency: string
}

/**
 * Balance — the editable "Your Balance Entries" table only.
 *
 * `type` sorts by the ENUM, investment before debt, matching the order the page
 * itself presents the two groups in. ⚠️ Not by the rendered label: those are
 * `Investment` and `Debt`, and `'Debt'.localeCompare('Investment') < 0` would
 * put debts first — the exact inverse.
 *
 * `maxContribution` and `remainingRoom` are both investment-only in the
 * rendering (`None` and an em-dash respectively for every debt row), so both
 * branch on `type` before reading the value. See rule 2 in the module docblock.
 */
export function createBalanceSortExtractors(): SortKeyExtractors<BalanceRow, BalanceSortKey> {
  return {
    type: (row) => (row.type === 'investment' ? 0 : 1),
    name: (row) => textOrNull(row.name),
    currentBalance: (row) => finiteOrNull(row.currentBalance),
    maxContribution: (row) =>
      row.type === 'investment' ? finiteOrNull(row.maxContributionLimit) : null,
    remainingRoom: (row) =>
      row.type === 'investment'
        ? finiteOrNull(
            remainingContributionRoom({
              maxContributionLimit: row.maxContributionLimit,
              currentBalance: row.currentBalance,
            })
          )
        : null,
    contribution: (row) => normalizedOrNull(row.monthlyContribution, row.frequency),
  }
}
