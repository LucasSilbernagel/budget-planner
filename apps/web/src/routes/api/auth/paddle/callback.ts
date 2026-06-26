/**
 * Paddle Authentication - Callback Handler
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Handles Paddle OAuth callback after user authentication
 *
 * Endpoint: GET /api/auth/paddle/callback
 *
 * Flow:
 * 1. User authenticates with Paddle
 * 2. Paddle redirects to this endpoint with authorization code
 * 3. We exchange code for access token
 * 4. We fetch user information from Paddle
 * 5. We create/update user in DanubeData PostgreSQL
 * 6. We create session and set cookies
 * 7. We redirect user to appropriate page
 *
 * Data Sovereignty: User data stored in DanubeData (Germany - EU) (NFR1, NFR2)
 * Security: State token validation, HTTP-only cookies, Secure flag in production
 */

import { handlePaddleCallback } from '@/server/api/auth/paddle'
import { signSession } from '@/server/api/auth/session'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

// Rate limiting state (simple in-memory for now - replace with Redis in production)
let lastCallbackAttempt: { timestamp: number; ip: string } | null = null
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const _RATE_LIMIT_MAX_ATTEMPTS = 5

export const Route = createFileRoute('/api/auth/paddle/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const ip =
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

        // Rate limiting
        const now = Date.now()
        if (
          lastCallbackAttempt &&
          ip === lastCallbackAttempt.ip &&
          now - lastCallbackAttempt.timestamp < RATE_LIMIT_WINDOW_MS
        ) {
          return json(
            { success: false, error: 'Too many requests. Please try again later.' },
            { status: 429 }
          )
        }

        // Validate code parameter
        if (!code) {
          return json({ success: false, error: 'Authorization code is required' }, { status: 400 })
        }

        // Validate code format (should be a non-empty string, typically alphanumeric)
        if (typeof code !== 'string' || code.length < 10 || code.length > 200) {
          return json(
            { success: false, error: 'Invalid authorization code format' },
            { status: 400 }
          )
        }

        // Validate state parameter (required for CSRF protection)
        if (!state) {
          return json(
            { success: false, error: 'State parameter is required for security' },
            { status: 400 }
          )
        }

        // Validate state format
        if (typeof state !== 'string' || state.length < 10 || state.length > 100) {
          return json({ success: false, error: 'Invalid state parameter format' }, { status: 400 })
        }

        // Update rate limiting state
        lastCallbackAttempt = { timestamp: now, ip }

        const result = await handlePaddleCallback(code, state)

        if (!result.success) {
          return json({ success: false, error: result.error }, { status: 400 })
        }

        // Create secure session cookie.
        // The cookie carries an HMAC-signed identity token (Story 5-7), NOT raw JSON,
        // so it cannot be forged or tampered with. Subscription status and currency
        // are intentionally NOT embedded — they are resolved authoritatively from the
        // database on each request in validateSessionToken().
        const isProduction = process.env.NODE_ENV === 'production'
        const sessionToken = signSession({
          userId: result.data.userId,
          paddleId: result.data.paddleId,
          email: result.data.email,
        })

        const maxAge = 7 * 24 * 60 * 60 // 7 days
        const secureFlag = isProduction ? '; Secure' : ''

        const response = new Response(null, {
          status: 302,
          headers: {
            Location: '/',
            'Set-Cookie': `session=${encodeURIComponent(
              sessionToken
            )}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=${maxAge}`,
          },
        })

        return response
      },
    },
  },
})
