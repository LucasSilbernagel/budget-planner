import type React from 'react'
import { useTheme, useToggleTheme } from '../../stores/themeStore'

/**
 * Dark mode toggle (story 7-3; ungated for every user in story 25-3, FR23).
 *
 * A `role="switch"` control that flips the persisted theme store, mirroring the
 * accessible switch idiom in `settings/currency-toggle.tsx`. Dark mode is a free
 * feature available to all users, so there is no tier gating here — the switch
 * is live for everyone.
 *
 * Placement: a single instance on the consolidated `/settings` surface (story
 * 11-6; relocated from the global {@link Footer}).
 */
export interface ThemeToggleProps {
  /** Extra classes for the control (e.g. layout/spacing from the host). */
  className?: string
}

// Shared control chrome for the switch. `focus:ring-2` (with a real ring width)
// is retained deliberately — ring color alone + `outline-none` is an invisible
// focus state (WCAG 2.4.7; the recurring Epic 15 a11y lesson).
const CONTROL_CLASS =
  'inline-flex items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'

export function ThemeToggle({ className }: ThemeToggleProps): React.ReactElement {
  const theme = useTheme()
  const toggleTheme = useToggleTheme()
  const darkOn = theme === 'dark'

  const controlClass = `${CONTROL_CLASS} ${className ?? ''}`.trim()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={darkOn}
      onClick={toggleTheme}
      className={controlClass}
    >
      <ThemeToggleFace darkOn={darkOn} />
    </button>
  )
}

/**
 * The visible face of the toggle: the "Dark mode" label (the control's
 * accessible name in the unlocked switch) plus the decorative switch track.
 */
function ThemeToggleFace({ darkOn }: { darkOn: boolean }): React.ReactElement {
  return (
    <>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Dark mode</span>
      <SwitchTrack on={darkOn} />
    </>
  )
}

/**
 * Decorative track + knob mirroring the currency toggle's switch visual. Purely
 * presentational (`aria-hidden`): the switch semantics live on the parent
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
