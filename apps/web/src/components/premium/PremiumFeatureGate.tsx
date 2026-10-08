// Presentation only, not a security boundary. Fail-closed: a loading or errored
// tier check renders as not premium.

import { useState } from 'react'
import type React from 'react'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { PremiumPrompt } from '../auth/premium-prompt'
import { SkeletonBlock } from '../ui/Skeleton'
import { PremiumLockBadge } from './PremiumLockBadge'

export interface PremiumFeatureGateProps {
  /** For the upgrade prompt; not the locked control's accessible name. */
  featureName: string
  children: React.ReactNode
  /** Rendered inside a `<button>`, so it must be non-interactive. */
  locked: React.ReactNode
  className?: string
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

  // Identical on server and first client paint (hydration-safe); never reveals
  // the children or the lock UI.
  if (status.isLoading) {
    return (
      <SkeletonBlock className={className} testId="premium-gate-skeleton">
        {locked}
      </SkeletonBlock>
    )
  }

  if (status.hasAccess) {
    return <>{children}</>
  }

  // No aria-label: it would replace the visible content in the accessible name.
  return (
    <>
      <button
        type="button"
        onClick={() => setIsPromptOpen(true)}
        className={className}
        data-testid="premium-gate-locked"
      >
        {locked}
        <PremiumLockBadge />
        <span className="sr-only">, locked</span>
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
