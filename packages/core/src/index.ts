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

// Retirement modeler
export * from './finance/retirement'

// Net worth projection
export * from './finance/projection'

// Premium forecasting
export * from './finance/forecasting'

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
