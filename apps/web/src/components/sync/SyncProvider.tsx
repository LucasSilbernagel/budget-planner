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
 *  2. If the session is a paid sync tier (active | past_due | lifetime, matching
 *     the server push/pull gate), render <ActiveSync>; otherwise render nothing.
 *  3. <ActiveSync> instantiates `useSync` (auto-pull poller on), registers the
 *     push queue with the sync bridge so paid store mutations are forwarded
 *     (Story 5-15 Task 3), and seeds the local stores with an initial pull.
 *  4. On unmount (logout / downgrade / navigation away from a paid session) the
 *     bridge is cleared and `useSync` tears down its poller — paid→free returns
 *     the app to localStorage-only behaviour with no further network (Task 5).
 *
 * Renders `null` — it is wiring, not UI. SSR-safe: the session probe runs only on
 * the client (after mount), so the server render is inert.
 */

import { lazyWithRetry } from '@/lib/lazy-with-retry'
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

/**
 * Subscription statuses allowed to use server-side sync (push AND pull). Must
 * mirror the server's `PAID_SYNC_STATUSES` (apps/web/src/server/api/sync.ts) —
 * kept as a local literal so this client component never imports the server
 * module (which would pull `@budget-planner/db` into the client bundle).
 *
 * `past_due` keeps sync alive for a paying customer inside the dunning window.
 *
 * ⚠️ THIS LIST WAS WRONG UNTIL STORY 34.1a, AND THE COMMENT ABOVE IT SAID
 * OTHERWISE. `'lifetime'` was missing while the comment claimed the list matched
 * the server "exactly". Because this gate decides whether `<ActiveSync>` mounts at
 * all, a lifetime buyer got NO sync whatsoever — and silently: no 403, no console
 * error, the request was never even fired. It is the same hole the server side
 * already had and fixed (see the server constant's own note), re-opened on the
 * client. Exported solely so `__tests__/sync-status-parity.test.ts` can assert the
 * two real constants against each other instead of restating either one.
 */
export const PAID_SYNC_STATUSES = ['active', 'past_due', 'lifetime'] as const

interface SessionUser {
  userId: string
  subscriptionStatus: string
}

function isPaidSyncSession(user: SessionUser | null): user is SessionUser {
  return (
    user !== null && (PAID_SYNC_STATUSES as readonly string[]).includes(user.subscriptionStatus)
  )
}

export function SyncProvider(): ReactElement | null {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [resolved, setResolved] = useState(false)

  // Resolve the session once, client-side. A failure (offline, 401) simply means
  // "no paid session" — the free tier path, never a crash.
  useEffect(() => {
    let cancelled = false
    // Anonymous visitors carry no session cookie — skip the probe entirely so the
    // free / unauthenticated tier makes ZERO network calls (AC-6, review P3). Only
    // a request that actually carries a session is worth resolving server-side.
    if (typeof document !== 'undefined' && !/(?:^|;\s*)session=/.test(document.cookie)) {
      setResolved(true)
      return
    }
    fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : { user: null }))
      .then((body: { user?: SessionUser | null }) => {
        if (!cancelled) {
          setUser(body.user ?? null)
          setResolved(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null)
          setResolved(true)
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
