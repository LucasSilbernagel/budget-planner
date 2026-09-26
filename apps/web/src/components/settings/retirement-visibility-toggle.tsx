import type React from 'react'
import {
  useShowRetirementPlanner,
  useToggleRetirementPlanner,
} from '../../stores/plannerVisibilityStore'

/**
 * Retirement planner visibility toggle (story 35.2, FR55).
 *
 * A `role="switch"` control that flips the persisted visibility preference,
 * mirroring the accessible switch idiom in `settings/currency-toggle.tsx` (story
 * 61.1 deleted `settings/theme-toggle.tsx`, which was the other example). There is no reusable Switch primitive in this
 * repo — `components/ui/` holds no such component — so the idiom is duplicated
 * deliberately rather than invented.
 *
 * Positive framing, matching both existing switches: ON means the planner is
 * shown. The store defaults to ON so nothing the app shows — the nav entry, the
 * page, or the expense form's retirement question — changes without their action.
 *
 * ⚠️ The accessible name must NOT contain the words "dark mode":
 * `settings-page.test.tsx` counts dark-mode switches by filtering every
 * `role="switch"` on `/dark mode/i` over `aria-label`/`textContent`, so a second
 * switch matching that phrase would break an unrelated, correct test.
 *
 * Turning the planner off hides the nav entry, makes `/retirement` render an
 * explanatory panel instead, and (story 71.1, FR113) hides the expense form's
 * ends-before-retirement question and its row badge. It deletes nothing: marked
 * expenses keep `endsBeforeRetirement` and show it again when the planner is
 * back (pinned by the 71.1 block in `components/__tests__/ExpensesPage.test.tsx`
 * and `e2e/ends-before-retirement.spec.ts`). The planner's own saved plan
 * (`retirementPlannerStore`, since story 44.1) and the shared
 * income/expense/balance stores it reads are untouched either way (pinned by
 * `__tests__/planner-visibility-data-safety.test.tsx`, which drives this switch
 * but never opens the expense form).
 *
 * ⚠️ CORRECTED by story 71.1: this docblock used to say "the planner holds no
 * persisted inputs of its own". That stopped being true at story 44.1.
 */
export interface RetirementVisibilityToggleProps {
  /** Extra classes for the control (e.g. layout/spacing from the host). */
  className?: string
  /**
   * Id of the element describing this control, wired to `aria-describedby`.
   *
   * The host owns the description text (it sits outside this component), so it
   * also owns the id. Without this the reassurance that hiding the planner
   * deletes nothing is visible to sighted users only.
   */
  describedBy?: string
}

// Shared control chrome for the switch. `focus:ring-2` (with a real ring width)
// is retained deliberately — ring color alone + `outline-none` is an invisible
// focus state (WCAG 2.4.7; the recurring Epic 15 a11y lesson).
const CONTROL_CLASS =
  'inline-flex items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'

export function RetirementVisibilityToggle({
  className,
  describedBy,
}: RetirementVisibilityToggleProps): React.ReactElement {
  const showRetirementPlanner = useShowRetirementPlanner()
  const toggleRetirementPlanner = useToggleRetirementPlanner()

  const controlClass = `${CONTROL_CLASS} ${className ?? ''}`.trim()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={showRetirementPlanner}
      aria-describedby={describedBy}
      onClick={toggleRetirementPlanner}
      className={controlClass}
    >
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Show Retirement planner
      </span>
      <SwitchTrack on={showRetirementPlanner} />
    </button>
  )
}

/**
 * Decorative track + knob mirroring the theme/currency toggles' switch visual.
 * Purely presentational (`aria-hidden`): the switch semantics live on the parent
 * `role="switch"` button.
 */
function SwitchTrack({ on }: { on: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </span>
  )
}
