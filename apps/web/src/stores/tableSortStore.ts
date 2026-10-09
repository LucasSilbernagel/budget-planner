import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nextSortState, type SortState } from '../lib/table-sort'

/**
 * Per-device view preference: never writes sortOrder or syncs. Validates shape only; useTableSort
 * resolves unavailable columns, so a stored sort returns when entitlement does.
 */

export type TableSortId = 'income' | 'expenses' | 'savings' | 'balance'

export const TABLE_SORT_STORAGE_KEY = 'budget-planner-table-sort-v1'

export const TABLE_SORT_VERSION = 1

/** Single source of the valid table set; TABLE_SORT_IDS derives from these keys. */
const DEFAULT_SORTS = {
	income: null,
	expenses: null,
	savings: null,
	balance: null,
} satisfies Record<TableSortId, SortState<string> | null>

export const TABLE_SORT_IDS = Object.keys(DEFAULT_SORTS) as readonly TableSortId[]

type TableSortStoreState = {
	sorts: Record<TableSortId, SortState<string> | null>
	setTableSort: (table: TableSortId, state: SortState<string> | null) => void
	clearTableSort: (table: TableSortId) => void
	toggleTableSort: (table: TableSortId, key: string) => void
}

/** `'ASC'` is rejected on purpose: nothing in the app writes it. */
export function coerceSortState(value: unknown): SortState<string> | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return null
	}
	const candidate = value as { key?: unknown; direction?: unknown }
	if (typeof candidate.key !== 'string' || candidate.key.length === 0) {
		return null
	}
	if (candidate.direction !== 'asc' && candidate.direction !== 'desc') {
		return null
	}
	return { key: candidate.key, direction: candidate.direction }
}

/**
 * Built from the known ids (drops unknown tables); the own-property check keeps a parsed
 * `__proto__` key out.
 */
export function coerceSorts(value: unknown): Record<TableSortId, SortState<string> | null> {
	const record =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {}

	const next = {} as Record<TableSortId, SortState<string> | null>
	for (const id of TABLE_SORT_IDS) {
		next[id] = Object.hasOwn(record, id) ? coerceSortState(record[id]) : null
	}
	return next
}

export const useTableSortStore = create<TableSortStoreState>()(
	persist(
		(set) => ({
			sorts: { ...DEFAULT_SORTS },

			setTableSort: (table, state) => {
				set((current) => ({ sorts: { ...current.sorts, [table]: state } }))
			},

			clearTableSort: (table) => {
				set((current) => ({ sorts: { ...current.sorts, [table]: null } }))
			},

			toggleTableSort: (table, key) => {
				set((current) => ({
					sorts: { ...current.sorts, [table]: nextSortState(current.sorts[table], key) },
				}))
			},
		}),
		{
			name: TABLE_SORT_STORAGE_KEY,
			skipHydration: true,
			partialize: (state) => ({ sorts: state.sorts }),
			version: TABLE_SORT_VERSION,
			migrate: (persisted) => ({
				sorts: coerceSorts((persisted as { sorts?: unknown } | undefined)?.sorts),
			}),
			// Runs on every rehydrate (migrate does not at the current version), so this is the
			// corrupt-payload guard.
			merge: (persisted, current) => ({
				...current,
				sorts: coerceSorts((persisted as { sorts?: unknown } | undefined)?.sorts),
			}),
		}
	)
)

export const useTableSortSelection = (table: TableSortId) =>
	useTableSortStore((state) => state.sorts[table])

export const useSetTableSort = () => useTableSortStore((state) => state.setTableSort)

export const useClearTableSort = () => useTableSortStore((state) => state.clearTableSort)

export const useToggleTableSort = () => useTableSortStore((state) => state.toggleTableSort)
