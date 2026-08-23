import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'

/**
 * `React.lazy`, but a failed chunk fetch is retried instead of being cached forever
 * (story 38.3, code review).
 *
 * ## Why this exists
 *
 * `React.lazy` memoises the promise it is given, INCLUDING a rejection. So one
 * transient failure — a dropped connection, a proxy hiccup, a 404 from a tab that was
 * open across a redeploy — permanently poisons that boundary for the rest of the
 * session. Every later render re-throws the cached rejection instantly, so the user
 * cannot recover by navigating away and back, and the network having healed changes
 * nothing. Only a full page reload clears it.
 *
 * ⚠️ **The 404-after-redeploy path is not hypothetical in this app.** The service
 * worker is generated with `clientsClaim`, `skipWaiting` and `cleanupOutdatedCaches`
 * (`scripts/generate-sw.mjs:28-31`) and registered with `{ immediate: true }`
 * (`components/pwa/RegisterSW.tsx:15`), so a deploy makes the new worker take over an
 * already-open tab and evict the previous build's precached assets. A chunk that was
 * deliberately DEFERRED is exactly the one such a tab has not fetched yet — so
 * deferring a module converts "already downloaded" into "may 404 later", and this
 * helper is what keeps that from being permanent.
 *
 * ## What it does NOT do
 *
 * Retrying cannot fix a chunk that is genuinely gone (a hash that no longer exists on
 * the server). For that the caller still needs an `ErrorBoundary` — retry narrows the
 * window, it does not close it. Both call sites pair the two.
 */
// biome-ignore lint/suspicious/noExplicitAny: mirrors React.lazy's own constraint
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  { retries = 2, delayMs = 350 }: { retries?: number; delayMs?: number } = {}
): LazyExoticComponent<T> {
  return lazy(async () => {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await factory()
      } catch (error) {
        lastError = error
        if (attempt < retries) {
          // Linear backoff. Short on purpose: this runs while the user is looking at
          // a pending region, so the budget is a moment, not a resilience strategy.
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
        }
      }
    }
    throw lastError
  })
}
