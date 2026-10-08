/**
 * The session + premium gate shared by the forecast and profile routes
 * (story 83.1, FR136).
 *
 * The identity ALWAYS comes from the HMAC-signed, DB-authoritative session cookie
 * (story 5-7), never from a request body or query.
 *
 * - 503 when the session cannot be RESOLVED (`getCurrentUserSession` →
 *   `success:false`, a DB/infra failure). An outage is not a sign-out: the
 *   `routes/api/auth/me.ts` rule. ⚠️ `sync/batch.ts` and `sync/changes.ts` answer
 *   401 for the same case; that difference is deliberate here (FR136 AC-1) and is
 *   not a reason to change them.
 * - 401 when there is no session.
 * - 403 when the status has no premium features (`hasPremiumFeatures`: active and
 *   lifetime; past_due is refused). ⚠️ NOT `hasPaidAccess`, the sync gate, which
 *   admits past_due: these routes serve Premium features, and the page gates on
 *   the same predicate (`usePremiumAccess` → `seedToStatus`).
 */

import { logger } from '@/lib/logger'
import { hasPremiumFeatures } from '@/lib/premium/access-statuses'
import { json } from '@tanstack/react-start'
import { type UserSession, getCurrentUserSession } from './paddle'

/** The 503 copy. Fixed text: the resolver's own error can carry driver detail. */
const SESSION_UNAVAILABLE_ERROR = 'Your session could not be checked. Try again in a moment.'

const AUTHENTICATION_REQUIRED_ERROR = 'Authentication required'

export type PremiumSessionResult =
  | { ok: true; user: UserSession }
  | { ok: false; response: Response }

/**
 * Resolve the caller and require premium features.
 *
 * @param premiumError - the 403 text, which names the feature being refused.
 */
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
