/** Same `hasPaidAccess` gate as push, so pull is reachable wherever push is. */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { logger } from '@/lib/logger'
import { hasPaidAccess } from '@/lib/premium/access-statuses'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { checkRateLimit, getLiveProfileIds, getSyncChanges } from '@/server/api/sync'
import { createDefaultProfileForUser } from '@/server/functions/profiles'

const DEFAULT_PULL_LIMIT = 100

export const GET = async ({ request }: { request: Request }): Promise<Response> => {
	const session = await getCurrentUserSession(request)
	if (!session.success) {
		return json({ success: false, error: session.error ?? 'No user session' }, { status: 401 })
	}
	if (!session.data) {
		return json({ success: false, error: 'No user session' }, { status: 401 })
	}

	if (!hasPaidAccess(session.data.subscriptionStatus)) {
		return json(
			{
				success: false,
				error: 'Premium feature: server sync requires an active paid subscription',
			},
			{ status: 403 }
		)
	}

	// Idempotent default-profile backfill: a pull with zero profiles deadlocks the client.
	// Failure must not fail the pull; the next poll retries.
	try {
		const backfillResult = await createDefaultProfileForUser(session.data.userId)
		if (!backfillResult.success) {
			logger.error('[sync/changes] default-profile backfill failed', {
				error: backfillResult.error,
			})
		}
	} catch (error) {
		logger.error('[sync/changes] default-profile backfill threw', { error })
	}

	const rateLimit = await checkRateLimit(session.data.userId)
	if (!rateLimit.allowed) {
		return json({ success: false, error: 'Rate limit exceeded' }, { status: 429 })
	}

	const url = new URL(request.url)

	const sinceParam = url.searchParams.get('since')
	let since: number | null = null
	if (sinceParam !== null && sinceParam !== '') {
		const parsed = Number(sinceParam)
		if (!Number.isFinite(parsed) || parsed < 0) {
			return json({ success: false, error: 'Invalid "since" parameter' }, { status: 400 })
		}
		since = parsed
	}

	const limitParam = url.searchParams.get('limit')
	let limit = DEFAULT_PULL_LIMIT
	if (limitParam !== null && limitParam !== '') {
		const parsedLimit = Number(limitParam)
		if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
			limit = Math.floor(parsedLimit)
		}
	}

	const profileId = request.headers.get('x-profile-id') || undefined

	try {
		const changes = await getSyncChanges(session.data.userId, since, limit, profileId)
		// `noUncheckedIndexedAccess` cannot see through the ternary.
		const newestChange = changes.at(-1)
		const lastPullTimestamp = newestChange ? newestChange.updatedAt : since
		// Optional: if unreadable, the client skips unsynced-profile detection this round.
		let profileIds: string[] | undefined
		try {
			profileIds = await getLiveProfileIds(session.data.userId)
		} catch (error) {
			logger.error('[sync/changes] live profile list failed', { error })
		}
		return json({ success: true, changes, lastPullTimestamp, profileIds })
	} catch (error) {
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to fetch sync changes',
			},
			{ status: 500 }
		)
	}
}

export const Route = createFileRoute('/api/sync/changes')({
	server: {
		handlers: {
			GET,
		},
	},
})
