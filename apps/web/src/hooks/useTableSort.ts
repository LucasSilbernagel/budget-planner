import { useCallback, useMemo } from 'react'
import {
  type AriaSortValue,
  type SortKeyExtractors,
  type SortState,
  ariaSortFor,
  sortRowsBy,
} from '../lib/table-sort'
import {
  type TableSortId,
  useClearTableSort,
  useTableSortSelection,
  useToggleTableSort,
} from '../stores/tableSortStore'

/**
 * Column-sort state and projection for one financial table (Story 34.2, FR61).
 *
 * ## One instance per TABLE, not per page
 *
 * ⚠️ This section USED to say `/balance` renders two tables over the same array
 * — the editable list plus a read-only Investment Accounts breakdown built from
 * `balanceEntries.filter(...)`. That breakdown was DELETED by story 43.1
 * (`781ecb6`), so `/balance` now renders exactly one table.
 *
 * The rule still holds and is still the reason this hook is per-table: apply the
 * sort projection where a table maps its rows, never at page level. Hoisting it
 * would silently reorder any sibling view over the same array, because `.filter`
 * preserves the relative order of whatever it is given — which is precisely how
 * the deleted breakdown would have been corrupted.
 *
 * ## Persisted per table (story 42.1, FR67 — REVERSES story 34.2 decision 4)
 *
 * ⚠️ This section USED to say the sort was plain component state, that nothing
 * was persisted, and that "manual order is the default" was therefore true BY
 * CONSTRUCTION rather than by rule — and that there was consequently no storage
 * key, `migrate` or hydration path anywhere. **All of that is now false.** FR67
 * persists the selection, so the default had to become an explicit RULE: every
 * table's stored slice defaults to `null`, and `null` means manual order.
 *
 * The state lives in `stores/tableSortStore` — one slice per table, keyed by the
 * {@link TableSortId} passed in here, because the four tables share almost no
 * columns (34.2's own reasoning for rejecting a single shared selection, which
 * survives the reversal intact). It follows the app's persisted-store
 * conventions: `skipHydration`, registration in `lib/store-hydration.tsx`, a
 * versioned `migrate` and a `merge` that coerces on every rehydrate.
 *
 * What did NOT change: this hook still writes no `sortOrder`, calls no `move*`
 * action and enqueues no sync operation. `lib/ordering.ts` still owns the manual
 * order and clearing a sort still returns the table to it untouched. The sort is
 * persisted per device; it is not synced.
 *
 * ## ⚠️ `extractors` is a memo INPUT, and two of them are not pure functions of
 * the row
 *
 * The projection is memoised on `[rows, state, extractor]` — the single resolved
 * extractor function, not the extractors object, because a computed member
 * expression is not statically checkable as a dependency. The granularity is the
 * same either way: a new `extractors` object yields new function identities. Two
 * columns read data that does not live on the row:
 *
 *   - **Category** resolves a uuid through the category name map, so a category
 *     RENAME must re-sort even though no row changed.
 *   - **Savings Monthly Allocation** reads the solver's allocation pool, which
 *     is recomputed when other goals change.
 *
 * Callers must therefore build `extractors` inside their own `useMemo` with
 * those values in its dependency list. An extractor object rebuilt on every
 * render is CORRECT but defeats memoisation; one memoised on the wrong deps is
 * neither — it leaves the table ordered by stale keys with no error anywhere.
 */
export interface TableSort<Row, Key extends string> {
  /** The active sort, or `null` when the table is in manual order. */
  state: SortState<Key> | null
  /** The rows to render: the input array when unsorted, a sorted copy otherwise. */
  rows: readonly Row[]
  /** Advance one column through `none -> asc -> desc -> none`. */
  toggle: (key: Key) => void
  /** Drop the sort entirely and return to manual order. */
  clear: () => void
  /** The `aria-sort` token for one column header. */
  ariaSort: (key: Key) => AriaSortValue
}

/**
 * ⚠️ `Row` is inferred from `rows` ONLY — `NoInfer` on the second parameter is
 * load-bearing. The extractor factories declare their minimal structural row
 * (`{ type, name, currentBalance, ... }`), so without this TypeScript would
 * resolve `Row` to that minimum and hand the caller back a projection missing
 * `id` and with `type`/`frequency` widened to `string`. The extractors are still
 * accepted by ordinary parameter contravariance.
 */
export function useTableSort<Row, Key extends string>(
  tableId: TableSortId,
  rows: readonly Row[],
  extractors: SortKeyExtractors<NoInfer<Row>, Key>
): TableSort<Row, Key> {
  // The persisted selection for THIS table. `SortState<string>`, not
  // `SortState<Key>`: storage validates shape only and cannot know this table's
  // columns, so the key is narrowed below by whether an extractor resolves it.
  // ⚠️ `== null`, loose on purpose: an id not present in the record yields
  // `undefined`, not `null`, and CI runs no `tsc` — a wrong id string would
  // otherwise reach `persisted.key` and throw during render.
  const persisted = useTableSortSelection(tableId)
  const toggleTableSort = useToggleTableSort()
  const clearTableSort = useClearTableSort()

  const toggle = useCallback(
    (key: Key) => {
      // The `none -> asc -> desc -> none` cycle lives in the store action so it
      // reads the persisted current value without this callback depending on it.
      toggleTableSort(tableId, key)
    },
    [toggleTableSort, tableId]
  )

  const clear = useCallback(() => {
    clearTableSort(tableId)
  }, [clearTableSort, tableId])

  // Resolved OUTSIDE the memo so the dependency is a plain function identity
  // rather than a computed member expression, which is not statically checkable.
  //
  // ⚠️ `hasOwnProperty`, NOT a bare `extractors[key]`. The persisted key is
  // untrusted user-editable JSON, and a bare bracket lookup walks the PROTOTYPE
  // CHAIN: `key: "toString"` resolves `Object.prototype.toString` — a function,
  // not `undefined` — so the degradation below never fires. Measured before this
  // guard existed: the table kept `state !== null`, every move arrow went
  // `aria-disabled="true"` with no reset control below `sm`, and `TableSortNotice`
  // rendered `SORT_COLUMN_LABELS["toString"]`, i.e. a FUNCTION, which React
  // rejects with "Functions are not valid as a React child". The store applies
  // exactly this discipline to the sorts RECORD (`coerceSorts`); it has to apply
  // to the KEY too. Unreachable before story 42.1 — a header can only ever emit a
  // real column key — and reachable now only because the key is persisted.
  const extractor =
    persisted == null || !Object.prototype.hasOwnProperty.call(extractors, persisted.key)
      ? undefined
      : extractors[persisted.key as Key]

  /**
   * A sort whose column is no longer AVAILABLE degrades to manual order.
   *
   * ⚠️ This is not defensive noise — it is what stops the table reaching a state
   * with no exit. The Category column is Premium-only, so its extractor is absent
   * for an unentitled user (see `createFlowSortExtractors`). Without this, the
   * PERSISTED value could name a column that is not rendered: the rows would stay sorted
   * by an invisible key, every header would report `aria-sort="none"`, every move
   * arrow would be disabled because `state !== null`, and the only reset control
   * is `sm:hidden` — so a DESKTOP user would have no affordance to clear it at
   * all. Deriving the effective state means the incoherent combination cannot be
   * represented rather than merely not occurring.
   *
   * ⚠️ The raw persisted value is deliberately left in STORAGE rather than
   * cleared through an effect. This is a pure derivation with no extra render,
   * and it is what lets an entitled user's Category sort come back if their
   * entitlement comes back. Story 42.1 made this reachable on a FRESH MOUNT for
   * the first time — before it was persisted, an orphaned key could only arise
   * from a tier flip within a single mount.
   */
  //
  // The cast is what narrows `SortState<string>` to `SortState<Key>`, and it is
  // sound precisely BECAUSE the guard above ran: a resolved extractor is proof
  // that `persisted.key` is one of this table's keys. It also preserves the
  // store slice's object IDENTITY, which the memo below depends on — rebuilding
  // an equal object here would recompute the projection on every render.
  const effectiveState = (extractor === undefined ? null : persisted) as SortState<Key> | null

  const sortedRows = useMemo(() => {
    if (effectiveState === null || extractor === undefined) {
      // The identity case returns the input array itself, not a copy: the
      // unsorted table must render the store array exactly as it did before this
      // story, so a regression in the sorted path cannot leak into the default.
      return rows
    }
    return sortRowsBy(rows, extractor, effectiveState.direction)
  }, [rows, effectiveState, extractor])

  const ariaSort = useCallback((key: Key) => ariaSortFor(effectiveState, key), [effectiveState])

  return { state: effectiveState, rows: sortedRows, toggle, clear, ariaSort }
}
