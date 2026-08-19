import { useCallback, useMemo, useState } from 'react'
import {
  type AriaSortValue,
  type SortKeyExtractors,
  type SortState,
  ariaSortFor,
  nextSortState,
  sortRowsBy,
} from '../lib/table-sort'

/**
 * Column-sort state and projection for one financial table (Story 34.2, FR61).
 *
 * ## One instance per TABLE, not per page
 *
 * `/balance` renders two tables over the same array — the read-only Investment
 * Accounts breakdown is `balanceEntries.filter(...)` of the editable list. Only
 * the editable one sorts, so the projection must be applied where that table
 * maps its rows, never at page level: hoisting it would silently reorder the
 * breakdown too, because a `.filter` preserves the relative order of whatever it
 * is given.
 *
 * ## Session-only, per page (ratified decision 4)
 *
 * Plain component state. Nothing is persisted, so every reload — and every route
 * change, since the state unmounts with the page — opens on the manual order.
 * That makes "manual order is the default" true by construction rather than by
 * rule, and it is why there is no new storage key, `migrate` or hydration path
 * anywhere in this story.
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
  rows: readonly Row[],
  extractors: SortKeyExtractors<NoInfer<Row>, Key>
): TableSort<Row, Key> {
  const [state, setState] = useState<SortState<Key> | null>(null)

  const toggle = useCallback((key: Key) => {
    setState((current) => nextSortState(current, key))
  }, [])

  const clear = useCallback(() => {
    setState(null)
  }, [])

  // Resolved OUTSIDE the memo so the dependency is a plain function identity
  // rather than a computed member expression, which is not statically checkable.
  const extractor = state === null ? undefined : extractors[state.key]

  /**
   * A sort whose column is no longer AVAILABLE degrades to manual order.
   *
   * ⚠️ This is not defensive noise — it is what stops the table reaching a state
   * with no exit. The Category column is Premium-only, so its extractor is absent
   * for an unentitled user (see `createFlowSortExtractors`). Without this,
   * `state` could name a column that is not rendered: the rows would stay sorted
   * by an invisible key, every header would report `aria-sort="none"`, every move
   * arrow would be disabled because `state !== null`, and the only reset control
   * is `sm:hidden` — so a DESKTOP user would have no affordance to clear it at
   * all. Deriving the effective state means the incoherent combination cannot be
   * represented rather than merely not occurring.
   *
   * The raw `state` is deliberately left alone rather than cleared through an
   * effect: this is a pure derivation with no extra render, and if the column
   * becomes available again the user's sort is still there.
   */
  const effectiveState = extractor === undefined ? null : state

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
