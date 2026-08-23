import { useSync } from '@/hooks/useSync'
import { seedOnce } from '@/lib/sync/seedLocalData'
import { clearSyncBridge, registerSyncBridge } from '@/lib/sync/syncBridge'
import { useProfileStore } from '@/stores/profileStore'
import { useEffect, useRef } from 'react'

/**
 * The sync engine, split out so it is DOWNLOADED ONLY BY A PAID SESSION
 * (story 38.3, AC-6).
 *
 * `SyncProvider` is mounted in `routes/__root.tsx`, so before this split its
 * static imports — `useSync`, `seedLocalData`, `syncBridge` and, through them,
 * `applyServerChanges` — landed in the root chunk that every visitor downloads
 * before hydration can begin. Nobody on the free tier can ever execute a line of
 * it: the parent returns `null` for them at `SyncProvider.tsx`'s paid-session
 * gate. Pulling it through `React.lazy` moves the whole engine into its own chunk
 * that only a paid session fetches.
 *
 * ⚠️ Hydration-safe for the same reason the Overview's charts are: the parent
 * renders `null` until its client-only `/api/auth/me` probe resolves, so this
 * subtree cannot appear in the SSR HTML and there is nothing for a `Suspense`
 * fallback to diverge from.
 *
 * ⚠️ This is wiring, not UI — it renders `null`. The one-chunk delay before it
 * mounts is invisible, and the ordering it depends on (`activeProfileReconciled`
 * before the bridge registers) is enforced inside this file, not by when the
 * module arrives.
 */

/**
 * The mounted-for-paid-sessions inner component. Split out so the `useSync` hook
 * (and its poller) only ever runs once we KNOW the session is a paid sync tier —
 * hooks cannot be called conditionally in the parent.
 */
export function ActiveSync({ userId }: { userId: string }): null {
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
