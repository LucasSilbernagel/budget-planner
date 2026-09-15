/**
 * A tiny, dedicated zustand store for "is this a paid sync session, and has
 * its first pull completed" (Story 53.1 review).
 *
 * Deliberately SEPARATE from `hooks/useSync.ts`'s own sync store: that module
 * statically imports the full sync engine (`SynchronizationService`, the sync
 * HTTP client, `applyServerChangesToStores`), and the whole point of
 * lazy-loading `ActiveSync` (story 38.3, AC-6) is to keep that engine out of
 * the eagerly-loaded root chunk for anonymous and free visitors. `SyncProvider`
 * (root-mounted, always eager) and `useIsInitialSyncPending` (used by 5
 * route-level pages) both need to read/write a slice of sync status WITHOUT
 * pulling that engine in — so this file imports nothing but `zustand`.
 *
 * `useSync.ts`'s `pull()` mirrors its own `lastPullTimestamp` into this store
 * (`setLastPullTimestamp`) so there is exactly one value any consumer,
 * lightweight or not, ever reads.
 */

import { create } from 'zustand'

interface SessionStatusState {
  /**
   * Whether `SyncProvider`'s own session probe (`/api/auth/me`, gated by
   * `hasProbableSession`) has resolved yet. `false` until then — including
   * for a free/unauthenticated visitor whose probe is skipped entirely (see
   * `SyncProvider.tsx`), so a consumer must check this before trusting
   * `isPaidSyncSession` below.
   */
  resolved: boolean

  /**
   * Whether the resolved session is a paid sync tier. Set by `SyncProvider`
   * from the SAME resolution it uses to decide whether to mount `ActiveSync`
   * — a consumer reading this can never disagree with `SyncProvider` about
   * "is this a paid session" the way a second, independently-resolved check
   * (e.g. `usePremiumAccess()`) could.
   */
  isPaidSyncSession: boolean

  /** Last pull timestamp (null if never pulled) — server → client cursor. */
  lastPullTimestamp: number | null
}

const useSessionStatusStore = create<SessionStatusState>(() => ({
  resolved: false,
  isPaidSyncSession: false,
  lastPullTimestamp: null,
}))

/** Read-only subscription to whether the session probe has resolved, and to what. */
export function useSyncSessionStatus(): { resolved: boolean; isPaidSyncSession: boolean } {
  return useSessionStatusStore((s) => ({
    resolved: s.resolved,
    isPaidSyncSession: s.isPaidSyncSession,
  }))
}

/**
 * Called by `SyncProvider` once its own `/api/auth/me` probe resolves, so
 * other lightweight consumers can read the outcome without a second probe.
 * Also called with `(true, false)` on the free/unauthenticated fast path,
 * where the probe is skipped entirely.
 */
export function setSyncSessionStatus(resolved: boolean, isPaidSyncSession: boolean): void {
  useSessionStatusStore.setState({ resolved, isPaidSyncSession })
}

/**
 * Read-only subscription to the last successful pull's cursor. `null` until
 * the first pull (success, or a failure that still reached the server)
 * records one — see `useSync.ts`'s `pull()`, which mirrors its own value here.
 */
export function useLastPullTimestamp(): number | null {
  return useSessionStatusStore((s) => s.lastPullTimestamp)
}

export function setLastPullTimestamp(value: number | null): void {
  useSessionStatusStore.setState({ lastPullTimestamp: value })
}

/** Reset the store. **Tests only.** */
export function resetSessionStatusStore(): void {
  useSessionStatusStore.setState({
    resolved: false,
    isPaidSyncSession: false,
    lastPullTimestamp: null,
  })
}
