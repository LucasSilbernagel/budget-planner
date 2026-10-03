/**
 * SyncProvider (Story 5-15)
 *
 * Mounts the multi-device sync service for an authenticated PAID session and
 * nothing else: free / unauthenticated users get no sync service, no poller and
 * no network calls (AC-1 / AC-6). It is the single place the otherwise-headless
 * `useSync` hook is instantiated in the running app.
 *
 * Lifecycle:
 *  1. On the client, ask `/api/auth/me` who we are (the server resolves the
 *     HMAC-signed, DB-authoritative session — Story 5-7).
 *  2. If the session has paid access (`hasPaidAccess`, the same rule as the
 *     server push/pull gate), render <ActiveSync>; otherwise render nothing.
 *  3. <ActiveSync> instantiates `useSync` (auto-pull poller on), registers the
 *     push queue with the sync bridge so paid store mutations are forwarded
 *     (Story 5-15 Task 3), and seeds the local stores with an initial pull.
 *  4. On unmount (logout / downgrade / navigation away from a paid session) the
 *     bridge is cleared and `useSync` tears down its poller — paid→free returns
 *     the app to localStorage-only behaviour with no further network (Task 5).
 *
 * It also applies the account boundary (story 90.1, `lib/sync/accountBoundary.ts`)
 * when the root could not trust the SSR seed: once `/api/auth/me` gives a
 * definitive answer, for every session kind, before `<ActiveSync>` renders.
 *
 * Otherwise wiring, not UI: its only visible output is `ActiveSync`'s
 * refused-edit notice (story 75.2), which renders nothing until the server
 * permanently refuses an edit. SSR-safe: the session probe runs only on the
 * client (after mount), so the server render is inert.
 */

import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { hasPaidAccess } from '@/lib/premium/access-statuses'
import { accountBoundaryAppliedFor, applyAccountBoundary } from '@/lib/sync/accountBoundary'
import { setSyncSessionStatus } from '@/lib/sync/sessionStatusStore'
import { type ReactElement, Suspense, useEffect, useState } from 'react'
import { ErrorBoundary } from '../ErrorBoundary'

/**
 * The sync engine is fetched only once a PAID session is confirmed (story 38.3).
 * Everything below the gate at {@link SyncProvider} is dead code for a free or
 * signed-out visitor, yet it used to ship in the root chunk they must download
 * before hydration. See `ActiveSync.tsx` for why this is hydration-safe.
 */
const ActiveSync = lazyWithRetry(() =>
  import('./ActiveSync').then((m) => ({ default: m.ActiveSync }))
)

interface SessionUser {
  userId: string
  subscriptionStatus: string
}

/**
 * Whether this session may use server-side sync (push AND pull) — the same
 * paid-access rule the server's sync routes apply, imported from the one
 * definition (Story 78.3). `past_due` keeps sync alive inside the dunning window.
 *
 * ⚠️ Until Story 34.1a this component kept its own literal list, and `lifetime`
 * was missing from it while its comment claimed it matched the server
 * "exactly". Because this gate decides whether `<ActiveSync>` mounts at all, a
 * lifetime buyer got NO sync whatsoever — silently: no 403, no console error,
 * no request. `lib/premium/access-statuses.ts` has no runtime imports, so this
 * client component can share the server's definition without pulling
 * `@budget-planner/db` into the client bundle.
 */
function isPaidSyncSession(user: SessionUser | null): user is SessionUser {
  return user !== null && hasPaidAccess(user.subscriptionStatus)
}

/**
 * Whether the browser plausibly holds a session, checked via `has_session` — a
 * deliberately NON-HttpOnly marker cookie set alongside the real `session`
 * cookie (Story 53.1). The real session cookie is `HttpOnly` by design (XSS
 * protection: `routes/api/auth/login/verify.ts`), so it is NEVER visible to
 * `document.cookie` in a real browser. This function used to test for
 * `session=` directly, which — because of that — evaluated false for every
 * real authenticated user: the probe below never ran, and sync never worked on
 * ANY device (not just a new one). `has_session` carries no secret (its value
 * is meaningless; only presence matters) and is not itself trusted for
 * anything — `/api/auth/me` below remains the sole, server-authoritative check.
 */
export function hasProbableSession(cookieString: string): boolean {
  return /(?:^|;\s*)has_session=/.test(cookieString)
}

export function SyncProvider(): ReactElement | null {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [resolved, setResolved] = useState(false)

  // Resolve the session once, client-side. A failure (offline, 401) simply means
  // "no paid session" — the free tier path, never a crash.
  useEffect(() => {
    let cancelled = false
    // Reading `document.cookie` can throw `SecurityError` in a sandboxed or
    // opaque-origin iframe / blocked site data. This effect has no boundary
    // above it before TanStack Router's root catch (see the load-bearing
    // ErrorBoundary note below), so an uncaught throw here would take down
    // the whole app for that reason alone — degrade to "no probable session"
    // instead (Story 53.1 review).
    let cookieString = ''
    try {
      cookieString = typeof document !== 'undefined' ? document.cookie : ''
    } catch {
      cookieString = ''
    }
    // Anonymous visitors carry no session cookie — skip the probe entirely so the
    // free / unauthenticated tier makes ZERO network calls (AC-6, review P3). Only
    // a request that actually carries a session is worth resolving server-side.
    if (!hasProbableSession(cookieString)) {
      // Signed out. `StoreHydration` has already applied the boundary for `''`
      // from the same cookie (story 90.1); this call is then a no-op.
      applyAccountBoundary('')
      setResolved(true)
      setSyncSessionStatus(true, false)
      return
    }
    let definitive = false
    fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
      .then((response) => {
        // Only a 200 is a DEFINITIVE answer (`{ user: null }` is signed out); a
        // 503 is the resolver failing, so the boundary is not applied on it.
        definitive = response.ok
        return response.ok ? response.json() : { user: null }
      })
      .then((body: { user?: SessionUser | null }) => {
        if (!cancelled) {
          // Story 90.1 (FR144): when the root could not trust the SSR seed (a
          // resolver error, or a cached document: `sessionForBoundary`), or
          // applied it for someone else, apply the boundary for the verified
          // session now, BEFORE `ActiveSync` can render below. Never on an
          // unverified answer: an offline paid user keeps their data.
          const verified = body.user?.userId ?? ''
          if (definitive && accountBoundaryAppliedFor() !== verified) {
            applyAccountBoundary(verified)
          }
          setUser(body.user ?? null)
          setResolved(true)
          setSyncSessionStatus(true, isPaidSyncSession(body.user ?? null))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null)
          setResolved(true)
          setSyncSessionStatus(true, false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!resolved || !isPaidSyncSession(user)) {
    return null
  }

  // ⚠️ THE ERROR BOUNDARY IS LOAD-BEARING, AND ITS ABSENCE WAS A HIGH FINDING.
  //
  // Deferring this module created a failure mode that did not exist before: the sync
  // engine used to ship inside the root chunk, so if the app rendered at all, the
  // engine was present. Now `import('./ActiveSync')` can reject — offline, a blocking
  // proxy, or a 404 in a tab left open across a redeploy (the service worker sets
  // `cleanupOutdatedCaches` and claims open clients immediately). Without a boundary
  // that rejection propagates out of `SyncProvider`, past `routes/__root.tsx:154`
  // which wraps it in nothing, to TanStack Router's root catch — replacing the ENTIRE
  // app, nav and figures included, for a PAYING customer whose local data was fine.
  //
  // The correct degradation for "the sync engine could not load" is "no sync", which
  // is what this component renders anyway. `fallback={null}` on both the pending and
  // the failed path says exactly that. The charts had a boundary from the start; the
  // load-bearing surface did not, which was the wrong way round.
  return (
    <ErrorBoundary
      fallback={null}
      onError={(error) => {
        console.error('[SyncProvider] sync engine failed to load; continuing without sync:', error)
      }}
    >
      <Suspense fallback={null}>
        <ActiveSync userId={user.userId} />
      </Suspense>
    </ErrorBoundary>
  )
}
