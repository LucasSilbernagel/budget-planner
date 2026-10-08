import { type ReactElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { AriaSortValue } from '../../lib/table-sort'
import { RESPONSIVE_HEADER_CELL_CLASS } from './ResponsiveTable'

/**
 * A clickable column header that reports its sort state through `aria-sort`
 * (Story 34.2, FR61).
 *
 * ⚠️ MODULE SCOPE, NOT DEFINED INSIDE A PAGE BODY — the same rule `FieldLabel`
 * carries in `ResponsiveTable.tsx`. A component declared in a page body gets a
 * new function identity on every render, which forces React to unmount and
 * remount its subtree; the header button would lose focus the moment it was
 * activated, which is precisely the interaction this component exists for.
 *
 * ## ⚠️ The `<th>`'s text content is EXACTLY the column label
 *
 * `components/__tests__/category-assignment.test.tsx` reads every `<th>` with
 * `th.textContent?.trim()` and pins the result as an EXACT ARRAY, for both the
 * free (`['Name','Amount','Frequency','Actions']`) and entitled variants, on two
 * pages. So the direction indicator is an `aria-hidden` inline `<svg>`, which
 * contributes no text: an sr-only span, a `▲` glyph or an appended state string
 * would each break four assertions across those two pages. It is also why the
 * button's accessible name is just the label — `aria-hidden` strips the icon
 * from the name computation, so `getByRole('columnheader', { name: 'Amount' })`
 * and `getByRole('button', { name: 'Amount' })` both keep working.
 *
 * ## ⚠️ The indicator renders ONLY for the active column, and that is a WIDTH
 * decision, not an aesthetic one
 *
 * An always-present "this is sortable" chevron cost ~16px per sortable column
 * (icon plus gap). Measured on `/income` at 768px, that took the free-tier
 * 4-column table's wrapper from 640px to 688px against a 656px client width, and
 * `e2e/categories-premium.spec.ts`'s wrapper-overflow guard (656 + 24px
 * tolerance) went red on both `/income` and `/expenses`. 33.3 already recorded
 * that these tables are tight just above the `sm` breakpoint — the entitled
 * 5-column variant overflows there by ~156px — so a persistent per-column
 * affordance is width this layout does not have.
 *
 * Rendering the indicator only when a column is active restores the unsorted
 * width exactly, and costs 16px on ONE column while a sort is active. The
 * sortable affordance is still carried by the hover colour change and the focus
 * ring.
 *
 * ⚠️ This paragraph USED to add "and `aria-sort="none"` for assistive
 * technology". Most screen readers do not announce `none` (the ARIA APG puts
 * `aria-sort` on the SORTED column only), so an unsorted header read as just
 * "Amount, button". Story 120.1 (FR188) gives every header a DESCRIPTION
 * ("Sortable column, not sorted" / "sorted ascending" / "sorted descending")
 * through `aria-describedby`, and announces a header click in a polite live
 * region, both from {@link useSortHeaderAnnouncements}. Both nodes live OUTSIDE
 * the `<th>` and the `<table>`, for the exact-array reason above: a description
 * span inside the `<th>` would be part of its `textContent` even when `hidden`.
 *
 * ## Why there is no 44px tap target here
 *
 * The `<thead>` is `display: none` below `sm` (`RESPONSIVE_THEAD_CLASS`), so a
 * `max-sm:min-h-[44px]` on this button would be dead CSS on a hidden ancestor
 * and `assertHasMobileTapTarget` would be asserting nothing.
 *
 * ⚠️ This paragraph USED to end "Sorting is a >= 640px affordance by ratified
 * decision" (story 34.2, decision 1). **That is no longer true.** Story 48.1
 * (UX-DR53) closed `deferred-work.md`'s "Sorting cannot be STARTED below 640px"
 * with `TableSortControl` — a picker that renders `sm:hidden` OUTSIDE the table
 * and drives the same store slice these headers drive. What survives the
 * reversal is this element's own rule: a header cell cannot carry the mobile
 * affordance, because its ancestor is hidden at exactly the widths that
 * affordance is for. That is why the control is a sibling of the table rather
 * than a second mode of this component.
 */

/** Matches the row action buttons: `focus:ring-2` with a real colour, and no
 * `focus:ring-offset-*` — the default offset colour is white and paints a band
 * across the dark card. `assertHasFocusRing` fails any offset lacking a `dark:`
 * counterpart.
 *
 * `uppercase tracking-wider` are repeated from the `<th>` rather than inherited:
 * Tailwind's preflight makes a `<button>` inherit font family, size, weight and
 * colour, but not `text-transform`, so relying on inheritance would render this
 * one header in sentence case on some engines. */
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
  /** The column label. Becomes the `<th>`'s entire text content AND the
   * button's accessible name — see the docblock. */
  label: string
  /** This column's current state, from `useTableSort().ariaSort(key)`. */
  ariaSort: AriaSortValue
  /** Advance this column through `none -> asc -> desc -> none`. */
  onToggle: () => void
  /** The id of this column's state description, from
   * `useSortHeaderAnnouncements().describedBy(ariaSort)` (story 120.1).
   * REQUIRED, so a table that forgets the wiring fails `tsc`. */
  describedBy: string
  /** `useSortHeaderAnnouncements().markActivated`. Runs BEFORE `onToggle`, so
   * the resulting sort change is announced (story 120.1, D2). */
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

/** The column a table is sorted by. `null` (passed to the hook) = unsorted. */
export interface SortAnnouncementState {
  label: string
  direction: 'asc' | 'desc'
}

export interface SortHeaderAnnouncements {
  /** The id of the hidden description for a header in this state. */
  describedBy: (ariaSort: AriaSortValue) => string
  /** Call from a header's click handler, BEFORE it changes the sort. */
  markActivated: () => void
  /** The three descriptions and the live region. Render them OUTSIDE the
   * `<table>`, as LAST children after it: `hidden` and `sr-only` (absolute)
   * nodes there cannot shift a sibling under `space-y-*` or a flex/grid `gap`. */
  nodes: ReactElement
}

const SORT_DESCRIPTIONS: Readonly<Record<AriaSortValue, string>> = {
  ascending: 'Sortable column, sorted ascending',
  descending: 'Sortable column, sorted descending',
  none: 'Sortable column, not sorted',
}

const SORT_DESCRIPTION_STATES = Object.keys(SORT_DESCRIPTIONS) as AriaSortValue[]

/**
 * Screen-reader state for ONE table's sortable headers (story 120.1, FR188).
 *
 * - **On focus:** each header button is described by one of three `hidden`
 *   spans ({@link SortHeaderAnnouncements.describedBy}). Accname reads a
 *   `hidden` node when it is referenced directly, so the text is never visible
 *   and never inside a `<th>`.
 * - **On change:** a polite live region says "Sorted by Amount, ascending" or
 *   "Sort cleared".
 *
 * ⚠️ ONLY A HEADER CLICK ANNOUNCES (story 120.1, D2). `markActivated` sets a flag
 * and the effect announces the RESULTING `current` only while that flag is set,
 * so the message can never disagree with the table. A first render, a sort
 * restored from storage after a reload, and the mobile `TableSortControl` picker
 * change `current` without the flag and stay silent: a restored sort is not
 * news, and the picker's `<select>` already speaks its new value (a second
 * announcement would double-speak, the reason `TableSortControl` has no live
 * region).
 *
 * ⚠️ NOT `role="status"`: each page already owns exactly ONE status region (its
 * loading skeleton, story 38.2 AC-8). The region is present, EMPTY, from the
 * first render, because a polite region inserted already filled is not reliably
 * announced.
 *
 * Ids come from `useId`: these pages server-render and hydrate.
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

  const nodes = (
    <>
      {SORT_DESCRIPTION_STATES.map((state) => (
        <span key={state} id={describedBy(state)} hidden>
          {SORT_DESCRIPTIONS[state]}
        </span>
      ))}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </>
  )

  return { describedBy, markActivated, nodes }
}
