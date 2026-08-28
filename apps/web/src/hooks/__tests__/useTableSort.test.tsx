import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SortKeyExtractors } from '../../lib/table-sort'
import { useTableSortStore } from '../../stores/tableSortStore'
import { useTableSort } from '../useTableSort'

/**
 * The sort state machine and projection for story 34.2 (FR61).
 *
 * The pure ordering rules live in `lib/__tests__/table-sort.test.ts`; this file
 * covers what the HOOK adds — the cycle, the one-active-column invariant, the
 * identity case, and the memo dependency that a stale-key defect would hide in.
 *
 * ⚠️ Story 42.1 moved the state into a PERSISTED store, so the hook now takes a
 * table id and the state outlives the component. `useTableSortStore` is a module
 * singleton shared with every other test file in this process, so a sort would
 * otherwise leak from one test into the next.
 *
 * The reset below is a BELT-AND-BRACES duplicate: `vitest.setup.ts` already
 * resets this store before every jsdom test. Kept local so this file's tests do
 * not silently depend on a global they do not name — but do not describe it as
 * the thing that stops the leak, because it is not the only one.
 */

interface Row {
  id: string
  amount: number
  name: string
}

const rows: Row[] = [
  { id: 'a', amount: 30, name: 'Charlie' },
  { id: 'b', amount: 10, name: 'Alpha' },
  { id: 'c', amount: 20, name: 'Bravo' },
]

type Key = 'amount' | 'name'

const extractors: SortKeyExtractors<Row, Key> = {
  amount: (row) => row.amount,
  name: (row) => row.name,
}

const ids = (result: readonly Row[]) => result.map((row) => row.id)

beforeEach(() => {
  localStorage.clear()
  useTableSortStore.setState({
    sorts: { income: null, expenses: null, savings: null, balance: null },
  })
})

describe('useTableSort', () => {
  it('starts unsorted and returns the INPUT ARRAY ITSELF', () => {
    const { result } = renderHook(() => useTableSort('income', rows, extractors))
    expect(result.current.state).toBeNull()
    // Identity, not a copy: the unsorted table must render exactly what it
    // rendered before this story existed, so a defect in the sorted path cannot
    // leak into the default rendering.
    expect(result.current.rows).toBe(rows)
    expect(result.current.ariaSort('amount')).toBe('none')
  })

  it('cycles one column none -> ascending -> descending -> none', () => {
    const { result } = renderHook(() => useTableSort('income', rows, extractors))

    act(() => result.current.toggle('amount'))
    expect(result.current.ariaSort('amount')).toBe('ascending')
    expect(ids(result.current.rows)).toEqual(['b', 'c', 'a'])

    act(() => result.current.toggle('amount'))
    expect(result.current.ariaSort('amount')).toBe('descending')
    expect(ids(result.current.rows)).toEqual(['a', 'c', 'b'])

    act(() => result.current.toggle('amount'))
    expect(result.current.state).toBeNull()
    expect(result.current.ariaSort('amount')).toBe('none')
    // Back to manual order — the array the store handed in, untouched.
    expect(ids(result.current.rows)).toEqual(['a', 'b', 'c'])
  })

  it('keeps at most ONE column active', () => {
    const { result } = renderHook(() => useTableSort('income', rows, extractors))
    act(() => result.current.toggle('amount'))
    act(() => result.current.toggle('amount'))
    expect(result.current.ariaSort('amount')).toBe('descending')

    act(() => result.current.toggle('name'))
    expect(result.current.ariaSort('name')).toBe('ascending')
    // The previously active column must reset, not retain 'descending'.
    expect(result.current.ariaSort('amount')).toBe('none')
    expect(ids(result.current.rows)).toEqual(['b', 'c', 'a'])
  })

  it('clear() drops the sort from any state', () => {
    const { result } = renderHook(() => useTableSort('income', rows, extractors))
    act(() => result.current.toggle('name'))
    expect(result.current.state).not.toBeNull()
    act(() => result.current.clear())
    expect(result.current.state).toBeNull()
    expect(result.current.rows).toBe(rows)
  })

  it('re-sorts when the ROWS change under an active sort', () => {
    const { result, rerender } = renderHook(
      ({ input }: { input: Row[] }) => useTableSort('income', input, extractors),
      { initialProps: { input: rows } }
    )
    act(() => result.current.toggle('amount'))
    expect(ids(result.current.rows)).toEqual(['b', 'c', 'a'])

    // A row added under an active sort lands in its SORTED position, not at the
    // bottom — the store appends it to the manual order and the projection is
    // re-applied on top.
    rerender({ input: [...rows, { id: 'd', amount: 15, name: 'Delta' }] })
    expect(ids(result.current.rows)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('re-sorts when the EXTRACTORS change, even though no row changed', () => {
    // ⚠️ This is the stale-key defect the memo dependency exists to prevent. On
    // the real pages the Category key resolves through the category name map and
    // the Savings allocation key reads the solver pool: both can change while
    // every row stays byte-identical. A projection memoised on the rows alone
    // would keep the old order with no error anywhere.
    const ascending: SortKeyExtractors<Row, Key> = {
      amount: (row) => row.amount,
      name: (row) => row.name,
    }
    const inverted: SortKeyExtractors<Row, Key> = {
      amount: (row) => -row.amount,
      name: (row) => row.name,
    }
    const { result, rerender } = renderHook(
      ({ keys }: { keys: SortKeyExtractors<Row, Key> }) => useTableSort('income', rows, keys),
      { initialProps: { keys: ascending } }
    )
    act(() => result.current.toggle('amount'))
    expect(ids(result.current.rows)).toEqual(['b', 'c', 'a'])

    rerender({ keys: inverted })
    expect(ids(result.current.rows)).toEqual(['a', 'c', 'b'])
  })

  it('degrades to manual order when the active key has NO extractor', () => {
    // ⚠️ The extractor map is PARTIAL because a column can be unavailable in some
    // states — Category is Premium-only. Without this degradation the hook could
    // report a sort that nothing on screen explains: rows in an unexplained
    // order, every header `aria-sort="none"`, and `state !== null` keeping every
    // move arrow disabled with no desktop control to clear it.
    const { result, rerender } = renderHook(
      ({ keys }: { keys: SortKeyExtractors<Row, Key> }) => useTableSort('income', rows, keys),
      { initialProps: { keys: extractors } }
    )
    act(() => result.current.toggle('amount'))
    expect(ids(result.current.rows)).toEqual(['b', 'c', 'a'])

    rerender({ keys: { name: extractors.name } })

    expect(result.current.state).toBeNull()
    expect(result.current.ariaSort('amount')).toBe('none')
    expect(ids(result.current.rows)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the array it was given', () => {
    const input = [...rows]
    const { result } = renderHook(() => useTableSort('income', input, extractors))
    act(() => result.current.toggle('amount'))
    expect(ids(input)).toEqual(['a', 'b', 'c'])
  })
})
