/**
 * EthicalAds Client
 *
 * Client-side loader for the EthicalAds widget script (story 4-11, FR20).
 *
 * EthicalAds is a privacy-respecting, contextual ad network hosted in
 * Germany/EU (NFR1/NFR2 — no US data residency, CLOUD Act immune) that sets
 * NO cookies and performs no cross-site tracking. The widget works by scanning
 * the DOM for `div[data-ea-publisher]` placeholders once its script has loaded;
 * in a single-page app we re-trigger that scan via `ethicalads.load()` after a
 * placeholder mounts.
 *
 * This module mirrors `src/lib/paddle/client.ts`: it isolates the side-effectful
 * script injection and the `window.ethicalads` global access behind a small,
 * narrowly-typed surface so components stay declarative and tests can mock it.
 */

/** Official EthicalAds client script (Germany/EU CDN). */
export const ETHICALADS_SCRIPT_URL = 'https://media.ethicalads.io/media/client/ethicalads.min.js'

/** Stable id so the script is injected at most once per document. */
export const ETHICALADS_SCRIPT_ID = 'ethicalads-client'

/**
 * Minimal typing for the `ethicalads` global injected by the loaded script.
 * Only `load()` (re-scan the DOM for ad placeholders) is used here.
 */
interface EthicalAdsGlobal {
  load: () => void
}

/**
 * Safely read the `ethicalads` global off `window` with a narrow type instead
 * of `any`. Returns undefined during SSR or before the script has loaded.
 */
export function getEthicalAds(): EthicalAdsGlobal | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return (window as unknown as { ethicalads?: EthicalAdsGlobal }).ethicalads
}

// Cache the in-flight/settled load so concurrent placements share one script
// injection. Reset on failure so a later mount can retry.
let scriptPromise: Promise<void> | null = null

/**
 * Inject the EthicalAds client script once and resolve when it has loaded.
 *
 * Idempotent: if the global is already present, or the script tag already
 * exists, or a load is in flight, the existing result is reused. Safe to call
 * during SSR (resolves immediately without touching the DOM).
 */
export function loadEthicalAdsScript(): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.resolve()
  }
  if (getEthicalAds()) {
    return Promise.resolve()
  }
  if (scriptPromise) {
    return scriptPromise
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    // Reuse a pre-existing tag rather than injecting a duplicate, but still wait
    // for its load event — resolving blind here would let the component call
    // `ethicalads.load()` before the global exists, leaving the slot unfilled.
    const existing = document.getElementById(ETHICALADS_SCRIPT_ID) as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')

    script.onload = () => resolve()
    script.onerror = () => {
      // Allow a future mount to retry cleanly: drop the cache AND the dead tag,
      // so the next call re-injects instead of short-circuiting on a stale tag.
      scriptPromise = null
      script.remove()
      reject(new Error('Failed to load EthicalAds'))
    }

    if (!existing) {
      script.id = ETHICALADS_SCRIPT_ID
      script.src = ETHICALADS_SCRIPT_URL
      script.async = true
      document.head.appendChild(script)
    }
  })

  return scriptPromise
}

/**
 * Reset the module-level load cache. Test-only helper so each test starts from
 * a clean slate (the cache otherwise persists across tests in the same file).
 */
export function resetEthicalAdsScriptState(): void {
  scriptPromise = null
}
