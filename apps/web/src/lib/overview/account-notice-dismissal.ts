/**
 * Permanent, stored as a fixed '1' sentinel rather than a timestamp. The predicate is `=== '1'`
 * and must match the pre-paint bootstrap exactly.
 */

/** Distinct from the install prompt's key so dismissing one does not silence the other. */
export const ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY = 'bp-overview-account-notice-dismissed'

export const DISMISSED_VALUE = '1'

export const ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE = 'data-dismiss-account-notice'

/** Fails open: a storage error (Safari private mode) must never hide the box forever. */
export function wasAccountNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY) === DISMISSED_VALUE
  } catch {
    return false
  }
}

export function rememberAccountNoticeDismissal(): void {
  try {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, DISMISSED_VALUE)
  } catch {
    // Blocked storage: the dismissal just does not survive this visit.
  }
}

/**
 * The bootstrap runs once per load, so mark <html> now or a client navigation back repaints the box.
 * One-way: safe only because the dismissal has no undo.
 */
export function markAccountNoticeDismissedOnDocument(): void {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.setAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE, DISMISSED_VALUE)
}
