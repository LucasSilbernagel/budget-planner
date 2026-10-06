/**
 * The app's ONE sign-out implementation (story 59.3, AC-7).
 *
 * Two controls sign a user out: the Account section at the bottom of
 * `/settings` (story 10-5) and the account menu in the chrome
 * (`auth/auth-indicator.tsx`, story 59.3). Both call `signOut` here, so the two
 * cannot drift into leaving the session in different states. Extracted from
 * `settings/account-section.tsx`, where it lived until 59.3.
 *
 * Leave the signed-in session behind with a FULL DOCUMENT LOAD, not a
 * client-side navigation.
 *
 * ⚠️ `router.invalidate()` + `router.navigate()` is not enough, and story 58.1's
 * code review caught why. The root route stays mounted across a client
 * navigation, so anything that read the SSR session seed ONCE as a `useState`
 * initializer keeps its signed-in value. Since 58.1 that includes `GlobalNav`,
 * which would go on showing a paid user's Forecasting / Profiles / Report /
 * Categories entries to a session that has just signed out, while
 * `AuthIndicator`, which refetches `/api/auth/me` per navigation, already reads
 * "Sign in". Two halves of the same header bar disagreeing.
 *
 * A document load re-runs the root loader, so every seed consumer re-derives
 * from the now-absent session. This is the right instrument for sign-out
 * regardless: it also drops all in-memory store state, which is what a user
 * leaving a shared machine expects.
 *
 * ⚠️ Do NOT "fix" the nav instead by making it read the seed reactively. That
 * re-creates the first-paint flash `GlobalNav`'s docblock exists to prevent.
 *
 * ⚠️ AMENDED by story 99.1: the nav no longer stays signed-in until a document
 * load. It still reads the seed only once, but it ALSO follows
 * `AuthIndicator`'s last definitive `/api/auth/me` answer
 * (`lib/session/verifiedSession.ts`), so after a client navigation the two
 * halves of the header agree. The document load stays the sign-out instrument
 * anyway, for the store-state reason above and for every OTHER seed consumer.
 * (Since story 101.2 `usePremiumAccess` and the Overview and Settings gates
 * follow that answer too; the Overview account notice, `PremiumCheckoutButton`
 * and the store-hydration boundary still read the seed only.)
 */

import { purgeAppShellCache } from '@/lib/pwa/app-shell-cache'

/** How long to wait for the logout POST before leaving anyway. */
const LOGOUT_TIMEOUT_MS = 10_000

/**
 * The sign-out in flight, shared by BOTH controls (story 59.3 code review).
 *
 * ⚠️ Module-level, not per-component, and that is the point. Each button used
 * to guard only itself, so hanging the `/settings` POST and then pressing the
 * chrome's Sign out sent a SECOND POST and raced a second `location.assign`
 * (verified by probe). The rule is one sign-out per app, not one per button.
 * Cleared when the attempt settles, so a timed-out attempt can be retried.
 */
let inFlight: Promise<void> | null = null

/**
 * Forget the in-flight sign-out. TEST-ONLY, and deliberately explicit rather
 * than a hidden reset: a suite that holds the logout POST open would otherwise
 * leave `inFlight` pending for every later test in the file, which would then
 * join a promise that never settles. No app code calls this — grep before
 * changing that.
 */
export function resetSignOutStateForTests(): void {
  inFlight = null
}

/**
 * Land on `/` with a document load. Used on its own after account deletion,
 * where the server has already cleared the session, and as the last step of
 * `signOut`.
 */
export function returnToSignedOutHome(): void {
  globalThis.location.assign('/')
}

/**
 * Ask the server to end the session, then leave with a document load.
 *
 * Leaves whatever the POST does, and never rejects: it runs from click
 * handlers, where a rejection would surface as an unhandled promise. That
 * covers the navigation too, which can throw in a sandboxed frame — the same
 * reason the account-deletion path wraps its own call.
 *
 * Between the POST and the navigation it deletes the service worker's page
 * cache (`lib/pwa/app-shell-cache.ts`, story 101.1, FR167): the documents in it
 * carry this session's seed, including the email, and on a shared machine the
 * next person would be served them offline (or, before 101.1, on any network
 * slower than 3 s). After the POST, not alongside it: once the server has
 * answered signed-out, a navigation in another tab can no longer re-cache a
 * signed-in document behind the purge (D2). The purge is bounded
 * (`APP_SHELL_PURGE_TIMEOUT_MS`) and never rejects, so it cannot stop the user
 * leaving.
 *
 * ⚠️ What a FAILED POST actually looks like, corrected in review and again by
 * story 101.1. The logout route clears the cookies unconditionally
 * (`routes/api/auth/logout.ts`), so if the request arrived, the session is
 * gone. If it did not arrive (offline), the purge still runs (Q3), so no cached
 * signed-in document is left to serve (unless the purge hit its bound): the
 * reload shows the browser's offline page until the network is back
 * (measured on the prod build, 101.1 evidence). Before 101.1 it could serve a
 * CACHED SIGNED-IN document instead. The session cookie is still valid on the
 * server if the POST never arrived (pre-existing, unchanged). Do not describe
 * this path as harmless.
 */
export async function signOut(): Promise<void> {
  inFlight ??= runSignOut().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runSignOut(): Promise<void> {
  try {
    // A hung POST used to disable Sign out for the rest of the session
    // (verified by probe in review). The timeout means the user always leaves.
    await fetch('/api/auth/logout', {
      method: 'POST',
      signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
    })
  } catch {
    // Deliberately empty. See the docblock: the reload is the report.
  }
  // Even when the POST failed (offline): the cached pages are this session's.
  await purgeAppShellCache()
  try {
    returnToSignedOutHome()
  } catch (error) {
    console.error('Sign-out could not navigate away', error)
  }
}
