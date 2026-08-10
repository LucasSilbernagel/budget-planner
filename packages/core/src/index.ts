/**
 * Budget Planner - Core Package
 *
 * Shared TypeScript utilities and calculation engine.
 * Will include:
 * - Financial calculation utilities (frequency normalization, net income, savings capacity)
 * - Custom error classes (domain-specific error hierarchy)
 * - Type definitions and shared interfaces
 * - Result type for error handling
 *
 * Architecture: Pure TypeScript functions, no side effects
 */

// Frequency normalization
export * from './finance/normalization'

// Net income calculation
export * from './finance/netIncome'

// Savings capacity calculation
export * from './finance/savingsCapacity'

// Automatic leftover-allocation solver (Story 26.2)
export * from './finance/savingsAllocation'

// Retirement modeler
export * from './finance/retirement'

// Net worth projection
export * from './finance/projection'

// Premium forecasting
export * from './finance/forecasting'

// Per-category breakdown (story 30.5)
// ⚠️ `Frequency` is imported as a TYPE inside that module and never re-exported
// from it — `./finance/normalization` above is its single source on this
// barrel, and a second star-export of the same name would make it ambiguous.
export * from './finance/categoryBreakdown'

// Currency formatting
export * from './format/currency'

// Currency → locale mapping (currency-driven formatting locale)
export * from './format/currency-locale'

// Synchronization service
export * from './sync/index'

// Client metadata capture (clean URL-string injection, privacy-respecting)
export * from './analytics/metadata'

// In-memory analytics service
export * from './analytics/service'

// Story 26.1: the savings allocation-mode union, re-exported for app consumers
// (e.g. SavingsPage) so they import the real type from the resolvable barrel
// rather than the `services/savingsGoals` subpath (which does not resolve under
// the web app's tsc) or a drift-prone local copy. A single NAMED type re-export —
// NOT `export *` of the whole module — to avoid barrel name collisions.
export type { AllocationMode } from './services/savingsGoals'

// Story 26.4: the remaining-contribution-room derivation, re-exported for app
// consumers (BalancePage) so they import from the resolvable root barrel rather
// than the `services/balanceTracking` subpath (which does not resolve under the
// web app's tsc). A single NAMED value re-export — NOT `export *` of the whole
// module — to avoid barrel name collisions.
export { remainingContributionRoom } from './services/balanceTracking'

// Story 30.5: the shared categorical palette generator, re-exported for the
// category-breakdown bar charts so they draw from the SAME palette as the
// overview pies rather than copying it. ⚠️ Same palette, NOT the same colour
// per category: it assigns `CATEGORY_COLORS[i % 16]` by ARRAY INDEX, and the
// two surfaces build their maps over different key sets (pies key on resolved
// name across both sides, the breakdown on category id per side). Callers that
// need order-stable colours must pass a stably-ordered key array — see
// `CategoryBreakdown.tsx`. `visualization` is not on this
// barrel (and the `finance/visualization` subpath does not resolve under the
// web app's tsc), so a single NAMED value re-export — NOT `export *` of the
// whole module, which would collide on several names — following the
// `remainingContributionRoom` precedent above.
export { generateColorMap } from './finance/visualization'
