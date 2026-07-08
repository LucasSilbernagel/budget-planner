import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

/**
 * Persistent signed-in / Premium indicator (Story 13-2).
 *
 * Mounted once in `routes/__root.tsx` as a slim top strip above `GlobalNav`, so
 * every route carries an always-visible signal of session state: a signed-in
 * user sees their email and — only when their subscription is active — a
 * "Premium" marker; a signed-out visitor sees a "Sign in" affordance and nothing
 * account-specific.
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
 * SSR-safety (AC-5): the session is fetched only after mount, so the server HTML
 * and the first client render are identical (both the neutral pre-resolution
 * state) — no hydration mismatch. The outer strip always renders with a reserved
 * min-height, so resolving the session swaps inner content without shifting
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
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' })
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
      data-auth-indicator
      role="status"
      aria-label="Account status"
      className="flex min-h-[2rem] items-center justify-end gap-2 border-b border-gray-200 bg-white px-4 text-sm dark:border-gray-700 dark:bg-gray-800"
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
          {authState.user.subscriptionStatus === 'active' && (
            // Text label, not color/icon alone (Story 11-3 / WCAG 1.4.1).
            <span className="shrink-0 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white dark:bg-green-500">
              Premium
            </span>
          )}
        </>
      )}
    </div>
  )
}
