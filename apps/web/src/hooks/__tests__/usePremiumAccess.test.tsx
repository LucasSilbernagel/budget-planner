import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/utils'
import { type SessionSeed, SessionSeedProvider } from '../../context/session-seed'
import { usePremiumAccess } from '../usePremiumAccess'

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
	paddleId: 'ctm_1',
	subscriptionStatus: 'active',
	billingInterval: 'year',
	currency: 'EUR',
	isAuthenticated: true,
}

function Probe() {
	const { status } = usePremiumAccess()
	return (
		<dl>
			<dd data-testid="isLoading">{String(status.isLoading)}</dd>
			<dd data-testid="hasAccess">{String(status.hasAccess)}</dd>
			<dd data-testid="isAuthenticated">{String(status.isAuthenticated)}</dd>
			<dd data-testid="subscriptionStatus">{String(status.subscriptionStatus)}</dd>
		</dl>
	)
}

function renderWithSeed(seed: SessionSeed | null) {
	return render(
		<SessionSeedProvider seed={seed}>
			<Probe />
		</SessionSeedProvider>
	)
}

const val = (id: string) => screen.getByTestId(id).textContent

beforeEach(() => {
	vi.clearAllMocks()
	vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('usePremiumAccess — SSR seed (story UX-1)', () => {
	it('an active seed resolves to premium on the first paint, with no client check', () => {
		renderWithSeed({
			isAuthenticated: true,
			userId: 'user-1',
			email: 'user@example.com',
			subscriptionStatus: 'active',
		})

		expect(val('isLoading')).toBe('false')
		expect(val('hasAccess')).toBe('true')
		expect(val('isAuthenticated')).toBe('true')
		expect(val('subscriptionStatus')).toBe('active')
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it.each(['free', 'past_due', 'canceled'] as const)(
		'a %s seed resolves to authenticated-but-no-access, fail-closed, no client check',
		(subscriptionStatus) => {
			renderWithSeed({
				isAuthenticated: true,
				userId: 'user-1',
				email: 'user@example.com',
				subscriptionStatus,
			})

			expect(val('isLoading')).toBe('false')
			expect(val('hasAccess')).toBe('false')
			expect(val('isAuthenticated')).toBe('true')
			expect(val('subscriptionStatus')).toBe(subscriptionStatus)
			expect(fetchMock).not.toHaveBeenCalled()
		}
	)

	it('a lifetime seed resolves to premium — a permanent purchase is entitled, like active', () => {
		// `lifetime` is the second entitled state, easily lost by simplifying to `=== 'active'`.
		renderWithSeed({
			isAuthenticated: true,
			userId: 'user-1',
			email: 'user@example.com',
			subscriptionStatus: 'lifetime',
		})

		expect(val('isLoading')).toBe('false')
		expect(val('hasAccess')).toBe('true')
		expect(val('isAuthenticated')).toBe('true')
		expect(val('subscriptionStatus')).toBe('lifetime')
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('is fail-closed by construction: a not-authenticated seed never yields premium even if subscriptionStatus is active', () => {
		renderWithSeed({
			isAuthenticated: false,
			userId: null,
			email: null,
			subscriptionStatus: 'active',
		})

		expect(val('isLoading')).toBe('false')
		expect(val('hasAccess')).toBe('false')
		expect(val('isAuthenticated')).toBe('false')
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('a signed-out seed resolves to unauthenticated / no access, no client check', () => {
		renderWithSeed({
			isAuthenticated: false,
			userId: null,
			email: null,
			subscriptionStatus: null,
		})

		expect(val('isLoading')).toBe('false')
		expect(val('hasAccess')).toBe('false')
		expect(val('isAuthenticated')).toBe('false')
		expect(val('subscriptionStatus')).toBe('null')
		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe('usePremiumAccess — no seed (pre-UX-1 fallback)', () => {
	it('starts loading and resolves via GET /api/auth/me when there is no seed', async () => {
		fetchMock.mockResolvedValue(meResponse({ user: { ...PAID_USER, subscriptionStatus: 'free' } }))

		renderWithSeed(null)

		expect(val('isLoading')).toBe('true')

		await waitFor(() => expect(val('isLoading')).toBe('false'))
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/me')
		expect(val('hasAccess')).toBe('false')
		expect(val('isAuthenticated')).toBe('true')
		expect(val('subscriptionStatus')).toBe('free')
	})

	it.each(['active', 'lifetime'] as const)(
		'a %s user with no seed ends with access',
		async (subscriptionStatus) => {
			fetchMock.mockResolvedValue(meResponse({ user: { ...PAID_USER, subscriptionStatus } }))

			renderWithSeed(null)

			await waitFor(() => expect(val('isLoading')).toBe('false'))
			expect(val('hasAccess')).toBe('true')
			expect(val('isAuthenticated')).toBe('true')
			expect(val('subscriptionStatus')).toBe(subscriptionStatus)
		}
	)

	it('past_due has no premium features, as the seed rule says', async () => {
		fetchMock.mockResolvedValue(
			meResponse({ user: { ...PAID_USER, subscriptionStatus: 'past_due' } })
		)

		renderWithSeed(null)

		await waitFor(() => expect(val('isLoading')).toBe('false'))
		expect(val('hasAccess')).toBe('false')
		expect(val('isAuthenticated')).toBe('true')
	})

	it.each(['trialing', 'constructor', 42])(
		'an unknown status (%s) from the server grants nothing',
		async (subscriptionStatus) => {
			// The payload is unvalidated JSON; an unknown status or a prototype key must not unlock anything.
			fetchMock.mockResolvedValue(meResponse({ user: { ...PAID_USER, subscriptionStatus } }))

			renderWithSeed(null)

			await waitFor(() => expect(val('isLoading')).toBe('false'))
			expect(val('hasAccess')).toBe('false')
			expect(val('isAuthenticated')).toBe('true')
			expect(val('subscriptionStatus')).toBe('free')
		}
	)

	it('a signed-out answer ({ user: null }) is NOT authenticated, exactly like a signed-out seed', async () => {
		fetchMock.mockResolvedValue(meResponse({ user: null }))

		renderWithSeed(null)

		await waitFor(() => expect(val('isLoading')).toBe('false'))
		expect(val('hasAccess')).toBe('false')
		expect(val('isAuthenticated')).toBe('false')
		expect(val('subscriptionStatus')).toBe('null')
	})

	/**
	 * Every premium gate relies on an errored check resolving to `hasAccess: false`, and `isLoading`
	 * must clear either way.
	 */
	it('a 503 (session could not be resolved) resolves fail-closed, not stuck loading', async () => {
		fetchMock.mockResolvedValue(meResponse({ success: false, error: 'db down' }, 503))

		renderWithSeed(null)

		await waitFor(() => expect(val('isLoading')).toBe('false'))
		expect(val('hasAccess')).toBe('false')
		expect(val('isAuthenticated')).toBe('false')
	})

	it.each([
		['a non-JSON body', 'upstream <html> error page'],
		['a body with no user key', { ok: true }],
		['a user with no id', { user: { subscriptionStatus: 'active' } }],
	])('%s on a 200 resolves fail-closed', async (_label, body) => {
		fetchMock.mockResolvedValue(meResponse(body))

		renderWithSeed(null)

		await waitFor(() => expect(val('isLoading')).toBe('false'))
		expect(val('hasAccess')).toBe('false')
		expect(val('isAuthenticated')).toBe('false')
	})

	it('a THROWN check resolves fail-closed too — the catch branch, not the fallback branch', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

		renderWithSeed(null)

		await waitFor(() => expect(val('isLoading')).toBe('false'))
		expect(val('hasAccess')).toBe('false')
		expect(val('isAuthenticated')).toBe('false')
	})
})
