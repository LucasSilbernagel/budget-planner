/**
 * The response is identical whether or not the email matches, the send succeeds or the
 * per-email limit was hit, so it never reveals account existence.
 */

import { getSiteUrl } from '@budget-planner/config'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { normalizeEmail } from '@/server/api/auth/email'
import { MagicLinkStageError, requestMagicLink } from '@/server/api/auth/magic-link'
import { clientIpForRateLimit } from '@/server/rate-limit/client-ip'
import { checkDbRateLimit } from '@/server/rate-limit/db-window'

/** RFC 5321 max email length — bound the limiter key before using it. */
const MAX_EMAIL_LENGTH = 254

const IP_LIMIT = { windowMs: 60 * 1000, maxAttempts: 5 } as const
export const EMAIL_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 5 } as const

const GENERIC_OK = { success: true } as const

/**
 * Anything that depends on the account lookup is logged inside the fire-and-forget chain,
 * so the response's body and timing don't change.
 */
const OUTCOME_MESSAGE = 'Magic-link request outcome'

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
	const now = Date.now()

	// Skipped when no trustworthy proxy IP is present, so callers do not share one bucket.
	const ip = clientIpForRateLimit(request)
	if (ip) {
		const ipLimit = await checkDbRateLimit({ scope: 'ip', subject: ip, now, ...IP_LIMIT })
		if (!ipLimit.allowed) {
			logger.info(OUTCOME_MESSAGE, { branch: 'throttled', scope: 'ip' })
			return json(
				{ success: false, error: 'Too many requests. Please try again later.' },
				{
					status: 429,
				}
			)
		}
	}

	let body: unknown
	try {
		body = await request.json()
	} catch {
		logger.info(OUTCOME_MESSAGE, { branch: 'bad-request' })
		return json({ success: false, error: 'Invalid request body' }, { status: 400 })
	}

	const email = (body as { email?: unknown } | null)?.email
	if (typeof email !== 'string') {
		logger.info(OUTCOME_MESSAGE, { branch: 'bad-request' })
		return json({ success: false, error: 'Email is required' }, { status: 400 })
	}

	// A blank email would skip the per-email limiter. `normalizeEmail` must match the key
	// account erasure deletes, or that delete becomes a silent no-op.
	const emailKey = normalizeEmail(email)
	if (!emailKey || emailKey.length > MAX_EMAIL_LENGTH) {
		logger.info(OUTCOME_MESSAGE, { branch: 'invalid-shape' })
		return json(GENERIC_OK)
	}

	// On exceed, still the generic 200 rather than a distinguishable status.
	const emailLimit = await checkDbRateLimit({
		scope: 'email',
		subject: emailKey,
		now,
		...EMAIL_LIMIT,
	})
	if (!emailLimit.allowed) {
		logger.info(OUTCOME_MESSAGE, { branch: 'throttled', scope: 'email' })
		return json(GENERIC_OK)
	}

	// Fire-and-forget so latency does not reveal whether the email matches an account.
	const siteUrl = getSiteUrl()
	void requestMagicLink(email, siteUrl)
		.then(
			(outcome) => {
				logger.info(OUTCOME_MESSAGE, outcome)
			},
			(error: unknown) => {
				// Log the original error: the logger serialises an Error as `{ name, message }` only.
				const stage = error instanceof MagicLinkStageError ? error.stage : undefined
				const original = error instanceof MagicLinkStageError ? error.cause : error
				logger.error(OUTCOME_MESSAGE, { branch: 'send-failed', stage, error: original })
				captureError(original, { scope: 'magic-link-request', stage })
			}
		)
		.catch(() => {
			// An unhandled rejection here would take the process down.
		})

	return json(GENERIC_OK)
}

export const Route = createFileRoute('/api/auth/login/request')({
	server: {
		handlers: {
			POST,
		},
	},
})
