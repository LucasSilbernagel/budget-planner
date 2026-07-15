/**
 * usePremiumAccess tests (story UX-1).
 *
 * Focus: the SSR session seed makes the first paint correct. When the hook is
 * rendered inside a <SessionSeedProvider>, `status` resolves synchronously from
 * the seed (`isLoading: false`) and the client access check is NOT run — so there
 * is no skeleton flash and (critically) a paid user never flashes a lock. Access
 * still requires an *active* subscription; every other state is fail-closed.
 *
 * Without a seed the hook keeps its pre-UX-1 behaviour: it starts in the loading
 * state and resolves via the client `checkAccess()` round-trip. The dynamically
 * imported server module is mocked so that path is deterministic and never
 * touches a real server import in jsdom.
 */

import { render, screen, waitFor } from '@/test/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type SessionSeed, SessionSeedProvider } from '../../context/session-seed'
import { usePremiumAccess } from '../usePremiumAccess'

const checkPremiumAccessServer = vi.fn()

vi.mock('../../server/api/data/forecasting', () => ({
  checkPremiumAccessServer: (request: Request) => checkPremiumAccessServer(request),
}))

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
})

describe('usePremiumAccess — SSR seed (story UX-1)', () => {
  it('an active seed resolves to premium on the first paint, with no client check', () => {
    renderWithSeed({
      isAuthenticated: true,
      userId: 'user-1',
      email: 'user@example.com',
      subscriptionStatus: 'active',
    })

    // Resolved synchronously — no loading flash.
    expect(val('isLoading')).toBe('false')
    expect(val('hasAccess')).toBe('true')
    expect(val('isAuthenticated')).toBe('true')
    expect(val('subscriptionStatus')).toBe('active')
    // The whole point: a seeded paint never round-trips to the server.
    expect(checkPremiumAccessServer).not.toHaveBeenCalled()
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
      expect(checkPremiumAccessServer).not.toHaveBeenCalled()
    }
  )

  it('is fail-closed by construction: a not-authenticated seed never yields premium even if subscriptionStatus is active', () => {
    // A malformed/unexpected seed (not authenticated but tagged active) must NOT
    // unlock premium — hasAccess is gated on isAuthenticated.
    renderWithSeed({
      isAuthenticated: false,
      userId: null,
      email: null,
      subscriptionStatus: 'active',
    })

    expect(val('isLoading')).toBe('false')
    expect(val('hasAccess')).toBe('false')
    expect(val('isAuthenticated')).toBe('false')
    expect(checkPremiumAccessServer).not.toHaveBeenCalled()
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
    expect(checkPremiumAccessServer).not.toHaveBeenCalled()
  })
})

describe('usePremiumAccess — no seed (pre-UX-1 fallback)', () => {
  it('starts loading and resolves via the client check when there is no seed', async () => {
    checkPremiumAccessServer.mockResolvedValue({
      success: true,
      data: { hasAccess: false, subscriptionStatus: 'free' },
    })

    renderWithSeed(null)

    // First paint: loading (fail-closed) until the client check resolves.
    expect(val('isLoading')).toBe('true')

    await waitFor(() => expect(val('isLoading')).toBe('false'))
    expect(checkPremiumAccessServer).toHaveBeenCalledTimes(1)
    expect(val('hasAccess')).toBe('false')
  })
})
