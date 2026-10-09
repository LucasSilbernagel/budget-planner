/**
 * A per-device view projection: never writes `sortOrder` or syncs. `localeCompare` is fine
 * here because, unlike the synced default order, a column sort never crosses devices.
 */

export type SortDirection = 'asc' | 'desc'

type SortValue = string | number | null

export type SortState<Key extends string> = {
	key: Key
	direction: SortDirection
}

export type AriaSortValue = 'ascending' | 'descending' | 'none'

export type SortKeyExtractor<Row> = (row: Row) => SortValue

/** Partial on purpose: a missing extractor lets `useTableSort` degrade an orphaned sort. */
export type SortKeyExtractors<Row, Key extends string> = Readonly<
	Partial<Record<Key, SortKeyExtractor<Row>>>
>

/** Compared with `<`/`>`, not subtraction: `Infinity - Infinity` is `NaN`, which corrupts a sort. */
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

/** Absence branches return before the direction flip so absent values stay last under `desc`. */
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

/** Sort is stable, so ties keep the input (default) order. */
export function sortRowsBy<Row>(
	rows: readonly Row[],
	extractor: SortKeyExtractor<Row>,
	direction: SortDirection
): Row[] {
	return [...rows].sort((a, b) => compareRowsBy(a, b, extractor, direction))
}

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

export function ariaSortFor<Key extends string>(
	current: SortState<Key> | null,
	key: Key
): AriaSortValue {
	if (current === null || current.key !== key) {
		return 'none'
	}
	return current.direction === 'asc' ? 'ascending' : 'descending'
}
