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

import { logger } from '@/lib/logger'
import { handlePaddleCallback } from '@/server/api/auth/paddle'
import { signSession } from '@/server/api/auth/session'
import { checkDbRateLimit } from '@/server/rate-limit/db-window'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/**
 * Per-IP rate limit for the OAuth callback: 5 attempts / 60s.
 *
 * Backed by the shared atomic DB store (Story SEC-2), so the limit holds across
 * app instances — pre-auth there is no principal, so the client IP is the only
 * key. Authoritative enforcement still belongs at the Rapids edge (deferred-work.md).
 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_ATTEMPTS = 5

/**
 * Number of trusted proxy hops the platform edge appends to the RIGHT of
 * X-Forwarded-For.
 *
 * DEFAULT 0 = trust the rightmost hop — the entry our immediately-upstream proxy
 * appends, which under this app's single-append-proxy topology is the real peer
 * IP (matching the long-standing behavior). Because the proxy appends AFTER any
 * client-supplied entries, a client that prepends forged hops cannot control the
 * rightmost value. Set `RATE_LIMIT_TRUSTED_PROXY_HOPS` to N>0 only if the edge is
 * known to append N of its OWN hops on the right (e.g. a Knative internal chain),
 * so the real client IP is read N entries in from the right. The exact count is
 * platform-specific — confirm against Rapids before overriding (pairs with 5-2).
 */
function trustedProxyHops(): number {
  const raw = Number.parseInt(process.env['RATE_LIMIT_TRUSTED_PROXY_HOPS'] ?? '', 10)
  return Number.isInteger(raw) && raw >= 0 ? raw : 0
}

/** Max plausible length of an IP literal (IPv6 + zone-id headroom). */
const MAX_IP_LENGTH = 64

/**
 * Best-effort client IP for pre-auth rate limiting.
 *
 * SECURITY: `x-forwarded-for` is client-supplied, so this is defense-in-depth
 * ONLY — real access control is the signed session + DB-authoritative
 * subscription, never this.
 *
 * We read the hop `trustedProxyHops()` positions in from the RIGHT (default 0 =
 * rightmost, the value our upstream proxy appends). Indexing from the right means
 * a client PREPENDING forged entries cannot shift which hop we read — the
 * forgeries land further left and are ignored. An implausibly long value (not an
 * IP) is rejected so it can't become a giant rate-limit key / oversized index
 * entry. When no trustworthy hop can be derived we fall through (→ x-real-ip,
 * else null) rather than trust a forgeable value.
 *
 * Returns null when no trustworthy proxy IP is present so the caller SKIPS
 * limiting rather than collapsing every header-less request into one shared
 * bucket (which would globally lock out logins).
 */
export function clientIpForRateLimit(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean)
    const idx = hops.length - 1 - trustedProxyHops()
    const clientHop = idx >= 0 ? hops[idx] : undefined
    if (clientHop && clientHop.length <= MAX_IP_LENGTH) {
      return clientHop
    }
    if (hops.length > 0) {
      // XFF present but yielded no trustworthy hop (too short for the configured
      // trusted-hop count, or an implausibly long value). Observe rather than
      // silently disabling limiting (AC-5); debug level so a flood of forged
      // headers can't itself become a log-amplification vector. Falls through so
      // the caller still applies any other key (e.g. email) and skips IP limiting.
      logger.debug('[RateLimit] x-forwarded-for present but no trusted client hop', {
        hopCount: hops.length,
      })
    }
  }
  const realIp = request.headers.get('x-real-ip')?.trim()
  return realIp && realIp.length <= MAX_IP_LENGTH ? realIp : null
}

export const GET = async ({ request }: { request: Request }): Promise<Response> => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  // Rate limiting (per-IP best-effort, 5/60s via the shared atomic DB store).
  // Skipped when no trustworthy proxy IP is present so a header-less deploy
  // doesn't lock out every login through one shared bucket.
  const ip = clientIpForRateLimit(request)
  if (ip) {
    const limit = await checkDbRateLimit({
      scope: 'paddle-cb',
      subject: ip,
      windowMs: RATE_LIMIT_WINDOW_MS,
      maxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
    })
    if (!limit.allowed) {
      return json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }
  }

  // Validate code parameter
  if (!code) {
    return json({ success: false, error: 'Authorization code is required' }, { status: 400 })
  }

  // Validate code format (should be a non-empty string, typically alphanumeric)
  if (typeof code !== 'string' || code.length < 10 || code.length > 200) {
    return json({ success: false, error: 'Invalid authorization code format' }, { status: 400 })
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
  const isProduction = process.env['NODE_ENV'] === 'production'
  const sessionToken = signSession({
    userId: result.data.userId,
    paddleId: result.data.paddleId,
    email: result.data.email,
  })

  const maxAge = 7 * 24 * 60 * 60 // 7 days
  const secureFlag = isProduction ? '; Secure' : ''

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `session=${encodeURIComponent(
        sessionToken
      )}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=${maxAge}`,
    },
  })
}

export const Route = createFileRoute('/api/auth/paddle/callback')({
  server: {
    handlers: {
      GET,
    },
  },
})
