import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { type SessionSeed, useSessionSeed } from '../../context/session-seed'

/**
 * Persistent signed-in / Premium indicator (Story 13-2).
 *
 * Mounted once in `routes/__root.tsx`, so every route carries an always-visible
 * signal of session state: a signed-in user sees their email and — only when
 * their subscription is active — a "Premium" marker; a signed-out visitor sees a
 * "Sign in" affordance and nothing account-specific. On desktop (≥640px) it sits
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

  // `pathname` is an intentional re-run trigger: the effect refetches the session
  // on every navigation (not a value read in the body), so the strip never shows a
  // stale identity after a client-side sign-out. Removing it defeats that fix.
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

      {authState.status === 'unauthenticated' && (
        <Link
          to="/login"
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
