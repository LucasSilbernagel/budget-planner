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

import { act, render, renderWithRouter, screen, userEvent, waitFor, within } from '@/test/utils'
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

/**
 * Story 59.3 (AC-7): the account menu's Sign out goes through the ONE shared
 * implementation. Wrapped, not replaced, exactly as in
 * `settings/account-section.test.tsx`: the real body still runs, and the spy
 * proves the menu reaches it rather than a copy.
 */
vi.mock('@/lib/account/sign-out', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/account/sign-out')>()
  return {
    ...real,
    signOut: vi.fn(real.signOut),
    returnToSignedOutHome: vi.fn(real.returnToSignedOutHome),
  }
})

import { resetSignOutStateForTests, signOut } from '@/lib/account/sign-out'
import { AuthIndicator } from '../auth-indicator'

/**
 * The labelled live region.
 *
 * ⚠️ Since story 59.3 a signed-in user's email is in the DOM up to THREE times:
 * the `sr-only` copy in this region (what a screen reader hears), the VISIBLE
 * copy in the account-menu trigger, and the panel's "Signed in as …" line while
 * open. An unscoped `getByText(email)` therefore throws "multiple elements".
 * Scope to the element whose claim the assertion makes: announced = this
 * region; visible and truncating = the trigger.
 */
const accountStatus = () => screen.getByRole('status', { name: /account status/i })
/** The same region, awaited: `renderWithRouter` mounts after the router loads. */
const findAccountStatus = () => screen.findByRole('status', { name: /account status/i })

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
  // `signOut()` dedupes at module level; a suite that holds the logout POST
  // open would otherwise leave that promise pending for every later test.
  resetSignOutStateForTests()
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
      expect(
        await within(await findAccountStatus()).findByText('user@example.com')
      ).toBeInTheDocument()
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
    expect(
      await within(await findAccountStatus()).findByText('user@example.com')
    ).toBeInTheDocument()
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

  // Story 59.2 (code review). On the desktop row this strip is a flex item beside
  // the nav. Without `sm:min-w-0` its minimum is its content width, so a long
  // email can never truncate and the nav wraps to 2-3 rows instead (measured).
  // Class TOKENS, because jsdom computes no layout. The rendered row is pinned
  // with a mocked signed-in session in `e2e/nav-more-disclosure.paid.spec.ts`.
  //
  // Story 59.3: the row chrome, `data-auth-indicator` and `sm:min-w-0` moved
  // from the status region to a new OUTER row, because the account-menu
  // trigger must sit OUTSIDE the live region. The email that truncates is now
  // the VISIBLE one, inside the trigger; the region's copy is `sr-only`.
  it('lets the strip yield width on the desktop row so a long email truncates', async () => {
    stubFetch({
      user: {
        userId: 'user-1',
        email: 'a.long.address@example.test',
        subscriptionStatus: 'active',
      },
    })
    const { container } = renderWithRouter(<AuthIndicator />)
    await within(await findAccountStatus()).findByText('a.long.address@example.test')
    const row = container.querySelector('[data-auth-indicator]') as HTMLElement
    expect(row, 'the outer row carries `data-auth-indicator`').not.toBeNull()
    expect(row.contains(accountStatus()), 'the status region sits inside the row').toBe(true)
    const rowTokens = [...row.classList]
    expect(rowTokens, 'the strip cannot shrink below its content on desktop').toContain(
      'sm:min-w-0'
    )
    expect(rowTokens, '`min-w-0` must stay desktop-only').not.toContain('min-w-0')
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    const email = within(trigger).getByText('a.long.address@example.test')
    expect([...email.classList]).toEqual(expect.arrayContaining(['min-w-0', 'truncate']))
    // The trigger itself must be allowed to shrink, or the email never can.
    expect([...trigger.classList]).toContain('min-w-0')
  })
})

describe('AuthIndicator — "Upgrade" affordance (UX review, 2026-09-14)', () => {
  it('offers "Upgrade" to /pricing alongside "Sign in" when signed out', async () => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />)

    const upgrade = await screen.findByRole('link', { name: 'Upgrade' })
    expect(upgrade).toHaveAttribute('href', '/pricing')
    expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
  })

  it('hides "Upgrade" on /pricing itself (self-link) but keeps "Sign in"', async () => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />, { path: '/pricing' })

    expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument()
  })

  it('hides "Upgrade" on /login too — that page keeps its deliberately-empty strip (story 41.3)', async () => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />, { path: '/login' })

    const indicator = await screen.findByRole('status', { name: /account status/i })
    await waitFor(() => {
      expect(indicator.children).toHaveLength(0)
    })
    expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument()
  })

  it('never shows "Upgrade" for an authenticated user', async () => {
    stubFetch({
      user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' },
    })
    renderWithRouter(<AuthIndicator />)

    expect(
      await within(await findAccountStatus()).findByText('user@example.com')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument()
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
    expect(
      await within(await findAccountStatus()).findByText('user@example.com')
    ).toBeInTheDocument()
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

    expect(
      await within(await findAccountStatus()).findByText('user@example.com')
    ).toBeInTheDocument()
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

/**
 * The account menu (story 59.3, FR99).
 *
 * A signed-in user can sign out from the chrome. The trigger is a disclosure
 * `<button aria-expanded>` (decision D1, Lucas 2026-09-22: NOT `<details>`,
 * whose one benefit, JS-off reach, cannot apply to a fetch-based sign-out),
 * and its panel is rendered ONLY while open. That is what makes the absence
 * assertions below mean something: a closed `<details>` keeps its content in
 * jsdom, where every query would still find it (story 59.2's silent greens).
 *
 * ⚠️ jsdom computes no layout and applies no media queries. Everything about
 * SIZE, the mobile panel direction and occlusion is measured in
 * `e2e/account-menu.spec.ts` / `.paid.spec.ts`. Here: structure, ARIA,
 * behaviour, and class TOKENS.
 */
describe('AuthIndicator — account menu (story 59.3)', () => {
  const USER = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' }
  const trigger = () => screen.getByRole('button', { name: 'Account menu' })
  /** The panel, found through the id the OPEN trigger controls. Null when closed. */
  const panel = () => {
    const id = trigger().getAttribute('aria-controls')
    return id === null ? null : document.getElementById(id)
  }

  async function renderSignedIn(user: Record<string, string> = USER) {
    stubFetch({ user })
    const result = renderWithRouter(<AuthIndicator />)
    await within(await findAccountStatus()).findByText(user.email)
    return result
  }

  it('offers a closed "Account menu" disclosure beside, not inside, the live region', async () => {
    await renderSignedIn()

    const button = trigger()
    // EXACT name: the email is announced by the status region, and a compound
    // name would break every full-string `getByRole` probe (AC-2).
    expect(button).toHaveAccessibleName('Account menu')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-haspopup')
    // No `aria-controls` while closed: the panel does not exist, and pointing
    // at a missing id is a dangling IDREF (review finding).
    expect(button).not.toHaveAttribute('aria-controls')
    // Closed = absent, not merely hidden.
    expect(document.querySelector('[role="dialog"], hr')).toBeNull()
    expect(screen.queryByRole('button', { name: /^sign out$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign out$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    // An interactive control inside a polite live region announces spuriously.
    expect(accountStatus().contains(button)).toBe(false)
    expect(accountStatus().querySelector('button, a, [tabindex]')).toBeNull()
  })

  it('shows [avatar][email][chevron] in the trigger and keeps the Premium pill outside it', async () => {
    await renderSignedIn()

    const button = trigger()
    expect(within(button).getByText('U')).toBeInTheDocument()
    expect(within(button).getByText('user@example.com')).toBeInTheDocument()
    expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull()

    // Story 11-3's always-visible tier signal (WCAG 1.4.1): never behind a click.
    const pill = within(accountStatus()).getByText(/^premium$/i)
    expect(button.contains(pill)).toBe(false)
    // The region still announces the email, via an `sr-only` copy.
    const announced = within(accountStatus()).getByText('user@example.com')
    expect([...announced.classList]).toContain('sr-only')
  })

  it('renders no trigger for a signed-out visitor or while the session is loading', async () => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />)
    await screen.findByRole('link', { name: /sign in/i })
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('renders no trigger in the loading state', async () => {
    stubFetchPending()
    renderWithRouter(<AuthIndicator />)
    await screen.findByRole('status')
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('opens to exactly "Signed in as {email}", a separator and Sign out', async () => {
    const { container } = await renderSignedIn()
    const user = userEvent.setup()

    await user.click(trigger())

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    // Now that it is open, `aria-controls` appears AND resolves.
    expect(trigger().getAttribute('aria-controls')).toBeTruthy()
    const open = panel()
    expect(open, 'aria-controls does not resolve to the panel').not.toBeNull()
    const el = open as HTMLElement
    expect(el).toHaveTextContent(/^Signed in as user@example\.com\s*Sign out$/)
    expect(el.querySelectorAll('hr')).toHaveLength(1)
    // One action, no destinations (FR90: Profiles/Report/Categories/Settings
    // stay in the nav).
    expect(within(el).getAllByRole('button')).toHaveLength(1)
    expect(within(el).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(within(el).queryAllByRole('link')).toHaveLength(0)
    // The panel is not a second live region (e2e/clear-local-data.spec.ts:65).
    expect(accountStatus().contains(el)).toBe(false)
    expect(container.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // Disclosure convention: opening does not move focus into the panel.
    expect(trigger()).toHaveFocus()
    // Tab reaches the panel next, in DOM order.
    await user.tab()
    expect(within(el).getByRole('button', { name: 'Sign out' })).toHaveFocus()
  })

  it('toggles closed on a second click', async () => {
    await renderSignedIn()
    const user = userEvent.setup()
    await user.click(trigger())
    await user.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(panel()).toBeNull()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    await renderSignedIn()
    const user = userEvent.setup()
    await user.click(trigger())
    await user.tab()
    await user.keyboard('{Escape}')
    expect(panel()).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it('closes on Escape WITHOUT stealing focus a control outside the menu already holds', async () => {
    stubFetch({ user: USER })
    renderWithRouter(
      <>
        <AuthIndicator />
        <button type="button">elsewhere</button>
      </>
    )
    await within(await findAccountStatus()).findByText(USER.email)
    const user = userEvent.setup()
    await user.click(trigger())
    screen.getByRole('button', { name: 'elsewhere' }).focus()
    await user.keyboard('{Escape}')
    expect(panel()).toBeNull()
    expect(screen.getByRole('button', { name: 'elsewhere' })).toHaveFocus()
  })

  it('closes on a press outside the menu, and not on a press inside the panel', async () => {
    stubFetch({ user: USER })
    renderWithRouter(
      <>
        <AuthIndicator />
        <button type="button">elsewhere</button>
      </>
    )
    await within(await findAccountStatus()).findByText(USER.email)
    const user = userEvent.setup()
    await user.click(trigger())

    // Inside: the "Signed in as" line is not interactive, and pressing it must
    // not dismiss the panel it belongs to.
    await user.click(within(panel() as HTMLElement).getByText(/signed in as/i))
    expect(panel()).not.toBeNull()

    // The Premium pill is in the cluster but NOT in the menu: that is outside.
    await user.click(within(accountStatus()).getByText(/^premium$/i))
    expect(panel()).toBeNull()

    await user.click(trigger())
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' })
    await user.click(elsewhere)
    expect(panel()).toBeNull()
    // Light dismiss must not yank focus off what the user pressed.
    expect(elsewhere).toHaveFocus()
  })

  it('closes on navigation, and does not come back open after a sign-out and back in', async () => {
    let currentUser: unknown = USER
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify({ user: currentUser }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof global.fetch
    const { router } = renderWithNavigableRouter()
    await within(await findAccountStatus()).findByText(USER.email)
    const user = userEvent.setup()

    // Pathname change closes it.
    await user.click(trigger())
    expect(panel()).not.toBeNull()
    await act(async () => {
      await router.navigate({ to: '/other' })
    })
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')

    // Signed out elsewhere while open: the trigger goes, and the open state
    // must not survive to a later sign-in.
    await user.click(trigger())
    currentUser = null
    await act(async () => {
      await router.navigate({ to: '/' })
    })
    await screen.findByRole('link', { name: /sign in/i })
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()

    currentUser = USER
    await act(async () => {
      await router.navigate({ to: '/other' })
    })
    await within(await findAccountStatus()).findByText(USER.email)
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  describe('Sign out', () => {
    const assign = vi.fn()
    beforeEach(() => {
      vi.stubGlobal('location', { ...globalThis.location, assign })
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('signs out through the shared implementation: logout POST, then a document load to /', async () => {
      await renderSignedIn()
      const user = userEvent.setup()
      await user.click(trigger())
      await user.click(screen.getByRole('button', { name: 'Sign out' }))

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
      expect(signOut).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' })
      )
    })

    // ⚠️ What this actually proves, corrected in review: `userEvent` does not
    // dispatch a click to a DISABLED element, so this exercises the `disabled`
    // attribute, not a re-entry guard inside the handler. That is the honest
    // mechanism for a second CLICK. The other mechanism — one sign-out per app,
    // covering a same-tick double dispatch and the `/settings` control — lives
    // in `signOut()` itself and is tested in `lib/account/sign-out.test.ts`
    // ("joins an in-flight sign-out instead of sending a second POST").
    it('disables Sign out once activated, so a second click sends no second POST', async () => {
      stubFetch({ user: USER })
      // Hold the logout POST open so the button stays in its pending state.
      const base = global.fetch
      global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/api/auth/logout')
          ? new Promise<Response>(() => {})
          : base(input, init)
      ) as typeof global.fetch
      renderWithRouter(<AuthIndicator />)
      await within(await findAccountStatus()).findByText(USER.email)
      const user = userEvent.setup()
      await user.click(trigger())
      const button = screen.getByRole('button', { name: 'Sign out' })
      await user.click(button)
      await user.click(button)

      const logoutCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(([input]) => String(input).includes('/api/auth/logout'))
      expect(logoutCalls).toHaveLength(1)
      expect(button).toBeDisabled()
    })
  })

  // Class TOKENS: jsdom applies no Tailwind. The rendered geometry (≥28px
  // target, the downward mobile panel, its stacking) is measured in e2e.
  it('carries the target-size and panel-placement tokens', async () => {
    await renderSignedIn()
    const user = userEvent.setup()
    // 28px, not 32: a 32px trigger grew the 320px strip from 32 to 33px
    // (measured in e2e), which is the layout shift story 13-2 reserves against.
    expect([...trigger().classList]).toEqual(expect.arrayContaining(['min-h-[1.75rem]', 'px-2']))
    expect([...trigger().classList]).not.toContain('min-h-[2rem]')
    await user.click(trigger())
    const tokens = [...(panel() as HTMLElement).classList]
    expect(tokens).toEqual(
      expect.arrayContaining([
        // Mobile: full-width, hanging DOWN from the top strip (the mirror of the
        // nav sheet's `max-sm:bottom-full`), scrollable if the viewport is short.
        'max-sm:inset-x-0',
        'max-sm:top-full',
        // Desktop: right-aligned under the trigger, above page content.
        'sm:right-0',
        'sm:top-full',
        'z-40',
        'absolute',
        'overflow-y-auto',
        // Opaque in both themes.
        'bg-white',
        'dark:bg-gray-800',
      ])
    )
    expect([
      ...within(panel() as HTMLElement).getByRole('button', { name: 'Sign out' }).classList,
    ]).toEqual(expect.arrayContaining(['py-2', 'text-sm']))
  })
})

// Decision D2 (Lucas, 2026-09-22): the trigger's email is hidden where it
// measures under 24px, which for a Premium user is below 660px. The pill is
// what takes the room, so a free user keeps the email at every desktop width.
// Class TOKENS here; the measured widths live in ONE place,
// `e2e/account-menu.paid.spec.ts` — deliberately not restated.
describe('AuthIndicator — account menu email at narrow desktop widths (story 59.3, D2)', () => {
  it.each([
    ['active', true],
    ['lifetime', true],
    ['free', false],
    ['past_due', false],
    ['canceled', false],
  ])('a %s user: email hidden below 660px = %s', async (subscriptionStatus, hidden) => {
    stubFetch({ user: { userId: 'u', email: 'user@example.com', subscriptionStatus } })
    renderWithRouter(<AuthIndicator />)
    await within(await findAccountStatus()).findByText('user@example.com')
    const email = within(screen.getByRole('button', { name: 'Account menu' })).getByText(
      'user@example.com'
    )
    expect(email.classList.contains('sm:max-[659.98px]:hidden')).toBe(hidden)
    // The pill and the rule read ONE predicate: hidden exactly when the pill shows.
    expect(within(accountStatus()).queryByText(/^premium$/i) !== null).toBe(hidden)
  })
})
