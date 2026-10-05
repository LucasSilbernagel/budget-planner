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
 *   `claimRetirementPlanFor`, not the pull applier, not `resetPlan` (Clear local
 *   data, AC-9). Those rewrite the plan from DEVICE-LOCAL inputs (income store,
 *   currency); if they pushed, two devices with different currencies would
 *   rewrite each other on every 30 s pull, for ever (AC-3).
 * - **One op per quiet period (D7, AC-4).** A burst of keystrokes is coalesced by
 *   a {@link PLAN_PUSH_DEBOUNCE_MS} debounce; the plan is read at FLUSH time. A
 *   plan equal to the last one pushed or pulled queues nothing (a blur re-echo
 *   that formats to the same string). One op is one request (`features/api/
 *   client.ts`), and push shares the 100 req/min budget with pull.
 * - **Nothing pending is lost on leave.** `pagehide` and `visibilitychange:
 *   hidden` flush a pending edit into the durable queue at once.
 * - **A pending edit is protected from a pull (AC-5).** Core's last-writer-wins
 *   protects QUEUED ops only. While {@link hasPendingPlanEdit} is true the pull
 *   applier skips the plan, and records the skipped server version as the
 *   store's `serverUpdatedAt`, which the flush sends as the op's `baseVersion`:
 *   so core does not later drop this newer edit in favour of the change it
 *   already skipped.
 * - **Owner and session (AC-6).** An op is queued only while a paid sync session
 *   is wired (`isSyncActive()`) AND the plan on screen is that session's
 *   (`ownerUserId === the bridge's userId`).
 *
 * ⚠️ IMPORTS: only the sync bridge and the store-free `lib/retirement-plan.ts`.
 * The retirement store imports THIS module, so importing any store here is a
 * cycle, and `cross-device-sync.db.test.tsx` imports every store concurrently,
 * where a cycle deadlocks. No `useSync`/`seedLocalData` either: the root chunk
 * guard (`overview-critical-path.guard.test.ts`) bans both. The store hands this
 * module a reader through {@link bindRetirementPlanSource} instead.
 */

import type { RetirementPlan } from '../retirement-plan'
import { enqueueCreate, getSyncSessionUserId, syncEntityUpdate } from './syncBridge'

/** How long the plan must stay unedited before it is queued (D7). */
export const PLAN_PUSH_DEBOUNCE_MS = 1500

/** What this module needs to read from the retirement store. */
export interface RetirementPlanSource {
  plan: RetirementPlan
  ownerUserId: string
  serverUpdatedAt: string | null
}

let readSource: (() => RetirementPlanSource) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** The plan last pushed OR pulled, as `<userId>\n<json>`; `null` when unknown. */
let lastSynced: string | null = null

/**
 * Give this module its read of the retirement store. Called once, at the bottom
 * of `stores/retirementPlannerStore.ts` (the registration direction keeps this
 * module store-free; see the module docblock).
 */
export function bindRetirementPlanSource(read: () => RetirementPlanSource): void {
  readSource = read
}

function syncedKey(userId: string, plan: RetirementPlan): string {
  return `${userId}\n${JSON.stringify(plan)}`
}

/**
 * A user edited the plan: queue it once the edits stop (D7). A no-op unless a
 * paid sync session is wired, so free and signed-out use starts no timer and
 * makes no call (AC-6).
 */
export function schedulePlanPush(): void {
  if (getSyncSessionUserId() === null) {
    return
  }
  if (timer !== null) {
    clearTimeout(timer)
  }
  timer = setTimeout(flushPlanPush, PLAN_PUSH_DEBOUNCE_MS)
}

/** Whether a user edit is waiting out its debounce (AC-5: the applier skips). */
export function hasPendingPlanEdit(): boolean {
  return timer !== null
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

/**
 * Queue the pending edit now, if there is one. `pagehide` / `hidden` call it so
 * an edit made in the last 1.5 s reaches the durable queue before the page goes.
 */
export function flushPendingPlanPush(): void {
  if (timer !== null) {
    flushPlanPush()
  }
}

function flushPlanPush(): void {
  cancelPendingPlanPush()
  const userId = getSyncSessionUserId()
  if (userId === null || readSource === null) {
    return
  }
  const { plan, ownerUserId, serverUpdatedAt } = readSource()
  if (ownerUserId !== userId) {
    return
  }
  const key = syncedKey(userId, plan)
  if (key === lastSynced) {
    return
  }
  lastSynced = key
  // `updatedAt` becomes the op's `baseVersion` (the bridge parses it): the newest
  // server version this device has seen, applied or skipped (AC-5). `undefined`
  // when it never saw one: core then falls back to the op's own timestamp.
  syncEntityUpdate('retirementPlan', {
    id: userId,
    plan,
    ...(serverUpdatedAt !== null ? { updatedAt: serverUpdatedAt } : {}),
  } as { id: string; updatedAt?: string })
}

/**
 * The pull applier wrote `plan` for `userId`: it is now what the server holds,
 * so an edit that returns to it has nothing to send.
 */
export function notePlanSynced(userId: string, plan: RetirementPlan): void {
  lastSynced = syncedKey(userId, plan)
}

/**
 * Forget the last synced plan. A refused push (AC-12) and Clear local data call
 * this: the server does NOT hold what was last sent, so the same plan typed
 * again must be sent again.
 */
export function forgetSyncedPlan(): void {
  lastSynced = null
}

/**
 * First sign-in, after the initial pull has been APPLIED (AC-7, D4: server
 * wins). If the server already has a plan (`serverUpdatedAt` set by that pull, or
 * by an earlier session of this same owner; there is no plan delete), this
 * device already shows it and nothing is sent. If it has none, ONE `create` with
 * the whole plan is queued, so free → premium loses nothing; the server inserts
 * it only if still absent (D5).
 *
 * Returns whether a create was queued. A pending edit skips the seed: its flush
 * sends an update, which the server upserts.
 */
export function seedRetirementPlanIfServerHasNone(): Promise<boolean> {
  const userId = getSyncSessionUserId()
  if (userId === null || readSource === null || hasPendingPlanEdit()) {
    return Promise.resolve(false)
  }
  const { plan, ownerUserId, serverUpdatedAt } = readSource()
  if (ownerUserId !== userId || serverUpdatedAt !== null) {
    return Promise.resolve(false)
  }
  const queued = enqueueCreate('retirementPlan', { id: userId, plan } as { id: string })
  if (queued === null) {
    return Promise.resolve(false)
  }
  lastSynced = syncedKey(userId, plan)
  return queued.then(() => true)
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

/** TEST-ONLY: forget every timer and the last synced plan. No app code calls it. */
export function resetRetirementPlanPushForTests(): void {
  cancelPendingPlanPush()
  lastSynced = null
}
