// Renewal happens only after full validation (signature, user, revocation watermark), so a
// revoked token can never be refreshed past the watermark.

import { logger } from '@/lib/logger'
import type { UserSession } from './paddle'
import { signSession } from './session'
import { buildHasSessionCookie, buildSessionCookie, isProductionEnv } from './session-cookies'

export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000

type RenewableSession = Pick<UserSession, 'userId' | 'paddleId' | 'email' | 'issuedAt'>

export function renewedSessionCookies(session: RenewableSession, now = Date.now()): string[] {
	if (now - session.issuedAt < SESSION_RENEW_AFTER_MS) {
		return []
	}
	try {
		const token = signSession({
			userId: session.userId,
			paddleId: session.paddleId,
			email: session.email,
		})
		const isProduction = isProductionEnv()
		return [buildSessionCookie(token, isProduction), buildHasSessionCookie(isProduction)]
	} catch (error) {
		logger.error('Session renewal failed; the existing cookie stays in place', { error })
		return []
	}
}

export function appendSessionRenewal<H extends Pick<Headers, 'append'>>(
	headers: H,
	session: RenewableSession
): H {
	for (const cookie of renewedSessionCookies(session)) {
		headers.append('Set-Cookie', cookie)
	}
	return headers
}
