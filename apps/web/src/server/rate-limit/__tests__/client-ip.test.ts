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

  it('REFUSES x-real-ip — a client-supplied header can never become the key', () => {
    // Without XFF, x-real-ip is attacker-chosen, so refusal is the only safe answer.
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': '198.51.100.4' }))).toBeNull()
  })

  it('a forged x-real-ip cannot POISON another subject window', () => {
    // Worse than evasion: naming a victim would burn THEIR budget.
    const victim = '203.0.113.77'
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': victim }))).not.toBe(victim)
    expect(clientIpForRateLimit(reqWith({ 'x-real-ip': victim }))).toBeNull()
  })

  it('refuses x-real-ip even when x-forwarded-for is present but unusable', () => {
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

describe('no-trustworthy-IP observability', () => {
  it('logs at info, NOT debug — debug is dropped in production', () => {
    clientIpForRateLimit(reqWith({}))

    // `debug` is dropped in production; a debug log here would pass CI and write
    // nothing where it is needed.
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

    clientIpForRateLimit(reqWith({ 'x-forwarded-for': `1.2.3.4, ${'a'.repeat(100)}` }))
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'xff-present-no-trusted-hop', hopCount: 2 })
    )

    vi.clearAllMocks()
    __resetNoClientIpLogGateForTests()

    // An EMPTY XFF must not read as "edge does not send XFF".
    clientIpForRateLimit(reqWith({ 'x-forwarded-for': '  ,  ' }))
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'xff-header-empty', hopCount: 0 })
    )
  })

  it('emits ONCE per interval however many header-less requests arrive', () => {
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
