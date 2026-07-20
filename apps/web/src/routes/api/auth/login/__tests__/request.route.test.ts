/**
 * Magic-link REQUEST route tests (Story 5-16 → DB-backed limiter in Story SEC-2)
 *
 * The endpoint must:
 *  - return an IDENTICAL response whether or not the email matches an account
 *    (no enumeration) — including when the underlying send fails;
 *  - rate-limit per IP and per email through the shared atomic DB store, with the
 *    exact preserved windows/maxima (IP 5/60s, email 5/15min — AC-2);
 *  - keep the email limit un-skippable even when the IP is unknown (AC-3);
 *  - never create an account (delegated to requestMagicLink, mocked here).
 *
 * `checkDbRateLimit` is mocked to a stateful in-memory counter (no database) that
 * honours the scope/subject/maxAttempts each call site passes, so the emergent
 * 429 / throttle behaviour is still exercised end-to-end through the route.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkDbRateLimit, buckets } = vi.hoisted(() => {
  const buckets = new Map<string, number>()
  const checkDbRateLimit = vi.fn(
    async ({
      scope,
      subject,
      maxAttempts,
    }: {
      scope: string
      subject: string
      maxAttempts: number
    }) => {
      const key = `${scope}:${subject}`
      const count = (buckets.get(key) ?? 0) + 1
      buckets.set(key, count)
      return { allowed: count <= maxAttempts, remaining: Math.max(0, maxAttempts - count) }
    }
  )
  return { checkDbRateLimit, buckets }
})

vi.mock('@/server/rate-limit/db-window', () => ({ checkDbRateLimit }))
vi.mock('@/server/api/auth/magic-link', () => ({
  requestMagicLink: vi.fn().mockResolvedValue(undefined),
}))

import { requestMagicLink } from '@/server/api/auth/magic-link'
import { POST } from '../request'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

// With the default trusted-hop count (0 = rightmost), the proxy-appended value is
// the rightmost XFF entry, so a single value resolves to the client IP.
const CLIENT_IP = { 'x-forwarded-for': '203.0.113.5' }

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST({
    request: new Request('https://app.test/api/auth/login/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  buckets.clear()
  asMock(requestMagicLink).mockResolvedValue(undefined)
})

describe('POST /api/auth/login/request', () => {
  it('returns the same generic 200 for a known and an unknown email (no enumeration)', async () => {
    const known = await post({ email: 'known@example.com' })
    const unknown = await post({ email: 'ghost@example.com' })

    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(await known.clone().json()).toEqual(await unknown.clone().json())
    // Delegated to the orchestration layer with the configured origin.
    expect(requestMagicLink).toHaveBeenCalledWith('known@example.com', 'https://app.test')
  })

  it('still returns the generic 200 when the send throws (failure is not observable)', async () => {
    asMock(requestMagicLink).mockRejectedValueOnce(new Error('mailer down'))
    const res = await post({ email: 'known@example.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })

  it('400s when the email field is missing or not a string', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ email: 123 })).status).toBe(400)
    expect(requestMagicLink).not.toHaveBeenCalled()
  })

  it('400s on an unparseable body', async () => {
    expect((await post('not json{')).status).toBe(400)
  })

  it('returns the generic 200 for a blank or over-long email without sending or unbounded keys', async () => {
    const blank = await post({ email: '   ' })
    const huge = await post({ email: `${'a'.repeat(300)}@x.com` })
    expect(blank.status).toBe(200)
    expect(huge.status).toBe(200)
    // Neither reaches the orchestration layer (no send, no work).
    expect(requestMagicLink).not.toHaveBeenCalled()
  })

  it('rate-limits per IP through the shared store (429 after 5/60s from one IP)', async () => {
    let last: Response | undefined
    for (let i = 0; i < 6; i++) {
      last = await post({ email: `u${i}@example.com` }, CLIENT_IP)
    }
    expect(last?.status).toBe(429)
    // AC-2: exact preserved IP window/max, keyed by the resolved client IP.
    expect(checkDbRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'ip',
        subject: '203.0.113.5',
        windowMs: 60_000,
        maxAttempts: 5,
      })
    )
  })

  it('rate-limits per email (stops sending for one address) while staying generic 200', async () => {
    let last: Response | undefined
    for (let i = 0; i < 7; i++) {
      last = await post({ email: 'spammed@example.com' })
    }
    expect(last?.status).toBe(200)
    // Sending stopped after the per-email max (5), so not all 7 reached the sender.
    expect(asMock(requestMagicLink).mock.calls.length).toBeLessThan(7)
    // AC-2: exact preserved email window/max.
    expect(checkDbRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'email',
        subject: 'spammed@example.com',
        windowMs: 15 * 60_000,
        maxAttempts: 5,
      })
    )
  })

  it('still applies the email limit when the IP is unknown (AC-3: email never skippable)', async () => {
    // No forwarded-for → IP bucket skipped, but the email bucket must still throttle.
    let last: Response | undefined
    for (let i = 0; i < 7; i++) {
      last = await post({ email: 'noip@example.com' })
    }
    expect(last?.status).toBe(200)
    // The IP scope was never consulted; the email scope was.
    const scopes = checkDbRateLimit.mock.calls.map((c) => (c[0] as { scope: string }).scope)
    expect(scopes).not.toContain('ip')
    expect(scopes).toContain('email')
    expect(asMock(requestMagicLink).mock.calls.length).toBeLessThan(7)
  })
})
