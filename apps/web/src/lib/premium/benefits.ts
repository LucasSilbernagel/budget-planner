/**
 * Fixes the set, not the wording: each surface keys its copy by PremiumBenefitId, so a missing
 * benefit is a tsc error. Tuple order is the display order everywhere.
 */
export const PREMIUM_BENEFIT_IDS = [
	'forecasting',
	'report',
	'profiles',
	'categories',
	'sync',
] as const

export type PremiumBenefitId = (typeof PREMIUM_BENEFIT_IDS)[number]
