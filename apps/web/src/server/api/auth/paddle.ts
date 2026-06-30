/**
 * Paddle Authentication Server Functions
 *
 * Handles Paddle OAuth authentication and user account management.
 * Implements the Paddle authentication flow for account creation and login.
 *
 * Architecture: TanStack Start Server Functions with Paddle OAuth
 * Data Sovereignty: All data stored in DanubeData (Germany - EU) (NFR1, NFR2)
 * Security: No US data residency, Paddle is UK-based, DanubeData is Germany-based
 */

import crypto from 'crypto'
import { logger } from '@/lib/logger'
import { type PaddleConfig, getPaddleConfig } from '@budget-planner/config'
import { db } from '@budget-planner/db'
import { users } from '@budget-planner/db/src/schema'
import { and, eq } from 'drizzle-orm'
import { createDefaultProfileForUser } from '../../functions/profiles'
import { verifySession } from './session'

/**
 * Result type for API responses
 */
export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Paddle user information from OAuth response
 * Includes subscription status for proper user record creation
 */
export interface PaddleUser {
  id: string
  email: string
  name?: string
  subscriptionStatus?: 'free' | 'active' | 'past_due' | 'canceled'
  currency?: string
}

/**
 * User session information
 * userId matches the UUID type from database schema (Story 4-2)
 */
export interface UserSession {
  userId: string
  email: string
  paddleId: string
  subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled'
  currency: string
  isAuthenticated: boolean
  name?: string
}

/**
 * Generate Paddle OAuth URL for authentication
 *
 * @returns Paddle OAuth URL or error
 */
export async function generatePaddleAuthUrl(): Promise<ApiResult<{ url: string }>> {
  try {
    const paddleConfig = getPaddleConfig()

    if (!paddleConfig.isConfigured) {
      return {
        success: false,
        error: 'Paddle is not configured. Vendor ID, API Key, and Public Key are required.',
      }
    }

    // Construct Paddle OAuth URL
    // This is a placeholder - actual implementation requires Paddle SDK
    const state = generateStateToken()
    const redirectUri = encodeURIComponent(
      `${process.env.SITE_URL || 'http://localhost:5173'}/auth/callback`
    )

    const url = `https://sandbox-paddle.com/oauth2/authorize?response_type=code&client_id=${paddleConfig.vendorId}&redirect_uri=${redirectUri}&state=${state}`

    return {
      success: true,
      data: { url },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate Paddle auth URL',
    }
  }
}

/**
 * Handle Paddle OAuth callback
 * Exchanges authorization code for access token and user information
 *
 * @param code - Authorization code from Paddle
 * @param state - State token for CSRF protection
 * @returns User session information
 */
export async function handlePaddleCallback(
  code: string,
  state: string
): Promise<ApiResult<UserSession>> {
  try {
    const paddleConfig = getPaddleConfig()

    if (!paddleConfig.isConfigured) {
      return {
        success: false,
        error: 'Paddle is not configured',
      }
    }

    // Validate state token (placeholder - implement actual validation)
    if (!validateStateToken(state)) {
      return {
        success: false,
        error: 'Invalid state token',
      }
    }

    // Exchange code for token (placeholder - use Paddle SDK)
    const tokenResponse = await exchangeCodeForToken(code, paddleConfig)

    if (!tokenResponse.success) {
      return tokenResponse
    }

    // Get user information from Paddle
    const userResponse = await getPaddleUser(tokenResponse.data?.accessToken, paddleConfig)

    if (!userResponse.success) {
      return userResponse
    }

    if (!userResponse.data) {
      return { success: false, error: 'Paddle user data missing from authentication response' }
    }

    // Create or update user in DanubeData PostgreSQL (Germany - EU)
    const userResult = await createOrUpdateUser(userResponse.data)

    if (!userResult.success) {
      return userResult
    }

    return userResult
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to handle Paddle callback',
    }
  }
}

/**
 * Get current user session from request
 * Uses cookies or JWT tokens for session management
 *
 * @param request - Incoming request object
 * @returns User session or null if not authenticated
 */
export async function getCurrentUserSession(
  request: Request
): Promise<ApiResult<UserSession | null>> {
  try {
    // Check for session cookie
    // Session is stored in 'session' cookie as JSON string
    const cookieHeader = request.headers.get('cookie')

    if (!cookieHeader) {
      return {
        success: true,
        data: null,
      }
    }

    // Parse cookies from header
    const cookies: Record<string, string> = {}
    for (const cookie of cookieHeader.split(';')) {
      const [name, ...rest] = cookie.trim().split('=')
      if (name && rest.length > 0) {
        cookies[name] = rest.join('=')
      }
    }

    const sessionToken = cookies.session

    if (!sessionToken) {
      return {
        success: true,
        data: null,
      }
    }

    // Validate token and get user session
    const session = await validateSessionToken(sessionToken)

    if (!session) {
      return {
        success: true,
        data: null,
      }
    }

    return {
      success: true,
      data: session,
    }
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

    return {
      success: true,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to logout',
    }
  }
}

// ============================================================================
// Helper functions (placeholder implementations)
// ============================================================================

/** A CSRF state token is 32 random bytes rendered as 64 lowercase hex chars. */
const STATE_TOKEN_PATTERN = /^[0-9a-f]{64}$/

/**
 * Generate a CSRF state token.
 *
 * Uses `crypto.randomBytes` (CSPRNG), not `Math.random()`, so the value is
 * unpredictable and cannot be guessed by an attacker constructing a forged
 * callback.
 */
export function generateStateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Validate a CSRF state token's shape.
 *
 * Enforces the exact CSPRNG format (64 hex chars), which rejects empty,
 * malformed, or low-entropy values — a strict improvement over the previous
 * `state.length > 0`.
 *
 * NOTE (Story 5.8): full CSRF protection also requires binding the issued state
 * to the user agent (e.g. a short-lived `HttpOnly` state cookie set when the
 * auth URL is generated and compared here). That round-trip is intentionally
 * deferred until the real Paddle SDK login flow replaces the current placeholder
 * (`generatePaddleAuthUrl` builds a fake `sandbox-paddle.com` URL and the
 * auth-url route has no client caller), at which point the stored-state compare
 * lands in the live callback. Tracked in deferred-work.md.
 */
export function validateStateToken(state: string): boolean {
  return STATE_TOKEN_PATTERN.test(state)
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(
  _code: string,
  paddleConfig: PaddleConfig
): Promise<ApiResult<{ accessToken: string; refreshToken: string }>> {
  // Placeholder - use Paddle SDK for actual implementation
  // This would call Paddle's OAuth token endpoint

  if (!paddleConfig.apiKey || !paddleConfig.vendorId) {
    return {
      success: false,
      error: 'Paddle credentials not configured',
    }
  }

  // Simulate token exchange
  return {
    success: true,
    data: {
      accessToken: 'placeholder-token',
      refreshToken: 'placeholder-refresh-token',
    },
  }
}

/**
 * Max retry attempts for Paddle API calls
 */
const MAX_RETRY_ATTEMPTS = 3

/**
 * Retry delay in milliseconds
 */
const RETRY_DELAY_MS = 1000

/**
 * Get user information from Paddle
 * Uses Paddle API to fetch user details including subscription status
 * Includes retry logic for transient failures
 *
 * Paddle API Endpoint: GET /users/me
 * Returns: User details including subscription information
 */
async function getPaddleUser(
  _accessToken: string,
  paddleConfig: PaddleConfig
): Promise<ApiResult<PaddleUser>> {
  // Validate credentials first
  if (!paddleConfig.apiKey || !paddleConfig.vendorId) {
    return {
      success: false,
      error: 'Paddle API credentials not configured',
    }
  }

  // Determine API base URL based on environment
  const apiBaseUrl =
    paddleConfig.environment === 'sandbox'
      ? 'https://sandbox-vendors.paddle.com'
      : 'https://vendors.paddle.com'

  let lastError: Error | undefined

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      // Get user information from Paddle API
      // Paddle API v2: GET /users/me returns authenticated user details
      const response = await fetch(`${apiBaseUrl}/api/2.0/users/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${paddleConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        lastError = new Error(errorData.error?.message || `Paddle API error: ${response.status}`)

        // Retry on 429 (rate limit) and 5xx errors
        if (response.status === 429 || response.status >= 500) {
          logger.error('Paddle API attempt failed, retrying', { attempt, error: lastError.message })
          if (attempt < MAX_RETRY_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
            continue
          }
        }

        return {
          success: false,
          error: lastError.message,
        }
      }

      const userData = await response.json()

      // Validate required fields
      if (!userData.id && !userData.user_id) {
        return {
          success: false,
          error: 'Paddle user ID is missing from API response',
        }
      }

      if (!userData.email) {
        return {
          success: false,
          error: 'Paddle user email is missing from API response',
        }
      }

      // Map Paddle response to our PaddleUser interface
      // Paddle API returns user details with subscription information
      const paddleUser: PaddleUser = {
        id: userData.id || userData.user_id,
        email: userData.email,
        name: userData.name,
        // Extract subscription status from Paddle user data
        // Paddle user objects include a 'subscriptions' array
        // For users with active subscriptions, status will be 'active'
        subscriptionStatus: mapPaddleSubscriptionStatus(userData),
        currency: userData.currency_code || userData.currency,
      }

      return {
        success: true,
        data: paddleUser,
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      logger.error('Paddle API attempt failed', { attempt, error: lastError.message })

      // Retry on network errors
      if (attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
        continue
      }

      // After all retries, fail - do NOT return placeholder user in production
      logger.error('Paddle API: All retry attempts failed')
      return {
        success: false,
        error: `Paddle API unavailable after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError.message}`,
      }
    }
  }

  // This should never be reached, but just in case
  return {
    success: false,
    error: 'Paddle API request failed',
  }
}

/**
 * Map Paddle API subscription data to our subscription status
 *
 * Paddle API returns user with subscriptions array
 * Each subscription has a status field
 * @param userData - Raw user data from Paddle API
 * @returns Mapped subscription status
 */
function mapPaddleSubscriptionStatus(userData: {
  subscriptions?: Array<{ status?: string }>
}): 'free' | 'active' | 'past_due' | 'canceled' {
  // Check if user has any active subscriptions
  const subscriptions = userData.subscriptions || []

  if (subscriptions.length === 0) {
    // No subscriptions - free tier or trial
    return 'free'
  }

  // Find the first valid subscription with a status
  for (const subscription of subscriptions) {
    if (subscription && typeof subscription === 'object') {
      const status = subscription.status?.toLowerCase()

      if (!status) {
        continue // Skip subscriptions without status
      }

      // Map Paddle status to our enum
      // Paddle uses: active, past_due, canceled, trialing
      switch (status) {
        case 'active':
        case 'trialing':
          return 'active'
        case 'past_due':
          return 'past_due'
        case 'canceled':
        case 'cancelled':
          return 'canceled'
        default:
          // Unknown status - continue to next subscription
          continue
      }
    }
  }

  // If no valid subscription found, default to free
  return 'free'
}

/**
 * Create or update user in database
 * Uses Drizzle ORM with DanubeData PostgreSQL (Germany - EU only)
 */
async function createOrUpdateUser(paddleUser: PaddleUser): Promise<ApiResult<UserSession>> {
  try {
    // Validate email format and length
    if (!paddleUser.email || typeof paddleUser.email !== 'string') {
      return {
        success: false,
        error: 'Invalid email from Paddle authentication',
      }
    }

    // RFC 5321: max 254 characters
    if (paddleUser.email.length > 254) {
      return {
        success: false,
        error: 'Email address too long',
      }
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(paddleUser.email)) {
      return {
        success: false,
        error: 'Invalid email format',
      }
    }

    // Validate paddleId
    if (!paddleUser.id || typeof paddleUser.id !== 'string') {
      return {
        success: false,
        error: 'Invalid Paddle user ID',
      }
    }

    // Check if user with this paddleId already exists
    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.paddleId, paddleUser.id))
      .limit(1)

    const existingUser = existingUsers[0]

    if (existingUser) {
      // User already exists - update subscriptionStatus and currency from Paddle if they differ
      // This ensures we have the latest subscription data from Paddle
      if (
        existingUser.subscriptionStatus !== paddleUser.subscriptionStatus ||
        existingUser.currency !== paddleUser.currency
      ) {
        await db
          .update(users)
          .set({
            subscriptionStatus: paddleUser.subscriptionStatus || existingUser.subscriptionStatus,
            currency: paddleUser.currency || existingUser.currency,
          })
          .where(eq(users.paddleId, paddleUser.id))
      }

      return {
        success: true,
        data: {
          userId: existingUser.id,
          email: existingUser.email,
          paddleId: existingUser.paddleId,
          subscriptionStatus: (paddleUser.subscriptionStatus || existingUser.subscriptionStatus) as
            | 'free'
            | 'active'
            | 'past_due'
            | 'canceled',
          currency: paddleUser.currency || existingUser.currency,
          isAuthenticated: true,
          name: paddleUser.name,
        },
      }
    }

    // Create new user with UUID and proper subscription status from Paddle
    // AC-2: subscriptionStatus must be set appropriately for Paddle-created users
    const [newUser] = await db
      .insert(users)
      .values({
        email: paddleUser.email,
        paddleId: paddleUser.id,
        // Use subscriptionStatus from Paddle if available, otherwise default to 'active'
        // This addresses Acceptance Auditor Finding #4: subscriptionStatus should be 'active' for Paddle users
        subscriptionStatus: paddleUser.subscriptionStatus || 'active',
        currency: paddleUser.currency || 'NONE',
      })
      .returning()

    // Create default profile for the new user
    const defaultProfileResult = await createDefaultProfileForUser(newUser.id)

    // Log any profile creation errors but don't fail user creation
    if (!defaultProfileResult.success) {
      logger.error('Failed to create default profile', { error: defaultProfileResult.error })
    }

    return {
      success: true,
      data: {
        userId: newUser.id,
        email: newUser.email,
        paddleId: newUser.paddleId,
        subscriptionStatus: newUser.subscriptionStatus,
        currency: newUser.currency,
        isAuthenticated: true,
        name: paddleUser.name,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create or update user',
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
