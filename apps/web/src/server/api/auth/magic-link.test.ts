/**
 * Magic-link orchestration tests (Story 5-16, Tasks 2 & 3 — AC-1, AC-2, AC-3)
 *
 * Covers the security-critical behaviours that sit between the routes and the
 * token/mailer/DB layers:
 *  - request: unknown / soft-deleted / invalid emails create NO token and send
 *    NO email (no account enumeration, no signup);
 *  - request: a known user gets a token + an email whose link carries only the
 *    opaque token (built from SITE_URL, fixed target — no open redirect);
 *  - verify: a good token resolves the EXACT { userId, paddleId, email } claims
 *    signSession needs; a bad token or a soft-deleted owner resolves null
 *    (fail-closed).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  selectLimit,
  dbSelect,
  createLoginToken,
  consumeLoginToken,
  peekLoginToken,
  sendMagicLinkEmail,
} = vi.hoisted(() => {
  const selectLimit = vi.fn()
  const selectWhere = vi.fn(() => ({ limit: selectLimit }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const dbSelect = vi.fn(() => ({ from: selectFrom }))
  return {
    selectLimit,
    dbSelect,
    createLoginToken: vi.fn(),
    consumeLoginToken: vi.fn(),
    peekLoginToken: vi.fn(),
    sendMagicLinkEmail: vi.fn(),
  }
})

vi.mock('@budget-planner/db', () => ({ db: { select: dbSelect } }))
vi.mock('./login-token', () => ({ createLoginToken, consumeLoginToken, peekLoginToken }))
vi.mock('@/server/email/mailer', () => ({ sendMagicLinkEmail }))

import {
  buildVerifyLink,
  isValidEmail,
  normalizeEmail,
  peekMagicLink,
  requestMagicLink,
  verifyMagicLink,
} from './magic-link'

const BASE = 'https://app.test'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('normalizeEmail / isValidEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com')
  })
  it('rejects malformed / empty / over-long addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
    expect(isValidEmail('nope')).toBe(false)
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail(`${'a'.repeat(250)}@x.com`)).toBe(false)
  })
})

describe('buildVerifyLink', () => {
  it('targets the fixed verify route with only the token in the query (no open redirect)', () => {
    const link = buildVerifyLink(BASE, 'raw-token-123')
    expect(link).toBe('https://app.test/api/auth/login/verify?token=raw-token-123')
  })
})

describe('requestMagicLink (no enumeration, no signup)', () => {
  it('sends a link for a known, non-deleted user', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 'u1', email: 'user@example.com', paddleId: 'pad_1' }])
    createLoginToken.mockResolvedValueOnce('raw-tok')

    await requestMagicLink('User@Example.com', BASE)

    expect(createLoginToken).toHaveBeenCalledWith('u1')
    expect(sendMagicLinkEmail).toHaveBeenCalledWith(
      'user@example.com',
      'https://app.test/api/auth/login/verify?token=raw-tok'
    )
  })

  it('does NOTHING for an unknown email (no token, no email, no account created)', async () => {
    selectLimit.mockResolvedValueOnce([])
    await requestMagicLink('ghost@example.com', BASE)
    expect(createLoginToken).not.toHaveBeenCalled()
    expect(sendMagicLinkEmail).not.toHaveBeenCalled()
  })

  it('does NOTHING for an invalid email without even querying the DB', async () => {
    await requestMagicLink('not-an-email', BASE)
    expect(dbSelect).not.toHaveBeenCalled()
    expect(createLoginToken).not.toHaveBeenCalled()
    expect(sendMagicLinkEmail).not.toHaveBeenCalled()
  })
})

describe('verifyMagicLink (single-use → identity claims, fail-closed)', () => {
  it('returns the exact signSession claims for a valid token + live user', async () => {
    consumeLoginToken.mockResolvedValueOnce('u1')
    selectLimit.mockResolvedValueOnce([{ id: 'u1', email: 'user@example.com', paddleId: 'pad_1' }])

    const result = await verifyMagicLink('raw-tok')

    expect(consumeLoginToken).toHaveBeenCalledWith('raw-tok')
    expect(result).toEqual({ userId: 'u1', paddleId: 'pad_1', email: 'user@example.com' })
  })

  it('returns null for an invalid/expired/consumed token (no DB lookup)', async () => {
    consumeLoginToken.mockResolvedValueOnce(null)
    const result = await verifyMagicLink('bad-tok')
    expect(result).toBeNull()
    expect(dbSelect).not.toHaveBeenCalled()
  })

  it('returns null when the token owner is soft-deleted / missing (fail-closed)', async () => {
    consumeLoginToken.mockResolvedValueOnce('u1')
    selectLimit.mockResolvedValueOnce([]) // isDeleted filter excludes the row
    const result = await verifyMagicLink('raw-tok')
    expect(result).toBeNull()
  })
})

describe('peekMagicLink (read-only, drives the confirm interstitial)', () => {
  it('returns the target email WITHOUT consuming the token', async () => {
    peekLoginToken.mockResolvedValueOnce('u1')
    selectLimit.mockResolvedValueOnce([{ id: 'u1', email: 'user@example.com', paddleId: 'pad_1' }])

    const result = await peekMagicLink('raw-tok')

    expect(result).toEqual({ email: 'user@example.com' })
    // Peek must not consume.
    expect(consumeLoginToken).not.toHaveBeenCalled()
  })

  it('returns null for an invalid/expired/consumed token (no user lookup)', async () => {
    peekLoginToken.mockResolvedValueOnce(null)
    expect(await peekMagicLink('bad')).toBeNull()
    expect(dbSelect).not.toHaveBeenCalled()
  })

  it('returns null when the owner is soft-deleted / missing (fail-closed)', async () => {
    peekLoginToken.mockResolvedValueOnce('u1')
    selectLimit.mockResolvedValueOnce([])
    expect(await peekMagicLink('raw-tok')).toBeNull()
  })
})
