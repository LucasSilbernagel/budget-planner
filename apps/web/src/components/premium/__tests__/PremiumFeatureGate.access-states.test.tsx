import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/utils'
import { type SessionSeed, SessionSeedProvider } from '../../../context/session-seed'
import { resetVerifiedSessionForTests } from '../../../lib/session/verifiedSession'
import { PremiumFeatureGate } from '../PremiumFeatureGate'

const fetchMock = vi.fn()

function meResponse(body: unknown, status = 200): Response {
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

const PAID_USER = {
	userId: 'user-1',
	email: 'user@example.com',
	subscriptionStatus: 'active',
}

function renderGate(seed: SessionSeed | null) {
	return render(
		<SessionSeedProvider seed={seed}>
			<PremiumFeatureGate featureName="Advanced Forecasting" locked={<span>Forecasting</span>}>
				<a href="/forecasting">Open forecasting</a>
			</PremiumFeatureGate>
		</SessionSeedProvider>
	)
}

const unlocked = () => screen.queryByRole('link', { name: 'Open forecasting' })
const locked = () => screen.queryByTestId('premium-gate-locked')
const pending = () => screen.queryByTestId('premium-gate-skeleton')

function expectLocked(): void {
	expect(locked()).toBeInTheDocument()
	expect(unlocked()).not.toBeInTheDocument()
}

function expectUnlocked(): void {
	expect(unlocked()).toBeInTheDocument()
	expect(locked()).not.toBeInTheDocument()
}

const seedWith = (subscriptionStatus: SessionSeed['subscriptionStatus']): SessionSeed => ({
	isAuthenticated: true,
	userId: 'user-1',
	email: 'user@example.com',
	subscriptionStatus,
})

beforeEach(() => {
	vi.clearAllMocks()
	vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
	vi.unstubAllGlobals()
	resetVerifiedSessionForTests()
})

describe('PremiumFeatureGate under an SSR seed', () => {
	it.each(['active', 'lifetime'] as const)(
		'a %s seed unlocks on the first paint, with no client check',
		(subscriptionStatus) => {
			renderGate(seedWith(subscriptionStatus))

			expectUnlocked()
			expect(pending()).not.toBeInTheDocument()
			expect(fetchMock).not.toHaveBeenCalled()
		}
	)

	it.each(['free', 'past_due', 'canceled'] as const)(
		'a %s seed locks on the first paint, with no client check',
		(subscriptionStatus) => {
			renderGate(seedWith(subscriptionStatus))

			expectLocked()
			expect(fetchMock).not.toHaveBeenCalled()
		}
	)

	it.each([
		['a signed-out seed', null],
		['a malformed signed-out seed claiming active', 'active'],
	] as const)('%s locks, with no client check', (_label, subscriptionStatus) => {
		renderGate({ isAuthenticated: false, userId: null, email: null, subscriptionStatus })

		expectLocked()
		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe('PremiumFeatureGate with no seed asks /api/auth/me', () => {
	it('shows the skeleton until the answer arrives, then locks a free user', async () => {
		fetchMock.mockResolvedValue(meResponse({ user: { ...PAID_USER, subscriptionStatus: 'free' } }))

		renderGate(null)

		expect(pending()).toBeInTheDocument()
		expect(unlocked()).not.toBeInTheDocument()
		await waitFor(() => expect(pending()).not.toBeInTheDocument())
		expectLocked()
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/me')
	})

	it.each(['active', 'lifetime'] as const)('a %s answer unlocks', async (subscriptionStatus) => {
		fetchMock.mockResolvedValue(meResponse({ user: { ...PAID_USER, subscriptionStatus } }))

		renderGate(null)

		await waitFor(() => expect(unlocked()).toBeInTheDocument())
		expect(locked()).not.toBeInTheDocument()
	})

	// The payload is unvalidated JSON, so an unknown status or a prototype key must unlock nothing.
	it.each([
		['past_due', meResponse({ user: { ...PAID_USER, subscriptionStatus: 'past_due' } })],
		['an unknown status', meResponse({ user: { ...PAID_USER, subscriptionStatus: 'trialing' } })],
		['a prototype key', meResponse({ user: { ...PAID_USER, subscriptionStatus: 'constructor' } })],
		['a numeric status', meResponse({ user: { ...PAID_USER, subscriptionStatus: 42 } })],
		['a signed-out answer', meResponse({ user: null })],
		['a 503', meResponse({ success: false, error: 'db down' }, 503)],
		['a non-JSON 200', meResponse('upstream <html> error page')],
		['a 200 with no user key', meResponse({ ok: true })],
		['a user with no id', meResponse({ user: { subscriptionStatus: 'active' } })],
	])('%s locks rather than staying on the skeleton', async (_label, response) => {
		fetchMock.mockResolvedValue(response)

		renderGate(null)

		await waitFor(() => expect(pending()).not.toBeInTheDocument())
		expectLocked()
	})

	it('a network failure locks rather than staying on the skeleton', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

		renderGate(null)

		await waitFor(() => expect(pending()).not.toBeInTheDocument())
		expectLocked()
	})
})
