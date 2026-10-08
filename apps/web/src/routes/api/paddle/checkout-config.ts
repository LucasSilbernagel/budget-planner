/**
 * Public: none of these values is secret. PADDLE_ENVIRONMENT must be set explicitly here,
 * so the schema's sandbox default can't point a real checkout at the wrong account.
 */

import { assertPaddleProductionConfig, getPaddleConfig } from '@budget-planner/config'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { logger } from '@/lib/logger'
import { hasPaidAccess } from '@/lib/premium/access-statuses'
import { getCurrentUserSession } from '@/server/api/auth/paddle'

/** Public and unauthenticated, so responses must never be cached by an intermediary. */
function noStoreHeaders() {
	return { headers: { 'Cache-Control': 'no-store' } }
}

export const GET = async ({ request }: { request: Request }): Promise<Response> => {
	try {
		// An empty `PADDLE_ENVIRONMENT=` counts as unset.
		if (!process.env['PADDLE_ENVIRONMENT']) {
			return json(
				{
					success: false,
					error:
						'PADDLE_ENVIRONMENT is not set. Refusing to silently default to sandbox for checkout — set it explicitly (sandbox or production).',
				},
				{ status: 500, ...noStoreHeaders() }
			)
		}

		assertPaddleProductionConfig()

		// Fails closed on an unresolvable session: treating it as anonymous could charge a
		// paying customer twice.
		const session = await getCurrentUserSession(request)
		if (!session.success) {
			logger.warn(
				'Paddle checkout-config: session unresolvable — refusing checkout (fail closed)',
				{
					error: session.error,
				}
			)
			return json(
				{ success: false, error: 'Checkout is not available right now.' },
				{ status: 503, ...noStoreHeaders() }
			)
		}
		// `canceled` has no paid access, so checkout is how it resubscribes.
		if (session.data && hasPaidAccess(session.data.subscriptionStatus)) {
			logger.info('Paddle checkout-config: refused for an already-entitled session', {
				subscriptionStatus: session.data.subscriptionStatus,
			})
			return json(
				{
					success: false,
					error: 'You already have Premium access — there is nothing to buy here.',
					alreadyEntitled: true,
				},
				{ status: 403, ...noStoreHeaders() }
			)
		}

		const config = getPaddleConfig()

		return json(
			{
				isConfigured: config.isConfigured,
				environment: config.environment,
				clientToken: config.clientToken ?? null,
				// Trimmed: an id pasted with a trailing newline would fail `Paddle.Checkout.open`.
				// `|| null`, not `?? null`, so an empty value becomes null.
				monthlyPriceId: config.monthlyPriceId?.trim() || null,
				annualPriceId: config.annualPriceId?.trim() ?? null,
				lifetimePriceId: config.lifetimePriceId?.trim() ?? null,
			},
			noStoreHeaders()
		)
	} catch (error) {
		// The assertion message names unset PADDLE_* vars and this route is public, so log it
		// at debug (every /pricing view hits this) and return a generic message.
		logger.debug('Paddle checkout-config: production config assertion failed', { error })
		return json(
			{ success: false, error: 'Checkout is not available right now.' },
			{ status: 500, ...noStoreHeaders() }
		)
	}
}

export const Route = createFileRoute('/api/paddle/checkout-config')({
	server: {
		handlers: { GET },
	},
})
