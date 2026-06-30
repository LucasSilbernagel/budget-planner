/**
 * Structured logger redaction tests (story 5-5, AC-2)
 *
 * The redaction contract is the first-class deliverable: a log call that carries
 * a secret, email, session token, or financial value must NEVER emit it. These
 * tests prove that — they are the privacy guardrail, not a nicety.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger, redact } from '../logger'

describe('redact()', () => {
  it('redacts values of PII / secret / financial keys, keeps non-PII identifiers', () => {
    const out = redact({
      userId: '4f1c0b2e-1111-2222-3333-444455556666', // non-PII UUID — keep
      email: 'jane@example.com', // PII — redact
      sessionToken: 'abc.def.ghi', // secret — redact
      monthlyIncome: 5200, // financial — redact
      balance: 9999.99, // financial — redact
      status: 'active', // benign — keep
    }) as Record<string, unknown>

    expect(out.userId).toBe('4f1c0b2e-1111-2222-3333-444455556666')
    expect(out.status).toBe('active')
    expect(out.email).toBe('[REDACTED]')
    expect(out.sessionToken).toBe('[REDACTED]')
    expect(out.monthlyIncome).toBe('[REDACTED]')
    expect(out.balance).toBe('[REDACTED]')
  })

  it('redacts network identifiers (IP / user-agent) that are GDPR personal data', () => {
    const out = redact({
      ipAddress: '203.0.113.7',
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      operationId: 'op-1', // benign — keep
    }) as Record<string, unknown>
    expect(out.ipAddress).toBe('[REDACTED]')
    expect(out.ip).toBe('[REDACTED]')
    expect(out.userAgent).toBe('[REDACTED]')
    expect(out.operationId).toBe('op-1')
  })

  it('scrubs email addresses and bearer tokens embedded in strings', () => {
    expect(redact('login for jane@example.com failed')).toBe('login for [REDACTED] failed')
    expect(redact('Authorization: Bearer sk_live_abc123')).toContain('[REDACTED]')
    expect(redact('Authorization: Bearer sk_live_abc123')).not.toContain('sk_live_abc123')
  })

  it('recurses into nested objects and arrays', () => {
    const out = redact({
      user: { email: 'a@b.com', userId: 'u1' },
      recipients: ['t1@x.com', 'plain'], // benign key → recurse + scrub strings
    }) as Record<string, unknown>
    const user = out.user as Record<string, unknown>
    expect(user.email).toBe('[REDACTED]')
    expect(user.userId).toBe('u1')
    expect((out.recipients as string[])[0]).toBe('[REDACTED]') // email scrubbed in-string
    expect((out.recipients as string[])[1]).toBe('plain')
  })

  it('redacts an Error message that contains PII without throwing', () => {
    const out = redact(new Error('failed for jane@example.com')) as Record<string, unknown>
    expect(out.name).toBe('Error')
    expect(out.message).toBe('failed for [REDACTED]')
  })

  it('caps recursion depth on deeply nested / cyclic-shaped input', () => {
    let nested: Record<string, unknown> = { v: 'leaf' }
    for (let i = 0; i < 12; i++) nested = { child: nested }
    expect(() => redact(nested)).not.toThrow()
  })

  it('redacts camelCase / compound sensitive keys (card, ip, price, ssn)', () => {
    const out = redact({
      cardNumber: '4111111111111111',
      creditCard: '4111',
      clientIp: '203.0.113.7',
      unitPrice: 1299,
      ssnNumber: '123-45-6789',
      databaseUrl: 'postgres://u:p@h/db',
    }) as Record<string, unknown>
    expect(out.cardNumber).toBe('[REDACTED]')
    expect(out.creditCard).toBe('[REDACTED]')
    expect(out.clientIp).toBe('[REDACTED]')
    expect(out.unitPrice).toBe('[REDACTED]')
    expect(out.ssnNumber).toBe('[REDACTED]')
    expect(out.databaseUrl).toBe('[REDACTED]')
  })

  it('does NOT over-redact benign keys that merely contain a token substring', () => {
    const out = redact({
      recipient: 'team', // contains "ip" — must NOT match \bip\b
      script: 'run', // contains "ip"
      description: 'note', // contains "rip"? no — sanity benign
      tooltip: 'help', // contains "ip"
    }) as Record<string, unknown>
    expect(out.recipient).toBe('team')
    expect(out.script).toBe('run')
    expect(out.description).toBe('note')
    expect(out.tooltip).toBe('help')
  })

  it('scrubs DB connection-string credentials, secret query params, and JWTs in strings', () => {
    expect(redact('connect to postgres://app:S3cret@db.internal/budget failed')).not.toContain(
      'S3cret'
    )
    expect(redact('visit https://app/verify?token=LIVE_SECRET now')).not.toContain('LIVE_SECRET')
    const jwt = 'eyJhbGciOi.eyJzdWIiOi.SflKxwRJ'
    expect(redact(`auth=${jwt}`)).not.toContain(jwt)
    // base64 bearer with +/= tail fully scrubbed
    expect(redact('Bearer ab+cd/ef==')).not.toContain('ab+cd/ef==')
  })

  it('handles non-plain objects safely (Date, Map, Set, Buffer, bigint)', () => {
    const d = new Date('2026-06-30T00:00:00.000Z')
    expect(redact({ when: d })).toEqual({ when: '2026-06-30T00:00:00.000Z' })
    expect(redact({ m: new Map([['a', 1]]) })).toEqual({ m: { a: 1 } })
    expect(redact({ s: new Set([1, 2]) })).toEqual({ s: [1, 2] })
    expect(redact({ buf: Buffer.from('secret') })).toEqual({ buf: '[BINARY]' })
    expect(redact({ big: 10n })).toEqual({ big: '10' })
  })
})

describe('logger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits a structured JSON line with level, time and msg', () => {
    logger.error('webhook failed', { paddleUserId: 'pad_1' })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = errorSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(line)
    expect(parsed.level).toBe('error')
    expect(parsed.msg).toBe('webhook failed')
    expect(typeof parsed.time).toBe('string')
    expect(parsed.context).toEqual({ paddleUserId: 'pad_1' })
  })

  it('redacts context and message before emitting', () => {
    logger.warn('invalid email jane@example.com', { email: 'jane@example.com', amount: 100 })
    const line = warnSpy.mock.calls[0][0] as string
    expect(line).not.toContain('jane@example.com')
    const parsed = JSON.parse(line)
    expect(parsed.context.email).toBe('[REDACTED]')
    expect(parsed.context.amount).toBe('[REDACTED]')
  })

  it('routes each level to the matching console method', () => {
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    expect(logSpy).toHaveBeenCalledTimes(1) // info → console.log
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})
