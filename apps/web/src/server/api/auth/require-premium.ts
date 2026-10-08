// 503 when the session cannot be resolved: an outage is not a sign-out. Gates on
// hasPremiumFeatures, not hasPaidAccess: past_due is refused here.

import { logger } from '@/lib/logger'
import { hasPremiumFeatures } from '@/lib/premium/access-statuses'
import { json } from '@tanstack/react-start'
import { type UserSession, getCurrentUserSession } from './paddle'

// Fixed text: the resolver's own error can carry driver detail.
const SESSION_UNAVAILABLE_ERROR = 'Your session could not be checked. Try again in a moment.'

const AUTHENTICATION_REQUIRED_ERROR = 'Authentication required'

export type PremiumSessionResult =
  | { ok: true; user: UserSession }
  | { ok: false; response: Response }

export async function requirePremiumSession(
  request: Request,
  premiumError: string
): Promise<PremiumSessionResult> {
  const session = await getCurrentUserSession(request)
  if (!session.success) {
    logger.error('[api] session resolution failed', { error: session.error })
    return {
      ok: false,
      response: json({ success: false, error: SESSION_UNAVAILABLE_ERROR }, { status: 503 }),
    }
  }
  if (!session.data) {
    return {
      ok: false,
      response: json({ success: false, error: AUTHENTICATION_REQUIRED_ERROR }, { status: 401 }),
    }
  }
  if (!hasPremiumFeatures(session.data.subscriptionStatus)) {
    return { ok: false, response: json({ success: false, error: premiumError }, { status: 403 }) }
  }
  return { ok: true, user: session.data }
}
