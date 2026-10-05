/**
 * The retirement plan's client PUSH (story 99.3, FR161; Part B of the 99.2 split).
 *
 * The plan is ONE value per account (99.2: id = the account's id, whole-plan
 * last-writer-wins). This module decides WHEN this device sends it, and the
 * rules are what keep two devices from rewriting each other:
 *
 * - **Only user intent pushes (D6).** The retirement store's intent setters call
 *   {@link schedulePlanPush}. Nothing else does: not the planner's three effects
 *   (desired-income seed, adopted-figure basis re-expression, locale
 *   re-expression, all through `setDesiredIncomeForLocale`), not
 *   `claimRetirementPlanFor`, not the pull applier's ordinary apply, not
 *   `resetPlan` (Clear local data, AC-9). Those rewrite the plan from
 *   DEVICE-LOCAL inputs (income store, currency); if they pushed, two devices
 *   with different currencies would rewrite each other on every pull (AC-3).
 * - **One op per quiet period (D7, AC-4).** A burst of keystrokes is coalesced by
 *   a {@link PLAN_PUSH_DEBOUNCE_MS} debounce; the plan is read at FLUSH time. A
 *   plan equal to the last one pushed or pulled queues nothing (a blur re-echo
 *   that formats to the same string). One op is one request, and push shares
 *   the 100 req/min budget with pull.
 * - **Leaving the page flushes.** `pagehide` and `visibilitychange: hidden` hand
 *   a pending edit to the durable queue at once. The queue's add is ASYNC
 *   (it awaits its storage write), so this starts the write before the page
 *   goes; it cannot guarantee the browser lets it finish.
 * - **A pending edit is protected from a pull (AC-5).** Core's last-writer-wins
 *   protects QUEUED ops only. While {@link hasPendingPlanEdit} is true (a timer
 *   is armed OR a flushed op is still being added to the queue) the pull applier
 *   skips the plan, and records the skipped server version as the store's
 *   `serverUpdatedAt`, which the next push sends as its `baseVersion`.
 * - **Owner and session (AC-6).** An op is queued only while a paid sync session
 *   is wired (`isSyncActive()`) AND the plan on screen is that session's.
 * - **A plan that is not on the server stays (AC-12 + code review 2026-10-05).**
 *   The store's persisted `localPlanDiverged` marks an OWNED plan that this
 *   device holds and the server may not: an edit made with no session to queue
 *   it (free period, before the bridge registers, a sign-out inside the
 *   debounce), a failed queue add, or an edit the server REFUSED. While it is
 *   set the applier skips the plan; after the next session's initial pull
 *   {@link reconcilePlanAfterInitialPull} pushes it. Cleared when a plan UPDATE
 *   is accepted (an acknowledged `create` may have been ignored by the server).
 * - **Own echo (code review 2026-10-05, HIGH).** The server's batch response
 *   carries no `updatedAt`, so after an accepted push this device's
 *   `serverUpdatedAt` is still the OLD version. A newer edit still QUEUED when
 *   the next pull returns that push's echo loses core's LWW (`echo.updatedAt >
 *   baseVersion`) and is dropped. The applier therefore treats a pulled plan
 *   that this device itself pushed (since its last applied pull) while the plan
 *   on screen differs as stale: it skips it and re-queues the screen plan,
 *   based on the echo's version.
 *
 * ⚠️ IMPORTS: only the sync bridge and the store-free `lib/retirement-plan.ts`.
 * The retirement store imports THIS module, so importing any store here is a
 * cycle, and `cross-device-sync.db.test.tsx` imports every store concurrently,
 * where a cycle deadlocks. No `useSync`/`seedLocalData` either: the root chunk
 * guard (`overview-critical-path.guard.test.ts`) bans both. The store hands this
 * module its reads and the marker writes through {@link bindRetirementPlanSource}.
 */

import type { SyncOperation } from '@budget-planner/core'
import { type RetirementPlan, coerceRetirementPlan } from '../retirement-plan'
import { enqueueCreate, enqueueUpdate, getSyncSessionUserId } from './syncBridge'

/** How long the plan must stay unedited before it is queued (D7). */
export const PLAN_PUSH_DEBOUNCE_MS = 1500

/** What this module reads from the retirement store. */
export interface RetirementPlanSnapshot {
  plan: RetirementPlan
  ownerUserId: string
  serverUpdatedAt: string | null
  localPlanDiverged: boolean
}

/** The store's side of the binding (see the module docblock). */
export interface RetirementPlanSource {
  read: () => RetirementPlanSnapshot
  /** Plain `setState` of `localPlanDiverged`; never pushes. */
  setDiverged: (diverged: boolean) => void
}

let source: RetirementPlanSource | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** Flushed ops whose queue add has not settled yet (the AC-5 gap). */
let addsInFlight = 0
/** The plan last pushed (add settled) OR pulled, as a canonical key; `null` when unknown. */
let lastSynced: string | null = null
/** Every plan key this device pushed since the last pull it APPLIED (own-echo detection). */
const pushedSincePull = new Set<string>()
/** Op timestamps of the newest accepted plan update and newest refused plan op. */
let lastAcceptedAt = Number.NEGATIVE_INFINITY
let lastRefusedAt = Number.NEGATIVE_INFINITY

/**
 * Give this module its access to the retirement store. Called once, at the
 * bottom of `stores/retirementPlannerStore.ts` (the registration direction keeps
 * this module store-free).
 */
export function bindRetirementPlanSource(next: RetirementPlanSource): void {
  source = next
}

/**
 * A canonical key for `plan` under `userId`. Rebuilt through
 * `coerceRetirementPlan` so the key does not depend on the object's key order
 * (the defaults and the coercion list the fields in different orders).
 */
function syncedKey(userId: string, plan: RetirementPlan): string {
  return `${userId}\n${JSON.stringify(coerceRetirementPlan(plan))}`
}

/**
 * A user edited the plan: queue it once the edits stop (D7).
 *
 * - No paid session (free, signed out, before the bridge registers): no timer,
 *   no call (AC-6). An OWNED plan is marked as not on the server, so the next
 *   paid session keeps it and pushes it; an unclaimed (`''`) plan is not (D4).
 * - A session whose account does not own the plan: nothing (the flush would
 *   refuse it, and an armed timer would block the first-sign-in seed).
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

/**
 * Whether a user edit has not reached the queue yet: its debounce is running,
 * or its queue add has not settled (AC-5: the applier skips the plan meanwhile).
 */
export function hasPendingPlanEdit(): boolean {
  return timer !== null || addsInFlight > 0
}

/**
 * Drop a pending edit WITHOUT queueing it. `resetPlan` and an owner change call
 * this: what was pending is no longer the plan on screen, and flushing would
 * push the defaults (or another account's plan) over the server copy.
 */
export function cancelPendingPlanPush(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

/** Queue the pending edit now, if there is one (`pagehide` / `hidden`). */
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

/**
 * Queue the plan on screen as an UPDATE (an upsert on the server, D5). `force`
 * skips the equality check (an own-echo or a not-on-server plan must be re-sent
 * even though it equals what this device last sent).
 */
function queuePlan(userId: string, { force }: { force: boolean }): void {
  if (source === null) {
    return
  }
  const { plan, serverUpdatedAt } = source.read()
  const key = syncedKey(userId, plan)
  if (!force && key === lastSynced) {
    return
  }
  // `updatedAt` becomes the op's `baseVersion` (the bridge parses it): the newest
  // server version this device has seen, applied or skipped (AC-5). Absent when
  // it never saw one: core then falls back to the op's own timestamp.
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
 * The pull applier is about to handle a pulled plan for `userId`. Returns
 * whether it must SKIP it in favour of the plan on screen, and in that case it
 * has already arranged what follows:
 *
 * - a pending edit (AC-5) or a plan not on the server (AC-12): skip; the edit's
 *   flush, or the next session's reconcile, sends the screen plan;
 * - an OWN ECHO (a plan this device pushed since its last applied pull, while
 *   the screen plan differs): skip AND re-queue the screen plan now, because core
 *   may just have dropped the queued op that carried it.
 *
 * The caller records the skipped version as `serverUpdatedAt` BEFORE any
 * re-queue reads it; see {@link requeueAfterOwnEcho}.
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

/** Re-send the screen plan after an own echo was skipped (see the module docblock). */
export function requeueAfterOwnEcho(userId: string): void {
  queuePlan(userId, { force: true })
}

/**
 * The pull applier wrote `plan` for `userId`: it is now what the server holds,
 * so an edit that returns to it has nothing to send, and earlier pushes are no
 * longer "own echoes".
 */
export function notePlanSynced(userId: string, plan: RetirementPlan): void {
  lastSynced = syncedKey(userId, plan)
  pushedSincePull.clear()
}

/**
 * Forget what was synced. Clear local data and an owner change call this: the
 * plan on screen is no longer the one those records describe.
 */
export function forgetSyncedPlan(): void {
  lastSynced = null
  pushedSincePull.clear()
}

/**
 * The server accepted plan ops (core's `onOperationsSynced`). An accepted UPDATE
 * means the server holds this device's plan, so the not-on-server marker clears,
 * unless a newer plan op was refused. An acknowledged `create` does not count:
 * insert-if-absent may have changed nothing.
 */
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

/**
 * The server permanently refused a plan op (`handleRejectedOperations`, AC-12).
 * Core has already dropped it, so mark the plan as not on the server, unless a
 * NEWER plan update was accepted (core reports accepted before refused within
 * one sync, so an older refusal must not undo that).
 */
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

/**
 * After the initial pull has been APPLIED and the bridge registered (AC-7 / D4,
 * AC-12). Returns what it queued.
 *
 * - The plan is not on the server (`localPlanDiverged`): push it as an update.
 *   The pull skipped the server copy, so this device's plan wins.
 * - Otherwise, if the server has a plan (`serverUpdatedAt` set by that pull, or
 *   by an earlier session of this same owner; there is no plan delete), this
 *   device already shows it: nothing.
 * - Otherwise ONE `create` with the whole plan (free → premium loses nothing); the
 *   server inserts it only if still absent (D5).
 *
 * A pending edit makes it do nothing: its flush sends an update.
 */
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

/** TEST-ONLY: forget every timer and record. No app code calls it. */
export function resetRetirementPlanPushForTests(): void {
  cancelPendingPlanPush()
  addsInFlight = 0
  lastSynced = null
  pushedSincePull.clear()
  lastAcceptedAt = Number.NEGATIVE_INFINITY
  lastRefusedAt = Number.NEGATIVE_INFINITY
}
