/**
 * The account boundary on a shared browser (story 90.1, FR144).
 *
 * Every persisted store is shared by whoever uses the browser, and signing out
 * resets none of them (`lib/account/sign-out.ts`). So the NEXT person, signed
 * out, free or paid, used to see the previous account's synced rows and its
 * retirement plan. Story 86.2 removed them for a paid session only, inside the
 * lazily loaded sync engine, after the `/api/auth/me` round trip.
 *
 * This runs it for EVERY session, from the root chunk, before first paint:
 * `StoreHydration` calls {@link applyAccountBoundary} right after it rehydrates
 * the stores, with the session the root loader resolved (the SSR seed). Route
 * content hydrates in a later pass (`lib/store-hydration.tsx`), so no page ever
 * renders the removed data.
 *
 * Once per document load is enough: every session change is a full document
 * load (sign-in is a server 302, sign-out and account deletion load `/`).
 *
 * ⚠️ When the seed cannot be trusted ({@link sessionForBoundary} returns
 * `undefined`), nothing is removed at rehydrate; `SyncProvider` applies the
 * boundary once `/api/auth/me` gives a DEFINITIVE answer. An unverified session
 * never removes anything: a paid user opening the app offline must keep seeing
 * their data.
 *
 * What is removed: rows and profiles owned by another real account
 * (`dropAnotherAccountsLocalData`, rule in `accountOwner.ts`; with no session
 * user every real-owned row is another account's), and another account's
 * retirement plan, which is parked rather than deleted
 * (`claimRetirementPlanFor`). What is kept: placeholder rows a free user made
 * here, the session's own rows, the previous account's unsent queue
 * (`bp-sync-queue-<id>`), and per-device preferences.
 */

import type { SessionSeed } from '../../context/session-seed'
import { claimRetirementPlanFor } from '../../stores/retirementPlannerStore'
import { dropAnotherAccountsLocalData } from './dropAnotherAccountsLocalData'

/**
 * The session the boundary was last applied for in this document, or `null` if
 * it has not been applied yet. Lets `SyncProvider` apply it only when the root
 * could not, or applied it for a different session than `/api/auth/me` reports
 * (a stale cached document).
 */
let appliedFor: string | null = null

/** Whether the `has_session` marker cookie is present (story 53.1). */
function hasMarkerCookie(cookieString: string): boolean {
  return /(?:^|;\s*)has_session=/.test(cookieString)
}

/**
 * The session to apply the boundary for, from the SSR seed and the marker
 * cookie, or `undefined` when that cannot be trusted yet.
 *
 * The cookie matters because the service worker serves the app-shell document
 * from its cache when offline (`pwa.config.mjs`, NetworkFirst), and a cached
 * document's seed is from when it was cached. The marker cookie is NOW, and
 * sign-out clears it (`server/api/auth/session-cookies.ts`):
 * - no marker: signed out, whatever the seed says (`SyncProvider` makes the same
 *   call: no marker, no probe);
 * - marker + an authenticated seed: that user;
 * - marker + a signed-out or `null` seed: unverified (a cached signed-out
 *   document opened by a signed-in user, or a resolver error).
 */
export function sessionForBoundary(
  seed: SessionSeed | null | undefined,
  cookieString: string
): string | undefined {
  if (!hasMarkerCookie(cookieString)) {
    return ''
  }
  if (seed?.isAuthenticated && seed.userId) {
    return seed.userId
  }
  return undefined
}

/** `document.cookie`, or `''` where reading it throws (sandboxed frames). */
export function readCookieString(): string {
  try {
    return typeof document === 'undefined' ? '' : document.cookie
  } catch {
    return ''
  }
}

/**
 * Remove another account's data for `sessionUserId` (`''` = signed out), once per
 * session per document. Each half is guarded on its own so one failure never
 * stops the other or breaks the caller's render.
 */
export function applyAccountBoundary(sessionUserId: string): void {
  if (appliedFor === sessionUserId) {
    return
  }
  appliedFor = sessionUserId
  try {
    dropAnotherAccountsLocalData(sessionUserId)
  } catch (error) {
    console.error('[accountBoundary] removing another account’s rows failed:', error)
  }
  try {
    claimRetirementPlanFor(sessionUserId)
  } catch (error) {
    console.error('[accountBoundary] claiming the retirement plan failed:', error)
  }
}

/** The session the boundary was applied for in this document, or `null`. */
export function accountBoundaryAppliedFor(): string | null {
  return appliedFor
}

/**
 * Forget that the boundary ran. TEST-ONLY: each document load starts with it
 * unapplied, and a suite that renders `StoreHydration` more than once models
 * several loads. No app code calls this.
 */
export function resetAccountBoundaryForTests(): void {
  appliedFor = null
}
