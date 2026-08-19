/**
 * Partition persisted financial rows into ones core can normalize and ones it
 * cannot (story 32.1, FR58).
 *
 * ## Why this exists
 *
 * Core's `calculateTotalMonthlyNormalized` → `normalizeToMonthly` →
 * `validateFrequency` / `validateAmount` **throw** on a row whose `frequency` is
 * outside the four-value set or whose `amount` is not finite. localStorage is
 * user-editable, the persist `migrate` steps only sanitize row SHAPE (not these
 * two fields), and the sync applier writes rows without validating either — so
 * an unguarded core call on the render path white-screens the whole page. That
 * failure is already live on the dashboard (`deferred-work.md:524`), and story
 * 32.1 would have added `/income` and `/expenses` to it by routing their totals
 * through core for the first time.
 *
 * ## Why EXCLUDE rather than COERCE
 *
 * The repo has two established responses to this hazard and they are not
 * interchangeable:
 *
 *   - `SavingsPage`'s `KNOWN_FREQUENCIES` coerces an unknown cadence to
 *     `'monthly'`. Fine for a contribution input that feeds a solver — wrong for
 *     a headline total, because it INVENTS a number and presents it as fact.
 *   - `lib/report/build-financial-summary.ts` partitions corrupt rows, counts
 *     them, and discloses the count "rather than silently under-reporting".
 *
 * A headline total takes the second. Callers pair `toNormalizableItems` with
 * `countUnreadableRows` and surface the count in the UI, so an excluded row is
 * visible to the user rather than quietly missing from their money.
 */

import type { Frequency } from '@budget-planner/core'

/**
 * The four members of the core `Frequency` union.
 *
 * ⚠️ Kept as a runtime set on purpose: `Frequency` is erased at compile time, so
 * a persisted string can only be checked against real values. This mirrors
 * `SavingsPage`'s `KNOWN_FREQUENCIES` and `CategoryBreakdown`'s `FREQUENCIES`.
 */
const KNOWN_FREQUENCIES: ReadonlySet<string> = new Set<Frequency>([
  'weekly',
  'biweekly',
  'monthly',
  'annually',
])

/** A row core is guaranteed to accept without throwing. */
export interface NormalizableItem {
  amount: number
  frequency: Frequency
}

/**
 * True when a persisted string is one of the four cadences core understands.
 *
 * Exported for story 34.2's Frequency comparator, which needs the frequency
 * check WITHOUT the amount check: it orders rows by cadence, so a row with a
 * corrupt `amount` still sorts fine, while a row with an unknown `frequency` has
 * no position at all and must be placed last.
 *
 * ⚠️ This is the guard that stops the Frequency sort returning `NaN`.
 * `getNormalizationMultiplier` does not throw on an unknown cadence — it returns
 * `undefined`, so an unguarded key silently produces `NaN`, and `lib/ordering.ts`
 * records what a `NaN` comparator does: undefined behaviour that can leave the
 * array in an arbitrary order, with no error anywhere.
 */
export function isKnownFrequency(frequency: unknown): frequency is Frequency {
  return typeof frequency === 'string' && KNOWN_FREQUENCIES.has(frequency)
}

/**
 * True when core can normalize this row — i.e. exactly the conditions under
 * which `validateAmount` and `validateFrequency` do NOT throw.
 *
 * ⚠️ Takes `unknown`, and the `typeof row === 'object' && row !== null` arm is
 * load-bearing, not defensive noise. A persisted array can contain a `null` or
 * primitive element (truncated write, hand-edited storage, an older bug). The
 * persist `migrate` filters exactly those out — but zustand only runs `migrate`
 * on a version MISMATCH, so a blob already at the current version carries the
 * bad element straight into state. Without this arm the guard throws
 * `Cannot read properties of null` on the render path and white-screens the very
 * page it exists to protect. (Code review 32.1. The pre-32.1 raw-sum getter threw
 * on the same input, so this closes a LATENT crash, not a regression.) Mirrors
 * `CategoryBreakdown`'s `row?.amount` and HomePage's `source?.id` guards.
 *
 * `Number.isFinite` (not `!Number.isNaN`) is deliberate: it rejects `Infinity`
 * and `-Infinity` too, matching core's own check and the repo-wide guard
 * established by bug-1.
 */
export function isReadableRow(row: unknown): row is NormalizableItem {
  if (typeof row !== 'object' || row === null) {
    return false
  }
  const { amount, frequency } = row as { amount?: unknown; frequency?: unknown }
  return (
    typeof frequency === 'string' &&
    KNOWN_FREQUENCIES.has(frequency) &&
    typeof amount === 'number' &&
    Number.isFinite(amount)
  )
}

/** The subset of rows core can normalize, narrowed to the shape core expects. */
export function toNormalizableItems(rows: readonly unknown[]): NormalizableItem[] {
  return rows.filter(isReadableRow).map((row) => ({
    amount: row.amount,
    frequency: row.frequency,
  }))
}

/** How many rows had to be excluded, for disclosure in the UI. */
export function countUnreadableRows(rows: readonly unknown[]): number {
  return rows.reduce<number>((count, row) => (isReadableRow(row) ? count : count + 1), 0)
}

/**
 * What a headline total needs in order to explain itself honestly.
 *
 * ⚠️ Both extra fields exist because of code-review findings against 32.1. The
 * pages used to derive the "before conversion" figure from ALL rows and gate the
 * conversion tooltip on `normalizedTotal !== rawTotal`. That lied in two
 * opposite directions:
 *
 *   1. **False positive.** One readable $1,500 monthly row + one corrupt-frequency
 *      row with a FINITE $100 amount made the two totals differ, so the tooltip
 *      fired claiming "Entered total before conversion: $1,600.00" — quoting money
 *      the total had deliberately EXCLUDED, and announcing a conversion that never
 *      happened, directly contradicting the unreadable-rows note beside it. Hence
 *      `rawTotalCents` sums READABLE rows only.
 *   2. **False negative.** $330 weekly + $1,200 annually normalizes to exactly the
 *      raw sum (`round(33000×52/12)=143000` + `10000` == `33000 + 120000` ==
 *      153000c), so a real conversion showed no explanation at all. Value-equality
 *      is only a PROXY for "did conversion happen"; `conversionApplied` asks the
 *      question directly.
 */
export interface ReadableRowsSummary {
  /** Sum of entered amounts across READABLE rows only, unconverted. */
  rawTotalCents: number
  /** Rows core could not read, for disclosure. */
  unreadableCount: number
  /** Whether any readable row sits on a non-monthly cadence. */
  conversionApplied: boolean
}

export function summarizeReadableRows(rows: readonly unknown[]): ReadableRowsSummary {
  const readable = toNormalizableItems(rows)
  return {
    rawTotalCents: readable.reduce((sum, row) => sum + row.amount, 0),
    unreadableCount: rows.length - readable.length,
    conversionApplied: readable.some((row) => row.frequency !== 'monthly'),
  }
}
