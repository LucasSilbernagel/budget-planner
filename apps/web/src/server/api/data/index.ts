/**
 * Data-Domain Server Functions
 *
 * Premium forecasting (`calculateForecastServer`, `calculateGoalTimelineServer`)
 * plus the shared `getUserContext` / `checkPremiumAccessServer` helpers.
 *
 * NOTE: this directory once also held `financialData.ts`, a per-entity CRUD
 * module. It was live once (story 16-2, `d918084`) but had no importer left by the
 * time it was deleted — see story `cleanup-3`. Paid-tier writes go
 * through `/api/sync` (`server/api/sync.ts`) and its generic
 * `createEntity`/`updateEntity`, NOT through per-entity server functions.
 * Do not reintroduce a per-entity CRUD layer here without deciding what it
 * serves that the sync path does not.
 *
 * Architecture: TanStack Start Server Functions with PostgreSQL
 */

export * from './forecasting'
