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

/**
 * Per-IP sliding-window rate limiter for the OAuth callback.
 *
 * The previous implementation kept a single global "last attempt" slot, which
 * (a) limited every caller to one attempt per window regardless of the intended
 * max, and (b) was trivially defeated by alternating two IPs — each request
 * overwrote the other's slot. This keeps an independent attempt log per IP and
 * actually enforces RATE_LIMIT_MAX_ATTEMPTS within the window.
 *
 * Pre-auth there is no authenticated principal, so the client IP (from the
 * platform's forwarded header) is the only available key. In-memory is adequate
 * for a single-instance container; replace with a shared store (e.g. Redis) if
 * the callback is ever horizontally scaled.
 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_ATTEMPTS = 5
const MAX_TRACKED_IPS = 10_000
const callbackAttempts = new Map<string, number[]>()

/** Test-only: clear the in-memory attempt log between cases. */
export function _resetCallbackRateLimiter(): void {
  callbackAttempts.clear()
}

/**
 * Best-effort client IP for pre-auth rate limiting.
 *
 * SECURITY: `x-forwarded-for` is client-supplied and spoofable, so this limiter
 * is defense-in-depth ONLY — the real access control is the signed session +
 * DB-authoritative subscription, never this. We take the RIGHTMOST hop (the
 * entry appended by our immediately-upstream trusted proxy) instead of the raw
 * header: behind a single trusted proxy that appends the real peer IP, a client
 * that pre-seeds a fake `x-forwarded-for` still gets the genuine IP appended to
 * the right. Authoritative rate limiting belongs at the Rapids edge layer (see
 * deferred-work.md).
 *
 * Returns null when no proxy IP is present so the caller SKIPS limiting rather
 * than collapsing every header-less request into one shared bucket (which would
 * globally lock out logins).
 */
export function clientIpForRateLimit(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const rightmost = xff.split(',').pop()?.trim()
    if (rightmost) {
      return rightmost
    }
  }
  return request.headers.get('x-real-ip')?.trim() || null
}

/** Drop every IP bucket whose attempts have all aged out of the window. */
function sweepExpired(windowStart: number): void {
  for (const [key, timestamps] of callbackAttempts) {
    if (timestamps.every((ts) => ts <= windowStart)) {
      callbackAttempts.delete(key)
    }
  }
}

/**
 * Record an attempt for `ip` and report whether it exceeds the window limit.
 * Returns true when the request should be rejected (limit already reached).
 *
 * Exported for unit testing; the route handler is the only production caller.
 */
export function isRateLimited(ip: string, now: number): boolean {
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const recent = (callbackAttempts.get(ip) ?? []).filter((ts) => ts > windowStart)

  if (recent.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    // Persist the pruned list so the window keeps sliding without unbounded growth.
    callbackAttempts.set(ip, recent)
    return true
  }

  // Hard memory bound: a spoofed-IP flood can mint unlimited distinct keys, so
  // before allocating a bucket for a NEW ip at capacity, sweep expired entries;
  // if still full, refuse to track it (degrade open for this request) rather
  // than let the map grow without limit. Already-tracked IPs stay limited.
  if (!callbackAttempts.has(ip) && callbackAttempts.size >= MAX_TRACKED_IPS) {
    sweepExpired(windowStart)
    if (callbackAttempts.size >= MAX_TRACKED_IPS) {
      return false
    }
  }

  recent.push(now)
  callbackAttempts.set(ip, recent)
  return false
}

export const Route = createFileRoute('/api/auth/paddle/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        // Rate limiting (per-IP best-effort, enforces RATE_LIMIT_MAX_ATTEMPTS per
        // window). Skipped when no proxy IP is present so a header-less deploy
        // doesn't lock out every login through one shared bucket.
        const ip = clientIpForRateLimit(request)
        const now = Date.now()
        if (ip && isRateLimited(ip, now)) {
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
