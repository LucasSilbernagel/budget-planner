// Uses the real login route's Set-Cookie headers instead of writing document.cookie,
// which jsdom exposes even for HttpOnly cookies.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkDbRateLimit, buckets } = vi.hoisted(() => {
	const buckets = new Map<string, number>()
	const checkDbRateLimit = vi.fn(async ({ scope, subject }: { scope: string; subject: string }) => {
		const key = `${scope}:${subject}`
		const count = (buckets.get(key) ?? 0) + 1
		buckets.set(key, count)
		return { allowed: true, remaining: 999 - count }
	})
	return { checkDbRateLimit, buckets }
})

vi.mock('@/server/rate-limit/db-window', () => ({ checkDbRateLimit }))
vi.mock('@/server/api/auth/magic-link', () => ({
	peekMagicLink: vi.fn(),
	verifyMagicLink: vi.fn(),
}))

import { GET, POST } from '@/routes/api/auth/login/verify'
import { peekMagicLink, verifyMagicLink } from '@/server/api/auth/magic-link'
import { hasProbableSession } from '../sync-session'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
	vi.clearAllMocks()
	buckets.clear()
})

// Models the browser's HttpOnly visibility rule; not under test.
function simulateDocumentCookie(setCookieHeaders: string[]): string {
	return setCookieHeaders
		.filter((header) => !/;\s*HttpOnly/i.test(header))
		.map((header) => header.split(';')[0])
		.join('; ')
}

async function signInAndGetSetCookieHeaders(): Promise<string[]> {
	asMock(peekMagicLink).mockResolvedValueOnce({ email: 'user@example.com' })
	const getRes = await GET({
		request: new Request('https://app.test/api/auth/login/verify?token=good-token'),
	})
	const csrfMatch = (getRes.headers.get('Set-Cookie') ?? '').match(/ml_csrf=([^;]*)/)
	const csrf = csrfMatch?.[1] ?? ''

	asMock(verifyMagicLink).mockResolvedValueOnce({
		userId: '11111111-1111-1111-1111-111111111111',
		paddleId: 'pad_1',
		email: 'user@example.com',
	})
	const postRes = await POST({
		request: new Request('https://app.test/api/auth/login/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `ml_csrf=${csrf}` },
			body: new URLSearchParams({ token: 'good-token', csrf }),
		}),
	})
	return postRes.headers.getSetCookie()
}

describe('cross-device sync data-loss repro: real Set-Cookie -> simulated document.cookie', () => {
	it('LOAD-BEARING: the real session cookie is HttpOnly and the has_session marker is not — this is the fact the rest of this file derives from', async () => {
		const setCookieHeaders = await signInAndGetSetCookieHeaders()

		const sessionHeader = setCookieHeaders.find((h) => h.startsWith('session='))
		const hasSessionHeader = setCookieHeaders.find((h) => h.startsWith('has_session='))

		expect(sessionHeader).toBeDefined()
		expect(sessionHeader).toMatch(/;\s*HttpOnly/i)
		expect(hasSessionHeader).toBeDefined()
		expect(hasSessionHeader).not.toMatch(/;\s*HttpOnly/i)
	})

	it("DERIVED: applying the browser's fixed HttpOnly rule to that fact, only has_session would ever reach document.cookie in a real browser", async () => {
		const setCookieHeaders = await signInAndGetSetCookieHeaders()
		const simulated = simulateDocumentCookie(setCookieHeaders)

		// Anchored: `has_session=` contains "session=", so a plain toContain would pass wrongly.
		expect(/(?:^|;\s*)session=/.test(simulated)).toBe(false)
		expect(simulated).toContain('has_session=1')
	})

	it('DERIVED: SyncProvider.hasProbableSession is TRUE against that real post-login browser cookie jar', async () => {
		const setCookieHeaders = await signInAndGetSetCookieHeaders()
		const simulated = simulateDocumentCookie(setCookieHeaders)

		expect(hasProbableSession(simulated)).toBe(true)
	})
})
