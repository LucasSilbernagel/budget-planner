/**
 * AuthIndicator tests (Story 13-2).
 *
 * The persistent signed-in / Premium indicator mounted as a top strip in
 * `__root.tsx`:
 *  - signed-out (or a failed session fetch) shows a "Sign in" affordance to
 *    `/login` and NEVER an email or a Premium marker (AC-2, AC-4 fail-closed);
 *  - a signed-in user sees their email; the "Premium" marker appears ONLY when
 *    `subscriptionStatus === 'active'` (AC-1, AC-3) — never for
 *    free / past_due / canceled;
 *  - the component resolves the session via a plain `fetch('/api/auth/me')`
 *    (no react-query, no `checkPremiumAccessServer`), mirroring AccountSection.
 *
 * Session state resolves in a post-mount effect, so assertions await `findBy*`
 * (or a `waitFor` proof of resolution) before checking absence. Rendered through
 * `renderWithRouter` because the signed-out state uses a `<Link>`.
 */

import { act, render, renderWithRouter, screen, within } from '@/test/utils'
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthIndicator } from '../auth-indicator'

const originalFetch = global.fetch

/** Route `fetch` by URL: /api/auth/me → `user` (or a network failure). */
function stubFetch({ user, fail }: { user?: unknown; fail?: boolean }) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/me')) {
      if (fail) {
        return Promise.reject(new Error('network down'))
      }
      return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof global.fetch
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

/**
 * Render `AuthIndicator` inside a real two-route memory router so a navigation
 * can be driven imperatively (the throwaway single-route `renderWithRouter`
 * cannot change the pathname). Returns the router so tests can `navigate`.
 */
function renderWithNavigableRouter() {
  // jsdom has no `window.scrollTo`; TanStack's scroll restoration calls it on
  // navigation and would log a noisy "not implemented" error. Stub it.
  window.scrollTo = (() => {}) as typeof window.scrollTo
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <AuthIndicator />
        <Outlet />
        <Link to="/other">go-other</Link>
      </>
    ),
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div>home</div>,
  })
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/other',
    component: () => <div>other</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, otherRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  return { router }
}

describe('AuthIndicator', () => {
  it('shows a "Sign in" link to /login and no account info when signed out — AC-2', async () => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />)

    const signIn = await screen.findByRole('link', { name: /sign in/i })
    expect(signIn).toHaveAttribute('href', '/login')
    expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
  })

  it('fails closed to the signed-out affordance if the session fetch rejects — AC-4', async () => {
    stubFetch({ fail: true })
    renderWithRouter(<AuthIndicator />)

    expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
    expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
  })

  it('shows the email and a Premium marker for an active subscription — AC-1, AC-3', async () => {
    stubFetch({
      user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' },
    })
    renderWithRouter(<AuthIndicator />)

    const indicator = await screen.findByRole('status')
    expect(await within(indicator).findByText('user@example.com')).toBeInTheDocument()
    expect(within(indicator).getByText(/^premium$/i)).toBeInTheDocument()
    // Signed-in: no "Sign in" affordance.
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it.each(['free', 'past_due', 'canceled'])(
    'shows the email but NO Premium marker for a %s subscription — AC-3',
    async (subscriptionStatus) => {
      stubFetch({
        user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus },
      })
      renderWithRouter(<AuthIndicator />)

      // Wait for the session to resolve (email present) before asserting absence.
      expect(await screen.findByText('user@example.com')).toBeInTheDocument()
      expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
    }
  )

  it('keeps a stable indicator container through loading → resolved (no layout collapse) — AC-5', async () => {
    // Hold the session fetch open so the loading state is observable: the strip
    // container must already exist (height reserved) BEFORE the session resolves,
    // rather than mounting nothing and shifting layout when it does.
    let resolveFetch: (value: Response) => void = () => {}
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/me')) {
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof global.fetch

    renderWithRouter(<AuthIndicator />)

    // Loading state: container present, but no account info / affordance yet.
    const indicator = await screen.findByRole('status')
    expect(indicator).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()

    // Resolve to signed-out; the SAME container stays mounted.
    resolveFetch(new Response(JSON.stringify({ user: null }), { status: 200 }))
    expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBe(indicator)
  })

  it('re-resolves on navigation so it does not show a stale identity after sign-out — AC-1', async () => {
    // First load: an active Premium user.
    let currentUser: unknown = {
      userId: 'user-1',
      email: 'user@example.com',
      subscriptionStatus: 'active',
    }
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify({ user: currentUser }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof global.fetch

    const { router } = renderWithNavigableRouter()
    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByText(/^premium$/i)).toBeInTheDocument()

    // Session ends elsewhere (e.g. a client-side sign-out): /api/auth/me now
    // returns no user. Navigating must drop the stale email + Premium marker.
    currentUser = null
    await act(async () => {
      await router.navigate({ to: '/other' })
    })

    expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByText('user@example.com')).not.toBeInTheDocument()
    expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
  })

  it('treats a user object without an email as signed-out (no render crash) — AC-2 defensive', async () => {
    // Contract-drift guard: an authenticated-looking payload missing `email`
    // must not deref `undefined.charAt(0)` and white-screen the app root.
    stubFetch({ user: { userId: 'user-1', subscriptionStatus: 'active' } })
    renderWithRouter(<AuthIndicator />)

    expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
    expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
  })
})
