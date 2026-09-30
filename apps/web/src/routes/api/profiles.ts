/**
 * The signed-in user's live profiles (story 83.1, FR136).
 *
 * TanStack Start server route (file-route `server.handlers`).
 *
 * Endpoint: GET /api/profiles
 *
 * The forecasting page reads this to pick the profile a saved forecast attaches
 * to. It used to call `server/functions/profiles.ts` through a CLIENT-side
 * `import()`, which bundled `pg` into the browser and failed there on `Buffer`
 * (story 80.1 Fact R). Status codes: `server/api/auth/require-premium.ts`.
 */

import { logger } from '@/lib/logger'
import { requirePremiumSession } from '@/server/api/auth/require-premium'
import { getProfiles } from '@/server/functions/profiles'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/** The existing 403 text of `getProfiles` (story 13-3). */
export const PROFILES_PREMIUM_ERROR = 'Premium feature: Please upgrade to manage custom profiles'

/** Every answer is user-specific, refusals included, so none may be cached. */
export const GET = async ({ request }: { request: Request }): Promise<Response> => {
  const response = await listProfiles(request)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

async function listProfiles(request: Request): Promise<Response> {
  const gate = await requirePremiumSession(request, PROFILES_PREMIUM_ERROR)
  if (!gate.ok) {
    return gate.response
  }

  const result = await getProfiles(gate.user.userId)
  if (!result.success) {
    // Do not leak internal detail (the `account/delete.ts` rule).
    logger.error('[api/profiles] GET failed', { error: result.error })
    return json({ success: false, error: 'Failed to load profiles' }, { status: 500 })
  }
  return json({ success: true, data: result.data })
}

export const Route = createFileRoute('/api/profiles')({
  server: {
    handlers: {
      GET,
    },
  },
})
