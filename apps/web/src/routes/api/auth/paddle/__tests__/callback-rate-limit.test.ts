/**
 * OAuth callback rate-limiting tests (Story 5.8 → rewritten for Story SEC-2).
 *
 * Two concerns:
 *  - `clientIpForRateLimit` now derives the client IP at the TRUSTED-PROXY
 *    boundary instead of blindly taking the rightmost X-Forwarded-For hop, so a
 *    client that PREPENDS a forged entry can no longer choose its own key (AC-5).
 *  - the route enforces the limit through the shared atomic DB store; here we
 *    assert it calls `checkDbRateLimit` with the preserved scope/window/max and
 *    returns 429 when the store says the bucket is full (AC-1, AC-2).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkDbRateLimit } = vi.hoisted(() => ({ checkDbRateLimit: vi.fn() }))

vi.mock('@/server/rate-limit/db-window', () => ({ checkDbRateLimit }))
vi.mock('@/server/api/auth/paddle', () => ({ handlePaddleCallback: vi.fn() }))
vi.mock('@/server/api/auth/session', () => ({ signSession: vi.fn(() => 'signed') }))

import { handlePaddleCallback } from '@/server/api/auth/paddle'
import { GET, clientIpForRateLimit } from '../callback'

const reqWith = (headers: Record<string, string>) =>
  new Request('https://app.test/api/auth/paddle/callback', { headers })

beforeEach(() => {
  vi.clearAllMocks()
  checkDbRateLimit.mockResolvedValue({ allowed: true, remaining: 4 })
})

describe('clientIpForRateLimit (trusted-proxy-boundary keying, AC-5)', () => {
  it('takes the rightmost hop by default (the value our upstream proxy appends)', () => {
    // Under the single-append-proxy topology the proxy appends the real peer IP
    // as the rightmost entry.
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('ignores forged entries a client PREPENDS on the left (no key spoofing)', () => {
    // Attacker sends `9.9.9.9`; the proxy appends the genuine peer IP AFTER it, so
    // the rightmost (and thus the key we read) is the real client, not the forgery.
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '9.9.9.9, 203.0.113.9' }))).toBe(
      '203.0.113.9'
    )
  })

  it('rejects an implausibly long hop value (not an IP → no giant rate-limit key)', () => {
    const huge = 'a'.repeat(100)
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': `1.2.3.4, ${huge}` }))).toBeNull()
  })

  it('honours RATE_LIMIT_TRUSTED_PROXY_HOPS for multi-hop edges', () => {
    vi.stubEnv('RATE_LIMIT_TRUSTED_PROXY_HOPS', '1')
    try {
      // One trusted edge hop on the right → client is the 2nd-from-right.
      expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe(
        '203.0.113.9'
      )
      // Chain too short to hold a client hop beyond the trusted one → null.
      expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '10.0.0.1' }))).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('falls back to x-real-ip when no forwarded-for is usable', () => {
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    // ...but rejects an implausibly long x-real-ip too.
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': 'z'.repeat(100) }))).toBeNull()
  })

  it('returns null when no proxy IP is present (caller skips limiting, no global lockout)', () => {
    expect(clientIpForRateLimit(reqWith({}))).toBeNull()
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '' }))).toBeNull()
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '  ,  ' }))).toBeNull()
  })
})

describe('callback route rate limiting (AC-1, AC-2)', () => {
  const url = (q: string) => `https://app.test/api/auth/paddle/callback?${q}`
  const goodParams = 'code=abcabcabcabc&state=statestatestate'

  it('limits the paddle-cb IP bucket at 5 / 60s via the shared DB store', async () => {
    ;(handlePaddleCallback as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'x',
    })
    await GET({
      request: new Request(url(goodParams), {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      }),
    })
    expect(checkDbRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'paddle-cb',
        subject: '1.2.3.4',
        windowMs: 60_000,
        maxAttempts: 5,
      })
    )
  })

  it('returns 429 when the shared store reports the bucket is full', async () => {
    checkDbRateLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const res = await GET({
      request: new Request(url(goodParams), {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      }),
    })
    expect(res.status).toBe(429)
    expect(handlePaddleCallback).not.toHaveBeenCalled()
  })

  it('skips limiting (no 429) when no trustworthy IP is present', async () => {
    ;(handlePaddleCallback as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'x',
    })
    const res = await GET({ request: new Request(url(goodParams)) })
    expect(checkDbRateLimit).not.toHaveBeenCalled()
    expect(res.status).not.toBe(429)
  })
})
