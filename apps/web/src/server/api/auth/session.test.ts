/**
 * Signed Session Tests (Story 5-7, LAUNCH BLOCKER)
 *
 * Covers:
 *  - signSession → verifySession round-trip
 *  - rejection of unsigned raw-JSON cookies (today's forgery exploit)
 *  - rejection of tampered payloads
 *  - rejection of tokens signed with a different secret
 *  - validateSessionToken (via getCurrentUserSession): subscription status is
 *    read from the database, not the cookie; forged cookies and missing user
 *    rows are rejected.
 */

import { resetConfig } from '@budget-planner/config'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signSession, verifySession } from './session'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

// Captured from the Vitest test env so per-test secret mutations can be undone.
const ORIGINAL_SESSION_SECRET = process.env.SESSION_SECRET

// ---------------------------------------------------------------------------
// Database mock: only the `db` export is replaced; real schema/exports remain.
// ---------------------------------------------------------------------------
const limitMock = vi.fn()

function mockUserLookup(result: unknown[]): void {
  limitMock.mockResolvedValue(result)
}

vi.mock('@budget-planner/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@budget-planner/db')>()
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: (...args: unknown[]) => limitMock(...args),
  }
  return {
    ...actual,
    db: {
      select: vi.fn(() => chain),
    },
  }
})

// Imported after the mock is registered.
import { getCurrentUserSession } from './paddle'

/**
 * Build a Request carrying a `session` cookie with the given raw token value,
 * URL-encoded exactly as the callback handler stores it.
 */
function requestWithSessionCookie(rawToken: string): Request {
  return {
    headers: new Headers({
      cookie: `session=${encodeURIComponent(rawToken)}`,
    }),
  } as unknown as Request
}

afterEach(() => {
  // Restore the test-env SESSION_SECRET after any per-test mutation.
  if (ORIGINAL_SESSION_SECRET === undefined) {
    // `delete` is required here: assigning `undefined` to a process.env key
    // stores the string "undefined" in Node, not an absent variable.
    // biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
    delete process.env.SESSION_SECRET
  } else {
    process.env.SESSION_SECRET = ORIGINAL_SESSION_SECRET
  }
  resetConfig()
  limitMock.mockReset()
})

describe('signSession / verifySession', () => {
  it('round-trips a payload through sign and verify', () => {
    const payload = {
      userId: VALID_UUID,
      paddleId: 'paddle-123',
      email: 'user@example.com',
    }

    const before = Date.now()
    const token = signSession(payload)
    expect(token).toContain('.')

    const verified = verifySession(token)
    // Identity claims round-trip; signSession also stamps an issued-at (iat).
    expect(verified).toMatchObject(payload)
    expect(verified?.iat).toBeGreaterThanOrEqual(before)
    expect(verified?.iat).toBeLessThanOrEqual(Date.now())
  })

  it('returns null for an empty or missing token', () => {
    expect(verifySession('')).toBeNull()
    expect(verifySession(null)).toBeNull()
    expect(verifySession(undefined)).toBeNull()
  })

  it('rejects an unsigned raw-JSON cookie (the forgery exploit)', () => {
    const forged = JSON.stringify({
      userId: VALID_UUID,
      paddleId: 'attacker',
      email: 'attacker@example.com',
      subscriptionStatus: 'active',
    })

    expect(verifySession(forged)).toBeNull()
  })

  it('rejects a token whose payload was tampered with after signing', () => {
    const token = signSession({
      userId: VALID_UUID,
      paddleId: 'paddle-123',
      email: 'user@example.com',
    })

    const [encodedPayload, signature] = token.split('.')
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    decoded.email = 'attacker@example.com'
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url')
    const tamperedToken = `${tamperedPayload}.${signature}`

    expect(verifySession(tamperedToken)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    process.env.SESSION_SECRET = 'first-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    resetConfig()
    const token = signSession({
      userId: VALID_UUID,
      paddleId: 'paddle-123',
      email: 'user@example.com',
    })

    process.env.SESSION_SECRET = 'second-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    resetConfig()

    expect(verifySession(token)).toBeNull()
  })
})

describe('validateSessionToken via getCurrentUserSession', () => {
  const dbUserRow = {
    id: VALID_UUID,
    email: 'db-user@example.com',
    paddleId: 'paddle-db',
    subscriptionStatus: 'active' as const,
    currency: 'EUR' as const,
    isDeleted: false,
    sessionsRevokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  it('returns a session with subscription status read from the DATABASE, not the cookie', async () => {
    // Signed token carries identity only; it never asserts a subscription.
    const token = signSession({
      userId: VALID_UUID,
      paddleId: 'paddle-cookie',
      email: 'cookie@example.com',
    })
    mockUserLookup([dbUserRow])

    const result = await getCurrentUserSession(requestWithSessionCookie(token))

    expect(result.success).toBe(true)
    expect(result.data).not.toBeNull()
    // Authoritative values come from the DB row, not the cookie payload.
    expect(result.data?.subscriptionStatus).toBe('active')
    expect(result.data?.currency).toBe('EUR')
    expect(result.data?.email).toBe('db-user@example.com')
    expect(result.data?.paddleId).toBe('paddle-db')
    expect(result.data?.isAuthenticated).toBe(true)
  })

  it('rejects a forged raw-JSON cookie claiming active subscription', async () => {
    const forged = JSON.stringify({
      userId: VALID_UUID,
      paddleId: 'attacker',
      email: 'attacker@example.com',
      subscriptionStatus: 'active',
    })

    const result = await getCurrentUserSession(requestWithSessionCookie(forged))

    expect(result.success).toBe(true)
    expect(result.data).toBeNull()
    // The DB must never be consulted for an unverifiable token.
    expect(limitMock).not.toHaveBeenCalled()
  })

  it('returns null when no matching user row exists', async () => {
    const token = signSession({
      userId: VALID_UUID,
      paddleId: 'paddle-cookie',
      email: 'cookie@example.com',
    })
    mockUserLookup([])

    const result = await getCurrentUserSession(requestWithSessionCookie(token))

    expect(result.success).toBe(true)
    expect(result.data).toBeNull()
  })

  it('rejects a token issued at or before the revocation watermark (Story 5.8 logout)', async () => {
    const token = signSession({
      userId: VALID_UUID,
      paddleId: 'paddle-cookie',
      email: 'cookie@example.com',
    })
    // User logged out "in the future" relative to this token's iat → revoked.
    mockUserLookup([{ ...dbUserRow, sessionsRevokedAt: Date.now() + 60_000 }])

    const result = await getCurrentUserSession(requestWithSessionCookie(token))

    expect(result.success).toBe(true)
    expect(result.data).toBeNull()
  })

  it('accepts a token issued after the revocation watermark (post-logout re-login)', async () => {
    const token = signSession({
      userId: VALID_UUID,
      paddleId: 'paddle-cookie',
      email: 'cookie@example.com',
    })
    // The watermark is in the past → this freshly-issued token is still valid.
    mockUserLookup([{ ...dbUserRow, sessionsRevokedAt: Date.now() - 60_000 }])

    const result = await getCurrentUserSession(requestWithSessionCookie(token))

    expect(result.success).toBe(true)
    expect(result.data?.isAuthenticated).toBe(true)
  })

  it('returns null data when no session cookie is present', async () => {
    const result = await getCurrentUserSession({
      headers: new Headers(),
    } as unknown as Request)

    expect(result.success).toBe(true)
    expect(result.data).toBeNull()
  })
})
