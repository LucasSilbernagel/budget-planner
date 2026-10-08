/**
 * Only user intent pushes: effects that rewrite the plan from device-local inputs must not, or devices rewrite each other.
 * Imports no store: the retirement store imports this, and a cycle deadlocks concurrent imports.
 */

import type { SyncOperation } from '@budget-planner/core'
import { type RetirementPlan, coerceRetirementPlan } from '../retirement-plan'
import { enqueueCreate, enqueueUpdate, getSyncSessionUserId } from './syncBridge'

export const PLAN_PUSH_DEBOUNCE_MS = 1500

export interface RetirementPlanSnapshot {
  plan: RetirementPlan
  ownerUserId: string
  serverUpdatedAt: string | null
  localPlanDiverged: boolean
}

export interface RetirementPlanSource {
  read: () => RetirementPlanSnapshot
  /** Plain setState; never pushes. */
  setDiverged: (diverged: boolean) => void
}

let source: RetirementPlanSource | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** Flushed ops whose queue add hasn't settled; the applier must still skip the plan meanwhile. */
let addsInFlight = 0
let lastSynced: string | null = null
/** For own-echo detection. */
const pushedSincePull = new Set<string>()
let lastAcceptedAt = Number.NEGATIVE_INFINITY
let lastRefusedAt = Number.NEGATIVE_INFINITY

export function bindRetirementPlanSource(next: RetirementPlanSource): void {
  source = next
}

/** Rebuilt through coerceRetirementPlan so the key doesn't depend on property order. */
function syncedKey(userId: string, plan: RetirementPlan): string {
  return `${userId}\n${JSON.stringify(coerceRetirementPlan(plan))}`
}

/**
 * With no session, an owned plan is marked not-on-server so the next paid session pushes it.
 * No timer for a non-owning session: it would block the first-sign-in seed.
 */
export function schedulePlanPush(): void {
  if (source === null) {
    return
  }
  const userId = getSyncSessionUserId()
  const { ownerUserId, localPlanDiverged } = source.read()
  if (userId === null) {
    if (ownerUserId !== '' && !localPlanDiverged) {
      source.setDiverged(true)
    }
    return
  }
  if (ownerUserId !== userId) {
    return
  }
  if (timer !== null) {
    clearTimeout(timer)
  }
  timer = setTimeout(flushPlanPush, PLAN_PUSH_DEBOUNCE_MS)
}

export function hasPendingPlanEdit(): boolean {
  return timer !== null || addsInFlight > 0
}

/** Flushing would push the defaults or another account's plan over the server copy. */
export function cancelPendingPlanPush(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

export function flushPendingPlanPush(): void {
  if (timer !== null) {
    flushPlanPush()
  }
}

function flushPlanPush(): void {
  cancelPendingPlanPush()
  if (source === null) {
    return
  }
  const userId = getSyncSessionUserId()
  const { ownerUserId } = source.read()
  if (userId === null) {
    // Signed out or downgraded inside the debounce: keep it for the next session.
    if (ownerUserId !== '') {
      source.setDiverged(true)
    }
    return
  }
  if (ownerUserId !== userId) {
    return
  }
  queuePlan(userId, { force: false })
}

/** `force` re-sends an own echo or a not-on-server plan even when equal to the last one sent. */
function queuePlan(userId: string, { force }: { force: boolean }): void {
  if (source === null) {
    return
  }
  const { plan, serverUpdatedAt } = source.read()
  const key = syncedKey(userId, plan)
  if (!force && key === lastSynced) {
    return
  }
  // `updatedAt` becomes the op's baseVersion: the newest server version seen, applied or skipped.
  const queued = enqueueUpdate('retirementPlan', {
    id: userId,
    plan,
    ...(serverUpdatedAt !== null ? { updatedAt: serverUpdatedAt } : {}),
  } as { id: string; updatedAt?: string })
  if (queued === null) {
    return
  }
  addsInFlight += 1
  queued
    .then(() => {
      // Only now: a failed add must not make the same plan look already sent.
      lastSynced = key
      pushedSincePull.add(key)
    })
    .catch((error) => {
      console.error('[retirementPlanPush] failed to queue the retirement plan:', error)
      source?.setDiverged(true)
    })
    .finally(() => {
      addsInFlight -= 1
    })
}

/**
 * Own echo: the batch response has no updatedAt, so a queued newer edit would lose LWW to the echo; skip and re-queue.
 * The caller records the skipped version as serverUpdatedAt before any re-queue reads it.
 */
export function classifyPulledPlan(
  userId: string,
  pulled: RetirementPlan
): 'apply' | 'skip' | 'own-echo' {
  if (source === null) {
    return 'apply'
  }
  const { plan, ownerUserId, localPlanDiverged } = source.read()
  if (ownerUserId !== userId) {
    return 'apply'
  }
  if (hasPendingPlanEdit() || localPlanDiverged) {
    return 'skip'
  }
  const pulledKey = syncedKey(userId, pulled)
  if (pushedSincePull.has(pulledKey) && pulledKey !== syncedKey(userId, plan)) {
    return 'own-echo'
  }
  return 'apply'
}

export function requeueAfterOwnEcho(userId: string): void {
  queuePlan(userId, { force: true })
}

export function notePlanSynced(userId: string, plan: RetirementPlan): void {
  lastSynced = syncedKey(userId, plan)
  pushedSincePull.clear()
}

export function forgetSyncedPlan(): void {
  lastSynced = null
  pushedSincePull.clear()
}

/** An acknowledged create doesn't count: insert-if-absent may have changed nothing. */
export function notePlanOpsAccepted(operations: readonly SyncOperation[], userId: string): void {
  for (const op of operations) {
    if (op.entityType === 'retirementPlan' && op.type === 'update' && op.entityId === userId) {
      lastAcceptedAt = Math.max(lastAcceptedAt, op.timestamp)
    }
  }
  if (source === null || lastAcceptedAt <= lastRefusedAt) {
    return
  }
  const { ownerUserId, localPlanDiverged } = source.read()
  if (ownerUserId === userId && localPlanDiverged) {
    source.setDiverged(false)
  }
}

/** Core reports accepted before refused within a sync, so an older refusal must not undo a newer acceptance. */
export function notePlanOpRefused(op: SyncOperation): void {
  lastRefusedAt = Math.max(lastRefusedAt, op.timestamp)
  if (source === null || op.timestamp <= lastAcceptedAt) {
    return
  }
  const { ownerUserId } = source.read()
  if (ownerUserId === String(op.entityId)) {
    lastSynced = null
    source.setDiverged(true)
  }
}

/** Not on the server → push an update; server has a plan → nothing; else one create (inserted only if absent). */
export async function reconcilePlanAfterInitialPull(): Promise<'pushed' | 'seeded' | 'none'> {
  const userId = getSyncSessionUserId()
  if (userId === null || source === null || hasPendingPlanEdit()) {
    return 'none'
  }
  const { plan, ownerUserId, serverUpdatedAt, localPlanDiverged } = source.read()
  if (ownerUserId !== userId) {
    return 'none'
  }
  if (localPlanDiverged) {
    queuePlan(userId, { force: true })
    return 'pushed'
  }
  if (serverUpdatedAt !== null) {
    return 'none'
  }
  const queued = enqueueCreate('retirementPlan', { id: userId, plan } as { id: string })
  if (queued === null) {
    return 'none'
  }
  try {
    await queued
  } catch (error) {
    source.setDiverged(true)
    throw error
  }
  lastSynced = syncedKey(userId, plan)
  return 'seeded'
}

function onPageLeave(): void {
  flushPendingPlanPush()
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    flushPendingPlanPush()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', onPageLeave)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

export function resetRetirementPlanPushForTests(): void {
  cancelPendingPlanPush()
  addsInFlight = 0
  lastSynced = null
  pushedSincePull.clear()
  lastAcceptedAt = Number.NEGATIVE_INFINITY
  lastRefusedAt = Number.NEGATIVE_INFINITY
}
