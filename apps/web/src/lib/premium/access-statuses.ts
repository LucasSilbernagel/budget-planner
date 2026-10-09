import type { SubscriptionStatus } from '@budget-planner/db/schema'

/**
 * Paid access includes past_due (dunning); premium features exclude it. Client-safe: the only
 * import is a type import, as a value import would ship server code to the client.
 */
export const STATUS_ACCESS = {
	free: { paidAccess: false, premiumFeatures: false },
	active: { paidAccess: true, premiumFeatures: true },
	past_due: { paidAccess: true, premiumFeatures: false },
	canceled: { paidAccess: false, premiumFeatures: false },
	lifetime: { paidAccess: true, premiumFeatures: true },
} as const satisfies Record<SubscriptionStatus, { paidAccess: boolean; premiumFeatures: boolean }>

type StatusAccess = typeof STATUS_ACCESS

export type PaidAccessStatus = {
	[S in SubscriptionStatus]: StatusAccess[S]['paidAccess'] extends true ? S : never
}[SubscriptionStatus]

export type PremiumFeatureStatus = {
	[S in SubscriptionStatus]: StatusAccess[S]['premiumFeatures'] extends true ? S : never
}[SubscriptionStatus]

const ALL_STATUSES = Object.keys(STATUS_ACCESS) as SubscriptionStatus[]

// Frozen: one array is shared by the sync gates, checkout and the retention purge.
export const PAID_ACCESS_STATUSES = Object.freeze(
	ALL_STATUSES.filter((status) => STATUS_ACCESS[status].paidAccess)
) as readonly PaidAccessStatus[]

export const PREMIUM_FEATURE_STATUSES = Object.freeze(
	ALL_STATUSES.filter((status) => STATUS_ACCESS[status].premiumFeatures)
) as readonly PremiumFeatureStatus[]

/** A membership test, never a key lookup, so prototype keys answer false. */
export function hasPaidAccess(status: unknown): status is PaidAccessStatus {
	return (PAID_ACCESS_STATUSES as readonly unknown[]).includes(status)
}

export function hasPremiumFeatures(status: unknown): status is PremiumFeatureStatus {
	return (PREMIUM_FEATURE_STATUSES as readonly unknown[]).includes(status)
}
