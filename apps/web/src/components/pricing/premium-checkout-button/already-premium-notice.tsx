import type { PaidAccessStatus } from '../../../lib/premium/access-statuses'

// These states have nothing to buy, and checkout risks a duplicate charge. `canceled` is
// excluded: that subscription has ended, so checkout is how they resubscribe.
export function AlreadyPremiumNotice({ status }: { status: PaidAccessStatus }) {
	if (status === 'lifetime') {
		return (
			<p className="mt-6 text-sm text-body">
				You already have lifetime Premium access — there&apos;s nothing more to buy.
			</p>
		)
	}
	if (status === 'past_due') {
		return (
			<p className="mt-6 text-sm text-body">
				Your Premium subscription has a payment issue. Buying a new plan won&apos;t fix this and
				would charge you again — please update your payment details with Paddle instead.
			</p>
		)
	}
	return <p className="mt-6 text-sm text-body">You already have an active Premium subscription.</p>
}
