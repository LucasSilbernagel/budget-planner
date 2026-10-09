import { type ReactElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { AriaSortValue } from '../lib/table-sort'

export type SortAnnouncementState = {
	label: string
	direction: 'asc' | 'desc'
}

export type SortHeaderAnnouncements = {
	describedBy: (ariaSort: AriaSortValue) => string
	/** Call from a header's click handler, BEFORE it changes the sort. */
	markActivated: () => void
	/** Render OUTSIDE the `<table>`, as last children: hidden nodes there can't shift siblings under `space-y-*`. */
	nodes: ReactElement
}

const SORT_DESCRIPTIONS = {
	ascending: 'Sortable column, sorted ascending',
	descending: 'Sortable column, sorted descending',
	none: 'Sortable column, not sorted',
} satisfies Readonly<Record<AriaSortValue, string>>

const SORT_DESCRIPTION_STATES = Object.keys(SORT_DESCRIPTIONS) as AriaSortValue[]

/**
 * Only a header click announces; restores and the mobile picker change `current` silently (emptying the region).
 * Not `role="status"` (each page has one already); the region starts empty because a pre-filled one isn't announced.
 */
export function useSortHeaderAnnouncements(
	current: SortAnnouncementState | null
): SortHeaderAnnouncements {
	const baseId = useId()
	const activated = useRef(false)
	const [message, setMessage] = useState('')

	// Primitives, not the object: callers build `current` inline on every render.
	const label = current?.label ?? null
	const direction = current?.direction ?? null

	useEffect(() => {
		if (!activated.current) {
			// A change without a header click empties the region: stale text would contradict the table,
			// and an identical next message would be a React no-op (silent).
			setMessage('')
			return
		}
		activated.current = false
		setMessage(
			label === null
				? 'Sort cleared'
				: `Sorted by ${label}, ${direction === 'asc' ? 'ascending' : 'descending'}`
		)
	}, [label, direction])

	const describedBy = useCallback((ariaSort: AriaSortValue) => `${baseId}-${ariaSort}`, [baseId])

	const markActivated = useCallback(() => {
		activated.current = true
	}, [])

	// Empty on unmount so the region never returns pre-filled. Stable identity: an inline ref callback
	// re-runs with `null` every render and would wipe each message.
	const regionRef = useCallback((element: HTMLParagraphElement | null) => {
		if (element === null) {
			setMessage('')
		}
	}, [])

	const nodes = (
		<>
			{SORT_DESCRIPTION_STATES.map((state) => (
				<span key={state} id={describedBy(state)} hidden>
					{SORT_DESCRIPTIONS[state]}
				</span>
			))}
			<p ref={regionRef} className="sr-only" aria-live="polite" aria-atomic="true">
				{message}
			</p>
		</>
	)

	return { describedBy, markActivated, nodes }
}
