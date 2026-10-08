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
  useSetTableSort,
  useTableSortSelection,
  useToggleTableSort,
} from '../stores/tableSortStore'

/**
 * Apply per table where rows are mapped, never at page level. Callers must memoise `extractors` with
 * non-row inputs (category names, solver pool) in deps, or the table sorts by stale keys.
 */
export interface TableSort<Row, Key extends string> {
  state: SortState<Key> | null
  rows: readonly Row[]
  toggle: (key: Key) => void
  /** Sets an exact state rather than advancing the cycle. */
  select: (state: SortState<Key> | null) => void
  ariaSort: (key: Key) => AriaSortValue
}

/** `NoInfer` is load-bearing: without it `Row` resolves to the extractors' minimal row type. */
export function useTableSort<Row, Key extends string>(
  tableId: TableSortId,
  rows: readonly Row[],
  extractors: SortKeyExtractors<NoInfer<Row>, Key>
): TableSort<Row, Key> {
  // Loose `== null`: an id missing from the record yields undefined, and would throw during render.
  const persisted = useTableSortSelection(tableId)
  const toggleTableSort = useToggleTableSort()

  const toggle = useCallback(
    (key: Key) => {
      toggleTableSort(tableId, key)
    },
    [toggleTableSort, tableId]
  )

  const setTableSort = useSetTableSort()

  const select = useCallback(
    (next: SortState<Key> | null) => {
      setTableSort(tableId, next)
    },
    [setTableSort, tableId]
  )

  // `hasOwnProperty`: the persisted key is untrusted JSON, and `toString` would resolve via the
  // prototype chain.
  const extractor =
    persisted == null || !Object.hasOwn(extractors, persisted.key)
      ? undefined
      : extractors[persisted.key as Key]

  /**
   * An unavailable column (Category is Premium-only) degrades to manual order instead of an invisible
   * sort with no exit. The raw value stays in storage so the sort returns with the column.
   */
  // Sound because a resolved extractor proves the key; also keeps the slice's identity for the memo.
  const effectiveState = (extractor === undefined ? null : persisted) as SortState<Key> | null

  const sortedRows = useMemo(() => {
    if (effectiveState === null || extractor === undefined) {
      return rows
    }
    return sortRowsBy(rows, extractor, effectiveState.direction)
  }, [rows, effectiveState, extractor])

  const ariaSort = useCallback((key: Key) => ariaSortFor(effectiveState, key), [effectiveState])

  return { state: effectiveState, rows: sortedRows, toggle, select, ariaSort }
}
