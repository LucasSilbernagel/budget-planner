/**
 * SyncProvider Gating Tests (Story 5-15)
 *
 * The provider is the single gate that decides whether multi-device sync runs:
 *  - unauthenticated / free → no useSync, no bridge registration, no network sync.
 *  - authenticated paid (active | past_due) → mounts useSync and registers the
 *    push queue with the bridge, then seeds via an initial pull.
 *
 * `useSync` and the sync bridge are mocked so the test asserts the wiring
 * decisions, not the service internals. `fetch` (the /api/auth/me probe) is
 * stubbed — no real network (NFR8).
 */

import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registerSyncBridge = vi.fn()
const clearSyncBridge = vi.fn()
const useSyncMock = vi.fn()
const seedOnce = vi.fn(async () => 0)

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
import { SyncProvider } from '../SyncProvider'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const forcePull = vi.fn(async () => undefined)

function stubMe(user: { userId: string; subscriptionStatus: string } | null, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ user }), { status: ok ? 200 : 401 }))
  )
}

// The probe is skipped entirely when no `session` cookie is present (review P3), so
// authenticated-path tests must set one; the anonymous test clears it.
function setSessionCookie() {
  document.cookie = 'session=test-token'
}
function clearSessionCookie() {
  document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
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
  // Bridge registration is gated on a reconciled REAL server profile (review P1);
  // these tests assert registration, so anchor a server-backed active profile.
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

    // No session cookie → the probe is skipped entirely; nothing mounts.
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
    // Bridge handle carries the session userId + the three queue functions.
    expect(registerSyncBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SESSION_USER_ID,
        queueCreate: expect.any(Function),
        queueUpdate: expect.any(Function),
        queueDelete: expect.any(Function),
      })
    )
    // Seeds local state with an immediate pull.
    await waitFor(() => expect(forcePull).toHaveBeenCalledTimes(1))
  })

  it('also mounts for a PAST_DUE subscriber (dunning window keeps sync)', async () => {
    stubMe({ userId: SESSION_USER_ID, subscriptionStatus: 'past_due' })
    render(<SyncProvider />)
    await waitFor(() => expect(registerSyncBridge).toHaveBeenCalledTimes(1))
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
    // Bootstrap placeholder profile (userId ''): not server-backed.
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

    // The component mounts and instantiates useSync (poller/pull can run) ...
    await waitFor(() => expect(useSyncMock).toHaveBeenCalled())
    // ... but with no reconciled server profile, the PUSH bridge is NOT registered
    // (no op would carry a valid profileId) and seeding does not run.
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
