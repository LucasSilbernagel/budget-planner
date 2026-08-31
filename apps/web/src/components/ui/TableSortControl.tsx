import { useMemo } from 'react'
import type { SortState } from '../../lib/table-sort'
import { RESPONSIVE_ACTION_BUTTON_CLASS } from './ResponsiveTable'

/**
 * The mobile sort control (Story 48.1, UX-DR53).
 *
 * ## What it replaces, and why that is a widening
 *
 * `TableSortNotice` (story 34.2, ratified decision 7) rendered only while a sort
 * was already active, because a sort could only be STARTED at >= 640px — the
 * `<thead>` is `display: none` below `sm` (`RESPONSIVE_THEAD_CLASS`), so there
 * was no header to activate on a phone. That gap was logged to
 * `deferred-work.md` as a product decision rather than a patch, and this story
 * closes it. Keeping the notice alongside this control would leave two mobile
 * affordances for one idea, which is the thing epic 48 exists to remove.
 *
 * ## ⚠️ ONE `<select>`, pairing column WITH direction
 *
 * Not two controls. A separate direction control makes "descending, no column"
 * representable, costs a second 44px target and a second focus stop, and buys
 * nothing a native picker does not already give: below `sm` this renders as the
 * platform's own list, which announces its value on change for free. That is
 * also why there is no `aria-live` region — the select's value change IS the
 * announcement, and a second one would double-speak.
 *
 * ## ⚠️ THE WIDTH CONSTRAINT IS A FORWARD GUARD, AND THE MEASUREMENT SAYS SO
 *
 * A `<select>`'s intrinsic width is driven by its longest `<option>` in Chrome
 * and Firefox, and the longest label here is `Monthly Allocation (descending)`
 * on `/savings`. `w-full` plus `min-w-0` on the wrapper is what stops option
 * text sizing the box.
 *
 * ⚠️ An earlier version of this note claimed the constraint prevents the control
 * OVERFLOWING 320px. **Measurement refuted that** — with it removed, nothing
 * overflows on any route. Measured at 320px under `DejaVu Sans` (the face CI
 * resolves `system-ui` to; a dev box picks the narrower Noto Sans and
 * understates every figure): constrained the control is 240px on all four
 * routes; unconstrained it is 215 / 215 / 263 / 272 on
 * `/income` / `/expenses` / `/balance` / `/savings` — and 272px is the card
 * interior **exactly**, i.e. zero headroom. So the guard is real and worth
 * keeping, but what it buys today is that the box tracks its CONTAINER rather
 * than the longest label; one extra character in an option would otherwise tip
 * `/savings` over. That mechanism is what
 * `mobile-table-sort.spec.ts`'s "sized by its container" test pins, because an
 * assertion for an overflow nothing currently produces could never fail.
 *
 * Every rect in jsdom is `{0,0,0,0}`, so the unit suite is green whatever this
 * does. The overflow floor is still held by `e2e/mobile-table-sort.spec.ts` and
 * the eight `responsive-320.spec.ts` finance-table tests, whose document-level
 * check reaches this control precisely because it sits OUTSIDE
 * `div.overflow-x-auto` — the table wrapper's scroll container cannot absorb
 * it.
 *
 * ## ⚠️ MODULE SCOPE, NOT DEFINED INSIDE A PAGE BODY
 *
 * The same rule `SortableColumnHeader` and `FieldLabel` carry. A component
 * declared in a page body gets a new function identity on every render, which
 * forces React to unmount and remount its subtree — the select would lose focus
 * mid-interaction, which is the whole interaction this component exists for.
 *
 * ## ⚠️ It renders no `<th>` and no `<td>`
 *
 * It is a SIBLING of the table wrapper. `category-assignment.test.tsx` reads
 * every `<th>`'s text content and pins it as an exact array on both flow pages
 * in both tiers, and the mobile card layout pins `FieldLabel` per cell; a stray
 * cell here would break four assertions across two pages.
 */

/** The value used for "no sort". Not a column key, and not the empty string —
 * an empty `value` makes `select.value` indistinguishable from an option that
 * failed to render. */
const MANUAL_VALUE = 'manual'

/**
 * The wrapper. `sm:hidden` is the whole visibility rule — NOT a
 * `useIsNarrowViewport()` branch, which returns `false` on the server and on the
 * first client render (`ResponsiveTable.tsx` records why a layout swap must not
 * depend on it, and story 42.1 records that the persisted sort makes a phone's
 * FIRST paint a state that matters).
 *
 * `min-w-0` is load-bearing beside the select's `w-full`: without it a flex or
 * grid ancestor sizes this box to its content's min-content width, which for a
 * `<select>` is its longest option.
 */
const WRAPPER_CLASS = 'sm:hidden mb-3 min-w-0'

/**
 * `RESPONSIVE_ACTION_BUTTON_CLASS` supplies the `max-sm:` 44px pair from the one
 * place the whole table layer takes it — `assertHasMobileTapTarget` requires the
 * breakpoint-prefixed form and rejects the unprefixed one, which would change
 * the desktop rendering.
 *
 * The ring carries a real colour and NO `focus:ring-offset-*`: the default
 * offset colour is white and `global.css` has no override, so an offset paints a
 * white band across the dark card. `assertHasFocusRing` fails any offset lacking
 * a `dark:` counterpart.
 *
 * Colours come from the `.surface-inset` / `text-body` tokens, not from
 * hand-rolled greys — `HomePage.tsx`'s duration select predates the token layer
 * and carries `bg-white` and `dark:text-gray-100`, both of which are in
 * `RETIRED_SURFACE_TOKENS`.
 */
const SELECT_CLASS = [
  'w-full max-w-full',
  'surface-inset border border-default rounded-lg',
  'px-3 py-2 text-sm text-body',
  RESPONSIVE_ACTION_BUTTON_CLASS,
  'focus:outline-none focus:ring-2 focus:ring-blue-500',
].join(' ')

interface SortOption<Key extends string> {
  value: string
  label: string
  state: SortState<Key> | null
}

interface TableSortControlProps<Key extends string> {
  /** The control's accessible name, e.g. `Sort income sources`. Mirrors the
   * table wrapper's own region label so the two read as one surface. */
  label: string
  /**
   * The sortable columns of THIS table, in header order.
   *
   * ⚠️ The caller passes the columns it actually RENDERS. On `/income` and
   * `/expenses` that means gating `category` on the same `showCategoryColumn`
   * expression the header uses: `createFlowSortExtractors` omits the Category
   * extractor for an unentitled user, so a Category option offered to a free
   * user would write a sort that `useTableSort`'s `effectiveState` immediately
   * degrades to manual order — a control that visibly does nothing, with no
   * error anywhere.
   */
  columns: readonly { key: Key; label: string }[]
  /** The table's current sort, from `useTableSort().state`. */
  state: SortState<Key> | null
  /** Apply an exact selection. Wire to `useTableSort().select`, never to the
   * store directly — the store has no view of which columns are available. */
  onSelect: (state: SortState<Key> | null) => void
}

export function TableSortControl<Key extends string>({
  label,
  columns,
  state,
  onSelect,
}: TableSortControlProps<Key>) {
  /**
   * ⚠️ The options carry their own `state`, and the change handler LOOKS ONE UP
   * rather than parsing the value back apart. A `${key}:${direction}` split
   * would re-introduce exactly the untrusted-key handling `useTableSort` already
   * had to defend against with an own-property check — for a value this
   * component itself generated. There is no untrusted input on this path; do not
   * add one.
   */
  const options = useMemo<readonly SortOption<Key>[]>(
    () => [
      { value: MANUAL_VALUE, label: 'Manual order', state: null },
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
      {/* The visible label is `sr-only`: at 320px the select needs the full
          card width, and the same pattern the overview duration selector uses
          (`HomePage.tsx`) — an `sr-only` span inside the `<label>` plus an
          `aria-label` carrying the identical string. */}
      <label className="block">
        <span className="sr-only">{label}</span>
        <select
          aria-label={label}
          className={SELECT_CLASS}
          value={value}
          onChange={(event) => {
            const chosen = options.find((option) => option.value === event.target.value)
            // ⚠️ An unmatched value applies NOTHING rather than falling back to
            // manual order. `undefined` here can only mean the option list and
            // the rendered options have diverged; silently clearing the user's
            // sort would hide that, and `manual` is a real, reachable choice
            // this must not be confused with.
            if (chosen === undefined) {
              // ⚠️ RESYNC THE DOM BEFORE BAILING. Refusing to call `onSelect`
              // protects the store but not the control: with no state change
              // there is no re-render, so React never re-coerces this controlled
              // `value`, and the select would keep DISPLAYING a selection that
              // nothing else in the app holds. Writing `value` back makes the
              // refusal visible instead of silent.
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
