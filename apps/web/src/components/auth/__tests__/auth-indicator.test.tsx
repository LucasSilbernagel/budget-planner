/**
 * AuthIndicator tests (Story 13-2).
 *
 * The persistent signed-in / Premium indicator mounted as a top strip in
 * `__root.tsx`:
 *  - signed-out (or a failed session fetch) shows a "Sign in" affordance to
 *    `/login` and NEVER an email or a Premium marker (AC-2, AC-4 fail-closed) —
 *    on every route EXCEPT `/login` itself, where story 41.3 (UX-DR51) drops the
 *    affordance rather than offer a link to the page already on screen;
 *  - a signed-in user sees their email; the "Premium" marker appears ONLY when
 *    `subscriptionStatus === 'active'` (AC-1, AC-3) — never for
 *    free / past_due / canceled;
 *  - the component resolves the session via a plain `fetch('/api/auth/me')`
 *    (no react-query, no `checkPremiumAccessServer`), mirroring AccountSection.
 *
 * Session state resolves in a post-mount effect, so assertions await `findBy*`
 * (or a `waitFor` proof of resolution) before checking absence. Rendered through
 * `renderWithRouter` because the signed-out state uses a `<Link>`.
 *
 * ⚠️ TWO AC NAMESPACES LIVE IN THIS FILE. The `AC-n` labels on the tests in the
 * first two describes are **story 13-2's** (AC-2 = signed-out affordance, AC-3 =
 * Premium marker, AC-4 = fail-closed, AC-5 = no layout collapse). The labels
 * inside `describe('AuthIndicator — the sign-in page (story 41.3, UX-DR51)')`
 * are **story 41.3's** (AC-1 = no self-link on `/login`, AC-4 = loading and
 * authenticated untouched, AC-5 = authenticated-on-`/login`, AC-6 = the tests
 * cover the contrast). They collide on AC-2 through AC-5 and mean different
 * things in each. Read the enclosing describe before chasing an AC number.
 */

import { act, render, renderWithRouter, screen, waitFor, within } from '@/test/utils'
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type SessionSeed, SessionSeedProvider } from '../../../context/session-seed'
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

/**
 * Hold `/api/auth/me` open so the post-mount refetch never resolves: whatever
 * the strip shows is coming from the SSR seed rather than from a round-trip.
 *
 * ⚠️ It does NOT hold the FIRST paint still, and an earlier version of this
 * comment claimed it did. React Testing Library renders inside `act` and every
 * `findBy*` awaits, so effects have already flushed by the time any assertion
 * runs — a value computed in a `useEffect` is indistinguishable here from one
 * computed during render. Measured: story 41.3's mutation M7b moved its route
 * check into an effect and every test in this file still passed. First-paint
 * claims need `serverRenderAt`, which runs no effects at all.
 *
 * (Deliberately count-free. An earlier version of this note said "19/19", which
 * was already stale by the time the story shipped its twentieth test — the same
 * trap the AC-7 guard's own docblock warns about.)
 */
function stubFetchPending() {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes('/api/auth/me')) {
      return new Promise<Response>(() => {})
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof global.fetch
}

/**
 * Render the strip under an SSR seed. `path` seeds the initial location so a
 * route-dependent branch (story 41.3) can be exercised at first paint; it
 * defaults to `/`, which is what every pre-41.3 caller relies on.
 */
function renderSeeded(seed: SessionSeed | null, path?: string) {
  return renderWithRouter(
    <SessionSeedProvider seed={seed}>
      <AuthIndicator />
    </SessionSeedProvider>,
    path === undefined ? undefined : { path }
  )
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
  // Story 41.3: the strip's unauthenticated branch is route-dependent, so a
  // real `/login` route is needed to drive a client-side navigation into and
  // out of it. `renderWithRouter`'s `path` option can only seed a FIRST paint.
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <div>login</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, otherRoute, loginRoute]),
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

describe('AuthIndicator — SSR seed (story UX-1)', () => {
  it('paints the email + Premium marker for an active seed while the refetch is pending — AC-2, AC-3', async () => {
    stubFetchPending()
    renderSeeded({
      isAuthenticated: true,
      userId: 'user-1',
      email: 'user@example.com',
      subscriptionStatus: 'active',
    })

    // The resolved state appears even though `/api/auth/me` never resolves, so it
    // is the SSR seed — not a round-trip — driving the first paint (no flip).
    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByText(/^premium$/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('paints the email but NO Premium marker for a free seed while the refetch is pending — AC-3', async () => {
    stubFetchPending()
    renderSeeded({
      isAuthenticated: true,
      userId: 'user-1',
      email: 'user@example.com',
      subscriptionStatus: 'free',
    })

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
  })

  it('paints the "Sign in" affordance for a signed-out seed while the refetch is pending — AC-2', async () => {
    stubFetchPending()
    renderSeeded({
      isAuthenticated: false,
      userId: null,
      email: null,
      subscriptionStatus: null,
    })

    expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    expect(screen.queryByText(/premium/i)).not.toBeInTheDocument()
  })
})

/**
 * The sign-in page (story 41.3, UX-DR51).
 *
 * The strip must not offer a link to the page the user is already on. The route
 * check is scoped to the `unauthenticated` branch: `loading` and `authenticated`
 * are untouched everywhere, `/login` included.
 *
 * ⚠️ WHY THIS BLOCK ASSERTS A CONTRAST AND NOT JUST AN ABSENCE. Every other test
 * in this file renders at `renderWithRouter`'s default path `/`, and so does
 * `nav-account-row.test.tsx` and every e2e assertion that existed before this
 * story. All of them stay green against a `/login`-only regression, because they
 * pin the half of the rule that did not move. The paired present/absent
 * assertions below are what make this coverage falsifiable.
 *
 * ⚠️ WHAT THIS BLOCK CANNOT PROVE. jsdom computes no layout — every rect is
 * `{0,0,0,0}` — so nothing here shows the strip does not COLLAPSE. That half of
 * AC-3 is measured in `e2e/auth-indicator.spec.ts`. What these tests do pin is
 * the structural half: the labelled `role="status"` region survives with its
 * height-reserving wrapper intact, and only its children change.
 */
/**
 * Server-render the strip at `path` under a signed-out SSR seed and return the
 * HTML string.
 *
 * `renderToString` executes NO effects, so this is the only layer in the unit
 * suite that can see the FIRST paint. `router.load()` first: without it the
 * router emits an unresolved Suspense boundary (`<!--$--><!--/$-->`) and every
 * assertion against the HTML would pass vacuously. Measured while writing this.
 */
async function serverRenderAt(path: string): Promise<string> {
  const rootRoute = createRootRoute({
    component: () => (
      <SessionSeedProvider
        seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
      >
        <AuthIndicator />
      </SessionSeedProvider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('AuthIndicator — the sign-in page (story 41.3, UX-DR51)', () => {
  it('drops the "Sign in" link on /login and leaves the status region empty — AC-1, AC-3', async () => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />, { path: '/login' })

    const indicator = await screen.findByRole('status', { name: /account status/i })
    // Proof of resolution. Until the session resolves the strip renders the
    // loading placeholder, so asserting "no link" before this point would pass
    // against a component that never became route-aware at all.
    await waitFor(() => {
      expect(indicator.children).toHaveLength(0)
    })

    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
    // The region itself must survive: removing it would trade a dead link for a
    // collapsed strip, which is what AC-3 forbids.
    expect(screen.getByRole('status', { name: /account status/i })).toBe(indicator)
  })

  it('still offers the "Sign in" link on a route that is not /login — AC-2', async () => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />, { path: '/pricing' })

    const signIn = await screen.findByRole('link', { name: /sign in/i })
    expect(signIn).toHaveAttribute('href', '/login')
    // Same region, same accessible name — only the children differ between the
    // two routes.
    const indicator = screen.getByRole('status', { name: /account status/i })
    expect(indicator.contains(signIn)).toBe(true)
  })

  it('drops the link on /login?error=… too, where a failed sign-in lands — AC-1', async () => {
    // `routes/api/auth/login/verify` redirects an expired magic link here, so
    // this is the arrival of the user LEAST helped by an offer to sign in.
    // `location.pathname` excludes the search string, so the exact match holds.
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />, { path: '/login?error=invalid_or_expired' })

    const indicator = await screen.findByRole('status', { name: /account status/i })
    await waitFor(() => {
      expect(indicator.children).toHaveLength(0)
    })
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it.each(['/Login', '/LOGIN', '/lOgIn'])(
    'drops the link on %s too — route matching is case-insensitive, the pathname is not — AC-1',
    async (path) => {
      // ⚠️ FOUND BY CODE REVIEW, and measured against the running app before it
      // was fixed: `/Login` served the login CARD and the strip's "Sign in"
      // link at the same time. TanStack matches routes case-insensitively, but
      // `location.pathname` preserves the case the user typed, and the router
      // does not canonicalise case the way it canonicalises a trailing slash.
      // A bare `===` therefore missed on a URL that really is the sign-in page.
      //
      // All thirteen of this story's mutation arms were blind to this, because
      // not one of them varied the case. A suite proves only what it varies.
      stubFetch({ user: null })
      renderWithRouter(<AuthIndicator />, { path })

      const indicator = await screen.findByRole('status', { name: /account status/i })
      await waitFor(() => {
        expect(indicator.children).toHaveLength(0)
      })
      expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
    }
  )

  it('renders no "Sign in" affordance on /login from a signed-out seed — AC-1', async () => {
    // `/api/auth/me` never resolves here, so what is on screen came from the SSR
    // seed rather than a round-trip.
    //
    // ⚠️ This test does NOT prove there is no first-paint FLASH, and an earlier
    // version of it claimed to. `findByRole` awaits, so React has already
    // flushed effects by the time the assertion runs — measured: computing the
    // route flag in a `useEffect` instead of during render leaves this test
    // GREEN — every test in the file passes — while a real browser paints the
    // link and then removes it.
    // The flash claim is carried by the server-render test below, which runs no
    // effects at all.
    stubFetchPending()
    renderSeeded(
      { isAuthenticated: false, userId: null, email: null, subscriptionStatus: null },
      '/login'
    )

    const indicator = await screen.findByRole('status', { name: /account status/i })
    expect(indicator.children).toHaveLength(0)
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('server-renders /login with the strip but WITHOUT the "Sign in" link — AC-1, no first-paint flash', async () => {
    // ⚠️ THIS is the first-paint assertion. `renderToString` runs no effects, so
    // it sees exactly what the server sends and what React hydrates against —
    // the one render a post-mount computation cannot fake its way through.
    //
    // The `/` arm is a positive control in the same test: without it, "the
    // server HTML has no Sign in link" would be satisfied just as well by a
    // strip that never renders one anywhere.
    //
    // ⚠️ No fetch stub here, deliberately. Every other test in this block holds
    // `/api/auth/me` open to prove the render came from the seed; this one
    // cannot need that, because `renderToString` runs no effects and so never
    // reaches the fetch at all. Stubbing it would imply a network path exists
    // in this test and quietly undercut the argument the test makes.

    const loginHtml = await serverRenderAt('/login')
    const homeHtml = await serverRenderAt('/')

    expect(homeHtml).toContain('Sign in')
    expect(loginHtml).not.toContain('Sign in')
    // The region survives on both — only its children differ.
    expect(loginHtml).toContain('Account status')
    expect(homeHtml).toContain('Account status')
  })

  it('leaves the loading placeholder untouched on /login — AC-4', async () => {
    // No seed → the loading state, held open. The height-reserving placeholder
    // must still render: the route check belongs to the unauthenticated branch
    // only, and the loading state is not a "Sign in" offer to suppress.
    stubFetchPending()
    renderWithRouter(<AuthIndicator />, { path: '/login' })

    const indicator = await screen.findByRole('status', { name: /account status/i })
    expect(indicator.querySelector('span[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('shows the authenticated state on /login exactly as elsewhere — AC-4, AC-5', async () => {
    // `/login` carries no route guard — and neither does any route in this app
    // (`routes/retirement.tsx:42-44`) — so an authenticated user genuinely
    // reaches this page. The strip reports account status; suppressing it here
    // would hide the one signal that explains the page.
    // ⚠️ jsdom-only by necessity: the e2e suite runs unauthenticated and this
    // repo has no session-seeding harness.
    stubFetchPending()
    renderSeeded(
      {
        isAuthenticated: true,
        userId: 'user-1',
        email: 'user@example.com',
        subscriptionStatus: 'active',
      },
      '/login'
    )

    const indicator = await screen.findByRole('status', { name: /account status/i })
    expect(await within(indicator).findByText('user@example.com')).toBeInTheDocument()
    expect(within(indicator).getByText(/^premium$/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('flips the affordance on client-side navigation into and out of /login — AC-6', async () => {
    // The strongest form of the requirement: correct at first paint is not the
    // same as reactive. The strip is mounted once at the root and never
    // remounts, so a route-derived branch that is read only at mount would pass
    // every test above and still be wrong the moment the user navigates.
    stubFetch({ user: null })
    const { router } = renderWithNavigableRouter()

    expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')

    await act(async () => {
      await router.navigate({ to: '/login' })
    })
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('status', { name: /account status/i })).toBeInTheDocument()

    await act(async () => {
      await router.navigate({ to: '/' })
    })
    expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
  })
})
