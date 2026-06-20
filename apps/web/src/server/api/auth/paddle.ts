/**
 * Paddle Authentication Server Functions
 * 
 * Handles Paddle OAuth authentication and user account management.
 * Implements the Paddle authentication flow for account creation and login.
 * 
 * Architecture: TanStack Start Server Functions with Paddle OAuth
 * Data Sovereignty: All data stored in Scaleway EU region (NFR1, NFR2)
 * Security: No US data residency, Paddle is UK-based
 */

import { getPaddleConfig, type PaddleConfig } from '@budget-planner/config'
import { db } from '@budget-planner/db'
import { users } from '@budget-planner/db/src/schema'
import { eq } from 'drizzle-orm'

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
 */
export interface PaddleUser {
  id: string
  email: string
  name?: string
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
    const redirectUri = encodeURIComponent(`${process.env.SITE_URL || 'http://localhost:5173'}/auth/callback`)
    
    const url = `https://sandbox-paddle.com/oauth2/authorize?` +
      `response_type=code&` +
      `client_id=${paddleConfig.vendorId}&` +
      `redirect_uri=${redirectUri}&` +
      `state=${state}`

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
    const userResponse = await getPaddleUser(tokenResponse.data!.accessToken, paddleConfig)
    
    if (!userResponse.success) {
      return userResponse
    }

    // Create or update user in database
    const session = await createOrUpdateUser(userResponse.data!)
    
    return {
      success: true,
      data: session,
    }
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
    // Check for session cookie or JWT token
    // This is a placeholder - implement actual session management
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    
    if (!token) {
      return {
        success: true,
        data: null,
      }
    }

    // Validate token and get user session
    const session = await validateSessionToken(token)
    
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
 * Logout user by invalidating session
 * 
 * @returns Success status
 */
export async function logoutUser(): Promise<ApiResult<void>> {
  try {
    // Invalidate session cookie or JWT token
    // This is a placeholder - implement actual logout logic
    
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

/**
 * Generate a state token for CSRF protection
 */
function generateStateToken(): string {
  // In production, use crypto.randomUUID() or similar
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15)
}

/**
 * Validate a state token
 */
function validateStateToken(state: string): boolean {
  // In production, validate against stored state
  return state.length > 0
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(
  code: string,
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
 * Get user information from Paddle
 */
async function getPaddleUser(
  accessToken: string,
  paddleConfig: PaddleConfig
): Promise<ApiResult<PaddleUser>> {
  // Placeholder - use Paddle SDK for actual implementation
  // This would call Paddle's user info endpoint
  
  // Simulate user info
  return {
    success: true,
    data: {
      id: 'paddle-user-id',
      email: 'user@example.com',
      name: 'John Doe',
    },
  }
}

/**
 * Create or update user in database
 * Uses Drizzle ORM with Scaleway PostgreSQL (EU region only)
 */
async function createOrUpdateUser(
  paddleUser: PaddleUser
): Promise<UserSession> {
  // Check if user with this paddleId already exists
  const existingUsers = await db
    .select()
    .from(users)
    .where(eq(users.paddleId, paddleUser.id))
    .limit(1)
  
  const existingUser = existingUsers[0]
  
  if (existingUser) {
    // User already exists - return existing session
    return {
      userId: existingUser.id,
      email: existingUser.email,
      paddleId: existingUser.paddleId,
      subscriptionStatus: existingUser.subscriptionStatus as 'free' | 'active' | 'past_due' | 'canceled',
      currency: existingUser.currency,
      isAuthenticated: true,
    }
  }
  
  // Create new user with UUID
  const [newUser] = await db
    .insert(users)
    .values({
      email: paddleUser.email,
      paddleId: paddleUser.id,
      subscriptionStatus: 'free',
      currency: 'NONE',
    })
    .returning()
  
  return {
    userId: newUser.id,
    email: newUser.email,
    paddleId: newUser.paddleId,
    subscriptionStatus: newUser.subscriptionStatus as 'free' | 'active' | 'past_due' | 'canceled',
    currency: newUser.currency,
    isAuthenticated: true,
  }
}

/**
 * Validate session token and return user session
 */
async function validateSessionToken(
  token: string
): Promise<UserSession | null> {
  // Placeholder - implement actual JWT validation
  // This would:
  // 1. Decode and verify JWT signature
  // 2. Check token expiration
  // 3. Return user session if valid
  
  // Simulate validation
  if (token === 'valid-token') {
    return {
      userId: 1,
      email: 'user@example.com',
      paddleId: 'paddle-user-id',
      subscriptionStatus: 'free',
      currency: 'USD',
      isAuthenticated: true,
    }
  }
  
  return null
}
