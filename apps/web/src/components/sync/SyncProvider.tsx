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
 *  2. If the session is a paid sync tier (active | past_due, matching the server
 *     push/pull gate), render <ActiveSync>; otherwise render nothing.
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

import { useSync } from '@/hooks/useSync'
import { seedOnce } from '@/lib/sync/seedLocalData'
import { clearSyncBridge, registerSyncBridge } from '@/lib/sync/syncBridge'
import { useProfileStore } from '@/stores/profileStore'
import { type ReactElement, useEffect, useRef, useState } from 'react'

/**
 * Subscription statuses allowed to use server-side sync (push AND pull). Mirrors
 * the server's `PAID_SYNC_STATUSES` (apps/web/src/server/api/sync.ts) — kept as a
 * local literal so this client component never imports the server module (which
 * pulls `@budget-planner/db` into the bundle). `past_due` is included so a paying
 * customer in the dunning window keeps sync, matching the server gate exactly.
 */
const PAID_SYNC_STATUSES = ['active', 'past_due'] as const

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

  return <ActiveSync userId={user.userId} />
}

/**
 * The mounted-for-paid-sessions inner component. Split out so the `useSync` hook
 * (and its poller) only ever runs once we KNOW the session is a paid sync tier —
 * hooks cannot be called conditionally in the parent.
 */
function ActiveSync({ userId }: { userId: string }): null {
  const sync = useSync({ userId, autoSync: true, autoPull: true })
  const initialPullRef = useRef(false)
  const backfillRef = useRef(false)
  // True once the active profile is a REAL server-backed profile (non-empty
  // userId) — i.e. the reconciling pull has landed. BOTH the push bridge and the
  // backlog seed gate on this so neither runs while config.profileId is still the
  // un-reconciled bootstrap placeholder. Reactive: re-runs the gated effects when
  // reconciliation flips it true.
  const activeProfileReconciled = useProfileStore((s) => {
    const active = s.profiles.find((p) => p.id === s.activeProfileId)
    return active !== undefined && Boolean(active.userId)
  })

  const { queueCreate, queueUpdate, queueDelete, forcePull } = sync

  // Register the push queue ONLY once the active profile is reconciled (review P1):
  // before that, config.profileId is the 'local-default' placeholder, so any pushed
  // op would carry an invalid profileId, fail non-retryably, stick in the queue and
  // trip the circuit breaker. While unreconciled the bridge stays unregistered →
  // paid edits are localStorage-only and are picked up by the backlog seed below.
  // Clears on unmount (logout / downgrade) or if the profile de-reconciles.
  useEffect(() => {
    if (!activeProfileReconciled) {
      return
    }
    registerSyncBridge({ userId, queueCreate, queueUpdate, queueDelete })
    return () => {
      clearSyncBridge()
    }
  }, [userId, activeProfileReconciled, queueCreate, queueUpdate, queueDelete])

  // Seed local state with one immediate pull on mount (the poller otherwise waits
  // a full interval). This also delivers the user's server profiles, which
  // applyServerChanges uses to repoint the active profile (Story 5-15).
  useEffect(() => {
    if (initialPullRef.current) {
      return
    }
    initialPullRef.current = true
    forcePull().catch((error) => {
      console.error('[SyncProvider] initial pull failed:', error)
    })
  }, [forcePull])

  // Free→paid backlog seed (Task 5): once the active profile is reconciled (so the
  // bridge above is registered and config.profileId is valid), push the user's
  // pre-upgrade localStorage backlog ONCE. seedOnce awaits the durable enqueues and
  // only then sets its per-user marker, skipping rows already on the server — so a
  // re-login does not replay creates and seeding never generates create-create
  // conflicts (review P2 + P6). On failure the ref is reset so a later trigger retries.
  useEffect(() => {
    if (backfillRef.current || !activeProfileReconciled) {
      return
    }
    backfillRef.current = true
    seedOnce(userId)
      .then((seeded) => {
        if (seeded > 0) {
          console.info(`[SyncProvider] seeded ${seeded} local row(s) to the server`)
        }
      })
      .catch((error) => {
        backfillRef.current = false
        console.error('[SyncProvider] seeding failed:', error)
      })
  }, [activeProfileReconciled, userId])

  return null
}
