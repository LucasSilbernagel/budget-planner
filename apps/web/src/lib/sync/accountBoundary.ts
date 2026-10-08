/**
 * Runs from StoreHydration before first paint for every session. An untrusted seed removes nothing (an offline paid user
 * must keep their data); SyncProvider applies it once the session is verified.
 */

import type { SessionSeed } from '../../context/session-seed'
import { claimRetirementPlanFor } from '../../stores/retirementPlannerStore'
import { dropAnotherAccountsLocalData } from './dropAnotherAccountsLocalData'

/** Lets SyncProvider re-apply when the root couldn't, or applied it for a stale cached session. */
let appliedFor: string | null = null

function hasMarkerCookie(cookieString: string): boolean {
  return /(?:^|;\s*)has_session=/.test(cookieString)
}

/** The marker cookie is current while a cached offline document's seed may be stale; sign-out clears it. */
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

/** Reading throws in sandboxed frames. */
export function readCookieString(): string {
  try {
    return typeof document === 'undefined' ? '' : document.cookie
  } catch {
    return ''
  }
}

/** Each half is guarded separately so one failure never stops the other or breaks render. */
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

export function accountBoundaryAppliedFor(): string | null {
  return appliedFor
}

export function resetAccountBoundaryForTests(): void {
  appliedFor = null
}
