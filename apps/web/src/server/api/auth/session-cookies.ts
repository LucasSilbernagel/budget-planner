/**
 * Shared Session Cookie Builders (Story 53.1 review)
 *
 * Centralizes the `session` (HttpOnly, server-authoritative) and `has_session`
 * (deliberately non-HttpOnly, client-readable marker — see `SyncProvider.
 * hasProbableSession`) cookie strings, so their name/attributes/lifetime can
 * never drift between the 3 places that set or clear them
 * (`routes/api/auth/login/verify.ts`, `routes/api/auth/logout.ts`,
 * `routes/api/account/delete.ts`). Reproducing that drift surface — a mismatch
 * between what one file sets and another expects — is exactly the class of
 * bug this story's original defect was.
 */

/** 7-day session lifetime, shared by both cookies (matches `session.ts`'s signed-session TTL). */
export const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60

export function isProductionEnv(): boolean {
  return process.env['NODE_ENV'] === 'production'
}

function secureFlag(isProduction: boolean): string {
  return isProduction ? '; Secure' : ''
}

/** The real, HttpOnly, server-authoritative session cookie. */
export function buildSessionCookie(token: string, isProduction: boolean): string {
  return `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secureFlag(
    isProduction
  )}; Max-Age=${SESSION_COOKIE_MAX_AGE}`
}

/**
 * The deliberately NON-HttpOnly companion marker. Carries no secret — its
 * value is meaningless, only presence matters — so client-side code
 * (`SyncProvider.hasProbableSession`) can tell "probably signed in" without
 * being able to read the real session cookie.
 */
export function buildHasSessionCookie(isProduction: boolean): string {
  return `has_session=1; Path=/; SameSite=Lax${secureFlag(
    isProduction
  )}; Max-Age=${SESSION_COOKIE_MAX_AGE}`
}

/** Clears both cookies, with matching `Secure` handling in both. */
export function buildClearSessionCookies(
  isProduction: boolean
): [session: string, hasSession: string] {
  const flag = secureFlag(isProduction)
  return [
    `session=; Path=/; HttpOnly; SameSite=Lax${flag}; Max-Age=0`,
    `has_session=; Path=/; SameSite=Lax${flag}; Max-Age=0`,
  ]
}
