/**
 * True only for a confirmed paid session on a device that has never pulled, while the calling page's
 * collection is empty and no pull has completed; bounded by a timeout so a stalled pull can't stick.
 */

import { useEffect, useState } from 'react'
import { useLastPullTimestamp, useSyncSessionStatus } from '../lib/sync/sessionStatusStore'

export const INITIAL_SYNC_PENDING_TIMEOUT_MS = 8000

const HAS_COMPLETED_INITIAL_PULL_KEY = 'sync:hasCompletedInitialPull'

function hasCompletedInitialPullBefore(): boolean {
  try {
    return window.localStorage.getItem(HAS_COMPLETED_INITIAL_PULL_KEY) === '1'
  } catch {
    return false
  }
}

function markInitialPullComplete(): void {
  try {
    window.localStorage.setItem(HAS_COMPLETED_INITIAL_PULL_KEY, '1')
  } catch {}
}

export function useIsInitialSyncPending(isCollectionEmpty: boolean): boolean {
  const { resolved, isPaidSyncSession } = useSyncSessionStatus()
  const lastPullTimestamp = useLastPullTimestamp()
  const [timedOut, setTimedOut] = useState(false)
  // Starts false and reads localStorage in an effect so server and first client render match.
  const [everCompletedBefore, setEverCompletedBefore] = useState(false)

  useEffect(() => {
    if (hasCompletedInitialPullBefore()) {
      setEverCompletedBefore(true)
    }
  }, [])

  useEffect(() => {
    if (lastPullTimestamp !== null) {
      markInitialPullComplete()
    }
  }, [lastPullTimestamp])

  const pending =
    resolved &&
    isPaidSyncSession &&
    !everCompletedBefore &&
    isCollectionEmpty &&
    lastPullTimestamp === null &&
    !timedOut

  useEffect(() => {
    if (!pending) {
      return
    }
    const timer = setTimeout(() => setTimedOut(true), INITIAL_SYNC_PENDING_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [pending])

  return pending
}
