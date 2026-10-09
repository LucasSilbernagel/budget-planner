import { resetConfig } from '@budget-planner/config/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signSession, verifySession } from '../session'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

const ORIGINAL_SESSION_SECRET = process.env.SESSION_SECRET

const limitMock = vi.fn()

function mockUserLookup(result: unknown[]): void {
	limitMock.mockResolvedValue(result)
}

vi.mock('@budget-planner/db/client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@budget-planner/db/client')>()
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

import { getCurrentUserSession } from '../paddle'

function requestWithSessionCookie(rawToken: string): Request {
	return {
		headers: new Headers({
			cookie: `session=${encodeURIComponent(rawToken)}`,
		}),
	} as unknown as Request
}

afterEach(() => {
	if (ORIGINAL_SESSION_SECRET === undefined) {
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
		const token = signSession({
			userId: VALID_UUID,
			paddleId: 'paddle-cookie',
			email: 'cookie@example.com',
		})
		mockUserLookup([dbUserRow])

		const result = await getCurrentUserSession(requestWithSessionCookie(token))

		expect(result.success).toBe(true)
		expect(result.data).not.toBeNull()
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

	it('rejects a token issued at or before the revocation watermark (logout)', async () => {
		const token = signSession({
			userId: VALID_UUID,
			paddleId: 'paddle-cookie',
			email: 'cookie@example.com',
		})
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

// `null` means signed out; an outage must surface as success:false so callers re-check.
describe('getCurrentUserSession — infrastructure failure is not "signed out"', () => {
	it('reports success:false when the user lookup throws, rather than a null session', async () => {
		const { getCurrentUserSession } = await import('../paddle')
		const token = signSession({
			userId: VALID_UUID,
			paddleId: 'paddle-123',
			email: 'a@example.test',
		})
		limitMock.mockRejectedValueOnce(new Error('connection terminated unexpectedly'))

		const result = await getCurrentUserSession(
			new Request('https://app.test/', { headers: { cookie: `session=${token}` } })
		)

		expect(result.success).toBe(false)
		expect(result.data).toBeUndefined()
	})

	it('still reports an ABSENT session as success:true with a null session', async () => {
		const { getCurrentUserSession } = await import('../paddle')

		const result = await getCurrentUserSession(new Request('https://app.test/'))

		expect(result.success).toBe(true)
		expect(result.data).toBeNull()
	})

	it('still reports an INVALID cookie as success:true with a null session', async () => {
		const { getCurrentUserSession } = await import('../paddle')

		const result = await getCurrentUserSession(
			new Request('https://app.test/', { headers: { cookie: 'session=not-a-valid-token' } })
		)

		expect(result.success).toBe(true)
		expect(result.data).toBeNull()
	})
})
