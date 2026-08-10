/**
 * Account management server functions (Story 10-5)
 *
 * Real, self-serve account ERASURE backing the Privacy Policy's "right to
 * erasure" promise (privacy.md:81) — GDPR Art. 17 / PIPEDA. This is a hard
 * DELETE of the user and every row they own, NOT a flip of the `isDeleted`
 * sync tombstone (Story 4-18): that tombstone is a cross-device delete-
 * propagation mechanism and leaves the financial values in the EU database,
 * so it does not satisfy erasure. See story Dev Notes.
 *
 * Data Sovereignty: all deletion runs against DanubeData EU PostgreSQL; the
 * only external call is a best-effort Paddle (UK/EU) subscription cancel — no
 * new US-resident processing (NFR1, NFR2).
 */

import { logger } from '@/lib/logger'
import { getPaddleConfig } from '@budget-planner/config'
import { db } from '@budget-planner/db'
import {
  balanceTracking,
  categories,
  expenses,
  forecastingProfiles,
  incomeSources,
  loginTokens,
  rateLimits,
  savingsGoals,
  userProfiles,
  users,
} from '@budget-planner/db/src/schema'
import { eq } from 'drizzle-orm'
import { getCurrentUserSession } from './auth/paddle'

/**
 * Outcome of an account-deletion request.
 *
 * `reason` lets the route map failures to the correct HTTP status without
 * leaking internal detail: `unauthenticated` → 401, `error` → 500.
 */
export interface DeleteAccountResult {
  success: boolean
  reason?: 'unauthenticated' | 'error'
  error?: string
}

/**
 * Hard-delete the authenticated user and ALL data they own, transactionally.
 *
 * The target user id is taken from the HMAC-signed, DB-authoritative session
 * (Story 5-7) ONLY — never from the request body — so a caller can only ever
 * erase their own account (AC-3 ownership).
 *
 * Idempotent: if the user row is already gone (double-submit, retry), every
 * DELETE simply affects zero rows and the call still reports success.
 */
export async function deleteUserAccount(request: Request): Promise<DeleteAccountResult> {
  // 1) Authenticate. An unresolved session (exception) must NOT delete anything.
  const sessionResult = await getCurrentUserSession(request)
  if (!sessionResult.success) {
    return {
      success: false,
      reason: 'error',
      error: sessionResult.error ?? 'Failed to resolve session',
    }
  }
  const session = sessionResult.data
  if (!session) {
    // No valid session cookie → not authenticated (route returns 401).
    return { success: false, reason: 'unauthenticated' }
  }

  const { userId, paddleId } = session

  try {
    // 2) Best-effort billing coordination (Paddle is Merchant of Record —
    //    deleting our row does NOT stop Paddle billing). Never blocks erasure.
    await cancelPaddleSubscriptionBestEffort(paddleId)

    // 3) Transactional hard-delete. Every FK in the schema is RESTRICT (no
    //    CASCADE), so children MUST be deleted before their parents. Financial
    //    rows and forecasting profiles reference BOTH users.id and
    //    userProfiles.id, so they precede userProfiles; rateLimits and
    //    loginTokens reference only users.id. `users` is deleted last.
    //
    //    ⚠️ `categories` (Story 30.4a) is referenced BY incomeSources.categoryId
    //    and expenses.categoryId, so it must come AFTER both of them — and it
    //    references users.id and userProfiles.id, so it must come BEFORE those.
    //    It is the only table in this list with a parent AND a child here.
    await db.transaction(async (tx) => {
      await tx.delete(forecastingProfiles).where(eq(forecastingProfiles.userId, userId))
      await tx.delete(incomeSources).where(eq(incomeSources.userId, userId))
      await tx.delete(expenses).where(eq(expenses.userId, userId))
      await tx.delete(categories).where(eq(categories.userId, userId))
      await tx.delete(savingsGoals).where(eq(savingsGoals.userId, userId))
      await tx.delete(balanceTracking).where(eq(balanceTracking.userId, userId))
      await tx.delete(loginTokens).where(eq(loginTokens.userId, userId))
      await tx.delete(rateLimits).where(eq(rateLimits.userId, userId))
      await tx.delete(userProfiles).where(eq(userProfiles.userId, userId))
      await tx.delete(users).where(eq(users.id, userId))
    })

    // The session is now invalid regardless of the cookie: validateSessionToken
    // resolves the user from the DB (Story 5-7) and that row is gone. The route
    // additionally clears the cookie unconditionally.
    return { success: true }
  } catch (error) {
    logger.error('Account deletion failed', { error })
    return {
      success: false,
      reason: 'error',
      error: error instanceof Error ? error.message : 'Failed to delete account',
    }
  }
}

/**
 * Best-effort Paddle subscription cancellation.
 *
 * Right to erasure is not conditional on a live subscription, and billing must
 * never block the DB erasure — so this NEVER throws and NEVER blocks. It cancels
 * only when a usable Paddle credential is configured; otherwise it logs an
 * actionable warning and returns.
 *
 * ⚠️ LAUNCH CHECKLIST: the Paddle production environment and a wired
 * cancel-subscription API call are Story 5-3 (still `ready-for-dev`). Until 5-3
 * lands there is no cancel endpoint to call, so this remains a documented
 * best-effort: it records intent and warns. Re-verify the real cancel path once
 * 5-3 is done. (Resolved decision #3, 2026-07-04.)
 */
async function cancelPaddleSubscriptionBestEffort(paddleId: string): Promise<void> {
  try {
    const paddleConfig = getPaddleConfig()
    if (!paddleConfig.isConfigured) {
      logger.warn(
        'Account deletion: Paddle not configured — skipping subscription cancellation. ' +
          'LAUNCH CHECKLIST: re-verify the Paddle cancel path once Story 5-3 (Paddle production) lands.',
        { paddleId }
      )
      return
    }

    // Paddle IS configured but the cancel-subscription API call is not wired in
    // the codebase yet (Story 5-3 owns the real Paddle Billing integration; the
    // webhook route only RECEIVES status events today). Log intent and proceed —
    // erasure is never blocked on billing.
    logger.warn(
      'Account deletion: Paddle configured but cancel-subscription wiring is deferred to Story 5-3 — ' +
        'subscription NOT cancelled programmatically. Re-verify once 5-3 lands.',
      { paddleId }
    )
  } catch (error) {
    // Defensive: even a config-read failure must not block erasure.
    logger.error('Account deletion: best-effort Paddle cancel failed (continuing with erasure)', {
      error,
    })
  }
}
