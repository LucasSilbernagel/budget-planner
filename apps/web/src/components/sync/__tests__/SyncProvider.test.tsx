import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registerSyncBridge = vi.fn()
const clearSyncBridge = vi.fn()
const useSyncMock = vi.fn()
const seedOnce = vi.fn(async (_userId: string) => 0)

vi.mock('@/lib/sync/syncBridge', () => ({
	registerSyncBridge: (...args: unknown[]) => registerSyncBridge(...args),
	clearSyncBridge: (...args: unknown[]) => clearSyncBridge(...args),
}))

vi.mock('@/lib/sync/seedLocalData', () => ({
	seedOnce: (...args: unknown[]) => seedOnce(...(args as [string])),
}))

vi.mock('@/hooks/useSync', () => ({
	useSync: (...args: unknown[]) => useSyncMock(...args),
}))

import { useProfileStore } from '@/stores/profileStore'
import { hasProbableSession, SyncProvider } from '../SyncProvider'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const forcePull = vi.fn(async () => undefined)

function stubMe(user: { userId: string; subscriptionStatus: string } | null, ok = true) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ user }), { status: ok ? 200 : 401 }))
	)
}

// The probe only runs when the `has_session` marker cookie is present (the real
// session cookie is HttpOnly).
function setSessionCookie() {
	document.cookie = 'has_session=1'
}
function clearSessionCookie() {
	document.cookie = 'has_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
}

beforeEach(() => {
	vi.clearAllMocks()
	setSessionCookie()
	useSyncMock.mockReturnValue({
		queueCreate: vi.fn(),
		queueUpdate: vi.fn(),
		queueDelete: vi.fn(),
		forcePull,
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
	clearSessionCookie()
})

describe('SyncProvider gating', () => {
	// Bridge registration requires a reconciled server-backed active profile.
	beforeEach(() => {
		useProfileStore.setState({
			profiles: [
				{
					id: 'server-p1',
					userId: SESSION_USER_ID,
					name: 'Main',
					isDefault: true,
					currency: 'NONE',
				},
			],
			activeProfileId: 'server-p1',
		})
	})

	it('makes ZERO network calls for an anonymous visitor (no session cookie, review P3)', async () => {
		clearSessionCookie()
		stubMe(null)
		render(<SyncProvider />)

		await waitFor(() => expect(useSyncMock).not.toHaveBeenCalled())
		expect(fetch).not.toHaveBeenCalled()
		expect(registerSyncBridge).not.toHaveBeenCalled()
	})

	it('does NOT mount sync for an authenticated FREE user', async () => {
		stubMe({ userId: SESSION_USER_ID, subscriptionStatus: 'free' })
		render(<SyncProvider />)

		await waitFor(() => expect(fetch).toHaveBeenCalled())
		expect(useSyncMock).not.toHaveBeenCalled()
		expect(registerSyncBridge).not.toHaveBeenCalled()
	})

	it('mounts sync and registers the bridge for an ACTIVE paid user', async () => {
		stubMe({ userId: SESSION_USER_ID, subscriptionStatus: 'active' })
		render(<SyncProvider />)

		await waitFor(() => expect(registerSyncBridge).toHaveBeenCalledTimes(1))
		expect(useSyncMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: SESSION_USER_ID, autoPull: true })
		)
		expect(registerSyncBridge).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: SESSION_USER_ID,
				queueCreate: expect.any(Function),
				queueUpdate: expect.any(Function),
				queueDelete: expect.any(Function),
			})
		)
		await waitFor(() => expect(forcePull).toHaveBeenCalledTimes(1))
	})

	it('also mounts for a PAST_DUE subscriber (dunning window keeps sync)', async () => {
		stubMe({ userId: SESSION_USER_ID, subscriptionStatus: 'past_due' })
		render(<SyncProvider />)
		await waitFor(() => expect(registerSyncBridge).toHaveBeenCalledTimes(1))
	})

	it('also mounts for a LIFETIME buyer (the status the client gate once lacked)', async () => {
		stubMe({ userId: SESSION_USER_ID, subscriptionStatus: 'lifetime' })
		render(<SyncProvider />)
		await waitFor(() => expect(registerSyncBridge).toHaveBeenCalledTimes(1))
	})

	it('does NOT mount sync for a CANCELED subscriber (access has ended)', async () => {
		stubMe({ userId: SESSION_USER_ID, subscriptionStatus: 'canceled' })
		render(<SyncProvider />)

		await waitFor(() => expect(fetch).toHaveBeenCalled())
		expect(useSyncMock).not.toHaveBeenCalled()
		expect(registerSyncBridge).not.toHaveBeenCalled()
	})

	it('clears the bridge on unmount (logout / downgrade teardown)', async () => {
		stubMe({ userId: SESSION_USER_ID, subscriptionStatus: 'active' })
		const { unmount } = render(<SyncProvider />)
		await waitFor(() => expect(registerSyncBridge).toHaveBeenCalledTimes(1))

		unmount()
		expect(clearSyncBridge).toHaveBeenCalled()
	})
})

describe('SyncProvider free→paid seeding + push gate (review P1)', () => {
	it('does NOT register the push bridge OR seed while the active profile is the un-synced bootstrap', async () => {
		useProfileStore.setState({
			profiles: [
				{
					id: 'local-default',
					userId: '',
					name: 'Main Profile',
					isDefault: true,
					currency: 'NONE',
				},
			],
			activeProfileId: 'local-default',
		})
		stubMe({ userId: SESSION_USER_ID, subscriptionStatus: 'active' })
		render(<SyncProvider />)

		await waitFor(() => expect(useSyncMock).toHaveBeenCalled())
		expect(registerSyncBridge).not.toHaveBeenCalled()
		expect(seedOnce).not.toHaveBeenCalled()
	})

	it('registers the bridge and seeds once the active profile is reconciled to a real server profile', async () => {
		useProfileStore.setState({
			profiles: [
				{
					id: 'server-p1',
					userId: SESSION_USER_ID,
					name: 'Main',
					isDefault: true,
					currency: 'NONE',
				},
			],
			activeProfileId: 'server-p1',
		})
		stubMe({ userId: SESSION_USER_ID, subscriptionStatus: 'active' })
		render(<SyncProvider />)

		await waitFor(() => expect(registerSyncBridge).toHaveBeenCalledTimes(1))
		await waitFor(() => expect(seedOnce).toHaveBeenCalledWith(SESSION_USER_ID))
	})
})

describe('hasProbableSession — Story 53.1 cross-device sync fix', () => {
	it('is false with no cookies at all', () => {
		expect(hasProbableSession('')).toBe(false)
	})

	it('is false for the real (HttpOnly) session cookie name alone', () => {
		expect(hasProbableSession('session=abc123')).toBe(false)
	})

	it('is true when the has_session marker is present', () => {
		expect(hasProbableSession('has_session=1')).toBe(true)
	})

	it('is true when has_session is present alongside other cookies', () => {
		expect(hasProbableSession('foo=bar; has_session=1; baz=qux')).toBe(true)
	})
})
