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
 * sortable affordance is still carried by the hover colour change, the focus
 * ring, and `aria-sort="none"` for assistive technology.
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
}

export function SortableColumnHeader({ label, ariaSort, onToggle }: SortableColumnHeaderProps) {
  return (
    <th aria-sort={ariaSort} className={RESPONSIVE_HEADER_CELL_CLASS}>
      <button type="button" onClick={onToggle} className={SORT_BUTTON_CLASS}>
        {label}
        {ariaSort === 'ascending' && <SortAscendingIcon />}
        {ariaSort === 'descending' && <SortDescendingIcon />}
      </button>
    </th>
  )
}
