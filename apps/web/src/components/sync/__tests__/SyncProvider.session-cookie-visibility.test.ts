/**
 * Cross-device sync data-loss reproduction (Story 53.1, FR85, AC-1/AC-2/AC-5;
 * tightened in code review — see the story's Review Findings for what the
 * first version of this file overclaimed).
 *
 * Reproduces the confirmed root cause WITHOUT the jsdom `document.cookie`
 * write that `SyncProvider.test.tsx` (Story 5-15) uses to simulate an
 * authenticated browser. That write is not representative of a real browser:
 * jsdom's `document.cookie` has no `HttpOnly` enforcement, so a test that sets
 * `document.cookie = 'session=...'` directly can never fail the way a real
 * browser would, and it is exactly what let the original defect ship
 * undetected (the story's own investigation named this).
 *
 * This file instead:
 *  1. Drives the REAL `POST /api/auth/login/verify` route handler (same
 *     approach as `verify.route.test.ts`) to get the actual `Set-Cookie`
 *     headers production code emits.
 *  2. Asserts the ONE fact about PRODUCTION code that this whole story rests
 *     on: the `session` cookie is `HttpOnly` and the `has_session` marker is
 *     not — this is the single load-bearing check against real code.
 *  3. Derives what a real browser's `document.cookie` would then contain, per
 *     the standard (RFC 6265 / WHATWG Fetch): an `HttpOnly` cookie is stored
 *     by the browser and sent on requests, but never exposed to script via
 *     `document.cookie`. Applying that FIXED, cited rule to the fact proven
 *     in step 2 is what step 4 checks — it is a consequence of step 2, not an
 *     independent claim about production code, and the test below says so.
 *  4. Feeds that derived value into the REAL, exported
 *     `SyncProvider.hasProbableSession`.
 *
 * ⚠️ Do not read the `simulateDocumentCookie` filter itself as evidence about
 * production code — it encodes the browser's fixed HttpOnly rule, which is
 * not under test. The only assertions here that can fail because of a
 * production-code regression are the ones checking the RAW `Set-Cookie`
 * headers (step 2) and the final `hasProbableSession` call (step 4).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkDbRateLimit, buckets } = vi.hoisted(() => {
  const buckets = new Map<string, number>()
  const checkDbRateLimit = vi.fn(async ({ scope, subject }: { scope: string; subject: string }) => {
    const key = `${scope}:${subject}`
    const count = (buckets.get(key) ?? 0) + 1
    buckets.set(key, count)
    return { allowed: true, remaining: 999 - count }
  })
  return { checkDbRateLimit, buckets }
})

vi.mock('@/server/rate-limit/db-window', () => ({ checkDbRateLimit }))
vi.mock('@/server/api/auth/magic-link', () => ({
  peekMagicLink: vi.fn(),
  verifyMagicLink: vi.fn(),
}))

import { GET, POST } from '@/routes/api/auth/login/verify'
import { peekMagicLink, verifyMagicLink } from '@/server/api/auth/magic-link'
import { hasProbableSession } from '../SyncProvider'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  buckets.clear()
})

/**
 * Apply the browser's own, FIXED rule for `document.cookie` visibility to a
 * set of real `Set-Cookie` response headers: every cookie EXCEPT one flagged
 * `HttpOnly`. This is not something under test — it models the browser's
 * behavior, not this codebase's.
 */
function simulateDocumentCookie(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .filter((header) => !/;\s*HttpOnly/i.test(header))
    .map((header) => header.split(';')[0])
    .join('; ')
}

async function signInAndGetSetCookieHeaders(): Promise<string[]> {
  asMock(peekMagicLink).mockResolvedValueOnce({ email: 'user@example.com' })
  const getRes = await GET({
    request: new Request('https://app.test/api/auth/login/verify?token=good-token'),
  })
  const csrfMatch = (getRes.headers.get('Set-Cookie') ?? '').match(/ml_csrf=([^;]*)/)
  const csrf = csrfMatch?.[1] ?? ''

  asMock(verifyMagicLink).mockResolvedValueOnce({
    userId: '11111111-1111-1111-1111-111111111111',
    paddleId: 'pad_1',
    email: 'user@example.com',
  })
  const postRes = await POST({
    request: new Request('https://app.test/api/auth/login/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `ml_csrf=${csrf}` },
      body: new URLSearchParams({ token: 'good-token', csrf }),
    }),
  })
  return postRes.headers.getSetCookie()
}

describe('cross-device sync data-loss repro: real Set-Cookie -> simulated document.cookie', () => {
  it('LOAD-BEARING: the real session cookie is HttpOnly and the has_session marker is not — this is the fact the rest of this file derives from', async () => {
    const setCookieHeaders = await signInAndGetSetCookieHeaders()

    const sessionHeader = setCookieHeaders.find((h) => h.startsWith('session='))
    const hasSessionHeader = setCookieHeaders.find((h) => h.startsWith('has_session='))

    expect(sessionHeader).toBeDefined()
    expect(sessionHeader).toMatch(/;\s*HttpOnly/i)
    expect(hasSessionHeader).toBeDefined()
    expect(hasSessionHeader).not.toMatch(/;\s*HttpOnly/i)
  })

  it("DERIVED: applying the browser's fixed HttpOnly rule to that fact, only has_session would ever reach document.cookie in a real browser", async () => {
    const setCookieHeaders = await signInAndGetSetCookieHeaders()
    const simulated = simulateDocumentCookie(setCookieHeaders)

    // Anchored: `has_session=` itself contains the substring "session=", so a
    // plain toContain check would pass for the wrong reason.
    expect(/(?:^|;\s*)session=/.test(simulated)).toBe(false)
    expect(simulated).toContain('has_session=1')
  })

  it('DERIVED: SyncProvider.hasProbableSession is TRUE against that real post-login browser cookie jar', async () => {
    const setCookieHeaders = await signInAndGetSetCookieHeaders()
    const simulated = simulateDocumentCookie(setCookieHeaders)

    expect(hasProbableSession(simulated)).toBe(true)
  })
})
