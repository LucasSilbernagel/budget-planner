/**
 * Magic-Link Token Service (Story 5-16, Task 1)
 *
 * Issues and consumes the single-use tokens behind passwordless email login.
 * SERVER-ONLY: imports the database client.
 *
 * Security model (AC-1, AC-2):
 *  - Tokens are 256 bits of CSPRNG entropy (`crypto.randomBytes`), base64url so
 *    they drop straight into a URL with no escaping.
 *  - Only the SHA-256 HASH of the token is persisted; the raw token exists only
 *    in the emailed link. A database leak therefore cannot be replayed as a
 *    login link, and lookups re-hash the presented value to find the row.
 *  - Consume is atomic + single-use: one UPDATE marks the row consumed while
 *    gating on `consumedAt IS NULL AND expiresAt > now`, returning the row only
 *    when it actually transitioned. This is correct under Rapids horizontal
 *    scaling where an in-memory "seen" cache would not be (shared with 5-2).
 */

import crypto from 'crypto'
import { db } from '@budget-planner/db'
import { loginTokens } from '@budget-planner/db/src/schema'
import { and, eq, gt, isNull } from 'drizzle-orm'

/** Token lifetime: short, per AC-2 (≤15 minutes). */
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000

/** CSPRNG token size: 32 bytes = 256 bits of entropy. */
export const LOGIN_TOKEN_BYTES = 32

/**
 * Generate a fresh, URL-safe magic-link token (the raw value emailed to the user).
 * base64url yields 43 chars from 32 bytes with no padding or `+`/`/` characters.
 */
export function generateRawToken(): string {
  return crypto.randomBytes(LOGIN_TOKEN_BYTES).toString('base64url')
}

/**
 * Hash a raw token for storage/lookup. SHA-256 is sufficient: the input is
 * already 256 bits of uniform entropy, so it is not subject to dictionary/brute
 * attacks the way a low-entropy password would be — no per-row salt needed.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

/**
 * Create a single-use login token for an existing user and return the RAW token
 * for embedding in the magic link. Only the hash is stored.
 */
export async function createLoginToken(userId: string): Promise<string> {
  const rawToken = generateRawToken()
  await db.insert(loginTokens).values({
    userId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
  })
  return rawToken
}

/**
 * Look up the owning userId for a token WITHOUT consuming it, or null if the
 * token is empty, unknown, expired, or already consumed.
 *
 * Read-only — used by the verify GET interstitial to show which account a link
 * will sign into before the user confirms. The consuming UPDATE
 * (`consumeLoginToken`) still re-validates on the POST, so a token that expires
 * or is consumed between peek and confirm is correctly rejected.
 */
export async function peekLoginToken(rawToken: string): Promise<string | null> {
  if (!rawToken) {
    return null
  }

  const tokenHash = hashToken(rawToken)
  const rows = await db
    .select({ userId: loginTokens.userId })
    .from(loginTokens)
    .where(
      and(
        eq(loginTokens.tokenHash, tokenHash),
        isNull(loginTokens.consumedAt),
        gt(loginTokens.expiresAt, new Date())
      )
    )
    .limit(1)

  return rows[0]?.userId ?? null
}

/**
 * Atomically consume a magic-link token, returning the owning userId, or null if
 * the token is empty, unknown, expired, or already consumed.
 *
 * The single UPDATE is the concurrency control: it sets `consumedAt` only on a
 * row that is currently unconsumed AND unexpired, and we trust the result solely
 * when a row is returned. Two opens of the same link race here and exactly one
 * wins — the other gets an empty result and is rejected (replay-safe).
 */
export async function consumeLoginToken(rawToken: string): Promise<string | null> {
  if (!rawToken) {
    return null
  }

  const tokenHash = hashToken(rawToken)
  const consumed = await db
    .update(loginTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(loginTokens.tokenHash, tokenHash),
        isNull(loginTokens.consumedAt),
        gt(loginTokens.expiresAt, new Date())
      )
    )
    .returning({ userId: loginTokens.userId })

  return consumed[0]?.userId ?? null
}
