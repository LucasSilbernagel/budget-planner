import { type ReactElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { AriaSortValue } from '../../lib/table-sort'
import { RESPONSIVE_HEADER_CELL_CLASS } from './ResponsiveTable'

/**
 * The `<th>` text must be exactly the label, so the direction icon is an `aria-hidden` svg shown only when active.
 * No 44px tap target: the `<thead>` is a hidden ancestor below `sm`, so mobile sorting sits outside the table.
 */

/** No `focus:ring-offset-*`: the white offset bands the dark card. `uppercase tracking-wider` are repeated
 * because a `<button>` doesn't inherit `text-transform`. */
const SORT_BUTTON_CLASS = [
  'inline-flex items-center gap-1',
  'uppercase tracking-wider',
  'hover:text-body',
  'rounded focus:outline-none focus:ring-2 focus:ring-blue-500',
].join(' ')

function SortAscendingIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      <path d="M5 15l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SortDescendingIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface SortableColumnHeaderProps {
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

export interface SortAnnouncementState {
  label: string
  direction: 'asc' | 'desc'
}

export interface SortHeaderAnnouncements {
  describedBy: (ariaSort: AriaSortValue) => string
  /** Call from a header's click handler, BEFORE it changes the sort. */
  markActivated: () => void
  /** Render OUTSIDE the `<table>`, as last children: hidden nodes there can't shift siblings under `space-y-*`. */
  nodes: ReactElement
}

const SORT_DESCRIPTIONS: Readonly<Record<AriaSortValue, string>> = {
  ascending: 'Sortable column, sorted ascending',
  descending: 'Sortable column, sorted descending',
  none: 'Sortable column, not sorted',
}

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
