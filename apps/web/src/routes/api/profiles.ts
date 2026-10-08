import { logger } from '@/lib/logger'
import { requirePremiumSession } from '@/server/api/auth/require-premium'
import { getProfiles } from '@/server/functions/profiles'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

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
