/**
 * Synchronization Service Types
 *
 * This file defines the core types used by the synchronization service for
 * multi-device data synchronization in the paid tier.
 */

import { z } from 'zod'
import { FINANCE_TYPES } from '../services/balanceTracking'

// ============================================================================
// Entity Validation Schemas
// ============================================================================

/**
 * PostgreSQL 32-bit `integer` bounds. Monetary fields are stored as `integer`
 * (cents), so client-side validation must reject values the DB cannot store to
 * avoid "integer out of range" failures that would otherwise only surface at
 * persistence time and be retried forever.
 *
 * ⚠️ `PG_INT32_MAX` is EXPORTED (story 66.4). It is not exported for convenience:
 * `nextSortOrder` (`apps/web/src/lib/ordering.ts`) has to clamp the position it
 * computes to the SAME bound `syncOperationDataSchema.sortOrder` rejects on
 * (`.max(PG_INT32_MAX)` below), and a producer whose bound is a separate copy of
 * the literal is a bound that can silently drift away from its gate. This repo
 * has already paid for that once, immediately below: the hand-mirrored currency
 * enum drifted to 11 of 21 values and became a permanent sync lockout. Import
 * this constant rather than re-declaring the number.
 *
 * ⚠️ SCOPE, stated precisely: this unifies the producer with the CLIENT gate
 * below. The SERVER ingest gate still carries its own literals
 * (`apps/web/src/server/api/sync.ts:125,136,190,209` for `sortOrder`, `:187` for
 * `monthlyAllocation`), so client/server drift remains possible. Narrowing that
 * gap would mean the server importing from core, which is a separate change.
 *
 * ⚠️ `PG_INT32_MIN` stays module-private — nothing outside this file needs it,
 * and an unused export is a maintenance claim with no caller.
 */
export const PG_INT32_MAX = 2_147_483_647
const PG_INT32_MIN = -2_147_483_648

/**
 * Every value the `currency` PostgreSQL enum can hold.
 *
 * ⚠️⚠️ THIS MUST MIRROR `currencyEnum` IN `packages/db/src/schema.ts` EXACTLY, and
 * a missing value is not a cosmetic gap — it is a lockout. Code review of story
 * 66.2 found this list stopped at `NZD` (11 of 21) while the column had carried
 * all 21 since migration `0001`. The write path is live and server-side:
 * `routes/api/webhooks/paddle.ts`'s `mapProvidedCurrency` validates a checkout's
 * currency against the FULL `currencyEnum.enumValues`, stores it on
 * `users.currency`, and `server/functions/profiles.ts`'s
 * `createDefaultProfileForUser` copies it onto the user's default profile.
 *
 * So once 66.2 made this schema a PULL gate, a user billed in any of the ten
 * missing currencies had their DEFAULT PROFILE refused on arrival — and because
 * `applyServerChangesToStores` then never sets `appliedProfile`,
 * `reconcileActiveProfile` never runs, `ActiveSync` never registers the push
 * bridge, and the free→paid seed never fires. A permanent client-side sync
 * deadlock, reported only through a `console.warn`.
 *
 * Core cannot import `@budget-planner/db` at runtime (it is a devDependency, and
 * the dependency direction is db → core, never the reverse), so this list is
 * duplicated deliberately and pinned by a parity test in
 * `__tests__/entity-schemas.test.ts` that imports the real enum. Do not edit one
 * without the other; the test is what stops the drift recurring.
 */
export const SYNC_CURRENCIES = [
  'NONE',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'CNY',
  'SEK',
  'NZD',
  'INR',
  'BRL',
  'MXN',
  'KRW',
  'SGD',
  'HKD',
  'NOK',
  'DKK',
  'PLN',
  'TRY',
] as const

/**
 * Zod schemas for validating entity data payloads
 * These ensure data structure matches expected format for each entity type
 *
 * ## ⚠️⚠️ What these schemas are FOR (story 66.2, FR103) — read before editing one
 *
 * Until 66.2 these were declared-for-parity and imported by NOTHING. They are now
 * the **PULL-path gate**: `apps/web/src/lib/sync/applyServerChanges.ts` validates
 * every server row against the matching schema before writing it into a client
 * store. That makes them the only gate in the whole sync contract that runs on
 * the server→client direction — the other five all sit on push or at rest.
 *
 * Two consequences that are easy to get wrong:
 *
 *  1. **They model a COMPLETE row, not an operation payload.** That is exactly
 *     why they, and not `syncOperationDataSchema`, are the pull gate: every field
 *     in that schema is `.optional()`, so it accepts `{}` and can never catch a
 *     row missing its required fields.
 *  2. **They must accept every SHAPE the column allows** — every legal null, and
 *     every enum value. A pulled row is the whole drizzle row, so it carries all
 *     of them. Four of these schemas disagreed with their columns and would have
 *     false-rejected the user's own data (`savingsGoalSchema.targetAmount`,
 *     `userProfileSchema.description`, and `currency` twice over — nullability
 *     AND a list that held 11 of the column's 21 values). ⚠️ A false rejection
 *     here is worse than the corruption the gate exists to stop: it silently
 *     refuses good rows. Before tightening any field, check the column.
 *
 *     ⚠️ VALUE RANGE is the one deliberate exception, and it is narrow.
 *     `targetAmount` carries `.positive()`, which the column alone does not
 *     require — it mirrors the server ingest gate (`server/api/sync.ts`), the
 *     ONLY live write path to that column. It is safe *because* of that, not
 *     because the database enforces it: the `savingsGoals_targetAmount_positive`
 *     CHECK in `packages/db/src/schema.ts` has never been emitted to a migration
 *     (0 of 8 — story 66.5's subject). Do not read the bound as evidence the
 *     column is constrained, and do not add a bound that no write path enforces.
 *
 *
 * ## ⚠️⚠️ The REQUIRED/NULLABLE rule — added by code review of 66.2
 *
 * A field here is **required iff its column is NOT NULL**, and `.nullable()` iff
 * the column is nullable. `.default(x)` is BANNED on these schemas.
 *
 * Why: `.default(x)` makes a key OPTIONAL on input. The review measured
 * `balanceTrackingSchema.safeParse({userId, type, name})` → **success**, parsed
 * as `currentBalance: 0` — so a server row that simply OMITTED `currentBalance`
 * passed the guard, entered the store with the key absent, and
 * `stores/balanceStore.ts`'s `sum + entry.currentBalance` produced **NaN**. That
 * is the same failure class this gate exists to stop, walking through the door
 * next to the one it closed. A default is a sensible thing for a PUSH payload,
 * where the client legitimately sends a partial row; it is never right for a
 * pulled row, which came from `db.select()` and therefore carries every column.
 *
 * ⚠️ The applier consumes the VERDICT ONLY (`safeParse().success`) and never
 * writes the parse output — `z.object` STRIPS undeclared keys, and these schemas
 * do not declare `profileId`, `sortOrder`, `categoryId`, `isDeleted`,
 * `createdAt` or `updatedAt`. Writing the output would delete them from every
 * synced row. Pinned by `__tests__/entity-schemas.test.ts`.
 */
export const incomeSourceSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().int(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  userId: z.string().uuid(),
})

export const expenseSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().int(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  // Story 65.2 (FR101): the user's statement that this expense ends before they
  // retire. Defaults false = today's behaviour. ⚠️ SIX-GATED: mirrored in
  // `syncOperationDataSchema` below (the gate that runs on the way OUT; this one
  // now runs on the way IN — see the block comment above), in the server gate
  // (apps/web/src/server/api/sync.ts), in the syncBridge payload whitelist, in
  // the db column and its migration, and in the client types — or the field
  // silently does not round-trip.
  // ⚠️ REQUIRED, not `.default(false)` — the column is NOT NULL (see the
  // REQUIRED/NULLABLE rule above); a pulled row always carries it.
  endsBeforeRetirement: z.boolean(),
  userId: z.string().uuid(),
})

/**
 * Story 30.4a: user-defined category (FR54).
 *
 * ⚠️ Like its siblings above, this schema runs on the PULL path (story 66.2) —
 * it is no longer unexercised. The gate that runs at QUEUE time, on the way out,
 * is still `syncOperationDataSchema` below (see `validateOperationData` in
 * synchronization.ts). The two are mirrors in different directions, and the drift
 * between them is exactly how the documented asymmetries in savingsGoalSchema
 * arose. If you change one, consider both — but a difference that exists because
 * one gate sees a whole ROW and the other a partial PAYLOAD is correct, not drift.
 */
export const categorySchema = z.object({
  name: z.string().min(1).max(255),
  kind: z.enum(['income', 'expense']),
  userId: z.string().uuid(),
})

export const savingsGoalSchema = z.object({
  name: z.string().min(1).max(255),
  // ⚠️ NULLABLE, and that is load-bearing (story 66.2). The column is
  // `integer('targetAmount')` with no NOT NULL: "null ⇒ savings account (no
  // target); a positive int ⇒ goal" (story 16-1). This schema required a number
  // until 66.2 gave it its first consumer — the PULL-path guard in
  // `apps/web/src/lib/sync/applyServerChanges.ts` — at which point it would have
  // rejected EVERY savings account the user owns. The bug was invisible for as
  // long as nothing imported this file. `.positive()` mirrors the server ingest
  // gate; `.max()` mirrors syncOperationDataSchema and the int32 column.
  targetAmount: z.number().int().positive().max(PG_INT32_MAX).nullable(),
  // ⚠️ REQUIRED and BOUNDED — `.default(0)` here let a row omit its balance
  // entirely and NaN `getTotalSavings()`. NOT NULL column.
  currentBalance: z.number().int().min(PG_INT32_MIN).max(PG_INT32_MAX),
  // Story 26.1: per-account allocation. `monthlyAllocation` is nullable cents
  // (0..int32). `allocationMode` is `.optional()` here (the client emits it via
  // syncBridge); the server gate uses `.default('automatic')` on ingest — an
  // intentional asymmetry, not an exact mirror. Bound matches syncOperationDataSchema.
  monthlyAllocation: z.number().int().min(0).max(PG_INT32_MAX).nullable().optional(),
  // ⚠️ REQUIRED — NOT NULL column (`default 'automatic'` is the DB's default
  // for an INSERT, not permission for a pulled row to omit the key).
  allocationMode: z.enum(['manual', 'automatic']),
  userId: z.string().uuid(),
})

export const balanceTrackingSchema = z.object({
  type: z.enum(FINANCE_TYPES),
  name: z.string().min(1).max(255),
  // ⚠️ REQUIRED and BOUNDED. `.default(0)` here was the measured hole: a row
  // omitting `currentBalance` passed the guard and NaN'd the net-worth figure via
  // `stores/balanceStore.ts`. NOT NULL column; may be negative (debt balances).
  currentBalance: z.number().int().min(PG_INT32_MIN).max(PG_INT32_MAX),
  // ⚠️ REQUIRED — NOT NULL column, and non-negative by the (inert) CHECK.
  monthlyContribution: z.number().int().min(0).max(PG_INT32_MAX),
  // Story 16-2: cadence of the contribution. ⚠️ REQUIRED — the column is NOT NULL
  // with a DB-side default of 'monthly', which is not permission for a pulled row
  // to omit the key. Mirrors the server gate in apps/web/src/server/api/sync.ts.
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  // Story 45.1 (FR72): the user's statement that this contribution is already
  // recorded as an expense, so the savings distributable pool must not subtract it
  // twice. Defaults false = today's arithmetic. ⚠️ TRIPLE-GATED: this must be
  // mirrored in the server gate (apps/web/src/server/api/sync.ts) and the
  // syncBridge payload whitelist, or the field silently does not round-trip.
  // ⚠️ REQUIRED — NOT NULL column (see the REQUIRED/NULLABLE rule above).
  contributionRecordedAsExpense: z.boolean(),
  userId: z.string().uuid(),
})

export const userProfileSchema = z.object({
  name: z.string().min(1).max(255),
  // ⚠️ `.nullable()` AS WELL AS `.optional()` (story 66.2), and the distinction is
  // the whole point: `.optional()` accepts an ABSENT KEY, never an explicit
  // `null`. The column is `text('description')` — nullable — so a PULLED row
  // carries `description: null` for every profile the user never described,
  // which is most of them. This schema rejected all of them.
  //
  // ⚠️ Why the server gate (apps/web/src/server/api/sync.ts) is NOT changed to
  // match: it only ever sees a PUSH payload, and `toServerPayload` OMITS the key
  // when the value is null (`syncBridge.ts`, `if (entity['description'] != null)`),
  // so a null never reaches it. Widening it would newly accept a "clear my
  // description" operation the product does not have. The two gates sit on
  // OPPOSITE paths and legitimately see different value sets — a deliberate
  // asymmetry of the same kind `allocationMode` already documents, not drift to
  // be tidied away.
  description: z.string().max(500).nullable().optional(),
  // ⚠️ REQUIRED — NOT NULL column (see the REQUIRED/NULLABLE rule above).
  isDefault: z.boolean(),
  // ⚠️ `.nullable()` for the same reason (story 66.2): `currencyEnum('currency')`
  // carries `.default('NONE')` but NO `.notNull()`, so a stored null is legal and
  // a pull delivers it.
  //
  // ⚠️⚠️ `.nullable()` and `.default('NONE')` are NOT interchangeable here, and
  // the story originally recorded that they were — corrected by its code review.
  // MEASURED on zod 3.25.76: `.default('NONE').safeParse(null)` → **false**;
  // `.safeParse(undefined)` → true; `.nullable().safeParse(null)` → true.
  // `.default()` substitutes for `undefined` ONLY, so swapping it in here would
  // reject every null-currency profile and reinstate the exact false rejection
  // this line was written to fix. The choice is forced, not stylistic.
  currency: z.enum(SYNC_CURRENCIES).nullable(),
  // Story 54.2 (FR78): the user-chosen avatar emoji. Nullable because the column
  // is nullable and `null` ("never chosen", render the hash fallback) must
  // round-trip through a pull without a ZodError. Bounded to the varchar(16) the
  // column declares. ⚠️ TRIPLE-GATED: mirrored in syncOperationDataSchema below,
  // in the server gate (apps/web/src/server/api/sync.ts) and in the syncBridge
  // payload whitelist, or the field silently does not round-trip.
  icon: z.string().max(16).nullable().optional(),
  userId: z.string().uuid(),
})

/**
 * Schema for sync operation data validation
 * Validates data structure based on entityType
 *
 * Numeric bounds mirror the `check()` declarations in packages/db/schema.ts so
 * invalid amounts are rejected client-side instead of failing the INSERT/UPDATE.
 *
 * ⚠️ "mirror the DATABASE CHECK constraints" is what this said until story 49.1,
 * and it was false. drizzle-kit 0.23 does not emit CHECK constraints to
 * migrations, so NONE of the seven `check()` blocks in `schema.ts` has ever
 * reached a real database — verified across all sixteen migrations. These zod
 * bounds are therefore the ONLY enforcement in practice, not a second line of
 * defence behind one. Logged in `deferred-work.md`; do not weaken them on the
 * assumption the database will catch it.
 * - amount: must be > 0
 * - targetAmount: > 0 for a goal, or null for a goal-less savings account (Story 16-1)
 * - monthlyContribution: must be >= 0
 * - contributionRecordedAsExpense: boolean (Story 45.1); absent leaves it unchanged
 * - endsBeforeRetirement: boolean (Story 65.2); absent leaves it unchanged
 * - currentBalance: may be negative (debt balances) but must fit in int32
 */
export const syncOperationDataSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  amount: z.number().int().positive().max(PG_INT32_MAX).optional(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']).optional(),
  // null ⇒ savings account (no target); a positive int ⇒ goal. Must allow null
  // or a paid-tier account create/update ZodError-fails at the sync-queue gate.
  targetAmount: z.number().int().positive().max(PG_INT32_MAX).nullable().optional(),
  currentBalance: z.number().int().min(PG_INT32_MIN).max(PG_INT32_MAX).optional(),
  type: z.enum(FINANCE_TYPES).optional(),
  monthlyContribution: z.number().int().min(0).max(PG_INT32_MAX).optional(),
  // Story 45.1 (FR72): see balanceTrackingSchema above. Optional here because an
  // operation payload is partial; absent leaves the server value untouched.
  contributionRecordedAsExpense: z.boolean().optional(),
  // Story 65.2 (FR101): the expense row's "this ends before I retire" flag.
  //
  // ⚠️⚠️ THIS GATE STRIPS UNDECLARED KEYS, and it is the one the story's epic
  // left out of its five-gate list. `validateOperationData` runs it
  // (synchronization.ts:116-117) BEFORE `queue.add()`, so omitting this line
  // drops the flag from the payload before the operation is ever queued — with
  // no error, no rejection, and a "successful" sync that silently discards the
  // user's tick. Same trap `sortOrder` and `icon` each document below, hit for
  // the third time. `.optional()` because an operation payload is partial; the
  // bridge stamps an explicit `false` so an untick always lands.
  endsBeforeRetirement: z.boolean().optional(),
  // Story 26.1: savings monthly allocation (nullable cents, >= 0) + mode. Bounds
  // mirror the DB (allocationMode NOT NULL default 'automatic'; monthlyAllocation
  // nullable). Absent from a payload is fine — both are optional here.
  monthlyAllocation: z.number().int().min(0).max(PG_INT32_MAX).nullable().optional(),
  allocationMode: z.enum(['manual', 'automatic']).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  // Story 30.4a (FR54): the category entity's own `kind`, and the nullable
  // `categoryId` reference carried by incomeSource/expense rows.
  //
  // ⚠️ `categoryId` MUST be `.nullable()`, not merely `.optional()`. Clearing a
  // category sends an explicit `null` (an omitted key would leave the previous
  // server value in place — updateEntity does a PARTIAL `.set()`), so a
  // nullable-less schema would reject every un-categorize operation at the queue
  // gate with a ZodError. This is the same trap savingsGoal.targetAmount hit in
  // Story 16-1; see its note above.
  kind: z.enum(['income', 'expense']).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  // Story 34.1a (FR60): explicit display position for the four financial lists.
  //
  // ⚠️ This gate STRIPS undeclared keys (see the note below), so omitting this line
  // would drop `sortOrder` from the payload before the operation is ever queued —
  // with no error, no rejection, and a "successful" sync that silently discards the
  // user's ordering. Bounded to the int32 column range for the same
  // defense-in-depth reason as monthlyAllocation.
  //
  // `.optional()` because entity types that have no ordering (userProfile,
  // category) share this one schema; `.min(0)` because positions are dense and
  // zero-based, and the backfill plus `max + 1` can never produce a negative.
  sortOrder: z.number().int().min(0).max(PG_INT32_MAX).optional(),
  // ⚠️ Same list, same reason as the pull gate above: an 11-value list here
  // rejects an EDIT to a profile whose currency the webhook legitimately stored.
  // Pre-existing (this gate predates 66.2); fixed alongside it so the two cannot
  // drift back apart.
  currency: z.enum(SYNC_CURRENCIES).optional(),
  // Story 54.2 (FR78): the userProfile entity's chosen avatar emoji.
  //
  // ⚠️ This gate STRIPS undeclared keys, so omitting this line would drop `icon`
  // from the payload before the operation is ever queued — with no error, no
  // rejection, and a "successful" sync that silently discards the user's choice.
  // Same trap `sortOrder` documents above.
  //
  // `.nullable()` as well as `.optional()`, for the reason `categoryId` records
  // above: a `null` is a legitimate value ("never chosen") that must survive a
  // pull, and an optional-only schema would reject it at the queue gate.
  icon: z.string().max(16).nullable().optional(),
  userId: z.string().uuid().optional(),
})

/**
 * Supported entity types that can be synchronized
 */
export type SyncEntityType =
  | 'incomeSource'
  | 'expense'
  | 'savingsGoal'
  | 'balanceTracking'
  | 'userProfile'
  // Story 30.4a: user-defined income/expense categories (FR54).
  //
  // ⚠️ Extending this union type-enforces exactly ONE downstream gate —
  // `ENTITY_BINDINGS` in apps/web/src/lib/sync/applyServerChanges.ts, which is
  // declared `Record<SyncEntityType, EntityBinding>`. Every other gate must be
  // updated by hand and fails SILENTLY if missed:
  //   - toServerPayload's switch (syncBridge.ts) — now has a `never`-exhaustive
  //     default so it, too, is a compile error rather than a silent misroute
  //   - syncOperationDataSchema below — zod STRIPS undeclared keys
  //   - syncOperationSchema.entityType (server/api/sync.ts) — a hard-coded enum;
  //     an unknown value fails the whole batch, not just its own operation
  //   - getSyncChanges (server/api/sync.ts) — five hard-coded per-entity blocks
  // A green `tsc` is NOT evidence the contract is complete.
  | 'category'

/**
 * Supported operation types for synchronization
 */
export type SyncOperationType = 'create' | 'update' | 'delete'

/**
 * Represents a single synchronization operation
 * Contains all metadata needed to sync data between devices
 */
export interface SyncOperation {
  /** Unique identifier for the operation */
  id: string

  /** Type of operation: create, update, or delete */
  type: SyncOperationType

  /** Type of entity being synchronized */
  entityType: SyncEntityType

  /** ID of the entity being synchronized */
  entityId: string

  /** The actual data payload for the operation */
  data: Record<string, unknown>

  /** Timestamp when the operation was created (Unix timestamp in milliseconds) */
  timestamp: number

  /** Unique identifier for the device where the operation originated */
  deviceId: string

  /** User ID who owns the data */
  userId: string

  /** Profile ID for data isolation (UUID) - required for profile-scoped entities */
  profileId?: string

  /** Optional version number for optimistic concurrency control */
  version?: number

  /**
   * The server-authoritative `updatedAt` (Unix ms epoch) of the entity row this
   * operation was derived from, if known (Story 4-18 review D1). Lets pull
   * reconciliation decide the winner by CAUSAL version instead of wall-clock
   * `timestamp`, which is unreliable across devices with skewed clocks: a pulled
   * server change is "already incorporated" by this op iff `change.updatedAt <=
   * baseVersion`. When absent (e.g. a brand-new create, or an edit on an entity
   * never pulled), reconciliation falls back to the `timestamp` comparison, so
   * this is a strict, regression-free improvement. Populated by the host layer
   * when it queues an edit against a known server row.
   */
  baseVersion?: number
}

/**
 * A single server-side change surfaced by the pull endpoint (Story 4-18).
 *
 * Reconstructed from an entity ROW (not an operation), so it deliberately carries
 * no originating deviceId or operation id — the server stores entities, not the
 * op log. Pull reconciliation therefore uses state-based last-write-wins keyed on
 * `updatedAt` rather than the op-based `detectConflict` path. A tombstone
 * (`isDeleted: true`) represents a delete the client must apply by removing the
 * entity locally.
 */
export interface ServerChange {
  /** Type of entity that changed */
  entityType: SyncEntityType

  /** Server-authoritative id of the entity (serial int as string, or uuid) */
  entityId: string

  /** The entity's current column values (cents for monetary fields) */
  data: Record<string, unknown>

  /** When the row was last mutated on the server (Unix ms epoch) */
  updatedAt: number

  /** Whether this change is a soft-delete tombstone */
  isDeleted: boolean
}

/**
 * Transport hook for fetching server-side changes since a cursor (Story 4-18).
 * Injected via {@link SyncConfig} to keep the core transport-agnostic — the web
 * layer supplies an HTTP implementation; the core never imports `fetch`/`db`.
 *
 * @param since - Pull cursor (Unix ms epoch); `null` requests a full snapshot.
 */
export type FetchServerChangesFn = (since: number | null) => Promise<ServerChange[]>

/**
 * Callback invoked with the server changes that were applied during a pull, so
 * the host app (web layer) can write them into its UI stores. The core never
 * imports the stores; it only emits the applied changes.
 */
export type ChangesPulledCallback = (changes: ServerChange[]) => void

/**
 * Result of a pull (server → client) operation (Story 4-18).
 */
export interface PullResult {
  /** Whether the pull completed without a transport/processing error */
  success: boolean

  /** Number of server changes applied to local state */
  changesPulledCount: number

  /** The server changes that were applied locally */
  applied: ServerChange[]

  /**
   * Server changes that were NOT applied because a newer queued local edit won
   * the last-write-wins comparison (unsynced local work is never discarded).
   */
  conflicts: ServerChange[]

  /** Error message if the pull failed */
  error?: string

  /** The advanced pull cursor after this pull (Unix ms epoch, or null) */
  lastPullTimestamp: number | null
}

/**
 * Status of the synchronization process
 */
export enum SyncStatus {
  PENDING = 'PENDING', // Sync has not started or is queued
  IN_PROGRESS = 'IN_PROGRESS', // Sync is currently in progress
  COMPLETED = 'COMPLETED', // Sync completed successfully with no conflicts or failures
  FAILED = 'FAILED', // Sync failed with errors
  CONFLICT = 'CONFLICT', // Sync detected conflicts that need resolution
  PARTIAL = 'PARTIAL', // Sync completed with some conflicts but no failures
  OFFLINE = 'OFFLINE', // Device is offline, operations are queued
}

/**
 * Interface for tracking the overall synchronization state
 */
export interface SyncState {
  /** Current status of synchronization */
  status: SyncStatus

  /** Timestamp of the last successful sync (null if never synced) */
  lastSyncTimestamp: number | null

  /**
   * Cursor for server → client pulls (Unix ms epoch; null if never pulled).
   * Tracked SEPARATELY from `lastSyncTimestamp` (the push cursor): a push must
   * not advance the pull cursor, or remote changes between the last pull and the
   * push would be skipped forever (Story 4-18).
   */
  lastPullTimestamp: number | null

  /** Operations that are pending synchronization */
  pendingOperations: SyncOperation[]

  /** Operations that failed during synchronization */
  failedOperations: SyncOperation[]

  /** Operations that have conflicts requiring resolution */
  conflictOperations: SyncOperation[]

  /**
   * Operations the server permanently REJECTED — a non-retryable failure whose
   * status code is POSITIVE evidence of permanence (see
   * `PERMANENT_REJECT_STATUS_CODES` in `synchronization.ts`).
   *
   * These are removed from the queue, because replaying one forever pins the
   * sync status at FAILED and re-opens the circuit breaker every cycle, which
   * suppresses retries for every OTHER entity.
   *
   * ⚠️⚠️ THIS FIELD IS WRITE-ONLY TODAY. Nothing reads it — not `useSync`, not
   * any store, not any component — so a rejected operation IS dropped silently
   * from the user's point of view: the edit leaves the outbox and the next sync
   * reports success with nothing shown. Do not cite this array as evidence that
   * the loss is surfaced; it records the loss for a future reader that does not
   * exist yet. Wiring it into the UI is tracked in `deferred-work.md`.
   * It is also never emptied by any path, so it grows for the service lifetime.
   *
   * ⚠️ Auth-blocked (401) and tier-blocked (403) operations are deliberately NOT
   * routed here — both stay queued. So does any non-retryable failure with no
   * status code proving permanence, which is the common 200-envelope shape the
   * server returns for transient database faults.
   */
  rejectedOperations: SyncOperation[]

  /** Whether the device is currently online */
  isOnline: boolean

  /** Error message from the last failed sync, if any */
  lastError?: string

  /** Number of retries attempted for failed operations */
  retryCount: number
}

/**
 * Interface for conflict detection result
 */
export interface ConflictResult {
  /** Whether a conflict was detected */
  hasConflict: boolean

  /** Type of conflict if detected */
  conflictType?: ConflictType

  /** The operation from the local device */
  localOperation?: SyncOperation

  /** The operation from the server */
  serverOperation?: SyncOperation

  /** Suggested resolution */
  resolution?: SyncOperation
}

/**
 * Types of conflicts that can occur during synchronization
 */
export type ConflictType =
  | 'create-create' // Both local and server created same entity
  | 'create-update' // Local create conflicts with server update
  | 'create-delete' // Local create conflicts with server delete
  | 'update-create' // Local update conflicts with server create
  | 'update-update' // Both local and server updated same entity
  | 'update-delete' // Local update conflicts with server delete
  | 'delete-create' // Local delete conflicts with server create
  | 'delete-update' // Local delete conflicts with server update
  | 'delete-delete' // Both local and server deleted same entity
  | 'version-mismatch' // Version numbers don't match

/**
 * Strategy for resolving conflicts
 */
export type ConflictResolutionStrategy =
  | 'last-write-wins' // Most recent timestamp wins
  | 'server-wins' // Server always wins
  | 'client-wins' // Client always wins
  | 'manual' // Require manual resolution
  | 'merge' // Attempt to merge changes

/**
 * Result of processing a single operation
 */
export interface ProcessOperationResult {
  /** Whether the operation was successful */
  success: boolean
  /** Whether a conflict was detected */
  conflict?: boolean
  /** Error message if operation failed */
  error?: string
  /**
   * Whether a failed operation should be retried. Transient failures
   * (network/5xx) are retryable; auth/validation failures (4xx) are not and
   * must abort rather than be hammered. When omitted, the failure is treated
   * as retryable for backwards compatibility.
   */
  retryable?: boolean
  /** Optional HTTP-style status code from the transport, used to classify failures. */
  statusCode?: number
}

/**
 * Function type for processing a single operation
 * This allows the sync service to be customized with different transport mechanisms
 * (e.g., direct database access, HTTP API calls, etc.)
 */
export type ProcessOperationFn = (operation: SyncOperation) => Promise<ProcessOperationResult>

/**
 * Configuration options for the synchronization service
 */
export interface SyncConfig {
  /** Strategy to use for conflict resolution */
  conflictResolutionStrategy: ConflictResolutionStrategy

  /** Maximum number of retry attempts for failed operations */
  maxRetries: number

  /** Delay between retry attempts in milliseconds */
  retryDelay: number

  /** Maximum batch size for sync operations */
  batchSize: number

  /** Whether to enable automatic sync */
  autoSync: boolean

  /** Interval for automatic sync in milliseconds (0 = disabled) */
  autoSyncInterval: number

  /** Whether to enable debug logging */
  debug: boolean

  /** Custom function to process operations (e.g., make API calls)
   * If not provided, operations will be queued but not processed
   */
  processOperation?: ProcessOperationFn

  /**
   * Transport hook for pulling server-side changes (Story 4-18). Injected the
   * same way as {@link processOperation} to keep the core transport-agnostic.
   * If not provided, `pull()` fails loud (it does not silently no-op) so a
   * misconfiguration can't masquerade as "no remote changes".
   */
  fetchServerChanges?: FetchServerChangesFn

  /** Interval for automatic server pulls in milliseconds (0/undefined = disabled) */
  pullInterval?: number

  /**
   * Active profile ID (UUID) for the session. Profile-scoped entities
   * (incomeSource, expense, savingsGoal, balanceTracking) require a
   * `profileId NOT NULL` server-side, so every queued operation is stamped
   * with this value. Required for those entity types when syncing the paid tier.
   */
  profileId?: string
}

/**
 * Result of a synchronization operation
 */
export interface SyncResult {
  /** Whether the sync was successful */
  success: boolean

  /** Number of operations synchronized */
  synchronizedCount: number

  /** Number of operations that failed */
  failedCount: number

  /** Number of conflicts detected */
  conflictCount: number

  /** New sync state after the operation */
  state: SyncState

  /** Error message if sync failed */
  error?: string

  /** Duration of the sync operation in milliseconds */
  duration: number
}

/**
 * Callback function type for sync status changes
 */
export type SyncStatusCallback = (state: SyncState) => void

/**
 * Callback function type for conflict detection
 */
export type ConflictCallback = (conflict: ConflictResult) => void

/**
 * Interface for storage of persisted sync queue
 * This allows the sync queue to survive page refreshes and browser restarts
 */
export interface SyncQueueStorage {
  /** Load the sync queue from storage */
  loadQueue: (userId: string) => Promise<SyncOperation[]>

  /** Save the sync queue to storage */
  saveQueue: (userId: string, queue: SyncOperation[]) => Promise<void>

  /** Clear the sync queue from storage */
  clearQueue: (userId: string) => Promise<void>
}
