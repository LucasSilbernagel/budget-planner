/**
 * Free-tier rows are re-sent as creates; rows already on the server conflict harmlessly.
 * Only placeholder-owned rows are seeded, never another account's.
 */

import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { isOwnedByAnotherAccount } from './accountOwner'
import { enqueueCreate, isSyncActive } from './syncBridge'

export function seedMarkerKey(userId: string): string {
  // `v2`: v1 markers were set while the server rejected every row; bumping re-seeds each device once (safe).
  return `budget-planner:sync-seeded-v2:${userId}`
}

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
    // Best-effort: the worst case is a harmless re-seed next session.
  }
}

/** Already-synced rows carry a real owner uuid; re-creating them causes conflicts the queue never drains. */
function needsSeeding(row: { userId?: unknown }, sessionUserId: string): boolean {
  return (
    String(row.userId ?? '') !== sessionUserId &&
    !isOwnedByAnotherAccount(row.userId, sessionUserId)
  )
}

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

  // Categories first: queue order is wire order and cashflow categoryId is an FK (necessary, not sufficient).
  // Tombstones excluded: the category payload drops isDeleted, so seeding would resurrect them.
  for (const row of useCategoryStore.getState().categories) {
    if (row.isDeleted) {
      continue
    }
    consider('category', row)
  }
  // Not profile-scoped: the whole device backlog is uploaded.
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

  // Await durable adds so the caller's marker reflects a persisted backlog.
  await Promise.all(pending)
  return pending.length
}

/** The marker is set only after the enqueues persist, so an interrupted seed retries next session. */
export async function seedOnce(userId: string): Promise<number> {
  if (hasSeeded(userId)) {
    return 0
  }
  if (!isSyncActive()) {
    return 0
  }
  const count = await seedLocalDataToServer(userId)
  markSeeded(userId)
  return count
}
