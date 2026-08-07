/**
 * Magic-Link Verify Route (Story 5-16, Task 3; hardened in code review 2026-06-29)
 *
 * Endpoint: GET  /api/auth/login/verify?token=<raw token>   → confirmation page
 *           POST /api/auth/login/verify  (token + csrf form fields) → consume + sign in
 *
 * The token is consumed ONLY on the POST, never on the bare GET. This is
 * deliberate (review findings):
 *
 *  - **Email link-scanners / prefetchers** (SafeLinks, Proofpoint, Mimecast,
 *    Gmail) auto-GET links; a state-changing GET would let them burn the
 *    single-use token before the human clicks. The GET here is read-only (peek),
 *    so the token survives scanning.
 *  - **Login CSRF:** the GET sets a double-submit `ml_csrf` cookie and embeds the
 *    matching value in the confirm form; the POST requires they match. A
 *    cross-site auto-POST cannot read/replay that cookie (SameSite=Lax is not
 *    sent on cross-site POST), so an attacker cannot silently sign a victim into
 *    the attacker's account. The page also shows WHICH account it will sign into.
 *
 * On success the POST mints the existing HMAC-signed session (5-7/5-8) with the
 * SAME cookie semantics as the Paddle callback and redirects to `/`. Every
 * failure (invalid/expired/consumed/unknown token, CSRF mismatch, soft-deleted
 * owner, internal error) yields one generic outcome with no session set. No open
 * redirect: the post-login target is hardcoded `/`.
 */

import crypto from 'crypto'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { clientIpForRateLimit } from '@/routes/api/auth/paddle/callback'
import { peekMagicLink, verifyMagicLink } from '@/server/api/auth/magic-link'
import { signSession } from '@/server/api/auth/session'
import { checkDbRateLimit } from '@/server/rate-limit/db-window'
import { createFileRoute } from '@tanstack/react-router'

/** 7-day session lifetime, matching the Paddle callback. */
const SESSION_MAX_AGE = 7 * 24 * 60 * 60
/** CSRF cookie lifetime — aligned with the 15-min token TTL. */
const CSRF_MAX_AGE = 15 * 60
/** Cookie path scopes the CSRF cookie to this endpoint only. */
const CSRF_COOKIE_PATH = '/api/auth/login/verify'
/** Generic failure redirect — identical for every rejection (no enumeration). */
const INVALID_REDIRECT = '/login?error=invalid_or_expired'

// Per-IP limiter on the consuming POST: bounds DB-write churn / amplification on
// the token-consumption endpoint (token guessing itself is infeasible at
// 256-bit). Shared atomic DB store (Story SEC-2) → holds across app instances.
const VERIFY_LIMIT = { windowMs: 60 * 1000, maxAttempts: 10 } as const

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

function secureFlag(): string {
  return isProduction() ? '; Secure' : ''
}

function invalidRedirect(): Response {
  return new Response(null, { status: 302, headers: { Location: INVALID_REDIRECT } })
}

/** Escape untrusted text for safe interpolation into HTML. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string
  )
}

/** Read a single cookie value from the request, or null. */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) {
    return null
  }
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      return rest.join('=')
    }
  }
  return null
}

/** Constant-time string compare (length-guarded so timingSafeEqual never throws). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

function htmlPage(title: string, inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(
    title
  )}</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#111"><h1 style="font-size:1.5rem">Longhand Budget</h1>${inner}</body></html>`
}

function confirmPage(token: string, email: string, csrf: string): string {
  const inner = `<p>You're about to sign in as <strong>${escapeHtml(
    email
  )}</strong>.</p><form method="POST" action="${CSRF_COOKIE_PATH}"><input type="hidden" name="token" value="${escapeHtml(
    token
  )}"><input type="hidden" name="csrf" value="${escapeHtml(
    csrf
  )}"><button type="submit" style="background:#2563eb;color:#fff;border:none;border-radius:.5rem;padding:.6rem 1.2rem;font-size:1rem;cursor:pointer">Sign in to this account</button></form><p style="margin-top:1rem;font-size:.85rem;color:#666">If this isn't you, just close this page — no one is signed in until you click the button.</p>`
  return htmlPage('Confirm sign-in', inner)
}

function invalidPage(): string {
  const inner = `<p>This sign-in link is invalid or has expired.</p><p><a href="/login">Request a new link</a></p>`
  return htmlPage('Link invalid or expired', inner)
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'text/html; charset=utf-8')
  return new Response(body, { ...init, status: init.status ?? 200, headers })
}

/**
 * GET — read-only confirmation interstitial. Peeks the token (no consume) and, if
 * valid, renders a page that POSTs back to consume it, planting a double-submit
 * CSRF cookie. Invalid/expired tokens get a generic page. Never sets a session.
 */
export const GET = async ({ request }: { request: Request }): Promise<Response> => {
  const token = new URL(request.url).searchParams.get('token') ?? ''

  let peeked: Awaited<ReturnType<typeof peekMagicLink>>
  try {
    peeked = await peekMagicLink(token)
  } catch (error) {
    logger.error('Magic-link peek failed', { error })
    captureError(error, { scope: 'magic-link-peek' })
    return htmlResponse(invalidPage())
  }

  if (!peeked) {
    return htmlResponse(invalidPage())
  }

  const csrf = crypto.randomBytes(32).toString('hex')
  return htmlResponse(confirmPage(token, peeked.email, csrf), {
    headers: {
      'Set-Cookie': `ml_csrf=${csrf}; Path=${CSRF_COOKIE_PATH}; HttpOnly; SameSite=Lax${secureFlag()}; Max-Age=${CSRF_MAX_AGE}`,
    },
  })
}

/**
 * POST — the consuming action. Rate-limited per IP, CSRF double-submit checked,
 * then verify+consume the token and mint the signed session, or generic redirect.
 */
export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const ip = clientIpForRateLimit(request)
  if (ip) {
    const limit = await checkDbRateLimit({ scope: 'login-verify', subject: ip, ...VERIFY_LIMIT })
    if (!limit.allowed) {
      return new Response('Too many requests. Please try again later.', { status: 429 })
    }
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return invalidRedirect()
  }

  const token = String(form.get('token') ?? '')
  const csrfField = String(form.get('csrf') ?? '')
  const csrfCookie = readCookie(request, 'ml_csrf')

  // Double-submit CSRF: a cross-site POST cannot carry the same-site ml_csrf
  // cookie (SameSite=Lax), so a mismatch (or missing cookie) is rejected.
  if (!csrfCookie || !csrfField || !safeEqual(csrfCookie, csrfField)) {
    return invalidRedirect()
  }

  let verified: Awaited<ReturnType<typeof verifyMagicLink>>
  try {
    verified = await verifyMagicLink(token)
  } catch (error) {
    logger.error('Magic-link verify failed', { error })
    captureError(error, { scope: 'magic-link-verify' })
    return invalidRedirect()
  }

  if (!verified) {
    return invalidRedirect()
  }

  const sessionToken = signSession({
    userId: verified.userId,
    paddleId: verified.paddleId,
    email: verified.email,
  })

  const headers = new Headers({ Location: '/' })
  headers.append(
    'Set-Cookie',
    `session=${encodeURIComponent(
      sessionToken
    )}; Path=/; HttpOnly; SameSite=Lax${secureFlag()}; Max-Age=${SESSION_MAX_AGE}`
  )
  // Clear the one-time CSRF cookie now that it has served its purpose.
  headers.append(
    'Set-Cookie',
    `ml_csrf=; Path=${CSRF_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`
  )
  return new Response(null, { status: 302, headers })
}

export const Route = createFileRoute('/api/auth/login/verify')({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
})
