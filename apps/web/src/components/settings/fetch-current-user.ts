import type { BillingInterval, SubscriptionStatus } from '@budget-planner/db/schema'

export type CurrentUser = {
	userId: string
	email: string
	subscriptionStatus: SubscriptionStatus
	// Optional: an older server mid-deploy omits it; absent reads as "not known".
	billingInterval?: BillingInterval | null
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
	const response = await fetch('/api/auth/me')
	if (!response.ok) {
		return null
	}
	const data = (await response.json()) as { user?: CurrentUser | null }
	return data.user ?? null
}
