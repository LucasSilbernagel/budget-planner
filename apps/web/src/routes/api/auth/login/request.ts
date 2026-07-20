/**
 * Magic-Link Request Route (Story 5-16, Task 2)
 *
 * Endpoint: POST /api/auth/login/request  body: { email: string }
 *
 * Emails a single-use sign-in link to an EXISTING account. The response is an
 * identical generic 200 whether or not the email matches, whether or not a send
 * succeeds, and whether or not the per-email limit was hit — so the endpoint
 * never reveals account existence (AC-1). Account creation is NOT possible here
 * (signup is Paddle Billing checkout, Story 5-3).
 *
 * Rate limited per IP (burst control) and per email (anti email-bombing), both
 * via the shared atomic DB-backed limiter (Story SEC-2), so the limits hold
 * across app instances. Authoritative enforcement belongs at the Rapids edge
 * (deferred-work.md).
 */

import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { clientIpForRateLimit } from '@/routes/api/auth/paddle/callback'
import { requestMagicLink } from '@/server/api/auth/magic-link'
import { checkDbRateLimit } from '@/server/rate-limit/db-window'
import { getSiteUrl } from '@budget-planner/config'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/** RFC 5321 max email length — bound the limiter key before using it. */
const MAX_EMAIL_LENGTH = 254

// Per-IP: short burst window mirroring the Paddle callback.
const IP_LIMIT = { windowMs: 60 * 1000, maxAttempts: 5 } as const
// Per-email: a wider window so one address cannot be mail-bombed with links.
const EMAIL_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 5 } as const

/** The single generic success body — identical for every non-error outcome. */
const GENERIC_OK = { success: true } as const

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const now = Date.now()

  // Per-IP burst limit (best-effort; skipped when no trustworthy proxy IP is
  // present so a header-less deploy doesn't collapse every caller into one
  // shared bucket).
  const ip = clientIpForRateLimit(request)
  if (ip) {
    const ipLimit = await checkDbRateLimit({ scope: 'ip', subject: ip, now, ...IP_LIMIT })
    if (!ipLimit.allowed) {
      return json(
        { success: false, error: 'Too many requests. Please try again later.' },
        {
          status: 429,
        }
      )
    }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ success: false, error: 'Invalid request body' }, { status: 400 })
  }

  const email = (body as { email?: unknown } | null)?.email
  if (typeof email !== 'string') {
    return json({ success: false, error: 'Email is required' }, { status: 400 })
  }

  // Normalize + bound BEFORE using as a rate-limit map key: a blank email would
  // skip the per-email limiter entirely, and an unbounded string would be a
  // memory-amplification key. Out-of-range values get the generic 200 (no work,
  // no enumeration) — the full shape check still runs inside requestMagicLink.
  const emailKey = email.trim().toLowerCase()
  if (!emailKey || emailKey.length > MAX_EMAIL_LENGTH) {
    return json(GENERIC_OK)
  }

  // Per-email throttle (never skippable — the email key always applies, even
  // when the IP was unknown). On exceed we still return the generic 200 (no
  // send, no enumeration) rather than a distinguishable status.
  const emailLimit = await checkDbRateLimit({
    scope: 'email',
    subject: emailKey,
    now,
    ...EMAIL_LIMIT,
  })
  if (!emailLimit.allowed) {
    return json(GENERIC_OK)
  }

  // Fire-and-forget so the response time does NOT depend on whether the email
  // matches an account: a known email triggers a DB insert + outbound send, an
  // unknown one returns after a lookup — awaiting that would leak existence via
  // latency despite the identical body. The send still runs; failures are logged,
  // never surfaced. `getSiteUrl()` fails closed in production (misconfig → 500),
  // which is a deploy-wide signal, not a per-email enumeration channel.
  const siteUrl = getSiteUrl()
  void requestMagicLink(email, siteUrl).catch((error) => {
    logger.error('Magic-link request failed', { error })
    captureError(error, { scope: 'magic-link-request' })
  })

  return json(GENERIC_OK)
}

export const Route = createFileRoute('/api/auth/login/request')({
  server: {
    handlers: {
      POST,
    },
  },
})
