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

import { logger } from '@/lib/logger'
import { __resetNoClientIpLogGateForTests, clientIpForRateLimit } from '../client-ip'

const reqWith = (headers: Record<string, string>) =>
  new Request('https://app.test/whatever', { headers })

beforeEach(() => {
  vi.clearAllMocks()
  // The no-IP log is gated to once per interval per process, so without this
  // the first test to trip it would silence every later one.
  __resetNoClientIpLogGateForTests()
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

  // ── Story sec-3 (AC-1, AC-2) ────────────────────────────────────────────────
  // These REPLACE a test that pinned the opposite behaviour ("falls back to
  // x-real-ip when no forwarded-for is usable"). That test encoded the defect:
  // the header is client-supplied, so honouring it handed the caller its own
  // rate-limit key.
  it('REFUSES x-real-ip — a client-supplied header can never become the key', () => {
    // The edge APPENDS to x-forwarded-for, so any request that reaches us
    // through it has a usable XFF hop and returns earlier. This path is
    // therefore only reachable when XFF is absent — exactly the case where
    // x-real-ip is attacker-chosen. Refusal is the only safe answer.
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': '198.51.100.4' }))).toBeNull()
  })

  it('a forged x-real-ip cannot POISON another subject window', () => {
    // The evade case (above) buys the attacker a fresh budget. This is the
    // worse one: naming a victim would let an attacker burn THEIR budget.
    const victim = '203.0.113.77'
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': victim }))).not.toBe(victim)
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': victim }))).toBeNull()
  })

  it('refuses x-real-ip even when x-forwarded-for is present but unusable', () => {
    // Belt-and-braces: the fall-through from a bad XFF must not re-enter the
    // deleted fallback either.
    expect(
      clientIpForRateLimit(reqWith({ 'x-forwarded-for': '  ,  ', 'x-real-ip': '198.51.100.4' }))
    ).toBeNull()
  })

  it('returns null when no proxy IP is present (caller skips limiting, no global lockout)', () => {
    expect(clientIpForRateLimit(reqWith({}))).toBeNull()
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '' }))).toBeNull()
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '  ,  ' }))).toBeNull()
  })
})

// ── Story sec-3 (AC-3): the no-IP path must be observable IN PRODUCTION ──────
describe('no-trustworthy-IP observability', () => {
  it('logs at info, NOT debug — debug is dropped in production', () => {
    clientIpForRateLimit(reqWith({}))

    // This is the whole point of the AC. `lib/logger.ts:161` returns early when
    // the level is below `minLevel()`, and `:157` floors that at `info` (20)
    // when NODE_ENV === 'production', while `debug` is 10. A debug log here
    // would emit in dev and test, go GREEN IN CI, and write nothing on the one
    // system whose behaviour we are trying to learn.
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.debug).not.toHaveBeenCalled()
  })

  it('distinguishes absent, empty, and present-but-untrusted XFF', () => {
    clientIpForRateLimit(reqWith({}))
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'no-xff-header', hopCount: 0 })
    )

    vi.clearAllMocks()
    __resetNoClientIpLogGateForTests()

    // A hop that is present but too long to be an IP: the trusted-hop logic
    // declines, and the reason must say so rather than blaming a missing header.
    clientIpForRateLimit(reqWith({ 'x-forwarded-for': `1.2.3.4, ${'a'.repeat(100)}` }))
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'xff-present-no-trusted-hop', hopCount: 2 })
    )

    vi.clearAllMocks()
    __resetNoClientIpLogGateForTests()

    // An edge that sets an EMPTY XFF must not read as "edge does not send XFF" —
    // that is the opposite conclusion, drawn from the same log line.
    clientIpForRateLimit(reqWith({ 'x-forwarded-for': '  ,  ' }))
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'xff-header-empty', hopCount: 0 })
    )
  })

  it('emits ONCE per interval however many header-less requests arrive', () => {
    // The condition is attacker-triggerable (just omit the header), so an
    // ungated log is a log-amplification vector — the reason the line this
    // replaces used `debug`. Gating is what lets the level be `info`.
    for (let i = 0; i < 50; i += 1) {
      expect(clientIpForRateLimit(reqWith({}))).toBeNull()
    }
    expect(logger.info).toHaveBeenCalledTimes(1)
  })

  it('does not log at all when a trustworthy hop IS derived', () => {
    expect(clientIpForRateLimit(reqWith({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.debug).not.toHaveBeenCalled()
  })
})
