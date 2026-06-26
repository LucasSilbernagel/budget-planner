/**
 * EthicalAds widget (story 4-11, AC-1 / FR20).
 *
 * Renders the EthicalAds placeholder `<div data-ea-publisher>` (inside an
 * accessible, skippable "Advertisement" landmark) and loads the EthicalAds
 * client script, which then fills the placeholder with a contextual,
 * privacy-respecting ad (no cookies, no tracking pixels — NFR7). Visibility
 * gating (who sees ads) lives in {@link AdPlacement}; this component renders the
 * ad surface itself — or **nothing at all** when there is no ad to show.
 *
 * The landmark lives here (not in the caller) so it never appears empty: when
 * the publisher id is unset or the script fails/times out, the component returns
 * `null` and no "Advertisement" region or bordered strip is emitted.
 *
 * The publisher id is read from `VITE_ETHICALADS_PUBLISHER_ID`. It is a *public*
 * identifier (it ships in client HTML on every EthicalAds-enabled site), so
 * exposing it to the bundle is intentional and not a secret leak. When it is
 * unset — e.g. local dev or before the publisher account exists — the component
 * renders nothing, so the app degrades gracefully with no broken ad slot.
 */

import { useEffect, useState } from 'react'
import { getEthicalAds, loadEthicalAdsScript } from '../../lib/ads/client'

export interface EthicalAdsProps {
  /**
   * Ad creative type. EthicalAds supports `image` (default) and `text`-only
   * placements; text is the least intrusive.
   */
  type?: 'image' | 'text'
  /** Extra classes for the surrounding landmark (spacing, borders, etc.). */
  className?: string
}

type LoadStatus = 'loading' | 'loaded' | 'error'

/**
 * Max time to wait for the EthicalAds script before giving up. Real-world
 * adblockers can drop the request without ever firing `onerror`, which would
 * otherwise leave a permanently `aria-busy` slot; on timeout we render nothing.
 */
const SCRIPT_LOAD_TIMEOUT_MS = 10_000

/**
 * The EthicalAds publisher id, read at render time (not module scope) so tests
 * can stub it via `vi.stubEnv` and so an unset value degrades to "no ads".
 * Trimmed so a stray-whitespace `.env` value degrades gracefully rather than
 * producing a broken `data-ea-publisher=" "` slot.
 */
function getPublisherId(): string {
  return (import.meta.env.VITE_ETHICALADS_PUBLISHER_ID ?? '').trim()
}

export function EthicalAds({ type = 'image', className }: EthicalAdsProps) {
  const publisherId = getPublisherId()
  const [status, setStatus] = useState<LoadStatus>('loading')

  useEffect(() => {
    if (!publisherId) {
      return
    }

    let cancelled = false

    // Guard against an adblocker that drops the script without firing onerror:
    // flip to 'error' (→ render nothing) so the slot never stays stuck busy.
    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        setStatus('error')
      }
    }, SCRIPT_LOAD_TIMEOUT_MS)

    loadEthicalAdsScript()
      .then(() => {
        if (cancelled) {
          return
        }
        // Re-scan the DOM so the just-mounted placeholder gets filled (SPA nav
        // and first load both rely on this).
        getEthicalAds()?.load()
        setStatus('loaded')
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [publisherId])

  // No publisher configured, or the script failed/timed out: render nothing —
  // no placeholder, and crucially no empty "Advertisement" landmark/strip.
  if (!publisherId || status === 'error') {
    return null
  }

  return (
    <aside
      aria-label="Advertisement"
      className={className ?? 'flex justify-center border-t border-gray-200 px-4 py-3'}
    >
      <div
        data-ea-publisher={publisherId}
        data-ea-type={type}
        data-testid="ethical-ads"
        // `aria-busy` lets assistive tech know the slot is still resolving; the
        // ad content itself comes from EthicalAds once the script fills the div.
        aria-busy={status === 'loading'}
      />
    </aside>
  )
}
