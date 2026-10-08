export * from './analytics/metadata'
export * from './analytics/service'
// `Frequency` comes only from ./finance/normalization; a second star-export of it would be ambiguous.
export * from './finance/categoryBreakdown'
export type {
	ContributionDuplicateCandidate,
	ContributionDuplicateInput,
	DuplicateCandidateContribution,
	DuplicateCandidateExpense,
} from './finance/contributionDuplicates'
// Presentation only: never feed these into a calculation (savingsAllocation must not import them).
export {
	findContributionDuplicateCandidates,
	NAME_SIMILARITY_HIGHLIGHT_THRESHOLD,
} from './finance/contributionDuplicates'
export * from './finance/forecasting'
export * from './finance/money-limits'
export * from './finance/netIncome'
export * from './finance/normalization'
export * from './finance/projection'
export * from './finance/retirement'
export * from './finance/savingsAllocation'
export * from './finance/savingsCapacity'
export { generateColorMap } from './finance/visualization'
export * from './format/currency'
export * from './format/currency-locale'
export {
	debtOwedCents,
	monthlyContributionCents,
	resolveDebtPaymentExpense,
} from './services/balanceTracking'
// Named re-exports: the services/* subpaths don't resolve under the web app's tsc,
// and `export *` of those modules would collide on names.
export type { AllocationMode } from './services/savingsGoals'
export * from './sync/index'
