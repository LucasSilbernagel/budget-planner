import { useSync } from '@/hooks/useSync'
import { dropAnotherAccountsLocalData } from '@/lib/sync/dropAnotherAccountsLocalData'
import { reconcilePlanAfterInitialPull } from '@/lib/sync/retirementPlanPush'
import { seedOnce } from '@/lib/sync/seedLocalData'
import { clearSyncBridge, registerSyncBridge } from '@/lib/sync/syncBridge'
import { useProfileStore } from '@/stores/profileStore'
import { type ReactElement, useEffect, useRef, useState } from 'react'
import { RefusedEditNotice } from './RefusedEditNotice'

// Removes another account's data from the shared stores before the engine mounts,
// so its first render never reads them.
export function ActiveSync({ userId }: { userId: string }): ReactElement | null {
  const [clearedFor, setClearedFor] = useState<string | null>(null)
  useEffect(() => {
    dropAnotherAccountsLocalData(userId)
    setClearedFor(userId)
  }, [userId])
  if (clearedFor !== userId) {
    return null
  }
  return <ActiveSyncEngine userId={userId} />
}

function ActiveSyncEngine({ userId }: { userId: string }): ReactElement {
  const sync = useSync({ userId, autoSync: true, autoPull: true })
  const initialPullRef = useRef(false)
  const backfillRef = useRef(false)
  const planSeedRef = useRef(false)
  const [initialPullApplied, setInitialPullApplied] = useState(false)
  // Gates the push bridge and backlog seed until the reconciling pull replaces the
  // placeholder profile.
  const activeProfileReconciled = useProfileStore((s) => {
    const active = s.profiles.find((p) => p.id === s.activeProfileId)
    return active !== undefined && Boolean(active.userId)
  })

  const { queueCreate, queueUpdate, queueDelete, forcePull, forceSync, isSyncing } = sync

  // Register only once reconciled: before that profileId is a placeholder, and pushed
  // ops would fail non-retryably and trip the circuit breaker.
  useEffect(() => {
    if (!activeProfileReconciled) {
      return
    }
    registerSyncBridge({ userId, queueCreate, queueUpdate, queueDelete })
    return () => {
      clearSyncBridge()
    }
  }, [userId, activeProfileReconciled, queueCreate, queueUpdate, queueDelete])

  useEffect(() => {
    if (initialPullRef.current) {
      return
    }
    initialPullRef.current = true
    forcePull()
      .then((result) => {
        if (result?.success) {
          setInitialPullApplied(true)
        }
      })
      .catch((error) => {
        console.error('[SyncProvider] initial pull failed:', error)
      })
  }, [forcePull])

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

  // Must run after the initial pull is applied: a seed queued earlier would win locally
  // by last-writer-wins while the server treated it as a no-op.
  useEffect(() => {
    if (planSeedRef.current || !initialPullApplied || !activeProfileReconciled) {
      return
    }
    planSeedRef.current = true
    reconcilePlanAfterInitialPull().catch((error) => {
      console.error('[SyncProvider] syncing the retirement plan failed:', error)
    })
  }, [initialPullApplied, activeProfileReconciled])

  return (
    <RefusedEditNotice
      onRetry={() => {
        void forceSync()
      }}
      isRetrying={isSyncing}
    />
  )
}
