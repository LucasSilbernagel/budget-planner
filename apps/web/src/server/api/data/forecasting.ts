/**
 * Server-side user context for the data API.
 *
 * All that is left here is `getUserContext` (used by `server/functions/sync.ts`);
 * the premium forecasting functions this module was named for are gone (below).
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
 * `routes/forecasting.tsx`, `HomePage.tsx`). `calculateGoalTimelineServer` and
 * `checkPremiumAccessServer` went the same way (no callers; premium access is
 * checked through `GET /api/auth/me` since story 83.1).
 *
 * Architecture: TanStack Start Server Functions with PostgreSQL
 */

import type { ApiResult, UserSession } from '../auth/paddle'

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
