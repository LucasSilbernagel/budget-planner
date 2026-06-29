/**
 * OAuth callback rate-limiter tests (Story 5.8 — AC group C / AC-9)
 *
 * The previous single-global-slot limiter capped everyone at one attempt per
 * window and was defeated by alternating two IPs. The replacement enforces a
 * real per-IP sliding window.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { _resetCallbackRateLimiter, clientIpForRateLimit, isRateLimited } from '../callback'

beforeEach(() => {
  _resetCallbackRateLimiter()
})

const reqWith = (headers: Record<string, string>) =>
  new Request('https://app.test/api/auth/paddle/callback', { headers })

describe('clientIpForRateLimit (trusted-hop keying)', () => {
  it('takes the RIGHTMOST x-forwarded-for hop (the trusted-proxy-appended IP)', () => {
    // A client pre-seeds a fake left entry; the trusted proxy appends the real IP.
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': 'fake, 203.0.113.9' }))).toBe(
      '203.0.113.9'
    )
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('falls back to x-real-ip when no forwarded-for', () => {
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  it('returns null when no proxy IP is present (caller skips limiting, no global lockout)', () => {
    expect(clientIpForRateLimit(reqWith({}))).toBeNull()
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '' }))).toBeNull()
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '  ,  ' }))).toBeNull()
  })
})

const T0 = 1_000_000

describe('isRateLimited (per-IP sliding window)', () => {
  it('allows up to 5 attempts then blocks the 6th within the window', () => {
    const ip = '203.0.113.7'
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(ip, T0 + i)).toBe(false)
    }
    expect(isRateLimited(ip, T0 + 5)).toBe(true)
  })

  it('tracks IPs independently (alternating two IPs no longer defeats it)', () => {
    const a = '198.51.100.1'
    const b = '198.51.100.2'
    // Five each, interleaved — both should be allowed (independent buckets)...
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(a, T0 + i)).toBe(false)
      expect(isRateLimited(b, T0 + i)).toBe(false)
    }
    // ...and each is then independently blocked on its 6th.
    expect(isRateLimited(a, T0 + 5)).toBe(true)
    expect(isRateLimited(b, T0 + 5)).toBe(true)
  })

  it('lets attempts through again once the window has slid past old ones', () => {
    const ip = '192.0.2.50'
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(ip, T0 + i)).toBe(false)
    }
    expect(isRateLimited(ip, T0 + 5)).toBe(true)
    // 61s later, the first five timestamps are outside the 60s window.
    expect(isRateLimited(ip, T0 + 61_000)).toBe(false)
  })
})
