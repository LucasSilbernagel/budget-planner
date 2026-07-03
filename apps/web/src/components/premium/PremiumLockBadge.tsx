/**
 * PremiumLockBadge (story 7-2, FR24).
 *
 * Small presentational affordance that marks a feature as premium/locked. It
 * carries a lock icon plus a visible "Premium" label so the locked state is
 * discoverable rather than hidden (FR24). Purely presentational — it renders no
 * interactive elements and makes no tier decision; {@link PremiumFeatureGate}
 * owns the gating and the upgrade interaction.
 *
 * The lock icon is decorative (`aria-hidden`); the visible "Premium" text is the
 * announced signal when the badge is read on its own. When the badge sits inside
 * a control that already names the locked state (the gate's button has an
 * `aria-label` like "Advanced Forecasting — premium, locked"), the label simply
 * reinforces it visually.
 */

import type React from 'react'

export interface PremiumLockBadgeProps {
  /** Extra layout classes for the badge container. */
  className?: string
}

export function PremiumLockBadge({ className }: PremiumLockBadgeProps): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 ${
        className ?? ''
      }`}
    >
      <LockIcon className="h-3 w-3" />
      Premium
    </span>
  )
}

/**
 * Lock Icon - decorative padlock marking the locked state.
 */
function LockIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 11v4m-6 6h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-11V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  )
}
