import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SortKeyExtractors } from '../../lib/table-sort'
import { useTableSortStore } from '../../stores/tableSortStore'
import { useTableSort } from '../useTableSort'

/** `useTableSortStore` is a module singleton shared across test files, so reset it locally. */

type Row = {
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
		expect(ids(result.current.rows)).toEqual(['a', 'b', 'c'])
	})

	it('keeps at most ONE column active', () => {
		const { result } = renderHook(() => useTableSort('income', rows, extractors))
		act(() => result.current.toggle('amount'))
		act(() => result.current.toggle('amount'))
		expect(result.current.ariaSort('amount')).toBe('descending')

		act(() => result.current.toggle('name'))
		expect(result.current.ariaSort('name')).toBe('ascending')
		expect(result.current.ariaSort('amount')).toBe('none')
		expect(ids(result.current.rows)).toEqual(['b', 'c', 'a'])
	})

	it('the hook exposes NO `clear` — `select(null)` is the one escape path', () => {
		const { result } = renderHook(() => useTableSort('income', rows, extractors))
		expect('clear' in result.current).toBe(false)
	})

	it('re-sorts when the ROWS change under an active sort', () => {
		const { result, rerender } = renderHook(
			({ input }: { input: Row[] }) => useTableSort('income', input, extractors),
			{ initialProps: { input: rows } }
		)
		act(() => result.current.toggle('amount'))
		expect(ids(result.current.rows)).toEqual(['b', 'c', 'a'])

		rerender({ input: [...rows, { id: 'd', amount: 15, name: 'Delta' }] })
		expect(ids(result.current.rows)).toEqual(['b', 'd', 'c', 'a'])
	})

	it('re-sorts when the EXTRACTORS change, even though no row changed', () => {
		// Keys can change while every row stays identical; a projection memoised on rows alone would
		// keep a stale order.
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

	it('select() sets an exact column and direction, without cycling', () => {
		const { result } = renderHook(() => useTableSort('income', rows, extractors))

		act(() => result.current.select({ key: 'amount', direction: 'desc' }))
		expect(result.current.state).toEqual({ key: 'amount', direction: 'desc' })
		expect(result.current.ariaSort('amount')).toBe('descending')
		expect(ids(result.current.rows)).toEqual(['a', 'c', 'b'])
	})

	it('select() re-selecting the SAME column and direction is idempotent', () => {
		const { result } = renderHook(() => useTableSort('income', rows, extractors))
		act(() => result.current.select({ key: 'name', direction: 'asc' }))
		act(() => result.current.select({ key: 'name', direction: 'asc' }))
		expect(result.current.state).toEqual({ key: 'name', direction: 'asc' })
		expect(ids(result.current.rows)).toEqual(['b', 'c', 'a'])
	})

	it('select(null) returns to manual order and the INPUT ARRAY ITSELF', () => {
		const { result } = renderHook(() => useTableSort('income', rows, extractors))
		act(() => result.current.select({ key: 'amount', direction: 'asc' }))
		expect(result.current.state).not.toBeNull()

		act(() => result.current.select(null))
		expect(result.current.state).toBeNull()
		expect(result.current.rows).toBe(rows)
	})

	it('select() persists through the SAME store slice a header click writes', () => {
		const { result } = renderHook(() => useTableSort('income', rows, extractors))
		act(() => result.current.select({ key: 'amount', direction: 'desc' }))

		expect(useTableSortStore.getState().sorts.income).toEqual({ key: 'amount', direction: 'desc' })

		act(() => result.current.select(null))
		expect(useTableSortStore.getState().sorts.income).toBeNull()
	})

	it('select() writes ONE table and leaves the others alone', () => {
		const { result } = renderHook(() => useTableSort('income', rows, extractors))
		act(() => result.current.select({ key: 'name', direction: 'asc' }))

		const { sorts } = useTableSortStore.getState()
		expect(sorts.income).toEqual({ key: 'name', direction: 'asc' })
		expect(sorts.expenses).toBeNull()
		expect(sorts.savings).toBeNull()
		expect(sorts.balance).toBeNull()
	})

	it('a key selected through select() still degrades when its extractor goes', () => {
		// If the control wrote the store directly, bypassing `effectiveState`, only this test would fail.
		const { result, rerender } = renderHook(
			({ keys }: { keys: SortKeyExtractors<Row, Key> }) => useTableSort('income', rows, keys),
			{ initialProps: { keys: extractors } }
		)
		act(() => result.current.select({ key: 'amount', direction: 'desc' }))
		expect(ids(result.current.rows)).toEqual(['a', 'c', 'b'])

		rerender({ keys: { name: extractors.name } })

		expect(result.current.state).toBeNull()
		expect(result.current.ariaSort('amount')).toBe('none')
		expect(ids(result.current.rows)).toEqual(['a', 'b', 'c'])
		// The raw value stays in storage so the sort returns if the column does.
		expect(useTableSortStore.getState().sorts.income).toEqual({ key: 'amount', direction: 'desc' })
	})

	it('does not mutate the array it was given', () => {
		const input = [...rows]
		const { result } = renderHook(() => useTableSort('income', input, extractors))
		act(() => result.current.toggle('amount'))
		expect(ids(input)).toEqual(['a', 'b', 'c'])
	})
})
