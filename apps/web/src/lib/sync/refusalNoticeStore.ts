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
 * is torn down, so one account's entry names never reach another's session.
 */

import type { SyncEntityType } from '@budget-planner/core/sync'
import { create } from 'zustand'

/** What this device did with the refused change (the DECISION: revert). */
export type RefusalOutcome =
  /** A refused CREATE — the row never reached the account, so it was removed here. */
  | 'removed'
  /** A refused UPDATE — the account's value was pulled back over it. */
  | 'changed-back'
  /** A refused DELETE — the account still has the row, so it was pulled back. */
  | 'restored'

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
}

interface RefusalNoticeState {
  notices: RefusalNotice[]
}

const useRefusalNoticeStore = create<RefusalNoticeState>(() => ({ notices: [] }))

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

/** Dismiss one notice by its row key. */
export function dismissRefusalNotice(key: string): void {
  useRefusalNoticeStore.setState((state) => ({
    notices: state.notices.filter((n) => n.key !== key),
  }))
}

/** Dismiss every notice. */
export function dismissAllRefusalNotices(): void {
  useRefusalNoticeStore.setState({ notices: [] })
}

/** Read-only subscription to the notices on screen. */
export function useRefusalNotices(): RefusalNotice[] {
  return useRefusalNoticeStore((s) => s.notices)
}

/** Current notices, outside React (tests, diagnostics). */
export function getRefusalNotices(): RefusalNotice[] {
  return useRefusalNoticeStore.getState().notices
}
