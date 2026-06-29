/**
 * Free→paid seeding (Story 5-15, Task 5).
 *
 * When a user upgrades to paid, the financial rows they accumulated while on the
 * free tier live ONLY in localStorage — nothing pushed them to the server (the
 * sync bridge only forwards edits made AFTER the paid session mounts). This
 * backfills that pre-upgrade data so AC-2's "zero data loss across the free→paid
 * transition" holds.
 *
 * APPROACH (idempotent, no bespoke upload endpoint): enqueue a `create` for every
 * existing local financial row through the SAME sync bridge the live edits use.
 * Because entity ids are client-generatable uuids shared across devices (5-14):
 *  - a row not yet on the server is created;
 *  - a row already on the server collides as a create-create CONFLICT, which the
 *    server ignores (no duplicate) — harmless.
 * Profiles are deliberately NOT seeded: the server auto-creates the user's default
 * profile at signup, and `applyServerChanges` reconciles the client to it. Every
 * seeded financial row is stamped (by the service) with the active *server*
 * profile id, so the caller MUST only invoke this once that profile is reconciled
 * (see SyncProvider's seeding gate).
 *
 * Re-seeding is avoided across sessions by a per-user localStorage marker so an
 * ordinary re-login does not replay creates and inflate the conflict count.
 */

import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { enqueueCreate, isSyncActive } from './syncBridge'

/** localStorage key marking that this user's free-tier backlog has been seeded. */
export function seedMarkerKey(userId: string): string {
  return `budget-planner:sync-seeded:${userId}`
}

/** Whether this user's backlog has already been seeded on this device. */
export function hasSeeded(userId: string): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' && localStorage.getItem(seedMarkerKey(userId)) !== null
    )
  } catch {
    return false
  }
}

function markSeeded(userId: string): void {
  try {
    localStorage.setItem(seedMarkerKey(userId), String(Date.now()))
  } catch {
    // Best-effort: if storage is unavailable the seed still runs; the only cost is
    // a possible (harmless, conflict-resolved) re-seed next session.
  }
}

/**
 * Whether a row still needs seeding: a row that has ALREADY been synced carries
 * the session user's uuid as its `userId` (a pull overwrote the local row with the
 * server's, Story 5-14), whereas a never-synced free-tier row carries the
 * placeholder (`0` / `''` / absent). Skipping already-server-backed rows is the
 * review fix (5-15 code review, Decision 1 option b) that prevents seeding from
 * re-creating server rows — which would produce `create-create` conflicts the
 * push queue never drains (→ circuit breaker). Race-free: it reads the merged
 * store state, no dependence on capturing the pull result.
 */
function needsSeeding(row: { userId?: unknown }, sessionUserId: string): boolean {
  return String(row.userId ?? '') !== sessionUserId
}

/**
 * Enqueue a `create` for every local financial row that is NOT already on the
 * server, and AWAIT the durable enqueues. Returns the number of rows enqueued.
 * Rows already server-backed (their `userId` is the session uuid) are skipped.
 */
export async function seedLocalDataToServer(sessionUserId: string): Promise<number> {
  const pending: Promise<void>[] = []

  const consider = (
    entityType: Parameters<typeof enqueueCreate>[0],
    row: { id: string; userId?: unknown }
  ): void => {
    if (!needsSeeding(row, sessionUserId)) {
      return
    }
    const queued = enqueueCreate(entityType, row)
    if (queued) {
      pending.push(queued)
    }
  }

  for (const row of useIncomeStore.getState().incomeSources) {
    consider('incomeSource', row)
  }
  for (const row of useExpenseStore.getState().expenses) {
    consider('expense', row)
  }
  for (const row of useSavingsStore.getState().savingsGoals) {
    consider('savingsGoal', row)
  }
  for (const row of useBalanceStore.getState().entries) {
    consider('balanceTracking', row)
  }

  // Await the durable adds so the marker (set by the caller AFTER this resolves)
  // truly reflects a persisted backlog.
  await Promise.all(pending)
  return pending.length
}

/**
 * Seed the user's free-tier backlog exactly once per device. The marker is set
 * ONLY AFTER the enqueues have durably persisted, so an interrupted or
 * bridge-inactive seed is retried next session rather than being silently lost.
 */
export async function seedOnce(userId: string): Promise<number> {
  if (hasSeeded(userId)) {
    return 0
  }
  // Bridge not ready (no paid session wired yet) — do NOT mark; retry later.
  if (!isSyncActive()) {
    return 0
  }
  const count = await seedLocalDataToServer(userId)
  markSeeded(userId)
  return count
}
