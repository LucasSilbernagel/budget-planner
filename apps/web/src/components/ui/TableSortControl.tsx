import { useMemo } from 'react'
import type { SortState } from '../../lib/table-sort'
import { RESPONSIVE_ACTION_BUTTON_CLASS } from './ResponsiveTable'

/**
 * One `<select>` pairing column with direction; a native select announces its own value, so no live region.
 * Rendered outside the table (no `<th>`/`<td>`); `w-full min-w-0` stops the longest option sizing the box.
 */

/** Not the empty string, which is indistinguishable from an option that failed to render. */
const MANUAL_VALUE = 'manual'

const DEFAULT_ORDER_LABEL = 'Default order'

/** `sm:hidden`, not `useIsNarrowViewport()` (false on SSR). `min-w-0` stops a flex ancestor sizing it
 * to the longest option. */
const WRAPPER_CLASS = 'sm:hidden mb-3 min-w-0'

/** No `focus:ring-offset-*`: the default white offset bands the dark card. */
const SELECT_CLASS = [
	'w-full max-w-full',
	'surface-inset border border-default rounded-lg',
	'px-3 py-2 text-sm text-body',
	RESPONSIVE_ACTION_BUTTON_CLASS,
	'focus:outline-none focus:ring-2 focus:ring-blue-500',
].join(' ')

type SortOption<Key extends string> = {
	value: string
	label: string
	state: SortState<Key> | null
}

type TableSortControlProps<Key extends string> = {
	label: string
	/** Only the columns the table actually renders; an unavailable column would silently degrade to manual order. */
	columns: readonly { key: Key; label: string }[]
	state: SortState<Key> | null
	/** Wire to `useTableSort().select`, never the store: the store doesn't know which columns are available. */
	onSelect: (state: SortState<Key> | null) => void
}

export function TableSortControl<Key extends string>({
	label,
	columns,
	state,
	onSelect,
}: TableSortControlProps<Key>) {
	/** Look the option up rather than parsing `${key}:${direction}` back apart. */
	const options = useMemo<readonly SortOption<Key>[]>(
		() => [
			{ value: MANUAL_VALUE, label: DEFAULT_ORDER_LABEL, state: null },
			...columns.flatMap((column) => [
				{
					value: `${column.key}:asc`,
					label: `${column.label} (ascending)`,
					state: { key: column.key, direction: 'asc' } as SortState<Key>,
				},
				{
					value: `${column.key}:desc`,
					label: `${column.label} (descending)`,
					state: { key: column.key, direction: 'desc' } as SortState<Key>,
				},
			]),
		],
		[columns]
	)

	const value = state === null ? MANUAL_VALUE : `${state.key}:${state.direction}`

	return (
		<div className={WRAPPER_CLASS}>
			{/* The label is `sr-only`: at 320px the select needs the full card width. */}
			<label className="block">
				<span className="sr-only">{label}</span>
				<select
					aria-label={label}
					className={SELECT_CLASS}
					value={value}
					onChange={(event) => {
						const chosen = options.find((option) => option.value === event.target.value)
						// An unmatched value means the options diverged; apply nothing rather than clearing the sort.
						if (chosen === undefined) {
							// Resync the DOM: with no state change React won't re-coerce this controlled `value`.
							event.target.value = value
							return
						}
						onSelect(chosen.state)
					}}
				>
					{options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>
		</div>
	)
}
