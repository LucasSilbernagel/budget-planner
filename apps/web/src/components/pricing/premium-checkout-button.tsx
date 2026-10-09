// Not auth-gated: accounts are created only by the Paddle webhook on a completed checkout,
// so requiring sign-in would lock out new customers. The session only pre-fills the email.

import { useSessionSeed } from '../../hooks/useSessionSeed'
import { hasPaidAccess } from '../../lib/premium/access-statuses'
import { AlreadyPremiumNotice } from './premium-checkout-button/already-premium-notice'
import { PremiumCheckoutForm } from './premium-checkout-button/premium-checkout-form'
import { useResolvedStatusWhenUnverified } from './premium-checkout-button/useResolvedStatusWhenUnverified'

export function PremiumCheckoutButton() {
	const seed = useSessionSeed()
	const resolvedStatus = useResolvedStatusWhenUnverified(seed === null)

	const status = seed ? (seed.subscriptionStatus ?? null) : resolvedStatus

	if (status === undefined) {
		return <p className="mt-6 text-sm text-body">Checking your account…</p>
	}

	if (hasPaidAccess(status)) {
		return <AlreadyPremiumNotice status={status} />
	}

	return <PremiumCheckoutForm seed={seed} />
}
