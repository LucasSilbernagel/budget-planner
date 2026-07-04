import type React from 'react'
import { useTheme, useToggleTheme } from '../../stores/themeStore'
import { PremiumFeatureGate } from '../premium'

/**
 * Premium-gated dark mode toggle (story 7-3, FR23).
 *
 * A `role="switch"` control that flips the persisted theme store, mirroring the
 * accessible switch idiom in `settings/currency-toggle.tsx`. It is the intended
 * consumer of story 7-2's {@link PremiumFeatureGate} (AC-4): the gate owns the
 * tier decision, so there is no bespoke gating here.
 * - paid → the working switch, no badge.
 * - free / lapsed / unauthenticated → a locked, discoverable affordance with a
 *   {@link PremiumLockBadge}; activating it opens the upgrade prompt (CTA →
 *   `/pricing`, the gate's default).
 * - loading (SSR + first client paint) → the gate's neutral skeleton; the live
 *   switch is never rendered until the tier resolves (fail-closed).
 *
 * Placement: a single instance on the consolidated `/settings` surface (story
 * 11-6; relocated from the global {@link Footer}). Keeping exactly one instance
 * (DECISION 2) sidesteps 7-2's deferred single-open-`Modal` limitation.
 */
export interface ThemeToggleProps {
  /** Extra classes for the control (e.g. layout/spacing from the host). */
  className?: string
}

// Shared control chrome so the locked affordance and the working switch look
// identical apart from the lock badge the gate adds.
const CONTROL_CLASS =
  'inline-flex items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'

export function ThemeToggle({ className }: ThemeToggleProps): React.ReactElement {
  const theme = useTheme()
  const toggleTheme = useToggleTheme()
  const darkOn = theme === 'dark'

  const controlClass = `${CONTROL_CLASS} ${className ?? ''}`.trim()

  return (
    <PremiumFeatureGate
      featureName="Dark mode"
      className={controlClass}
      // Free users are always light (AC-3), so the locked affordance shows the
      // off state. It is non-interactive — the gate renders it inside a button.
      locked={<ThemeToggleFace darkOn={false} />}
    >
      <button
        type="button"
        role="switch"
        aria-checked={darkOn}
        onClick={toggleTheme}
        className={controlClass}
      >
        <ThemeToggleFace darkOn={darkOn} />
      </button>
    </PremiumFeatureGate>
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
 * `role="switch"` button (unlocked) or the gate's locked button.
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
