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
 * state and resolves via the client `checkAccess()` round-trip, which since story
 * 83.1 (FR136) is `GET /api/auth/me`. `fetch` is stubbed so that path is
 * deterministic. (Before 83.1 the hook `import()`ed `server/api/data/forecasting`
 * in the browser, which in the production bundle failed on `Buffer` and locked a
 * paid user out: MEASURED, story 83.1 M3.)
 */

import { render, screen, waitFor } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SessionSeed, SessionSeedProvider } from '../../context/session-seed'
import { usePremiumAccess } from '../usePremiumAccess'

const fetchMock = vi.fn()

/** A `/api/auth/me` answer: `{ user }` as the route sends it. */
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

    // Resolved synchronously — no loading flash.
    expect(val('isLoading')).toBe('false')
    expect(val('hasAccess')).toBe('true')
    expect(val('isAuthenticated')).toBe('true')
    expect(val('subscriptionStatus')).toBe('active')
    // The whole point: a seeded paint never round-trips to the server.
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
    expect(fetchMock).not.toHaveBeenCalled()
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

    // First paint: loading (fail-closed) until the client check resolves.
    expect(val('isLoading')).toBe('true')

    await waitFor(() => expect(val('isLoading')).toBe('false'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/me')
    expect(val('hasAccess')).toBe('false')
    expect(val('isAuthenticated')).toBe('true')
    expect(val('subscriptionStatus')).toBe('free')
  })

  it.each(['active', 'lifetime'] as const)(
    'a %s user with no seed ends with access (story 83.1, FR136 AC-2)',
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
      // The payload is unvalidated JSON; a newer server's status, or a prototype
      // key, must not unlock anything or be echoed as a status.
      fetchMock.mockResolvedValue(meResponse({ user: { ...PAID_USER, subscriptionStatus } }))

      renderWithSeed(null)

      await waitFor(() => expect(val('isLoading')).toBe('false'))
      expect(val('hasAccess')).toBe('false')
      expect(val('isAuthenticated')).toBe('true')
      expect(val('subscriptionStatus')).toBe('free')
    }
  )

  it('a signed-out answer ({ user: null }) is NOT authenticated, exactly like a signed-out seed', async () => {
    // ⚠️ Story 83.1. The old server check answered `{hasAccess:false,
    // subscriptionStatus:'free'}` for no session and the hook then set
    // `isAuthenticated: true` on EVERY successful check, so a signed-out visitor
    // was reported as a signed-in free user. The re-check now goes through
    // `seedToStatus`, the same rule as the SSR seed.
    fetchMock.mockResolvedValue(meResponse({ user: null }))

    renderWithSeed(null)

    await waitFor(() => expect(val('isLoading')).toBe('false'))
    expect(val('hasAccess')).toBe('false')
    expect(val('isAuthenticated')).toBe('false')
    expect(val('subscriptionStatus')).toBe('null')
  })

  /**
   * The ERRORED path — every shape it can take.
   *
   * ⚠️ Added by the story 33.3 code review, which found this pinned nowhere.
   * Every premium gate in the app is fail-closed *by relying on this*: they
   * branch on `hasAccess` alone and carry no separate error branch, precisely
   * because an errored check is supposed to resolve to `hasAccess: false`. That
   * made the contract load-bearing for `CategoryPicker`, `PremiumFeatureGate`,
   * `CategoriesPage`, `ReportPage` and the story 33.3 Category column — while
   * resting entirely on reading the source.
   *
   * A non-OK answer and an unreadable body take the hook's fallback branch; a
   * THROWN fetch takes the catch. All must land fail-closed, and `isLoading`
   * must clear either way — a gate stuck loading forever is its own defect.
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
    // A network failure: `fetch` rejects instead of answering.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    renderWithSeed(null)

    await waitFor(() => expect(val('isLoading')).toBe('false'))
    expect(val('hasAccess')).toBe('false')
    expect(val('isAuthenticated')).toBe('false')
  })
})
