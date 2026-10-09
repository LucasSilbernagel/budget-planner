import { cn } from '@/lib/cn'
import type { AriaSortValue } from '../../lib/table-sort'
import { SortAscendingIcon } from '../icons/SortAscendingIcon'
import { SortDescendingIcon } from '../icons/SortDescendingIcon'
import { RESPONSIVE_HEADER_CELL_CLASS } from './ResponsiveTable'

/**
 * The `<th>` text must be exactly the label, so the direction icon is an `aria-hidden` svg shown only when active.
 * No 44px tap target: the `<thead>` is a hidden ancestor below `sm`, so mobile sorting sits outside the table.
 */

/** No `focus:ring-offset-*`: the white offset bands the dark card. `uppercase tracking-wider` are repeated
 * because a `<button>` doesn't inherit `text-transform`. */
const SORT_BUTTON_CLASS = cn(
	'inline-flex items-center gap-1',
	'uppercase tracking-wider',
	'hover:text-body',
	'rounded focus:outline-none focus:ring-2 focus:ring-blue-500'
)

type SortableColumnHeaderProps = {
	/** Becomes the `<th>`'s entire text content and the button's accessible name. */
	label: string
	ariaSort: AriaSortValue
	onToggle: () => void
	/** Required, so a table that forgets the wiring fails `tsc`. */
	describedBy: string
	/** Runs BEFORE `onToggle`, so the resulting sort change is announced. */
	onActivate: () => void
}

export function SortableColumnHeader({
	label,
	ariaSort,
	onToggle,
	describedBy,
	onActivate,
}: SortableColumnHeaderProps) {
	return (
		<th aria-sort={ariaSort} className={RESPONSIVE_HEADER_CELL_CLASS}>
			<button
				type="button"
				onClick={() => {
					onActivate()
					onToggle()
				}}
				aria-describedby={describedBy}
				className={SORT_BUTTON_CLASS}
			>
				{label}
				{ariaSort === 'ascending' && <SortAscendingIcon />}
				{ariaSort === 'descending' && <SortDescendingIcon />}
			</button>
		</th>
	)
}
