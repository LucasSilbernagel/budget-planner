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

import { redact } from '@/lib/logger'
import {
  MagicLinkStageError,
  buildVerifyLink,
  isValidEmail,
  normalizeEmail,
  peekMagicLink,
  requestMagicLink,
  toMessageRef,
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
    sendMagicLinkEmail.mockResolvedValueOnce('<202609271234.12345678901@smtp-relay.mailin.fr>')

    const outcome = await requestMagicLink('User@Example.com', BASE)

    expect(outcome).toEqual({
      branch: 'sent',
      userId: 'u1',
      messageRef: '202609271234.12345678901',
    })
    expect(createLoginToken).toHaveBeenCalledWith('u1')
    expect(sendMagicLinkEmail).toHaveBeenCalledWith(
      'user@example.com',
      'https://app.test/api/auth/login/verify?token=raw-tok'
    )
  })

  it('does NOTHING for an unknown email (no token, no email, no account created)', async () => {
    selectLimit.mockResolvedValueOnce([])
    expect(await requestMagicLink('ghost@example.com', BASE)).toEqual({ branch: 'no-such-user' })
    expect(createLoginToken).not.toHaveBeenCalled()
    expect(sendMagicLinkEmail).not.toHaveBeenCalled()
  })

  it('does NOTHING for an invalid email without even querying the DB', async () => {
    expect(await requestMagicLink('not-an-email', BASE)).toEqual({ branch: 'invalid-shape' })
    expect(dbSelect).not.toHaveBeenCalled()
    expect(createLoginToken).not.toHaveBeenCalled()
    expect(sendMagicLinkEmail).not.toHaveBeenCalled()
  })
})

describe('requestMagicLink — outcome and failure stage (Story 74.1, AC-5)', () => {
  it('omits messageRef when the provider returned no messageId', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 'u1', email: 'user@example.com', paddleId: 'pad_1' }])
    createLoginToken.mockResolvedValueOnce('raw-tok')
    sendMagicLinkEmail.mockResolvedValueOnce(undefined)
    expect(await requestMagicLink('user@example.com', BASE)).toEqual({
      branch: 'sent',
      userId: 'u1',
    })
  })

  it('tags a DB lookup failure with stage lookup', async () => {
    const cause = new Error('db down')
    selectLimit.mockRejectedValueOnce(cause)
    const error = await requestMagicLink('user@example.com', BASE).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MagicLinkStageError)
    expect(error).toMatchObject({ stage: 'lookup', cause })
    expect(createLoginToken).not.toHaveBeenCalled()
  })

  it('tags a token-insert failure with stage token', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 'u1', email: 'user@example.com', paddleId: 'pad_1' }])
    createLoginToken.mockRejectedValueOnce(new Error('insert failed'))
    const error = await requestMagicLink('user@example.com', BASE).catch((e: unknown) => e)
    expect(error).toMatchObject({ stage: 'token' })
    expect(sendMagicLinkEmail).not.toHaveBeenCalled()
  })

  it('tags a provider failure with stage send', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 'u1', email: 'user@example.com', paddleId: 'pad_1' }])
    createLoginToken.mockResolvedValueOnce('raw-tok')
    sendMagicLinkEmail.mockRejectedValueOnce(new Error('Email provider returned 401'))
    const error = await requestMagicLink('user@example.com', BASE).catch((e: unknown) => e)
    expect(error).toMatchObject({ stage: 'send' })
  })
})

describe('toMessageRef — a Brevo id that survives the logger (Story 74.1, AC-5 trap)', () => {
  const BREVO_ID = '<202609271234.12345678901@smtp-relay.mailin.fr>'

  it('keeps the part before @, and it survives the REAL redact()', () => {
    expect(toMessageRef(BREVO_ID)).toBe('202609271234.12345678901')
    expect(redact({ messageRef: toMessageRef(BREVO_ID) })).toEqual({
      messageRef: '202609271234.12345678901',
    })
  })

  it('the raw id would NOT survive — the reason the reduction exists', () => {
    expect(redact({ messageRef: BREVO_ID })).toEqual({ messageRef: '[REDACTED]' })
  })

  it('returns undefined for a missing or empty id', () => {
    expect(toMessageRef(undefined)).toBeUndefined()
    expect(toMessageRef('')).toBeUndefined()
    expect(toMessageRef('<@x>')).toBeUndefined()
  })

  it('strips a trailing > when the id carries no @ (review)', () => {
    expect(toMessageRef('<abc123>')).toBe('abc123')
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
    selectLimit.mockResolvedValueOnce([])
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
