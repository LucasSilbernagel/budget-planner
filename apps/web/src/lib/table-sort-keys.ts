import { getNormalizationMultiplier, normalizeToMonthly } from '@budget-planner/core'
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
 *      the key suppresses it too. An ASSET row is the live example: its
 *      Contribution cell renders an em-dash (story 43.4, D2) while the row still
 *      stores a `monthlyContribution` of 0, so the `contribution` extractor
 *      branches on `type` and returns null rather than keying at 0 — otherwise
 *      every asset would sort among the genuine zeroes.
 *      ⚠️ This rule was originally illustrated with `remainingContributionRoom`,
 *      whose column story 49.1 (FR75) removed. The rule outlived the example.
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

export type BalanceSortKey = 'type' | 'name' | 'currentBalance' | 'contribution'

interface BalanceRow {
  type: string
  name: string
  currentBalance: number
  monthlyContribution: number
  frequency: string
}

/**
 * Balance — the editable "Your Balance Entries" table only.
 *
 * `type` sorts by the ENUM in the order the page presents the money in:
 * investment (0), asset (1), debt (2) — what you own, then what you own
 * outright, then what you owe, matching the summary-card row. ⚠️ Not by the
 * rendered label: those are `Investment`, `Asset` and `Debt`, and
 * `'Asset'.localeCompare('Debt') < 0 < 'Investment'` would order them
 * Asset, Debt, Investment — assets and debts adjacent, which is the one
 * grouping the page never shows.
 *
 * ⚠️ Story 43.4: this was a BINARY key (`type === 'investment' ? 0 : 1`). Left
 * alone, a third value would have tied with every debt row rather than erroring
 * — `BalanceRow.type` is `string`, so the compiler could not see it.
 *
 * `contribution` is em-dashed for assets (story 43.4, D2), so it branches on
 * `type` before reading the value. See rule 2 in the module docblock.
 */
/**
 * Display rank per finance type. An unknown value sorts LAST rather than tying
 * with a real one, so a corrupt or newer-than-this-build row is visibly at the
 * end instead of silently interleaved.
 */
const TYPE_SORT_RANK: Readonly<Record<string, number>> = {
  investment: 0,
  asset: 1,
  debt: 2,
}
const TYPE_SORT_RANK_FALLBACK = 3

export function createBalanceSortExtractors(): SortKeyExtractors<BalanceRow, BalanceSortKey> {
  return {
    // ⚠️ An OWN-property check, not `?? FALLBACK`: a row whose `type` is 'constructor',
    // 'toString' or 'valueOf' would otherwise read an INHERITED Object.prototype
    // member — a function, which is not nullish, so `??` never fires and the
    // comparator receives a function as a sort key. Unknown types are reachable
    // (a hand-edited or newer-build row survives rehydrate untouched, pinned in
    // `balanceStore.dom.test.ts`), which is exactly what the fallback is for.
    // `hasOwnProperty.call` rather than `Object.hasOwn`: this package's `lib`
    // target predates ES2022.
    type: (row) =>
      Object.prototype.hasOwnProperty.call(TYPE_SORT_RANK, row.type)
        ? TYPE_SORT_RANK[row.type] ?? TYPE_SORT_RANK_FALLBACK
        : TYPE_SORT_RANK_FALLBACK,
    name: (row) => textOrNull(row.name),
    currentBalance: (row) => finiteOrNull(row.currentBalance),
    // An asset shows an em-dash here, not "$0.00 / Monthly" — rule 2 says sort
    // by what the CELL SHOWS, so it must null out rather than key at 0.
    contribution: (row) =>
      row.type === 'asset' ? null : normalizedOrNull(row.monthlyContribution, row.frequency),
  }
}
