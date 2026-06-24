/**
 * Signed Session Tokens
 *
 * Produces and verifies HMAC-SHA256 signed session cookies so that session
 * payloads cannot be forged or tampered with by the client (Story 5-7,
 * LAUNCH BLOCKER). Mirrors the HMAC pattern already used for Paddle webhook
 * verification (apps/web/src/routes/api/webhooks/paddle.ts) — Node `crypto`
 * only, no JWT dependency, keeping the dependency surface and EU-only posture
 * clean.
 *
 * Token format: `<base64url(JSON payload)>.<hex HMAC-SHA256 over the base64url>`
 *
 * Security: integrity-protected (signed), NOT encrypted. The payload carries
 * only identity claims (userId/paddleId/email) — never secrets, and never the
 * subscription status, which is read authoritatively from the database on each
 * request (see validateSessionToken).
 */

import crypto from 'crypto'
import { getSessionSecret } from '@budget-planner/config'

/**
 * Claims embedded in a signed session token.
 *
 * Deliberately minimal: identity only. Subscription status and currency are
 * resolved from the database, not trusted from the cookie.
 */
export interface SessionPayload {
  userId: string
  paddleId: string
  email: string
}

/**
 * Compute the hex HMAC-SHA256 of the encoded payload using the session secret.
 */
function computeSignature(encodedPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('hex')
}

/**
 * Sign a session payload into a tamper-evident token suitable for a cookie.
 *
 * @param payload - Identity claims to embed
 * @returns `<base64url(payload)>.<hex hmac>`
 */
export function signSession(payload: SessionPayload): string {
  const secret = getSessionSecret()
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = computeSignature(encodedPayload, secret)
  return `${encodedPayload}.${signature}`
}

/**
 * Verify a session token's signature and return its payload, or null.
 *
 * Returns null (never throws) when the token is missing, malformed, has an
 * invalid/mismatched signature, or was signed with a different secret. Only a
 * payload whose signature matches is parsed and returned.
 *
 * @param token - Raw token value from the session cookie
 * @returns The verified SessionPayload, or null if verification fails
 */
export function verifySession(token: string | null | undefined): SessionPayload | null {
  if (!token) {
    return null
  }

  try {
    const separatorIndex = token.indexOf('.')
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
      return null
    }

    const encodedPayload = token.slice(0, separatorIndex)
    const providedSignature = token.slice(separatorIndex + 1)

    const secret = getSessionSecret()
    const expectedSignature = computeSignature(encodedPayload, secret)

    const providedBuffer = Buffer.from(providedSignature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    // timingSafeEqual throws on length mismatch, so guard first. A length
    // mismatch also means the signatures cannot be equal.
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return null
    }

    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const payload = JSON.parse(decoded) as Partial<SessionPayload>

    if (!payload.userId || !payload.paddleId || !payload.email) {
      return null
    }

    return {
      userId: payload.userId,
      paddleId: payload.paddleId,
      email: payload.email,
    }
  } catch {
    return null
  }
}
