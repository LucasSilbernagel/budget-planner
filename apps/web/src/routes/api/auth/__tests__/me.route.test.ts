import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/api/auth/paddle', () => ({
	getCurrentUserSession: vi.fn(),
}))

vi.mock('@/server/api/auth/session-renewal', () => ({
	appendSessionRenewal: vi.fn((headers: Headers) => headers),
}))

import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { appendSessionRenewal } from '@/server/api/auth/session-renewal'
import { GET } from '../me'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const req = () => new Request('https://app.test/api/auth/me')

function session(billingInterval: 'month' | 'year' | null) {
	return {
		userId: 'u1',
		email: 'user@example.com',
		paddleId: 'ctm_1',
		subscriptionStatus: 'active',
		currency: 'EUR',
		billingInterval,
		isAuthenticated: true,
	}
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/auth/me', () => {
	it.each(['month', 'year', null] as const)(
		'returns billingInterval=%s so Settings can name the plan',
		async (billingInterval) => {
			asMock(getCurrentUserSession).mockResolvedValue({
				success: true,
				data: session(billingInterval),
			})

			const body = (await (await GET({ request: req() })).json()) as {
				user: { billingInterval?: unknown }
			}

			// `toHaveProperty` fails on a dropped key; `toBe(null)` would not.
			expect(body.user).toHaveProperty('billingInterval', billingInterval)
		}
	)

	it('forwards the renewed session cookies on a signed-in answer', async () => {
		const data = session('year')
		asMock(getCurrentUserSession).mockResolvedValue({ success: true, data })
		asMock(appendSessionRenewal).mockImplementationOnce((headers: Headers) => {
			headers.append('Set-Cookie', 'session=renewed; Path=/')
			return headers
		})

		const res = await GET({ request: req() })

		expect(appendSessionRenewal).toHaveBeenCalledWith(expect.any(Headers), data)
		expect(res.headers.getSetCookie()).toEqual(['session=renewed; Path=/'])
	})

	it('returns {user:null} for an unauthenticated request (unchanged)', async () => {
		asMock(getCurrentUserSession).mockResolvedValue({ success: true, data: null })
		const res = await GET({ request: req() })
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ user: null })
	})
})
