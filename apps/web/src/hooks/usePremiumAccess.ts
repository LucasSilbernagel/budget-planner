/**
 * usePremiumAccess Hook
 *
 * React hook for checking premium feature access.
 * Provides subscription status and access control for premium features.
 *
 * Architecture: seeded from the SSR session (story UX-1); without a seed, one
 * same-origin `GET /api/auth/me` (story 83.1).
 * Data Sovereignty: All checks performed server-side, data in DanubeData (Germany - EU)
 *
 * ⚠️ Never `import()` a `server/` module here (story 83.1, FR136). The client
 * check used to load `server/api/data/forecasting` in the browser; in the
 * production bundle that chunk carried `pg` and failed with `Buffer is not
 * defined`, so a paid user with no SSR seed was shown the upgrade prompt
 * (MEASURED, story 83.1 M3). `scripts/check-client-bundle.mjs` now fails the
 * build gate if server code reaches the client bundle.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  type SeedSubscriptionStatus,
  type SessionSeed,
  useSessionSeed,
} from '../context/session-seed'
import { STATUS_ACCESS, hasPremiumFeatures } from '../lib/premium/access-statuses'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Premium access status
 */
export interface PremiumAccessStatus {
  /** Whether user has access to premium features */
  hasAccess: boolean
  /** User's subscription status */
  subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime' | null
  /** Whether the check is currently loading */
  isLoading: boolean
  /** Error message if check failed */
  error: string | null
  /** Whether user is authenticated */
  isAuthenticated: boolean
}

/**
 * Result of premium access check
 */
export interface PremiumAccessCheckResult {
  hasAccess: boolean
  subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime' | null
  isAuthenticated: boolean
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Default premium access status
 */
const defaultStatus: PremiumAccessStatus = {
  hasAccess: false,
  subscriptionStatus: null,
  isLoading: true,
  error: null,
  isAuthenticated: false,
}

/**
 * Derive the resolved premium status from the SSR session seed (story UX-1) so
 * `status.isLoading` starts `false` with the correct value on the first paint —
 * no skeleton flash, and paid users never flash a lock (7-2 DECISION 3).
 *
 * No seed → the fail-closed loading default (resolved after mount by a client
 * check). A signed-out seed resolves to a not-authenticated, no-access status.
 * Access requires a premium-features status (`hasPremiumFeatures`: active or
 * lifetime — NOT past_due); every other state is fail-closed to no access.
 * The no-seed client re-check resolves through this function too (story 83.1),
 * so seed and re-check cannot disagree.
 *
 * ⚠️ Its `hasAccess` field and `lib/premium/entitlement.ts`'s `isEntitledSeed`
 * are THE SAME RULE (story 58.2). Since story 78.3 both call the same status
 * predicate (`hasPremiumFeatures`), but each wraps it in its own authentication
 * conjunct, and this one is not refactored to call `isEntitledSeed` because it
 * builds a five-field object on the hot path of every premium gate in the app. **Exported solely so `entitlement.test.ts` can assert
 * the two agree for real** — an earlier version of that test recomputed the
 * predicate inline and could never go red, which is exactly the drift it claimed
 * to prevent. If that parity test fails, these two have diverged; fix the code,
 * not the test.
 */
export function seedToStatus(seed: SessionSeed | null): PremiumAccessStatus {
  if (!seed) {
    return defaultStatus
  }
  return {
    // Gate access on authentication too, so a malformed seed can never yield
    // premium for a not-authenticated session — fail-closed by construction, not
    // by luck of what the resolver emits (code review 2026-07-14). Both an active
    // subscription and a permanent lifetime purchase (story 25-2) are entitled.
    hasAccess: seed.isAuthenticated && hasPremiumFeatures(seed.subscriptionStatus),
    subscriptionStatus: seed.isAuthenticated ? seed.subscriptionStatus ?? 'free' : null,
    isLoading: false,
    error: null,
    isAuthenticated: seed.isAuthenticated,
  }
}

/**
 * Custom hook for checking premium feature access
 *
 * @returns Premium access status and check function
 *
 * @example
 * ```tsx
 * const { hasAccess, subscriptionStatus, isLoading, checkAccess } = usePremiumAccess()
 *
 * if (isLoading) return <LoadingSpinner />
 * if (!hasAccess) return <UpgradePrompt />
 * return <PremiumFeature />
 * ```
 */
export function usePremiumAccess(): {
  status: PremiumAccessStatus
  checkAccess: () => Promise<PremiumAccessCheckResult>
  refresh: () => Promise<void>
} {
  // Seed the initial status from the SSR-resolved session (story UX-1). Read once
  // as an initializer so a later provider change can never clobber a resolved
  // status. When there is no seed (resolver could not verify, or rendered outside
  // the provider) we keep the fail-closed loading default and resolve via the
  // client check below.
  const seed = useSessionSeed()
  const [status, setStatus] = useState<PremiumAccessStatus>(() => seedToStatus(seed))

  /**
   * Check premium access with the server (`GET /api/auth/me`).
   *
   * A readable answer is turned into a {@link SessionSeed} and resolved by
   * {@link seedToStatus}, the SAME rule as the SSR seed, so the first paint and a
   * re-check can never disagree (story 83.1). Anything else fails CLOSED.
   */
  const checkAccess = useCallback(async (): Promise<PremiumAccessCheckResult> => {
    try {
      setStatus((prev) => ({ ...prev, isLoading: true, error: null }))

      const seedFromServer = await fetchSessionSeed()

      if (seedFromServer.ok) {
        const newStatus = seedToStatus(seedFromServer.seed)
        setStatus(newStatus)
        return {
          hasAccess: newStatus.hasAccess,
          subscriptionStatus: newStatus.subscriptionStatus,
          isAuthenticated: newStatus.isAuthenticated,
        }
      }
      // Fallback for when server check fails - assume no access
      // Log the error for debugging
      console.error('Premium access check failed:', seedFromServer.error)
      const fallbackStatus: PremiumAccessStatus = {
        hasAccess: false,
        subscriptionStatus: 'free',
        isLoading: false,
        error: seedFromServer.error,
        isAuthenticated: false,
      }
      setStatus(fallbackStatus)
      return {
        hasAccess: false,
        subscriptionStatus: 'free',
        isAuthenticated: false,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to check premium access'
      const errorStatus: PremiumAccessStatus = {
        hasAccess: false,
        subscriptionStatus: null,
        isLoading: false,
        error: errorMessage,
        isAuthenticated: false,
      }
      setStatus(errorStatus)
      return {
        hasAccess: false,
        subscriptionStatus: null,
        isAuthenticated: false,
      }
    }
  }, [])

  /**
   * Refresh premium access status
   */
  const refresh = useCallback(async (): Promise<void> => {
    await checkAccess()
  }, [checkAccess])

  // Resolve access on mount ONLY when there is no SSR seed. With a seed the first
  // paint is already correct (story UX-1) and re-checking would reintroduce the
  // flash (and, in the browser, a needless server round-trip). Explicit
  // checkAccess()/refresh() callers (e.g. the forecasting route) are unaffected.
  useEffect(() => {
    if (seed) {
      return
    }
    checkAccess()
  }, [checkAccess, seed])

  return { status, checkAccess, refresh }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Whether a status read from the `/api/auth/me` JSON is one this app knows.
 * Derived from `STATUS_ACCESS`, the one status table (story 78.3), never
 * restated here; an own-key test, so a prototype key is not a status.
 */
const isKnownStatus = (value: unknown): value is Exclude<SeedSubscriptionStatus, null> =>
  typeof value === 'string' && Object.keys(STATUS_ACCESS).includes(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Ask `GET /api/auth/me` who this is, as a {@link SessionSeed} (story 83.1).
 *
 * `{ user: null }` is an AUTHORITATIVE signed-out answer. A non-OK status (the
 * route answers 503 when the session cannot be resolved), a body that is not
 * JSON, or a `user` without an id is "could not determine" (`ok: false`). A
 * network failure rejects. The payload is otherwise unvalidated, as for every
 * other consumer of this route; an unknown status becomes `null` (no access).
 */
async function fetchSessionSeed(): Promise<
  { ok: true; seed: SessionSeed } | { ok: false; error: string }
> {
  const response = await fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    return { ok: false, error: `Failed to check premium access (HTTP ${response.status})` }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, error: 'Failed to check premium access (unreadable response)' }
  }
  if (!isRecord(body) || !('user' in body)) {
    return { ok: false, error: 'Failed to check premium access (unexpected response)' }
  }
  const { user } = body
  if (user === null) {
    return {
      ok: true,
      seed: { isAuthenticated: false, userId: null, email: null, subscriptionStatus: null },
    }
  }
  if (!isRecord(user) || typeof user['userId'] !== 'string' || user['userId'] === '') {
    return { ok: false, error: 'Failed to check premium access (unexpected response)' }
  }
  const status = user['subscriptionStatus']
  return {
    ok: true,
    seed: {
      isAuthenticated: true,
      userId: user['userId'],
      email: typeof user['email'] === 'string' ? user['email'] : null,
      subscriptionStatus: isKnownStatus(status) ? status : null,
    },
  }
}

// ============================================================================
// Utility Hook for Route Protection
// ============================================================================

/**
 * Hook for protecting premium routes
 * Returns whether user can access the route and loading state
 *
 * @returns Object with access status and loading state
 */
export function usePremiumRouteAccess(): {
  canAccess: boolean
  isLoading: boolean
  subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime' | null
  isAuthenticated: boolean
} {
  const { status } = usePremiumAccess()

  return {
    canAccess: status.hasAccess,
    isLoading: status.isLoading,
    subscriptionStatus: status.subscriptionStatus,
    isAuthenticated: status.isAuthenticated,
  }
}
