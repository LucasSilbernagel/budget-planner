/**
 * usePremiumAccess Hook
 *
 * React hook for checking premium feature access.
 * Provides subscription status and access control for premium features.
 *
 * Architecture: seeded from the SSR session (story UX-1); without a seed, one
 * same-origin `GET /api/auth/me` (story 83.1). Since story 101.2 (FR168) it
 * ALSO follows the last DEFINITIVE `/api/auth/me` answer `AuthIndicator`
 * records (`lib/session/verifiedSession.ts`), as `GlobalNav` has since 99.1:
 * the seed decides the first paint, the verified answer every frame after it.
 * Fail direction unchanged: CLOSED (no answer and no seed = loading, then its
 * own check; any failure = no access).
 * Data Sovereignty: All checks performed server-side, data in DanubeData (Germany - EU)
 *
 * ⚠️ Never `import()` a `server/` module here (story 83.1, FR136). The client
 * check used to load `server/api/data/forecasting` in the browser; in the
 * production bundle that chunk carried `pg` and failed with `Buffer is not
 * defined`, so a paid user with no SSR seed was shown the upgrade prompt
 * (MEASURED, story 83.1 M3). `scripts/check-client-bundle.mjs` now fails the
 * build gate if server code reaches the client bundle.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SIGNED_OUT_SEED,
  type SeedSubscriptionStatus,
  type SessionSeed,
  useSessionSeed,
} from '../context/session-seed'
import { STATUS_ACCESS, hasPremiumFeatures } from '../lib/premium/access-statuses'
import { useVerifiedSession } from '../lib/session/verifiedSession'

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
 * so seed and re-check cannot disagree, and so does the indicator's verified
 * answer (story 101.2).
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
  // Seed the initial status from the SSR-resolved session (story UX-1). The seed
  // is still read once, as an initializer, so a later provider change can never
  // clobber a resolved status. When there is no seed (resolver could not verify,
  // or rendered outside the provider) we keep the fail-closed loading default and
  // resolve via the client check below.
  //
  // Story 101.2 (FR168): the hook ALSO follows the indicator's last DEFINITIVE
  // `/api/auth/me` answer, read through `useVerifiedSession()` ONLY. While
  // hydrating, React reads zustand's SERVER snapshot (`undefined`), so SSR and
  // the first client frame are both the seed's; a non-reactive
  // `getVerifiedSession()` here would break that (101.2 AC 6, mutation M5). A gate
  // mounting AFTER an answer (a client navigation) starts from that answer
  // (decision DS2). Agreeing answers re-render with equal values: never through
  // `isLoading: true`, so a gate never flashes its skeleton (AC 5).
  const seed = useSessionSeed()
  const verified = useVerifiedSession()
  const [status, setStatus] = useState<PremiumAccessStatus>(() =>
    seedToStatus(verified === undefined ? seed : knownStatusSeed(verified))
  )
  // The latest definitive answer, for `checkAccess` (DS1) and the mount check
  // (DS2), which must not re-run when it changes.
  const verifiedRef = useRef(verified)

  useEffect(() => {
    verifiedRef.current = verified
    if (verified !== undefined) {
      setStatus(seedToStatus(knownStatusSeed(verified)))
    }
  }, [verified])

  /**
   * Check premium access with the server (`GET /api/auth/me`).
   *
   * A readable answer is turned into a {@link SessionSeed} and resolved by
   * {@link seedToStatus}, the SAME rule as the SSR seed, so the first paint and a
   * re-check can never disagree (story 83.1). Anything else fails CLOSED.
   */
  const checkAccess = useCallback(async (): Promise<PremiumAccessCheckResult> => {
    /** Apply the held definitive answer, if any (DS1); `null` when none is held. */
    const verifiedStatus = (): PremiumAccessCheckResult | null => {
      const held = verifiedRef.current
      if (held === undefined) {
        return null
      }
      const heldStatus = seedToStatus(knownStatusSeed(held))
      setStatus(heldStatus)
      return {
        hasAccess: heldStatus.hasAccess,
        subscriptionStatus: heldStatus.subscriptionStatus,
        isAuthenticated: heldStatus.isAuthenticated,
      }
    }
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
      // Decision DS1 (story 101.2): a failed check is UNKNOWN, and unknown keeps
      // the last definitive answer (99.1 D2). So when the indicator's answer is
      // held, it stands instead of the fail-closed fallback.
      const held = verifiedStatus()
      if (held) {
        return held
      }
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
      const held = verifiedStatus()
      if (held) {
        return held
      }
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

  // Resolve access on mount ONLY when there is no SSR seed AND no definitive
  // answer is held yet. With a seed the first paint is already correct (story
  // UX-1) and re-checking would reintroduce the flash (and, in the browser, a
  // needless server round-trip). With a held answer the indicator has just asked
  // the same question (story 101.2, DS2: no request). A successful check and a
  // later verified answer are both definitive: the last one wins. Explicit
  // checkAccess()/refresh() callers are unaffected.
  useEffect(() => {
    if (seed || verifiedRef.current !== undefined) {
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

/**
 * A verified answer with its status narrowed to the known set (story 101.2).
 * `AuthIndicator` casts the raw `/api/auth/me` string; `fetchSessionSeed` maps an
 * unknown status to `null`. Same here, so `subscriptionStatus` stays inside its
 * declared union and an unknown status is no access.
 */
function knownStatusSeed(seed: SessionSeed): SessionSeed {
  return isKnownStatus(seed.subscriptionStatus) ? seed : { ...seed, subscriptionStatus: null }
}

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
    return { ok: true, seed: { ...SIGNED_OUT_SEED } }
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
