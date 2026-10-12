import { resetConfig } from '@budget-planner/config/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifySession } from '../session'
import { SESSION_COOKIE_MAX_AGE } from '../session-cookies'
import {
	appendSessionRenewal,
	renewedSessionCookies,
	SESSION_RENEW_AFTER_MS,
} from '../session-renewal'

const ORIGINAL_SESSION_SECRET = process.env.SESSION_SECRET
const NOW = 1_800_000_000_000

const session = {
	userId: '11111111-1111-1111-1111-111111111111',
	paddleId: 'pad_1',
	email: 'user@example.com',
	issuedAt: NOW - SESSION_RENEW_AFTER_MS,
}

beforeEach(() => {
	process.env.SESSION_SECRET = 'a-very-long-session-secret-with-enough-entropy-123456'
	resetConfig()
	vi.useFakeTimers()
	vi.setSystemTime(NOW)
})

afterEach(() => {
	vi.useRealTimers()
	process.env.SESSION_SECRET = ORIGINAL_SESSION_SECRET
	resetConfig()
})

describe('renewedSessionCookies', () => {
	it('re-issues both cookies with a fresh iat once the token is a day old', () => {
		const cookies = renewedSessionCookies(session, NOW)

		expect(cookies).toHaveLength(2)
		const [sessionCookie, hasSessionCookie] = cookies
		expect(sessionCookie).toMatch(/^session=/)
		expect(sessionCookie).toMatch(/HttpOnly/)
		expect(sessionCookie).toMatch(new RegExp(`Max-Age=${SESSION_COOKIE_MAX_AGE}`))
		expect(hasSessionCookie).toMatch(/^has_session=1/)
		expect(hasSessionCookie).toMatch(new RegExp(`Max-Age=${SESSION_COOKIE_MAX_AGE}`))

		const raw = decodeURIComponent(
			String(sessionCookie).split(';')[0]?.replace('session=', '') ?? ''
		)
		expect(verifySession(raw)).toEqual({
			userId: session.userId,
			paddleId: session.paddleId,
			email: session.email,
			iat: NOW,
		})
	})

	it.each([0, SESSION_RENEW_AFTER_MS - 1])('is a no-op for a token %d ms old', (age) => {
		expect(renewedSessionCookies({ ...session, issuedAt: NOW - age }, NOW)).toEqual([])
	})

	it('renews a legacy token that carries no iat', () => {
		expect(renewedSessionCookies({ ...session, issuedAt: 0 }, NOW)).toHaveLength(2)
	})

	it('leaves the existing cookie in place when signing fails', () => {
		process.env.SESSION_SECRET = ''
		resetConfig()
		vi.stubEnv('NODE_ENV', 'production')
		resetConfig()
		expect(renewedSessionCookies(session, NOW)).toEqual([])
		vi.unstubAllEnvs()
	})
})

describe('appendSessionRenewal', () => {
	it('appends renewed cookies without touching other headers', () => {
		const headers = new Headers({ 'cache-control': 'no-store' })
		appendSessionRenewal(headers, session)
		expect(headers.getSetCookie()).toHaveLength(2)
		expect(headers.get('cache-control')).toBe('no-store')
	})

	it('appends nothing for a fresh token', () => {
		const headers = appendSessionRenewal(new Headers(), { ...session, issuedAt: NOW })
		expect(headers.getSetCookie()).toEqual([])
	})
})
