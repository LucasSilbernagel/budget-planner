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
 */

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
 * ⚠️ What a FAILED POST actually looks like, corrected in review. The logout
 * route clears the cookies unconditionally (`routes/api/auth/logout.ts`), so
 * if the request arrived, the session is gone. If it did not arrive, the
 * reload decides what the user sees, and that is NOT always "still signed in":
 * with the service worker's `NetworkFirst` app-shell cache
 * (`apps/web/pwa.config.mjs`) an offline reload can serve a CACHED SIGNED-IN
 * document, whose strip then fails closed to "Sign in" while the session
 * cookie is still valid. The cache behaviour is pre-existing — it applies to
 * the `/settings` control just the same, and has since 58.1 — and is logged in
 * `deferred-work.md`. Do not describe this path as harmless.
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
  try {
    returnToSignedOutHome()
  } catch (error) {
    console.error('Sign-out could not navigate away', error)
  }
}
