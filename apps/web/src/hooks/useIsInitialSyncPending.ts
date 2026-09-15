/**
 * Whether a paid session's very FIRST-EVER cross-device sync pull is still in
 * flight on THIS device (Story 53.1, AC-4; redesigned in code review — see the
 * story's Review Findings for what the first version got wrong).
 *
 * Before this story, `ActiveSync`'s mount-time `forcePull()` never actually
 * ran for anyone (the gate ahead of it never mounted `ActiveSync` at all —
 * see `SyncProvider.hasProbableSession`), so this window did not exist in
 * practice. Now that the pull genuinely runs, a device with no LOCAL data yet
 * (a fresh device, mid pull) would otherwise render the same confident
 * "no income sources yet" / "let's set up your budget" empty state a
 * permanently-empty account shows — which is indistinguishable from the data
 * loss this story exists to fix, for as long as the pull takes.
 *
 * Takes `isCollectionEmpty` — whether the CALLING page's own local collection
 * is currently empty — so the page never has to guess: any page with real
 * local data to show is never gated, full stop, regardless of sync state.
 *
 * True only while ALL of:
 *  - a paid sync session is confirmed (mirrors `SyncProvider`'s own
 *    resolution via the shared `sessionStatusStore` — NOT a second,
 *    independently-resolved check like `usePremiumAccess()`, which can
 *    disagree with `SyncProvider` about whether a session is paid, since it
 *    depends on a different, HttpOnly-blind cookie read; see the deferred
 *    finding in the story's Review Findings)
 *  - this DEVICE has never completed an initial pull before, per a
 *    `localStorage` flag. Combined with `isCollectionEmpty` rather than
 *    replacing it: the flag alone would still gate a genuinely-empty
 *    category on an established device (e.g. a user who never used Balance
 *    Tracking) every cold load until it flips true — with BOTH checks, an
 *    established device (flag true) is never gated on any page, and a
 *    device that somehow has local rows despite an unset flag (e.g. its
 *    localStorage was cleared) is still never gated on a page with real data.
 *  - the CALLING page's own collection is currently empty
 *    (`isCollectionEmpty`)
 *  - no pull has completed THIS session yet (`lastPullTimestamp === null`)
 *
 * Bounded by `INITIAL_SYNC_PENDING_TIMEOUT_MS`: a stalled or permanently
 * failing pull (offline, a persistent server error) degrades to the
 * resolved-empty state rather than an indefinite skeleton, trading a
 * possibly-too-early empty render for a page that can never be stuck loading
 * forever.
 */

import { useEffect, useState } from 'react'
import { useLastPullTimestamp, useSyncSessionStatus } from '../lib/sync/sessionStatusStore'

/** Exported for tests only, so a timeout test doesn't hard-code a duplicate value. */
export const INITIAL_SYNC_PENDING_TIMEOUT_MS = 8000

const HAS_COMPLETED_INITIAL_PULL_KEY = 'sync:hasCompletedInitialPull'

function hasCompletedInitialPullBefore(): boolean {
  try {
    return window.localStorage.getItem(HAS_COMPLETED_INITIAL_PULL_KEY) === '1'
  } catch {
    // Blocked/unavailable storage: treat as "never synced before" — the
    // pending gate stays live a little longer, never permanently wrong.
    return false
  }
}

function markInitialPullComplete(): void {
  try {
    window.localStorage.setItem(HAS_COMPLETED_INITIAL_PULL_KEY, '1')
  } catch {
    // Best-effort: a blocked/full localStorage just means this device may
    // show the pending gate once more next session — not a correctness issue.
  }
}

export function useIsInitialSyncPending(isCollectionEmpty: boolean): boolean {
  const { resolved, isPaidSyncSession } = useSyncSessionStatus()
  const lastPullTimestamp = useLastPullTimestamp()
  const [timedOut, setTimedOut] = useState(false)
  // ⚠️ Starts `false` on EVERY render, server and first client render alike —
  // matching `useStoresHydrated`'s own documented reasoning for why this must
  // never be a synchronous-initializer `useState(hasCompletedInitialPullBefore)`.
  // localStorage is only ever read inside an effect (below), which cannot run
  // before the first commit, so server and client render identically on the
  // very first pass and there is no hydration-mismatch risk.
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
