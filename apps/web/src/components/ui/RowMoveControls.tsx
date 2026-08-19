/**
 * Per-row move-up / move-down controls for the four financial lists
 * (Story 34.1b, FR60).
 *
 * ⚠️ MODULE SCOPE, NOT DEFINED INSIDE A PAGE BODY. A component declared in a
 * page body gets a new function identity on every render, which forces React to
 * unmount and remount its subtree — the focus-loss failure this repo has already
 * shipped once and fixed (see the same warning on `FieldLabel` in
 * `ResponsiveTable.tsx`). Focus retention after a move is an acceptance criterion
 * here, so this placement is load-bearing rather than stylistic.
 *
 * ⚠️ BOUNDARY CONTROLS USE `aria-disabled`, NOT THE NATIVE `disabled` ATTRIBUTE,
 * and that is a deliberate decision rather than an oversight. The story requires
 * BOTH that a boundary is communicated rather than silently ignored AND that
 * focus stays on the control the user just activated. A natively disabled button
 * is removed from the focus order and drops focus to `<body>`, so satisfying the
 * first with `disabled` would break the second at exactly the boundary the first
 * is about: moving a row up into position 0 would strand the keyboard user.
 * `aria-disabled` announces the state to assistive technology while keeping the
 * control focusable, so repeated presses keep working.
 *
 * The cost is that `aria-disabled` has NO behavioural effect — the handler must
 * guard itself, which it does below. `toBeDisabled()` will not pass on these
 * controls; assert `aria-disabled` and assert that the click is a no-op.
 *
 * Icons are hand-written inline SVG because this repo has no icon library and
 * every other icon in it is inline (adding a dependency for two chevrons would
 * be a poor trade). Text labels were not an option: four 44px tap targets plus
 * two text labels do not fit the ~200px available in a 320px row.
 */

import type { RowMoveDirection } from '../../lib/ordering'
import { RESPONSIVE_ACTION_BUTTON_CLASS } from './ResponsiveTable'

/**
 * Matches the Edit/Delete buttons beside these controls: `focus:ring-2` plus a
 * real colour, and deliberately NO `focus:ring-offset-*` — the default
 * ring-offset colour is white and paints a band across the gray-800 card in dark
 * mode. `assertHasFocusRing` fails any offset that lacks a `dark:` counterpart.
 *
 * `aria-disabled:text-faint` rather than an opacity change, so the disabled look
 * cannot collide with `hover:opacity-80` (two utilities setting the same property
 * resolve by Tailwind's source order, not by class order — an unreliable thing to
 * depend on).
 */
const MOVE_BUTTON_CLASS = [
  'text-body hover:opacity-80',
  'aria-disabled:text-faint aria-disabled:cursor-not-allowed',
  'rounded focus:outline-none focus:ring-2 focus:ring-blue-500',
  // Desktop-only separation. Below `sm` the actions group supplies its own
  // `gap-1`, so an unprefixed margin would stack on top of it; above `sm` the
  // group is inert and `mr-4` separates only Edit from Delete, which left the
  // two chevrons flush against each other and against Edit (review).
  'sm:mr-2',
  RESPONSIVE_ACTION_BUTTON_CLASS,
].join(' ')

interface RowMoveControlsProps {
  /**
   * The row's own name. Used to build an accessible name that identifies WHICH
   * row each control moves — without it a list of N rows exposes N identically
   * named "Move up" buttons, the exact defect `e2e/confirm-dialog.spec.ts`
   * records for the Delete buttons.
   */
  label: string
  /** True for the first row: move-up is a no-op and announces itself as such. */
  isFirst: boolean
  /** True for the last row: move-down is a no-op and announces itself as such. */
  isLast: boolean
  /**
   * Forces BOTH controls into the disabled state regardless of position
   * (story 34.2, ratified decision 2).
   *
   * ⚠️ This exists because a column sort and a manual move cannot both be live.
   * The four pages derive `isFirst`/`isLast` from the RENDERED row index, while
   * `planRowMove` derives a row's neighbours from the manual order
   * (`sortByDisplayOrder`) — under a view sort those two disagree, so an arrow
   * would swap the row with a neighbour the user cannot see, and the visually
   * first row would report itself as movable. Rather than reconcile two
   * orderings, a sort disables the arrows; clearing the sort restores them.
   *
   * Deliberately NOT expressed by passing `isFirst && isLast` from the pages:
   * that would make a genuine single-row list indistinguishable from a sorted
   * one, and it would put a fifth copy of the rule in each page.
   */
  disabled?: boolean
  onMove: (direction: RowMoveDirection) => void
}

function ChevronUpIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M5 15l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function RowMoveControls({
  label,
  isFirst,
  isLast,
  disabled = false,
  onMove,
}: RowMoveControlsProps) {
  // Resolved once so the rendered attribute and the handler's guard can never
  // disagree: `aria-disabled` is advisory only, and it is the guard that makes
  // the control an actual no-op.
  const upDisabled = disabled || isFirst
  const downDisabled = disabled || isLast

  return (
    <>
      <button
        type="button"
        aria-label={`Move ${label} up`}
        aria-disabled={upDisabled}
        onClick={() => {
          if (upDisabled) {
            return
          }
          onMove('up')
        }}
        className={MOVE_BUTTON_CLASS}
      >
        <ChevronUpIcon />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        aria-disabled={downDisabled}
        onClick={() => {
          if (downDisabled) {
            return
          }
          onMove('down')
        }}
        className={MOVE_BUTTON_CLASS}
      >
        <ChevronDownIcon />
      </button>
    </>
  )
}
