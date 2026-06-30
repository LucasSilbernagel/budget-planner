/**
 * Magic-Link Orchestration (Story 5-16, Tasks 2 & 3)
 *
 * SERVER-ONLY. Sits between the HTTP routes and the token / mailer / DB layers so
 * the routes stay thin and the security rules live in one tested place.
 *
 *  - requestMagicLink: re-authentication ONLY. Looks up a NON-deleted user by
 *    email; if found, mints a single-use token and emails the link. Unknown,
 *    soft-deleted, or invalid emails are a silent no-op — NO account is created
 *    (signup happens at Paddle Billing checkout, Story 5-3) and NO existence
 *    signal is produced (the route returns an identical response either way).
 *
 *  - verifyMagicLink: consumes the token (single-use, enforced in the token
 *    service), then loads the non-deleted user and returns the exact identity
 *    claims `signSession` needs. Fail-closed: a bad token or a soft-deleted owner
 *    resolves null and no session is minted.
 */

import { sendMagicLinkEmail } from '@/server/email/mailer'
import { db } from '@budget-planner/db'
import { users } from '@budget-planner/db/src/schema'
import { and, eq, sql } from 'drizzle-orm'
import { consumeLoginToken, createLoginToken, peekLoginToken } from './login-token'

/** Identity claims required to mint a signed session (matches SessionPayload). */
export interface VerifiedLoginUser {
  userId: string
  paddleId: string
  email: string
}

/** RFC 5321 maximum email length. */
const EMAIL_MAX_LENGTH = 254
/** Same shape check used by the Paddle user creation path. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Normalize an email for lookup + as a rate-limit key (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Cheap shape/length validation before any DB work. */
export function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_REGEX.test(email)
}

/**
 * Build the absolute magic-link URL. The target is the FIXED verify route — the
 * only user-influenced part is the opaque token in the query string, so there is
 * no open-redirect surface (the post-login redirect target is hardcoded to `/`
 * inside the verify route, never taken from the request).
 */
export function buildVerifyLink(baseUrl: string, rawToken: string): string {
  const url = new URL('/api/auth/login/verify', baseUrl)
  url.searchParams.set('token', rawToken)
  return url.toString()
}

/**
 * Request a magic link for `rawEmail`. No-op (no token, no email, no account) for
 * invalid, unknown, or soft-deleted emails — the caller must respond identically
 * regardless, so this never reveals whether an account exists.
 */
export async function requestMagicLink(rawEmail: string, baseUrl: string): Promise<void> {
  const email = normalizeEmail(rawEmail)
  if (!isValidEmail(email)) {
    return
  }

  // Case-insensitive match (the stored address may differ in case) and exclude
  // soft-deleted users (they cannot log in — consistent with validateSessionToken).
  const matches = await db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, eq(users.isDeleted, false)))
    .limit(1)

  const user = matches[0]
  if (!user) {
    return
  }

  const rawToken = await createLoginToken(user.id)
  await sendMagicLinkEmail(user.email, buildVerifyLink(baseUrl, rawToken))
}

/**
 * Resolve the email a (still-valid, unconsumed) token will sign into, WITHOUT
 * consuming it, or null. Drives the verify GET interstitial so the user sees and
 * confirms the target account (login-CSRF awareness) before the consuming POST.
 */
export async function peekMagicLink(rawToken: string): Promise<{ email: string } | null> {
  const userId = await peekLoginToken(rawToken)
  if (!userId) {
    return null
  }

  const matches = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
    .limit(1)

  const user = matches[0]
  return user ? { email: user.email } : null
}

/**
 * Verify and consume a magic-link token, resolving the identity claims for the
 * signed session, or null when the token is invalid/expired/consumed or its
 * owner is soft-deleted/missing (fail-closed).
 */
export async function verifyMagicLink(rawToken: string): Promise<VerifiedLoginUser | null> {
  const userId = await consumeLoginToken(rawToken)
  if (!userId) {
    return null
  }

  const matches = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
    .limit(1)

  const user = matches[0]
  if (!user) {
    return null
  }

  return { userId: user.id, paddleId: user.paddleId, email: user.email }
}
