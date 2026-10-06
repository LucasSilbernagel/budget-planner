/**
 * Premium Forecasting Server Functions
 *
 * Server-side functions for premium forecasting features.
 * Only available for paid tier users.
 *
 * NOTE: this directory once also held `financialData.ts`, a per-entity CRUD
 * module. It was live once (story 16-2, `d918084`) but had no importer left by the
 * time it was deleted — see story `cleanup-3`. Paid-tier writes go
 * through `/api/sync` (`server/api/sync.ts`) and its generic
 * `createEntity`/`updateEntity`, NOT through per-entity server functions.
 * Do not reintroduce a per-entity CRUD layer here without deciding what it
 * serves that the sync path does not. (Moved here from the `data/index.ts`
 * barrel when story 78.1 deleted it: nothing imported the barrel.)
 *
 * `calculateForecastServer` was deleted (it had no callers; deferred from story
 * 100.1). The forecast engine is called in the browser (`scenario-builder.tsx`,
 * `routes/forecasting.tsx`, `HomePage.tsx`).
 *
 * Architecture: TanStack Start Server Functions with PostgreSQL
 */

import { type GoalCalculation, calculateGoalTimeline } from '@budget-planner/core'
import type { SubscriptionStatus } from '@budget-planner/db'
import { hasPremiumFeatures } from '../../../lib/premium/access-statuses'
import type { UserSession } from '../auth/paddle'
import type { ApiResult } from '../auth/paddle'

/**
 * Server Function: Calculate goal timeline
 * Only available for paid tier users
 */
export async function calculateGoalTimelineServer(
  request: Request,
  data: {
    targetAmount: number // In cents
    currentAmount: number // In cents
    monthlyContribution: number // In cents
    annualReturnRate: number // As decimal
  }
): Promise<ApiResult<GoalCalculation>> {
  try {
    const userResult = await getUserContext(request)

    if (!userResult.success) {
      // Rebuilt rather than cast across generics: on the failure path `data` is
      // absent, so the only meaningful fields are `success` and `error`.
      return { success: false, error: userResult.error }
    }

    const user = userResult.data

    if (!user) {
      return {
        success: false,
        error: 'Authentication required for premium features',
      }
    }

    // Check if user has access to premium features
    if (!hasPremiumFeatures(user.subscriptionStatus)) {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to access goal tracking',
      }
    }

    const result = calculateGoalTimeline(
      data.targetAmount,
      data.currentAmount,
      data.monthlyContribution,
      data.annualReturnRate
    )

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to calculate goal timeline',
    }
  }
}

/**
 * Server Function: Check premium feature access
 */
export async function checkPremiumAccessServer(
  request: Request
  // ⚠️ `SubscriptionStatus`, not `string`. The value here is `user.subscriptionStatus`,
  // which is already the pg enum union (`packages/db/src/schema.ts:568`); declaring
  // it `string` widened it back out and forced three assignments in
  // `hooks/usePremiumAccess.ts` to fail against the union THEY correctly declare.
): Promise<ApiResult<{ hasAccess: boolean; subscriptionStatus: SubscriptionStatus }>> {
  try {
    const userResult = await getUserContext(request)

    if (!userResult.success) {
      return {
        success: false,
        error: userResult.error,
      }
    }

    const user = userResult.data

    if (!user) {
      return {
        success: true,
        data: {
          hasAccess: false,
          subscriptionStatus: 'free',
        },
      }
    }

    return {
      success: true,
      data: {
        // Both an active subscription and a permanent lifetime purchase
        // (story 25-2) grant premium access.
        hasAccess: hasPremiumFeatures(user.subscriptionStatus),
        subscriptionStatus: user.subscriptionStatus,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check premium access',
    }
  }
}

/**
 * Get user context from request
 * Extracts user session from request headers/cookies
 *
 * Exported so server functions (e.g. sync) can resolve the authenticated user
 * through the same path used by the data API.
 */
export async function getUserContext(request: Request): Promise<ApiResult<UserSession | null>> {
  const { getCurrentUserSession } = await import('../auth/paddle')
  return getCurrentUserSession(request)
}
