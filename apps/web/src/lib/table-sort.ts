/**
 * View-level column sorting for the four financial tables (Story 34.2, FR61).
 *
 * ## What this is NOT
 *
 * This is a **projection**, not an ordering. `lib/ordering.ts` owns the user's
 * MANUAL order — the persisted `sortOrder` field, its canonical
 * `sortOrder ASC -> createdAt ASC -> id ASC` rule, and the move actions that
 * write it. Nothing in this module writes `sortOrder`, calls a `move*` action or
 * enqueues a sync operation. A column sort is a per-device view of the same
 * array, and clearing it returns the table to the manual order untouched.
 *
 * ⚠️ This paragraph used to say "per-device, per-SESSION". Story 42.1 (FR67)
 * persists the selection in `stores/tableSortStore`, so a sort now survives a
 * reload and a navigation. The BOUNDARY is unchanged and is the part that
 * matters: persisting which projection to apply is not the same as writing the
 * order, and this module still touches neither `sortOrder` nor sync.
 *
 * ## Three invariants, each of which has its own failure mode
 *
 *   1. **Absent values sort LAST in BOTH directions.** They are therefore
 *      handled *outside* the direction flip — see {@link sortRowsBy}. Negating a
 *      comparator that has already placed absences would send them to the top
 *      under `desc`, which reads as broken rather than as "no value".
 *   2. **A tie returns 0 and nothing else.** The input array is already in
 *      manual order and `Array.prototype.sort` is stable (guaranteed since
 *      ES2019), so equal keys keep their manual relative order for free. Do not
 *      "improve" this by re-deriving the manual order here — that would make the
 *      module depend on `sortOrder`, which is exactly what it must not do.
 *   3. **A key is NEVER `NaN`.** `ordering.ts` records the reason: a comparator
 *      returning `NaN` is undefined behaviour and can leave the array in an
 *      arbitrary order — silently. Every extractor in `lib/table-sort-keys.ts`
 *      returns `null` instead of an unusable number, and
 *      {@link compareDefinedValues} never subtracts.
 *
 * ## Why `localeCompare` here, when `ordering.ts` forbids it
 *
 * `ordering.ts:75-78` compares ids with `<`/`>` rather than `localeCompare`
 * because the manual order is SYNCED and must be identical on every device that
 * receives it — a locale-sensitive collation would let two devices disagree
 * about the same stored data.
 *
 * ⚠️ That reason used to be written as "because the manual order is PERSISTED",
 * with this module contrasted as living "in component state". Story 42.1
 * persists the column sort too, so stated that way the contrast would now argue
 * for the opposite conclusion. The distinction was never persistence — it is
 * **whether the ordering crosses devices**. The manual order does; a column sort
 * does not (`tableSortStore` is per-device and is not a synced field), and it is
 * recomputed in the browser that reads it. For a user-facing alphabetical sort,
 * locale-aware collation is the correct behaviour, and it is what the repo's
 * other sortable list already does (`components/forecasting/forecast-list.tsx`).
 */

/** Ascending or descending. There is no third direction — "unsorted" is the
 * absence of a {@link SortState}, not a value of this type. */
export type SortDirection = 'asc' | 'desc'

/**
 * A sort key's value for one row.
 *
 * `null` means **absent, unreadable, or not applicable to this row** — a savings
 * goal with no target, a debt row's contribution room, a persisted row whose
 * `frequency` is not one of the four known cadences. All three collapse to the
 * same rendering (`No target`, `—`, `None`) and to the same ordering: last.
 */
export type SortValue = string | number | null

/** The active sort. `null` state (no sort) is represented by the absence of
 * this object, so an unsorted table cannot be confused with one sorted by a
 * key that no longer exists. */
export interface SortState<Key extends string> {
  key: Key
  direction: SortDirection
}

/** The `aria-sort` token for a column header. */
export type AriaSortValue = 'ascending' | 'descending' | 'none'

/** Extracts one row's value for one column. Must never return `NaN`. */
export type SortKeyExtractor<Row> = (row: Row) => SortValue

/**
 * The per-page map of column key -> extractor.
 *
 * ⚠️ PARTIAL on purpose. A column can be unavailable in some states — Category is
 * Premium-only — and omitting its extractor is what lets `useTableSort` degrade
 * an orphaned sort back to manual order instead of leaving the table sorted by a
 * column that is not rendered.
 */
export type SortKeyExtractors<Row, Key extends string> = Readonly<
  Partial<Record<Key, SortKeyExtractor<Row>>>
>

/**
 * Compares two values that are both present.
 *
 * Numbers are compared with `<`/`>` rather than by subtraction: subtraction of
 * two infinities is `NaN`, and `ordering.ts:101-103` already records what a
 * `NaN` comparator does to an array. Strings use locale-aware collation (see the
 * module docblock for why that is safe here and not in `ordering.ts`).
 *
 * A mixed pair cannot arise from a single column — every extractor for a given
 * key returns one type or `null` — but it is ordered deterministically
 * (numbers before strings) rather than left to chance.
 */
export function compareDefinedValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) {
      return 0
    }
    return a < b ? -1 : 1
  }
  if (typeof a === 'number') {
    return -1
  }
  if (typeof b === 'number') {
    return 1
  }
  return a.localeCompare(b)
}

/**
 * Orders two rows by one extractor, in one direction, with absences last.
 *
 * ⚠️ The absence branches return BEFORE the direction flip, deliberately. That
 * is the whole of invariant 1 — moving either `return` below the flip, or
 * implementing `desc` as a `.reverse()` of the ascending result, sends absent
 * values to the top under `desc`.
 */
export function compareRowsBy<Row>(
  a: Row,
  b: Row,
  extractor: SortKeyExtractor<Row>,
  direction: SortDirection
): number {
  const valueA = extractor(a)
  const valueB = extractor(b)
  if (valueA === null) {
    return valueB === null ? 0 : 1
  }
  if (valueB === null) {
    return -1
  }
  const comparison = compareDefinedValues(valueA, valueB)
  return direction === 'asc' ? comparison : -comparison
}

/**
 * Returns a new array ordered by `extractor`, leaving the input untouched.
 *
 * Ties keep their input order (invariant 2), so passing the store array — which
 * every write path has already re-sorted into manual order — makes "equal keys
 * fall back to the user's manual arrangement" true without this module knowing
 * anything about `sortOrder`.
 */
export function sortRowsBy<Row>(
  rows: readonly Row[],
  extractor: SortKeyExtractor<Row>,
  direction: SortDirection
): Row[] {
  return [...rows].sort((a, b) => compareRowsBy(a, b, extractor, direction))
}

/**
 * The next sort state when a header is activated (ratified decision 5).
 *
 * A column cycles `none -> ascending -> descending -> none`, and returning to
 * `none` IS the "restore my manual order" affordance — which is why there is no
 * separate reset button at >= 640px. Activating a different column starts it at
 * `ascending` and drops the previous column's state entirely, so at most one
 * header is ever non-`none`.
 */
export function nextSortState<Key extends string>(
  current: SortState<Key> | null,
  key: Key
): SortState<Key> | null {
  if (current === null || current.key !== key) {
    return { key, direction: 'asc' }
  }
  if (current.direction === 'asc') {
    return { key, direction: 'desc' }
  }
  return null
}

/** The `aria-sort` token for one column given the table's current state. */
export function ariaSortFor<Key extends string>(
  current: SortState<Key> | null,
  key: Key
): AriaSortValue {
  if (current === null || current.key !== key) {
    return 'none'
  }
  return current.direction === 'asc' ? 'ascending' : 'descending'
}
