/**
 * Session resolution for authenticated (paid-tier) requests.
 *
 * Architecture: TanStack Start server routes / functions call `getCurrentUserSession`
 * to resolve the signed session cookie into a DB-authoritative user identity.
 * Data Sovereignty: all data stored in DanubeData (Germany - EU) (NFR1, NFR2).
 *
 * ⚠️ History: this file was the Paddle "OAuth login" module. That flow was a
 * false premise (Paddle is billing-only, not an identity provider) and its stub
 * was removed in Story 5-3. Identity is now app-owned — the magic-link login
 * (`routes/api/auth/login/*`, Story 5-16) mints the signed session; account
 * creation happens at the Paddle Billing checkout webhook
 * (`routes/api/webhooks/paddle.ts`). The filename is kept only because ~12 call
 * sites import `getCurrentUserSession` / `UserSession` from `@/server/api/auth/paddle`.
 */

import { logger } from '@/lib/logger'
import { db } from '@budget-planner/db'
import { users } from '@budget-planner/db/src/schema'
import { and, eq } from 'drizzle-orm'
import { verifySession } from './session'

// Imported for local use AND re-exported so existing importers of this module
// keep working; the single declaration lives in `../result`.
import type { Currency } from '@budget-planner/db'
import type { ApiResult } from '../result'

export type { ApiResult }

/**
 * User session information.
 * userId matches the UUID type from database schema (Story 4-2).
 */
export interface UserSession {
  userId: string
  email: string
  paddleId: string
  subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime'
  // Non-null: the column is nullable but carries a `'NONE'` default, and every
  // construction site below falls back to that rather than propagating null.
  currency: Currency
  isAuthenticated: boolean
  name?: string
}

/**
 * Get current user session from the request's signed session cookie.
 *
 * @param request - Incoming request object
 * @returns User session or null if not authenticated
 */
export async function getCurrentUserSession(
  request: Request
): Promise<ApiResult<UserSession | null>> {
  try {
    const cookieHeader = request.headers.get('cookie')

    if (!cookieHeader) {
      return { success: true, data: null }
    }

    // Parse cookies from header
    const cookies: Record<string, string> = {}
    for (const cookie of cookieHeader.split(';')) {
      const [name, ...rest] = cookie.trim().split('=')
      if (name && rest.length > 0) {
        cookies[name] = rest.join('=')
      }
    }

    const sessionToken = cookies['session']

    if (!sessionToken) {
      return { success: true, data: null }
    }

    const session = await validateSessionToken(sessionToken)

    if (!session) {
      return { success: true, data: null }
    }

    return { success: true, data: session }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get current user session',
    }
  }
}

/**
 * Logout user by revoking their server-side sessions.
 *
 * Stamps the user's `sessionsRevokedAt` watermark to now, which invalidates
 * every session token issued at or before this moment (see validateSessionToken).
 * Clearing the client cookie alone (done by the logout route) is insufficient —
 * a token that was exfiltrated would otherwise stay valid for its full 7-day
 * TTL. Resolving the user from the current session means logout works even
 * though the stateless token carries no server-side session record.
 *
 * No valid session → no-op success (the caller is already effectively logged
 * out). Failures are reported so the route can surface a 500.
 *
 * @param request - Incoming request carrying the session cookie to revoke
 * @returns Success status
 */
export async function logoutUser(request: Request): Promise<ApiResult<void>> {
  try {
    const sessionResult = await getCurrentUserSession(request)
    const userId = sessionResult.success ? sessionResult.data?.userId : undefined

    if (userId) {
      await db.update(users).set({ sessionsRevokedAt: Date.now() }).where(eq(users.id, userId))
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to logout',
    }
  }
}

/**
 * Validate session token and return user session.
 *
 * Security (Story 5-7): the token's HMAC signature is verified before any of
 * its contents are trusted, so forged or tampered cookies are rejected. The
 * subscription status and currency are then read authoritatively from the
 * database by userId — never from the cookie — so a client cannot grant itself
 * premium access, and a stale cookie cannot outlive a downgrade/cancellation.
 */
async function validateSessionToken(token: string): Promise<UserSession | null> {
  try {
    // The cookie value is URL-encoded; decode before signature verification.
    const decodedToken = decodeURIComponent(token)

    // Verify the HMAC signature first. Unsigned, tampered, or wrong-secret
    // tokens return null and are treated as unauthenticated.
    const payload = verifySession(decodedToken)
    if (!payload) {
      // Security signal (possible tampering/forgery) — emitted in prod (warn),
      // but not error, to avoid false error-rate spikes from routine bad cookies.
      logger.warn('Invalid session token: signature verification failed')
      return null
    }

    // Ensure userId is a valid UUID format before querying the database.
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidPattern.test(payload.userId)) {
      logger.debug('Invalid session token: userId is not a valid UUID')
      return null
    }

    // Resolve the authoritative user record. Subscription status and currency
    // come from the database, NOT the cookie (NFR: server-enforced premium).
    // Soft-deleted users are excluded (fail-closed → treated as logged out).
    const matchingUsers = await db
      .select()
      .from(users)
      .where(and(eq(users.id, payload.userId), eq(users.isDeleted, false)))
      .limit(1)

    const user = matchingUsers[0]
    if (!user) {
      logger.debug('Invalid session token: no matching user record')
      return null
    }

    // Server-side revocation (Story 5-8): a token issued at or before the user's
    // revocation watermark is rejected, so logout (and "sign out everywhere")
    // invalidates exfiltrated tokens ahead of their 7-day TTL.
    if (user.sessionsRevokedAt != null && payload.iat <= user.sessionsRevokedAt) {
      // Security signal (token used after logout / "sign out everywhere") —
      // emitted in prod (warn), not error, to avoid false error-rate spikes.
      logger.warn('Invalid session token: issued before session revocation')
      return null
    }

    return {
      userId: user.id,
      email: user.email,
      paddleId: user.paddleId,
      subscriptionStatus: user.subscriptionStatus,
      currency: user.currency ?? 'NONE',
      isAuthenticated: true,
    }
  } catch (error) {
    logger.error('Failed to validate session token', { error })
    return null
  }
}
