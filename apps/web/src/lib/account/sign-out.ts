/**
 * Leave with a full document load, not a client navigation: it re-runs the root loader for every
 * session-seed consumer and drops in-memory store state.
 */

import { purgeAppShellCache } from '@/lib/pwa/app-shell-cache'

const LOGOUT_TIMEOUT_MS = 10_000

/** Module-level so both sign-out controls share one attempt; cleared on settle so a timeout can retry. */
let inFlight: Promise<void> | null = null

export function resetSignOutStateForTests(): void {
  inFlight = null
}

export function returnToSignedOutHome(): void {
  globalThis.location.assign('/')
}

/**
 * Never rejects. Purges the app-shell cache after the POST, so another tab cannot re-cache a
 * signed-in page behind it.
 */
export async function signOut(): Promise<void> {
  inFlight ??= runSignOut().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runSignOut(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
    })
  } catch {
    // Deliberately empty: the reload is the report.
  }
  // Even when the POST failed: the cached pages carry this session.
  await purgeAppShellCache()
  try {
    returnToSignedOutHome()
  } catch (error) {
    console.error('Sign-out could not navigate away', error)
  }
}
