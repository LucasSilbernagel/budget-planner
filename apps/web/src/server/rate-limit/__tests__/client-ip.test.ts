/**
 * `clientIpForRateLimit` — trusted-proxy-boundary keying (Stories 5-8 / SEC-2).
 *
 * Relocated from `routes/api/auth/paddle/__tests__/callback-rate-limit.test.ts`
 * when Story 5-3 removed the Paddle OAuth callback route. The IP-derivation
 * behaviour is unchanged; the callback route's own 429 path is now covered by
 * the magic-link login route tests, which are the only remaining consumers.
 *
 * A client that PREPENDS a forged X-Forwarded-For entry can no longer choose its
 * own rate-limit key, because we index from the RIGHT (the hop our upstream
 * proxy appends).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { clientIpForRateLimit } from '../client-ip'

const reqWith = (headers: Record<string, string>) =>
  new Request('https://app.test/whatever', { headers })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('clientIpForRateLimit', () => {
  it('takes the rightmost hop by default (the value our upstream proxy appends)', () => {
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('ignores forged entries a client PREPENDS on the left (no key spoofing)', () => {
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
      expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe(
        '203.0.113.9'
      )
      expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '10.0.0.1' }))).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('falls back to x-real-ip when no forwarded-for is usable', () => {
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': 'z'.repeat(100) }))).toBeNull()
  })

  it('returns null when no proxy IP is present (caller skips limiting, no global lockout)', () => {
    expect(clientIpForRateLimit(reqWith({}))).toBeNull()
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '' }))).toBeNull()
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '  ,  ' }))).toBeNull()
  })
})
