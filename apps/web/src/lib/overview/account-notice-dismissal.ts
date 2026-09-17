/**
 * Persistence for the Overview "No account needed" notice dismissal
 * (story 55.1, FR82).
 *
 * Mirrors the shape of `components/pwa/InstallPrompt`'s dismissal helpers — a
 * key constant, a guarded boolean read, a guarded write — with one deliberate
 * difference: this dismissal is PERMANENT. `InstallPrompt` stores
 * `Date.now()` and compares it against a 30-day window because it wants to
 * eventually re-nag; the user's ask here was to be done with the box, not
 * snoozed (AC-2), so there is no expiry check and therefore no timestamp.
 *
 * ⚠️ WHY A FIXED SENTINEL AND NOT A TIMESTAMP. Storing a date under a key with
 * no expiry invites a future reader to add one, and it drags in
 * `InstallPrompt`'s whole clock-skew bug class: that component has to reject
 * FUTURE timestamps (`InstallPrompt.tsx:64-69`) because a corrupt-but-finite
 * value yields a negative age that is always inside the window, suppressing the
 * affordance essentially forever. `'1'` cannot be skewed.
 *
 * ⚠️ THE PREDICATE IS `=== '1'`, NEVER TRUTHINESS, and the pre-paint bootstrap
 * in `./no-flash-account-notice-script` MUST apply the byte-identical rule. Two
 * readers of the same key that disagree produce a pre-paint/post-hydration
 * INVERSION — the box hidden on the first frame and restored after hydration,
 * or the reverse — which is worse than either behaviour on its own. The planner
 * bootstrap documents the same hazard at
 * `lib/nav/no-flash-planner-visibility-script.ts:28-32`.
 */

/**
 * localStorage key holding the dismissal flag.
 *
 * Deliberately distinct from `InstallPrompt`'s `bp-pwa-install-dismissed`
 * (AC-2): the two affordances are unrelated, and sharing a key would make
 * dismissing one silence the other.
 *
 * Single source of truth — imported by the component AND by the pre-paint
 * bootstrap, which is the only reason this lives in `lib/` rather than as a
 * module-local const in the component.
 */
export const ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY = 'bp-overview-account-notice-dismissed'

/**
 * The only value that counts as dismissed.
 *
 * EXPORTED because `./no-flash-account-notice-script` interpolates it into the
 * inline bootstrap. Both readers of this key must apply the byte-identical
 * rule, and a shared constant is what makes that true by construction rather
 * than by two hand-maintained test tables (code review 55.1).
 */
export const DISMISSED_VALUE = '1'

/**
 * Attribute the pre-paint bootstrap sets on `<html>`, and the hook the
 * `[data-dismiss-account-notice='1']` rule in `styles/global.css` matches.
 *
 * Shared so the bootstrap string, the component's in-session marker and the
 * tests all name it once.
 */
export const ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE = 'data-dismiss-account-notice'

/**
 * True only when the user has dismissed the notice.
 *
 * Fails OPEN (returns `false` → the box shows) on any storage failure or
 * unrecognised value (AC-3). A blocked store — Safari private mode throws
 * `SecurityError` on access — must never throw out of here and must never
 * wrongly suppress the box forever. Same swallow-errors discipline as
 * `StoreHydration` and `InstallPrompt.wasRecentlyDismissed`.
 */
export function wasAccountNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY) === DISMISSED_VALUE
  } catch {
    return false
  }
}

/**
 * Record the dismissal permanently.
 *
 * A blocked or full store means the dismissal simply does not survive this
 * visit — the in-session unmount still happens, so the click is never a no-op
 * from the user's point of view.
 */
export function rememberAccountNoticeDismissal(): void {
  try {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, DISMISSED_VALUE)
  } catch {
    // Intentionally ignored — see the JSDoc above.
  }
}

/**
 * Mark `<html>` so the `styles/global.css` rule suppresses the box for the rest
 * of THIS document's lifetime — what the `<head>` bootstrap does on a fresh
 * load, done at the moment of an in-session dismissal.
 *
 * ⚠️ WITHOUT THIS THERE IS A REAL FLASH, found in code review and reproduced in
 * a browser. The bootstrap runs once per document load, so a dismissal that
 * happens afterwards leaves `<html>` unmarked; a client-side navigation away
 * from `/` and back then remounts the component, which renders the box and only
 * removes it in a post-paint effect. Measured: the node re-attached with
 * `display: "block"`.
 *
 * One-way by design, and safe as such only because this dismissal has no undo
 * path — see the warning in `./no-flash-account-notice-script` about what an
 * added "undo" would have to do.
 *
 * Guarded for non-DOM callers (SSR, node-environment tests) so it is safe to
 * call from anywhere.
 */
export function markAccountNoticeDismissedOnDocument(): void {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.setAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE, DISMISSED_VALUE)
}
