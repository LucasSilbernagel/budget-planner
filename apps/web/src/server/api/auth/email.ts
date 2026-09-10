/**
 * Email canonicalization — the SINGLE strategy used everywhere an email is
 * stored or looked up.
 *
 * Story 5-3: the Paddle Billing checkout webhook (account creation) and the
 * magic-link login lookup (`magic-link.ts`) previously each normalized emails
 * their own way, and the login lookup leaned on Postgres `lower()` whose
 * case-folding can disagree with JS `toLowerCase()` on some non-ASCII inputs
 * (deferred-work.md). Both paths now normalize through `normalizeEmail` HERE
 * before touching the DB, so the stored form and every lookup key are produced
 * by the same code.
 */

/** RFC 5321 maximum email length. */
export const EMAIL_MAX_LENGTH = 254

/** Cheap shape check — one `@`, a dot in the domain, no whitespace. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Canonical form for storage and lookup: trim, then lowercase.
 *
 * ASCII-only assumption: JS `toLowerCase()` is used. For the address space this
 * app serves (checkout + sign-in emails) this is sufficient; a Unicode-aware
 * case fold is out of scope. The point is that ONE function produces the value
 * at every call site, so the stored form and the lookup key always agree.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Shape/length validation. Run on the normalized value. */
export function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_REGEX.test(email)
}
