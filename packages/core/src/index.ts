export * from './finance/normalization'

export * from './finance/money-limits'

export * from './finance/netIncome'

export * from './finance/savingsCapacity'

export * from './finance/savingsAllocation'

export * from './finance/retirement'

export * from './finance/projection'

export * from './finance/forecasting'

// `Frequency` comes only from ./finance/normalization; a second star-export of it would be ambiguous.
export * from './finance/categoryBreakdown'

export * from './format/currency'

export * from './format/currency-locale'

export * from './sync/index'

export * from './analytics/metadata'

export * from './analytics/service'

// Named re-exports: the services/* subpaths don't resolve under the web app's tsc,
// and `export *` of those modules would collide on names.
export type { AllocationMode } from './services/savingsGoals'

export { monthlyContributionCents } from './services/balanceTracking'
export { resolveDebtPaymentExpense } from './services/balanceTracking'
export { debtOwedCents } from './services/balanceTracking'

export { generateColorMap } from './finance/visualization'

// Presentation only: never feed these into a calculation (savingsAllocation must not import them).
export {
  NAME_SIMILARITY_HIGHLIGHT_THRESHOLD,
  findContributionDuplicateCandidates,
} from './finance/contributionDuplicates'
export type {
  ContributionDuplicateCandidate,
  ContributionDuplicateInput,
  DuplicateCandidateContribution,
  DuplicateCandidateExpense,
} from './finance/contributionDuplicates'
