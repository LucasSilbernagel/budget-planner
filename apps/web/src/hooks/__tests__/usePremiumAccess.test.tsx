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

  it('a lifetime seed resolves to premium — a permanent purchase is entitled, like active', () => {
    // ⚠️ `lifetime` (story 25-2) is the SECOND entitled state and the one that
    // gets dropped when someone "simplifies" an entitlement check to
    // `subscriptionStatus === 'active'`. Added by the story 33.3 code review,
    // which found this mapping pinned NOWHERE despite the Category-column gate
    // (and every other `hasAccess` consumer) depending on it.
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
    expect(checkPremiumAccessServer).not.toHaveBeenCalled()
  })

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

  /**
   * The ERRORED path — both shapes it can take.
   *
   * ⚠️ Added by the story 33.3 code review, which found this pinned nowhere.
   * Every premium gate in the app is fail-closed *by relying on this*: they
   * branch on `hasAccess` alone and carry no separate error branch, precisely
   * because an errored check is supposed to resolve to `hasAccess: false`. That
   * made the contract load-bearing for `CategoryPicker`, `PremiumFeatureGate`,
   * `CategoriesPage`, `ReportPage` and the story 33.3 Category column — while
   * resting entirely on reading the source.
   *
   * The two shapes are genuinely different code paths in the hook: a RESOLVED
   * failure envelope (`success: false`) takes the fallback branch, while a
   * THROWN error takes the catch. Both must land fail-closed, and `isLoading`
   * must clear either way — a gate stuck loading forever is its own defect.
   */
  it('a failed check (success: false) resolves fail-closed, not stuck loading', async () => {
    checkPremiumAccessServer.mockResolvedValue({
      success: false,
      error: 'subscription lookup failed',
    })

    renderWithSeed(null)

    await waitFor(() => expect(val('isLoading')).toBe('false'))
    expect(val('hasAccess')).toBe('false')
    expect(val('isAuthenticated')).toBe('false')
  })

  it('a THROWN check resolves fail-closed too — the catch branch, not the fallback branch', async () => {
    // The real-world instance of this is the known "Buffer is not defined"
    // failure on the no-seed client path: the dynamic server import throws
    // rather than returning an envelope.
    checkPremiumAccessServer.mockRejectedValue(new Error('Buffer is not defined'))

    renderWithSeed(null)

    await waitFor(() => expect(val('isLoading')).toBe('false'))
    expect(val('hasAccess')).toBe('false')
    expect(val('isAuthenticated')).toBe('false')
  })
})
