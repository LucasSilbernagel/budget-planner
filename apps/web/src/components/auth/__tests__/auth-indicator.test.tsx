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
 * Since story 69.2 a signed-in user's email is in the DOM exactly ONCE: the
 * `sr-only` copy in this region (what a screen reader hears). Story 59.3 had
 * added a visible copy in the account-menu trigger and a "Signed in as …" line
 * in the panel; 69.2 (decision D2) removed both. Scope email lookups to this
 * region anyway, so an assertion says which claim it makes.
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
  // Story 69.2: the account menu's Settings link and the signed-out gear both
  // navigate here, so the tree needs a real `/settings` to navigate INTO.
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: () => <div>settings</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, otherRoute, loginRoute, settingsRoute]),
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
  // the nav. Without `sm:min-w-0` its minimum is its content width, so the nav
  // wrapped to 2-3 rows beside a long email instead (measured). Class TOKENS,
  // because jsdom computes no layout. The rendered row is pinned in the
  // signed-in e2e sweeps (`nav-more-disclosure{,.paid}.spec.ts`).
  //
  // Story 59.3 moved the row chrome to a new OUTER row. Story 69.2 took the
  // email out of the chrome altogether (decision D2), so there was nothing left
  // to truncate. ⚠️ REVERSED by story 69.3 (decision D4): `sm:min-w-0` then only
  // let the row's box shrink below its content, and `justify-end` pushed the
  // overflow LEFT over the nav at an enlarged root font. It is gone; the row
  // keeps its content width, `sm:ml-auto` keeps it right-aligned when the header
  // wraps it to its own line (`e2e/nav-enlarged-font{,.paid}.spec.ts`).
  it('keeps the outer row at its content width, with no visible email left in it', async () => {
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
    expect(rowTokens, 'the strip can shrink below its content again (69.3 D4)').not.toContain(
      'sm:min-w-0'
    )
    expect(rowTokens).not.toContain('min-w-0')
    expect(rowTokens, 'a wrapped cluster would lose its right alignment').toContain('sm:ml-auto')
    // The ONE copy is the announced one.
    const copies = screen.getAllByText('a.long.address@example.test')
    expect(copies).toHaveLength(1)
    expect([...copies[0].classList]).toContain('sr-only')
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

  // Story 69.2 (decision D2): the trigger is `[avatar][chevron]`. The email is
  // announced by the status region and shown on /settings, and nowhere in the
  // trigger — for EVERY tier. (Until 69.2 a Premium user's email hid below
  // 660px and a free user's truncated; that per-tier rule went with the email.)
  it.each(['active', 'lifetime', 'free', 'past_due', 'canceled'])(
    'a %s user: the trigger is [avatar][chevron], with no email in it',
    async (subscriptionStatus) => {
      await renderSignedIn({ ...USER, subscriptionStatus })
      const button = trigger()
      expect(button).toHaveTextContent(/^U$/)
      expect(button.textContent).not.toContain('@')
      expect(button.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
      // The name stays exactly "Account menu". D4: the email-based WCAG 2.5.3
      // failure is gone; whether the visible one-letter initial is a "label"
      // is arguable and recorded as such (69.2 code review), not settled here.
      expect(button).toHaveAccessibleName('Account menu')
    }
  )

  it('keeps the Premium pill outside the trigger and the email announced', async () => {
    await renderSignedIn()

    const button = trigger()

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

  it('opens to exactly Settings, a separator and Sign out', async () => {
    const { container } = await renderSignedIn()
    const user = userEvent.setup()

    await user.click(trigger())

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    // Now that it is open, `aria-controls` appears AND resolves.
    expect(trigger().getAttribute('aria-controls')).toBeTruthy()
    const open = panel()
    expect(open, 'aria-controls does not resolve to the panel').not.toBeNull()
    const el = open as HTMLElement
    // ANCHORED, exactly as the 59.3 version was (story 69.2, epic AC-3): an
    // extra row, or the old "Signed in as" line surviving, turns this red. A
    // substring check would trade that guard for a green run.
    expect(el).toHaveTextContent(/^Settings\s*Sign out$/)
    // Structure, in DOM order: the link, the separator, the button.
    expect([...el.children].map((c) => c.tagName)).toEqual(['A', 'HR', 'BUTTON'])
    const settings = within(el).getByRole('link', { name: 'Settings', exact: true })
    expect(settings).toHaveAttribute('href', '/settings')
    expect(within(el).getAllByRole('link')).toHaveLength(1)
    expect(within(el).getAllByRole('button')).toHaveLength(1)
    expect(within(el).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    // No email in the panel either (decision D2): only on /settings.
    expect(el.textContent).not.toContain('@')
    // The panel is not a second live region (e2e/clear-local-data.spec.ts:65).
    expect(accountStatus().contains(el)).toBe(false)
    expect(container.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // Disclosure convention: opening does not move focus into the panel.
    expect(trigger()).toHaveFocus()
    // Tab reaches the panel next, in DOM order: Settings, then Sign out.
    await user.tab()
    expect(settings).toHaveFocus()
    await user.tab()
    expect(within(el).getByRole('button', { name: 'Sign out' })).toHaveFocus()
  })

  it('marks the Settings row current on /settings, and only there', async () => {
    stubFetch({ user: USER })
    renderWithRouter(<AuthIndicator />, { path: '/settings' })
    await within(await findAccountStatus()).findByText(USER.email)
    const user = userEvent.setup()
    await user.click(trigger())
    expect(
      within(panel() as HTMLElement).getByRole('link', { name: 'Settings', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  })

  it('marks the Settings row current on /Settings too (case-insensitive)', async () => {
    stubFetch({ user: USER })
    renderWithRouter(<AuthIndicator />, { path: '/Settings' })
    await within(await findAccountStatus()).findByText(USER.email)
    const user = userEvent.setup()
    await user.click(trigger())
    expect(
      within(panel() as HTMLElement).getByRole('link', { name: 'Settings', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  })

  it('does not mark the Settings row current elsewhere', async () => {
    await renderSignedIn()
    const user = userEvent.setup()
    await user.click(trigger())
    expect(
      within(panel() as HTMLElement).getByRole('link', { name: 'Settings', exact: true })
    ).not.toHaveAttribute('aria-current')
  })

  // ⚠️ The case the pathname-change close cannot cover (story 69.2, Read-first
  // #4): on /settings, clicking Settings changes NO pathname, and the press
  // starts and ends inside the menu, so the outside-press guard declines too.
  // Only the link's own `onClick` closes the panel. Mutation-measured: without
  // it this test goes red and no other one does.
  it('closes when Settings is chosen on /settings itself (same route), focus back on the trigger', async () => {
    stubFetch({ user: USER })
    renderWithRouter(<AuthIndicator />, { path: '/settings' })
    await within(await findAccountStatus()).findByText(USER.email)
    const user = userEvent.setup()
    await user.click(trigger())
    await user.click(
      within(panel() as HTMLElement).getByRole('link', { name: 'Settings', exact: true })
    )
    expect(panel(), 'the panel stayed open after a same-route click on Settings').toBeNull()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveFocus()
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

    // Inside: the separator is not interactive, and pressing it must not
    // dismiss the panel it belongs to. (It was the "Signed in as" line until
    // story 69.2 removed it.)
    await user.click((panel() as HTMLElement).querySelector('hr') as HTMLElement)
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

  it('closes when Settings is chosen from another route, which navigates to /settings', async () => {
    stubFetch({ user: USER })
    const { router } = renderWithNavigableRouter()
    await within(await findAccountStatus()).findByText(USER.email)
    const user = userEvent.setup()
    await user.click(trigger())
    await user.click(
      within(panel() as HTMLElement).getByRole('link', { name: 'Settings', exact: true })
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
    expect(panel()).toBeNull()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
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

/**
 * The signed-out route to Settings (story 69.2, FR109, decision D1).
 *
 * Settings left the nav. A signed-in user reaches it from the account menu; a
 * signed-OUT visitor has no menu, so the cluster carries an icon-only gear link
 * beside "Sign in". It is navigation, so it sits OUTSIDE the live region (a
 * sibling, like the account menu), and it follows UX-DR28 on `/settings`
 * (marked current, not dropped). It hides on `/login` only (decision D3), so the
 * sign-in page keeps the empty strip story 41.3 gave it.
 *
 * Class TOKENS for size: jsdom has no layout. The rendered box, the width it
 * costs at 640px and its reachability at 320/1280px are e2e
 * (`e2e/settings-route.spec.ts`, `e2e/nav-responsive-css.spec.ts`).
 */
describe('AuthIndicator — the signed-out Settings gear (story 69.2)', () => {
  const gear = () => screen.queryByRole('link', { name: 'Settings' })

  it.each(['/', '/income', '/pricing'])(
    'renders a gear link to /settings on %s, outside the live region',
    async (path) => {
      stubFetch({ user: null })
      const { container } = renderWithRouter(<AuthIndicator />, { path })
      await screen.findByRole('link', { name: /sign in/i })
      const link = gear()
      expect(link, `no Settings gear on ${path}`).not.toBeNull()
      expect(link).toHaveAttribute('href', '/settings')
      expect(link).toHaveAccessibleName('Settings')
      // Icon-only: the name is the label, the glyph is decorative.
      expect(link?.textContent).toBe('')
      expect(link?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      // Navigation stays out of the polite live region, in the row beside it.
      expect(accountStatus().contains(link)).toBe(false)
      expect(container.querySelector('[data-auth-indicator]')?.contains(link)).toBe(true)
      // The 28x28px box (the project's target floor), as tokens.
      expect([...(link as HTMLElement).classList]).toEqual(
        expect.arrayContaining(['h-7', 'w-7', 'shrink-0'])
      )
      expect(link).not.toHaveAttribute('aria-current')
    }
  )

  it('marks the gear current on /settings rather than dropping it (UX-DR28)', async () => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />, { path: '/settings' })
    await screen.findByRole('link', { name: /sign in/i })
    expect(gear()).toHaveAttribute('aria-current', 'page')
  })

  // Decision D3. Anti-vacuity: the "Sign in" link resolving on /pricing above
  // proves the unauthenticated branch renders; here the whole strip is empty,
  // so resolution is proven by the region having settled with no children.
  it('renders no gear on /login, which keeps its empty strip (story 41.3, D3)', async () => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />, { path: '/login' })
    const indicator = await findAccountStatus()
    await waitFor(() => expect(indicator.children).toHaveLength(0))
    expect(gear()).toBeNull()
    expect(document.querySelector('a[href="/settings"]')).toBeNull()
  })

  it('renders no gear for a signed-in user (the account menu is their route)', async () => {
    stubFetch({ user: { userId: 'u', email: 'user@example.com', subscriptionStatus: 'free' } })
    renderWithRouter(<AuthIndicator />)
    await within(await findAccountStatus()).findByText('user@example.com')
    expect(gear()).toBeNull()
    expect(document.querySelector('a[href="/settings"]')).toBeNull()
  })

  it('renders no gear while the session is loading', async () => {
    stubFetchPending()
    renderWithRouter(<AuthIndicator />)
    // A real gate (69.2 code review): the region always renders, so finding it
    // proves nothing. The loading PLACEHOLDER is the region's only child, an
    // `aria-hidden` span, and it exists only in the loading state.
    const region = await findAccountStatus()
    expect(region.children).toHaveLength(1)
    expect(region.children[0]).toHaveAttribute('aria-hidden', 'true')
    expect(gear()).toBeNull()
  })

  // 69.2 code review (Edge layer, MEASURED): `/Settings` serves the settings
  // page, but TanStack's active match is case-sensitive, so the gear was not
  // marked there. It is marked from a lowercased read now, like the /login hide.
  it.each(['/Settings', '/SETTINGS'])('marks the gear current on %s too', async (path) => {
    stubFetch({ user: null })
    renderWithRouter(<AuthIndicator />, { path })
    await screen.findByRole('link', { name: /sign in/i })
    expect(gear()).toHaveAttribute('aria-current', 'page')
  })
})

/**
 * Story 69.3 (decision D3): a SIGNED-IN visitor with JavaScript off reaches
 * `/settings` through a `<noscript>` gear.
 *
 * What jsdom can and cannot say here, MEASURED at 69.3 with a throwaway probe:
 * React 19's `renderToString` emits the anchor INSIDE `<noscript>`, and a
 * CLIENT render leaves the `<noscript>` EMPTY (no child elements). So this file
 * can prove the client half, that the element is there and holds no LIVE
 * second gear with JavaScript on. The server half (a visible, working link
 * with JavaScript off) is a rendered fact, proven in
 * `e2e/settings-route.paid.spec.ts`.
 */
describe('AuthIndicator — the signed-in JS-off Settings gear (story 69.3, D3)', () => {
  it('renders a <noscript> in the signed-in cluster, holding no live link', async () => {
    stubFetch({
      user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' },
    })
    const { container } = renderWithRouter(<AuthIndicator />, { path: '/income' })
    await screen.findByRole('button', { name: 'Account menu' })
    const row = container.querySelector('[data-auth-indicator]') as HTMLElement
    const noscripts = row.querySelectorAll(':scope > noscript')
    expect(noscripts, 'the signed-in cluster has no <noscript> gear').toHaveLength(1)
    // Outside the live region, like the signed-out gear.
    expect(accountStatus().contains(noscripts[0] as Node)).toBe(false)
    // No live second gear: the panel is closed, so NOTHING links to /settings.
    expect(screen.queryAllByRole('link', { name: 'Settings' })).toHaveLength(0)
    expect(container.querySelector('a[href="/settings"]')).toBeNull()
  })

  it('renders no <noscript> gear for a signed-out visitor, who has the real one', async () => {
    stubFetch({ user: null })
    const { container } = renderWithRouter(<AuthIndicator />, { path: '/income' })
    await screen.findByRole('link', { name: /sign in/i })
    expect(container.querySelectorAll('noscript')).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(1)
  })
})
