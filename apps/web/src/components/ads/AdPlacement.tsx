/**
 * Ad placement gate (story 4-11, AC-1 + AC-2 / FR20).
 *
 * Decides *whether* to show ads based on the user's premium access; the ad
 * surface and its accessible landmark live in {@link EthicalAds}, which renders
 * nothing when there is no ad to show (so this gate never produces an empty
 * "Advertisement" region).
 *
 * Visibility rule — ads are shown only to users WITHOUT active premium access:
 *   - Unauthenticated (free tier): no session → no premium → ads shown (AC-1).
 *   - Authenticated paid (active subscription): premium → ads hidden (AC-2).
 *   - Authenticated but lapsed (past_due/canceled): not currently premium → ads
 *     shown. This matches the business intent ("ads sustain the app from
 *     non-paying users") and both acceptance criteria.
 *
 * Gating on `hasAccess` (the server-verified active-premium signal from
 * {@link usePremiumAccess}) rather than mere authentication is deliberate: it is
 * the same source of truth the premium feature gates use, so ads and premium
 * features can never disagree about a user's tier.
 *
 * Fails CLOSED: while the access check is in flight OR if it errored, we render
 * nothing. This avoids flashing an ad to a paying user before their status
 * resolves, and — critically — never serves ads to a (possibly premium) user
 * whose tier could not be verified (AC-2). The check runs client-side only (SSR
 * renders nothing), so there is no hydration mismatch.
 */

import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { EthicalAds } from './EthicalAds'

export interface AdPlacementProps {
  /** Forwarded to {@link EthicalAds}; defaults to image creatives. */
  type?: 'image' | 'text'
  /** Forwarded to {@link EthicalAds} as the landmark's layout classes. */
  className?: string
}

export function AdPlacement({ type, className }: AdPlacementProps) {
  const { status } = usePremiumAccess()

  // Don't flash ads before we know the user's tier; never show them to
  // active-premium users; and fail closed when the tier check errored (a
  // verification failure must not leak ads to a paying customer).
  if (status.isLoading || status.hasAccess || status.error) {
    return null
  }

  return <EthicalAds type={type} className={className} />
}
