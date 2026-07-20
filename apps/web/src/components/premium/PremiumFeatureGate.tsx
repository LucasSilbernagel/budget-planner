/**
 * PremiumFeatureGate (story 7-2, FR24).
 *
 * Reusable presentation-layer gate that makes a premium feature *discoverable
 * but locked* for non-paying users, rather than hiding it. It is driven entirely
 * by {@link usePremiumAccess} — the same server-verified tier signal that the
 * `/forecasting` route uses — so routes and feature gates can never disagree
 * about a user's tier.
 *
 * This is a PRESENTATION layer only: it never calls premium server functions and
 * is not a security boundary. Real enforcement stays server-side (the
 * `/forecasting` loader + session gate from stories 5-7/5-8). A determined user
 * bypassing this UI still hits the server gate.
 *
 * Three render states (fail-closed — unknown/errored/loading tier ⇒ NOT premium):
 *   - `status.isLoading` (SSR + first client paint) → the tier-agnostic feature
 *     label (the copy both resolved states share), gently pulsing inside the
 *     resolved control's exact footprint. Server and first client render are
 *     identical here, so hydration is stable; paid users never see a lock flash
 *     before their status resolves (DECISION 3); and the card reads as content
 *     settling rather than a blank grey box. Never the children, never the lock
 *     badge, never the upgrade affordance.
 *   - resolved `hasAccess === true` → the unlocked {@link children}, no lock UI.
 *   - resolved `!hasAccess` (free, past_due, canceled, unauthenticated, OR an
 *     errored check) → the locked presentation: a button showing {@link locked}
 *     content + a {@link PremiumLockBadge}; activating it opens the shared
 *     {@link PremiumPrompt} upgrade dialog (CTA → `/pricing`, DECISION 2).
 *
 * New premium features (e.g. the dark-mode toggle in story 7-3) adopt the same
 * locked treatment by wrapping their control in this gate — no bespoke gating
 * logic (AC-4).
 */

import { useState } from 'react'
import type React from 'react'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { PremiumPrompt } from '../auth/premium-prompt'
import { PremiumLockBadge } from './PremiumLockBadge'

export interface PremiumFeatureGateProps {
  /**
   * Human-readable feature name. Used both in the locked control's accessible
   * name and in the upgrade prompt so the user knows what they are unlocking.
   */
  featureName: string
  /** Unlocked content, rendered only when the user has active premium access. */
  children: React.ReactNode
  /**
   * Visible content shown inside the locked affordance for non-paying users
   * (e.g. the feature's label/card body). Must be non-interactive — it is
   * rendered inside a `<button>`, so do not nest links or other buttons here.
   */
  locked: React.ReactNode
  /** Classes applied to the locked `<button>` wrapper. */
  className?: string
  /**
   * Where the upgrade call-to-action points. Defaults to `/pricing` (public
   * value + how to unlock), per story 7-2 DECISION 2.
   */
  upgradeHref?: string
}

export function PremiumFeatureGate({
  featureName,
  children,
  locked,
  className,
  upgradeHref = '/pricing',
}: PremiumFeatureGateProps): React.ReactElement {
  const { status } = usePremiumAccess()
  const [isPromptOpen, setIsPromptOpen] = useState(false)

  // Tier not yet known (SSR + first client paint): render the tier-agnostic
  // label inside the resolved control's exact footprint (from `className`) so
  // the card looks like settling content, not a blank grey box, and the layout
  // never jumps when the tier resolves. `animate-pulse` signals the pending
  // state; `aria-hidden` keeps this transient placeholder out of the a11y tree.
  // Identical on server + first client render → hydration-safe, and fail-closed:
  // never the premium children, never the lock badge, never the upgrade prompt.
  if (status.isLoading) {
    return (
      <div
        aria-hidden="true"
        className={`animate-pulse ${className ?? ''}`}
        data-testid="premium-gate-skeleton"
      >
        {locked}
      </div>
    )
  }

  // Verified active premium: render the real, unlocked feature with no lock UI.
  if (status.hasAccess) {
    return <>{children}</>
  }

  // Everything else (free / lapsed / unauthenticated / errored check) is treated
  // as NOT premium and shown locked but discoverable.
  return (
    <>
      <button
        type="button"
        onClick={() => setIsPromptOpen(true)}
        aria-label={`${featureName} — premium, locked`}
        className={className}
        data-testid="premium-gate-locked"
      >
        {locked}
        <PremiumLockBadge />
      </button>
      {isPromptOpen && (
        <PremiumPrompt
          asDialog
          featureName={featureName}
          upgradeHref={upgradeHref}
          onClose={() => setIsPromptOpen(false)}
        />
      )}
    </>
  )
}
