/**
 * The notices for sync edits the server permanently refused (story 75.2, FR119).
 *
 * Written by `lib/sync/refusedEdits.ts` (through `useSync`), read by
 * `components/sync/RefusedEditNotice.tsx`. Deliberately tiny and dependency-light
 * — `zustand` and a type import only — for the same reason as
 * `sessionStatusStore.ts`: it must never import a domain store (a
 * `profileStore` → domain-store cycle has deadlocked Vite's module runner
 * before) or the sync engine.
 *
 * ⚠️ One entry per refused ROW (`entityType:entityId`), and an entry already on
 * screen is never added twice — a create refused together with its queued
 * follow-ups (75.1 D1) arrives as several ops for one row. A LATER refusal of
 * the same row with a DIFFERENT outcome (its update was changed back, now its
 * delete is restored) REPLACES the entry, moved to the end so it is announced
 * afresh (code review 75.2). Dismissing removes the entry, and nothing keeps a
 * copy, so the list cannot grow for the life of the session: it holds only what
 * the user has not dismissed yet. `useSync` also clears it when the sync service
 * is torn down (`resetRefusalNotices`), so one account's entry names never reach
 * another's session.
 *
 * Since story 79.2 it also holds `'not-synced'` notices: edits that keep failing
 * and are still KEPT. Those are driven by the core's escalated view through
 * `reconcileNotSyncedNotices`, not added by a refusal.
 */

import type { SyncEntityType, SyncOperationType } from '@budget-planner/core/sync'
import { create } from 'zustand'

/** What this device did with the refused change (the DECISION: revert). */
export type RefusalOutcome =
  /** A refused CREATE — the row never reached the account, so it was removed here. */
  | 'removed'
  /** A refused UPDATE — the account's value was pulled back over it. */
  | 'changed-back'
  /** A refused DELETE — the account still has the row, so it was pulled back. */
  | 'restored'
  /**
   * NOT a refusal (story 79.2, FR128): the edit keeps failing to sync and is
   * still KEPT on this device and queued. Nothing was undone. The notice clears
   * itself once the edit lands or leaves the queue.
   */
  | 'not-synced'

export interface RefusalNotice {
  /** `entityType:entityId` — one notice per row. */
  key: string
  entityType: SyncEntityType
  /** The entry's name, or `null` when no non-blank name could be found. */
  name: string | null
  /** The kind as the user knows it: "income", "expense", "savings", "investment", … */
  kind: string
  /** "An income entry", "A debt", … — used when `name` is `null`. */
  fallback: string
  outcome: RefusalOutcome
  /**
   * For a `'not-synced'` notice only: what kind of change is pending (a create,
   * an update or a delete), so the sentence can say so.
   */
  change?: SyncOperationType
}

interface RefusalNoticeState {
  notices: RefusalNotice[]
  /**
   * Rows whose `'not-synced'` notice the user dismissed while the edit is still
   * failing (story 79.2). The core re-reports an escalated edit on every status
   * change, so without this a dismissed notice would come straight back. A key
   * is forgotten once its row is no longer escalated, so a later, separate
   * escalation is shown again.
   */
  dismissedNotSynced: ReadonlySet<string>
}

const EMPTY_KEYS: ReadonlySet<string> = new Set()

const useRefusalNoticeStore = create<RefusalNoticeState>(() => ({
  notices: [],
  dismissedNotSynced: EMPTY_KEYS,
}))

/**
 * Add notices for refused rows. A row already on screen with the SAME outcome
 * is not added again; with a different outcome it replaces the old entry.
 */
export function addRefusalNotices(notices: readonly RefusalNotice[]): void {
  if (notices.length === 0) {
    return
  }
  useRefusalNoticeStore.setState((state) => {
    let next = state.notices
    let changed = false
    for (const notice of notices) {
      const existing = next.find((n) => n.key === notice.key)
      if (existing && existing.outcome === notice.outcome) {
        continue
      }
      next = [...next.filter((n) => n.key !== notice.key), notice]
      changed = true
    }
    return changed ? { notices: next } : state
  })
}

/**
 * Make the `'not-synced'` notices match the rows the core currently reports as
 * escalated (story 79.2). Called on every sync status change.
 *
 * - A row in `current` gets a notice unless the user dismissed it, or a notice
 *   for that row is already on screen. An on-screen REFUSAL for the row is kept:
 *   it reports something that already happened on this device (decision, Lucas
 *   2026-09-29, code review 79.2). An on-screen not-synced notice whose wording
 *   no longer matches (renamed, or now a delete) is rewritten in place.
 * - A `'not-synced'` notice whose row is not in `current` is removed: the edit
 *   landed or left the queue. Notices with any other outcome are never touched.
 * - A dismissal is forgotten once its row is not in `current`.
 *
 * Returns the same state object when nothing changes, so a quiet sync does not
 * re-render the notice.
 */
export function reconcileNotSyncedNotices(current: readonly RefusalNotice[]): void {
  useRefusalNoticeStore.setState((state) => {
    const currentKeys = new Set(current.map((n) => n.key))

    let dismissed = state.dismissedNotSynced
    if ([...dismissed].some((key) => !currentKeys.has(key))) {
      dismissed = new Set([...dismissed].filter((key) => currentKeys.has(key)))
    }

    let notices = state.notices.filter((n) => n.outcome !== 'not-synced' || currentKeys.has(n.key))
    for (const notice of current) {
      if (dismissed.has(notice.key)) {
        continue
      }
      const onScreen = notices.find((n) => n.key === notice.key)
      if (onScreen === undefined) {
        notices = [...notices, { ...notice, outcome: 'not-synced' }]
      } else if (onScreen.outcome === 'not-synced' && !sameWording(onScreen, notice)) {
        // What is pending changed (an update, then a delete) or the entry was
        // renamed: rewrite the notice IN PLACE (code review 79.2). Same React key,
        // so it is updated, not announced again.
        notices = notices.map((n) => (n === onScreen ? { ...notice, outcome: 'not-synced' } : n))
      }
    }

    const noticesChanged =
      notices.length !== state.notices.length || notices.some((n, i) => n !== state.notices[i])
    if (!noticesChanged && dismissed === state.dismissedNotSynced) {
      return state
    }
    return { notices, dismissedNotSynced: dismissed }
  })
}

/** Whether two notices for one row would render the same sentence. */
function sameWording(a: RefusalNotice, b: RefusalNotice): boolean {
  return (
    a.name === b.name && a.kind === b.kind && a.fallback === b.fallback && a.change === b.change
  )
}

/** The `'not-synced'` keys among `notices`, added to `dismissed`. */
function withDismissed(
  dismissed: ReadonlySet<string>,
  notices: readonly RefusalNotice[]
): ReadonlySet<string> {
  const keys = notices.filter((n) => n.outcome === 'not-synced').map((n) => n.key)
  return keys.length === 0 ? dismissed : new Set([...dismissed, ...keys])
}

/**
 * Dismiss one notice by its row key. A `'not-synced'` notice stays dismissed
 * while its edit is still failing (story 79.2).
 */
export function dismissRefusalNotice(key: string): void {
  useRefusalNoticeStore.setState((state) => ({
    notices: state.notices.filter((n) => n.key !== key),
    dismissedNotSynced: withDismissed(
      state.dismissedNotSynced,
      state.notices.filter((n) => n.key === key)
    ),
  }))
}

/** Dismiss every notice (the user's "Dismiss all"). */
export function dismissAllRefusalNotices(): void {
  useRefusalNoticeStore.setState((state) => ({
    notices: [],
    dismissedNotSynced: withDismissed(state.dismissedNotSynced, state.notices),
  }))
}

/**
 * Forget everything: every notice AND every dismissal (story 79.2). For the
 * sync service's teardown, not for the user: the next session may belong to
 * another account, whose entry names must never meet this one's, and whose own
 * edits must not stay hidden behind this session's dismissals.
 */
export function resetRefusalNotices(): void {
  useRefusalNoticeStore.setState({ notices: [], dismissedNotSynced: EMPTY_KEYS })
}

/** Read-only subscription to the notices on screen. */
export function useRefusalNotices(): RefusalNotice[] {
  return useRefusalNoticeStore((s) => s.notices)
}

/** Current notices, outside React (tests, diagnostics). */
export function getRefusalNotices(): RefusalNotice[] {
  return useRefusalNoticeStore.getState().notices
}
