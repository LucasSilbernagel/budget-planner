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
export * from './format/currency';
