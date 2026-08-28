import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { type SessionSeed, useSessionSeed } from '../../context/session-seed'

/**
 * Persistent signed-in / Premium indicator (Story 13-2).
 *
 * Mounted once in `routes/__root.tsx`, so every route carries an always-visible
 * signal of session state: a signed-in user sees their email and — only when
 * their subscription is active — a "Premium" marker; a signed-out visitor sees a
 * "Sign in" affordance and nothing account-specific, EXCEPT on `/login` itself,
 * where that affordance would link to the page already on screen (story 41.3,
 * UX-DR51 — see the note on the unauthenticated branch). On desktop (≥640px) it sits
 * on the SAME row as the primary nav, trailing/right-aligned (story 19-3); below
 * `sm:` it is a full-width top strip above the content (GlobalNav's bottom tab
 * bar carries the nav on mobile). It is kept out of `GlobalNav` so the 320px
 * mobile tab bar is not crowded (story 13-2).
 *
 * Session resolution mirrors `settings/account-section.tsx`: a plain
 * `fetch('/api/auth/me')` in a mount effect, NOT `@tanstack/react-query` (the
 * app mounts no `QueryClientProvider`) and NOT the `usePremiumAccess` hook /
 * `checkPremiumAccessServer` server import (which throws "Buffer is not defined"
 * in the browser bundle — see the premium-check e2e Buffer gap). The fetch fails
 * closed: any error resolves to the signed-out state.
 *
 * Because this strip is mounted once at the root and never remounts on client
 * navigation, it re-resolves the session whenever the route changes (the effect
 * depends on the pathname). Sign-out (`account-section.tsx`) is a client-side
 * `router.navigate` that does NOT remount the root — without the refetch the
 * strip would keep showing the signed-out user's email + Premium marker until a
 * hard reload. The refetch keeps `/api/auth/me` calls to one per navigation and
 * does not reset to the loading state, so a signed-in user sees no flicker while
 * browsing.
 *
 * First-paint resolution (story UX-1): the strip's initial state is seeded from
 * the session the root loader resolves server-side (see context/session-seed), so
 * the server HTML and the first client render already show the correct state — no
 * neutral-placeholder→content flip. Hydration stays stable because the seed is
 * identical on the server and at the client's first render (it is the loader data
 * serialized into the SSR payload). When no seed is available (rendered outside
 * the provider, e.g. unit tests), it falls back to the pre-UX-1 loading state that
 * resolves via the post-mount fetch. The outer strip always renders with a
 * reserved min-height, so any state change swaps inner content without shifting
 * layout, and the strip never pushes the document past a 320px viewport.
 */

/**
 * The one route on which the strip must not offer its "Sign in" link (story
 * 41.3, UX-DR51). Shared by the route check and the `<Link>` itself so the two
 * cannot drift apart.
 */
const LOGIN_PATH = '/login' as const

interface CurrentUser {
  userId: string
  email: string
  subscriptionStatus: string
}

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: CurrentUser }

/**
 * Map the SSR-resolved session seed to the initial auth state so the first frame
 * is already correct (story UX-1). No seed → the neutral loading state (resolved
 * after mount by the fetch). An authenticated seed must carry a usable email for
 * the same reason `fetchCurrentUser` guards it: the authenticated render derefs
 * `user.email`, so a seed missing it is treated as signed-out.
 */
function seedToAuthState(seed: SessionSeed | null): AuthState {
  if (!seed) {
    return { status: 'loading' }
  }
  if (seed.isAuthenticated && seed.email) {
    return {
      status: 'authenticated',
      user: {
        userId: seed.userId ?? '',
        email: seed.email,
        subscriptionStatus: seed.subscriptionStatus ?? 'free',
      },
    }
  }
  return { status: 'unauthenticated' }
}

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch('/api/auth/me')
  if (!response.ok) {
    return null
  }
  const data = (await response.json()) as { user?: CurrentUser | null }
  const user = data.user
  // Defensive: a user object without a usable email is treated as signed-out.
  // The render path derefs `user.email` (avatar initial + label), so an endpoint
  // contract drift that dropped `email` would otherwise throw during render at
  // the app root — above any error boundary — and white-screen every route.
  if (!user || typeof user.email !== 'string' || user.email.length === 0) {
    return null
  }
  return user
}

export function AuthIndicator() {
  // Seed the initial state from the SSR-resolved session so the first paint is
  // already correct (story UX-1). Read once as an initializer — the per-navigation
  // fetch below owns freshness thereafter.
  const seed = useSessionSeed()
  const [authState, setAuthState] = useState<AuthState>(() => seedToAuthState(seed))
  // Re-resolve on every navigation so the strip never shows a stale identity
  // after a client-side sign-out (which navigates without remounting the root).
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  // Story 41.3 (UX-DR51). Which URLs count as "the sign-in page", all three
  // MEASURED against the running app rather than assumed:
  //
  //  - `/login?error=invalid_or_expired` — the target `api/auth/login/verify`
  //    redirects an expired magic link to. `location.pathname` excludes the
  //    search string, so this matches. The user who just failed to sign in is
  //    the last one who should be offered a link back here.
  //  - `/login/` — the router CANONICALISES this (307 → `/login`) before the
  //    strip ever renders, so `pathname` is never the trailing-slash form.
  //    Measured, not inferred: probed at runtime, `page.url()` reads `/login`.
  //  - `/Login`, `/LOGIN` — ⚠️ THE CASE THAT BIT. Route matching is
  //    case-INSENSITIVE by default, but `location.pathname` preserves whatever
  //    the user typed, and the router does NOT canonicalise case the way it
  //    canonicalises the trailing slash. So `/Login` really does serve the
  //    login page, and a bare `===` renders the self-link on it — the exact
  //    defect this story removes. Hence `toLowerCase()`.
  //
  // ⚠️ `GlobalNav.tsx`'s `item.to === pathname` is the in-repo precedent for
  // reading the route, and it has this same case hole — but there the failure
  // mode is benign (a nav link simply is not marked active). Here it is the
  // regression itself, so the precedent is followed for the READ and
  // deliberately not for the COMPARISON. `toLowerCase()` (not
  // `toLocaleLowerCase()`) is locale-independent, so a Turkish-locale client
  // cannot map `I` to a dotless `ı` and reopen the hole.
  const isOnLoginPage = pathname.toLowerCase() === LOGIN_PATH

  // `pathname` now does two jobs. It is read in the render body (the route check
  // above), and it is ALSO an intentional re-run trigger for this effect: the
  // session is refetched on every navigation, so the strip never shows a stale
  // identity after a client-side sign-out. The suppression below covers the
  // SECOND job only — the value is deliberately absent from the effect's own
  // body, and removing it from the dependency array would defeat that fix.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional re-run-on-navigation dependency
  useEffect(() => {
    let active = true
    fetchCurrentUser()
      .then((user) => {
        if (!active) {
          return
        }
        setAuthState(user ? { status: 'authenticated', user } : { status: 'unauthenticated' })
      })
      .catch(() => {
        // Fail closed: any failure resolving the session shows the signed-out state.
        if (active) {
          setAuthState({ status: 'unauthenticated' })
        }
      })
    return () => {
      active = false
    }
  }, [pathname])

  return (
    <div
      // Reserve height on every render (incl. SSR + the loading state) so
      // resolving the session never shifts layout. `justify-end` keeps the
      // indicator right-aligned; `min-w-0` + `truncate` on the email guard 320px.
      // The bar chrome (border + background) is `max-sm:`-scoped: below 640px
      // this is a standalone top strip and needs its own border/bg, but on the
      // desktop row it inherits the shared chrome from the `__root.tsx` wrapper
      // so the nav and this indicator read as one bar (story 19-3).
      data-auth-indicator
      role="status"
      aria-label="Account status"
      className="flex min-h-[2rem] items-center justify-end gap-2 px-4 text-sm max-sm:border-b max-sm:border-gray-200 max-sm:bg-white dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800"
    >
      {authState.status === 'loading' && (
        // Neutral placeholder: identical on server + first client render, holds
        // the strip's height until the session resolves. Hidden from AT.
        <span aria-hidden="true" className="h-4 w-24" />
      )}

      {/*
        Story 41.3 (UX-DR51): no "Sign in" offer on the sign-in page. Until this
        story `/login` rendered a link to `/login`, and because it is a TanStack
        `<Link>` it rendered with `aria-current="page"` and an `active` class — so
        the chrome did not merely point at the page already on screen, it
        announced that it did.

        ⚠️ This DIVERGES from UX-DR28 / story 21.1, which is the app's rule for a
        link to the current page everywhere else: `GlobalNav` and `Footer` keep
        the link and MARK it with `activeProps` + `aria-current="page"`. That rule
        is for wayfinding, where "you are here" is a useful answer. This strip is
        an account-status affordance, not navigation — an invitation to sign in,
        on the sign-in page, has no destination worth marking. Recorded here so a
        later story does not "restore consistency" by putting the link back.

        ⚠️ `activeProps` cannot express this. It can restyle an active link but
        not decline to render one, and story 31.5 measured that misapplying it
        fails SILENTLY — it just marks nothing. The route read is `useRouterState`,
        which this component already subscribes to for the refetch effect.

        ⚠️ Only the CHILDREN are route-dependent; the wrapper above is not. Its
        `min-h-[2rem]` is the sole height reserve, so returning `null` here — or
        dropping the labelled `role="status"` region on this one route — would
        trade a dead link for a collapsed strip and a layout shift, which is the
        exact thing story 13.2 reserved the height to prevent.

        ⚠️ The `loading` and `authenticated` branches are deliberately NOT
        route-aware. An authenticated user genuinely reaches `/login` — this app
        carries no route guards anywhere, a stance recorded at
        `routes/retirement.tsx` — and the strip reporting who they are is the one
        signal that explains why the page looks wrong to them.
      */}
      {authState.status === 'unauthenticated' && !isOnLoginPage && (
        <Link
          to={LOGIN_PATH}
          className="rounded-md px-3 py-1 font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
        >
          Sign in
        </Link>
      )}

      {authState.status === 'authenticated' && (
        <>
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-300"
          >
            {authState.user.email.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
            {authState.user.email}
          </span>
          {(authState.user.subscriptionStatus === 'active' ||
            authState.user.subscriptionStatus === 'lifetime') && (
            // Text label, not color/icon alone (Story 11-3 / WCAG 1.4.1).
            // Both an active subscription and a lifetime purchase (25-2) are Premium.
            <span className="shrink-0 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white dark:bg-green-500">
              Premium
            </span>
          )}
        </>
      )}
    </div>
  )
}
