// The filename is historical: identity is app-owned (magic link), not Paddle. Kept for its importers.

// Re-exported so existing importers of this module keep working.
import type { BillingInterval, Currency } from '@budget-planner/db'
import { db } from '@budget-planner/db'
import { users } from '@budget-planner/db/src/schema'
import { and, eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import type { ApiResult } from '../result'
import { verifySession } from './session'

export type { ApiResult }

export type UserSession = {
	userId: string
	email: string
	paddleId: string
	subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime'
	// Non-null: the column is nullable but carries a `'NONE'` default, and every
	// construction site below falls back to that rather than propagating null.
	currency: Currency
	// NULL = cadence unknown, or lifetime. Display only: no entitlement decision may read it.
	billingInterval: BillingInterval | null
	isAuthenticated: boolean
	name?: string
}

export async function getCurrentUserSession(
	request: Request
): Promise<ApiResult<UserSession | null>> {
	try {
		const cookieHeader = request.headers.get('cookie')

		if (!cookieHeader) {
			return { success: true, data: null }
		}

		const cookies: Record<string, string> = {}
		for (const cookie of cookieHeader.split(';')) {
			const [name, ...rest] = cookie.trim().split('=')
			if (name && rest.length > 0) {
				cookies[name] = rest.join('=')
			}
		}

		const sessionToken = cookies['session']

		if (!sessionToken) {
			return { success: true, data: null }
		}

		const session = await validateSessionToken(sessionToken)

		if (!session) {
			return { success: true, data: null }
		}

		return { success: true, data: session }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to get current user session',
		}
	}
}

// Stamps the revocation watermark: clearing the cookie alone leaves an exfiltrated token valid for its TTL.
export async function logoutUser(request: Request): Promise<ApiResult<void>> {
	try {
		const sessionResult = await getCurrentUserSession(request)
		const userId = sessionResult.success ? sessionResult.data?.userId : undefined

		if (userId) {
			await db.update(users).set({ sessionsRevokedAt: Date.now() }).where(eq(users.id, userId))
		}

		return { success: true }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to logout',
		}
	}
}

// Status and currency come from the DB, never the cookie, so a client cannot grant itself premium.
async function validateSessionToken(token: string): Promise<UserSession | null> {
	try {
		// The cookie value is URL-encoded; decode before signature verification.
		const decodedToken = decodeURIComponent(token)

		const payload = verifySession(decodedToken)
		if (!payload) {
			// warn, not error: routine bad cookies must not spike the error rate.
			logger.warn('Invalid session token: signature verification failed')
			return null
		}

		const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		if (!uuidPattern.test(payload.userId)) {
			logger.debug('Invalid session token: userId is not a valid UUID')
			return null
		}

		const matchingUsers = await db
			.select()
			.from(users)
			.where(and(eq(users.id, payload.userId), eq(users.isDeleted, false)))
			.limit(1)

		const user = matchingUsers[0]
		if (!user) {
			logger.debug('Invalid session token: no matching user record')
			return null
		}

		if (user.sessionsRevokedAt != null && payload.iat <= user.sessionsRevokedAt) {
			logger.warn('Invalid session token: issued before session revocation')
			return null
		}

		return {
			userId: user.id,
			email: user.email,
			paddleId: user.paddleId,
			subscriptionStatus: user.subscriptionStatus,
			currency: user.currency ?? 'NONE',
			billingInterval: user.billingInterval ?? null,
			isAuthenticated: true,
		}
	} catch (error) {
		// Rethrow: a DB outage is "unknown", not "no session". Callers act on null as an authoritative
		// signed-out answer (e.g. checkout's already-entitled guard).
		logger.error('Failed to validate session token', { error })
		throw error
	}
}
