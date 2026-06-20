/**
 * API Server Functions
 * 
 * Main entry point for all Server Functions in the Budget Planner application.
 * Organized by domain:
 * - auth/: Authentication and user management (Paddle OAuth)
 * - calculations/: Financial calculations (retirement, projections, etc.)
 * - data/: Financial data CRUD and synchronization
 * - sync/: Multi-device synchronization
 * 
 * Architecture: TanStack Start Server Functions for RPC-style backend communication
 */

export * from './auth'
export * from './calculations'
export * from './data'
export * from './sync'
