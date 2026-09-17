// `sql` is exported from the drizzle-orm package root (NOT pg-core) in
// drizzle-orm 0.30.x; importing it from pg-core yields undefined and throws
// "sql is not a function" when drizzle() walks the schema's CHECK constraints.
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// Type imports for Drizzle
// Note: Using InferSelectModel and InferInsertModel (InferModel is deprecated)
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

// VALIDATION STRATEGY:
// - Application-layer validation (Zod schemas) will be added in Story 2-2 for better UX/error messages
// - All monetary amounts use integer type (cents) for precision
// - Positive constraints: > 0 for strictly positive, >= 0 for non-negative, NULL allowed where optional
// - Database-level CHECK constraints: Added directly in schema for positive amount validation
// - Timestamps use default mode (returns strings) for JSON serialization compatibility
// - Indexes: paddleId has implicit index via unique constraint, explicit indexes added on userProfiles.userId, rateLimits.userId, forecastingProfiles
// - Soft-delete: Users table has isDeleted flag; all foreign keys use RESTRICT (no CASCADE) to prevent accidental data loss

// Frequency enum for income and expense recurrence
// Values use snake_case as per architecture: weekly, biweekly, monthly, annually
export const frequencyEnum = pgEnum('frequency', ['weekly', 'biweekly', 'monthly', 'annually'])

// Finance type enum for balance tracking
// Values use snake_case as per architecture
//
// `asset` (story 43.4 / FR70) is something the user owns outright — a property,
// a vehicle, or a cash holding. It counts on the ASSET side of net worth, so a
// homeowner who records a mortgage can also record the property it is against.
// It deliberately carries NO contribution: an owned asset changes value by
// appreciation, not by deposits (story 43.4, D2). (It also carried no
// contribution LIMIT — a field story 49.1 / FR75 removed for every type.)
export const financeTypeEnum = pgEnum('financeType', ['investment', 'debt', 'asset'])

/**
 * The single source of truth for the finance-type values, DERIVED from the enum
 * so it cannot drift from it.
 *
 * ⚠️ Every zod schema, validation whitelist and option list that used to restate
 * `['investment', 'debt']` now derives from this (story 43.4). Restating the
 * values is what let the two-value assumption spread to ~24 sites, only ONE of
 * which the compiler could catch.
 *
 * ⚠️ Do NOT rewrite this as `[...] as const satisfies readonly FinanceType[]`.
 * `satisfies` checks assignability, and a SHORT tuple is assignable to
 * `readonly FinanceType[]` — so a MISSING member compiles clean. It catches
 * misspellings, never omissions. Deriving from `enumValues` is what makes drift
 * impossible.
 *
 * ⚠️ CLIENT CODE MUST NOT IMPORT THIS FROM THE PACKAGE BARREL. `src/index.ts`
 * re-exports `./client`, which throws at module scope when `window` is defined.
 * Import from `@budget-planner/db/src/schema` instead (aliased in
 * `apps/web/vite.config.ts`); a TYPE-only import of `FinanceType` is safe either
 * way because it is erased at compile time.
 */
export const ALL_FINANCE_TYPES = financeTypeEnum.enumValues

// Allocation mode for savings accounts/goals (Story 26.1): a 'manual' account
// holds a fixed monthlyAllocation; an 'automatic' account receives an even share
// of the leftover pool (computed in Story 26.2). Defaults to 'automatic'.
export const allocationModeEnum = pgEnum('allocationMode', ['manual', 'automatic'])

// Which side of the ledger a user-defined category applies to (Story 30.4a).
// Income and expense categories are separate namespaces so an expense category
// ("Groceries") can never be offered on the income form, and so core's
// aggregateByCategoryAndType — which already partitions by `${type}:${category}`
// — is matched rather than fought. A NEW enum is deliberate: extending an
// existing one needs `ALTER TYPE ... ADD VALUE`, which cannot run inside a
// transaction block on older PG (see 0009_absent_molten_man.sql).
export const categoryKindEnum = pgEnum('categoryKind', ['income', 'expense'])

// Subscription status enum for user accounts
// Values use snake_case as per architecture
export const subscriptionStatusEnum = pgEnum('subscriptionStatus', [
  'free',
  'active',
  'past_due',
  'canceled',
  // Permanent Premium from a one-time lifetime purchase (story 25-2). Distinct
  // from 'active' so a subscription-lifecycle event (e.g. cancelling a redundant
  // annual sub after buying lifetime) can NEVER downgrade a lifetime buyer.
  'lifetime',
])

// Currency enum for user currency preferences
export const currencyEnum = pgEnum('currency', [
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
])

// Users table - referenced by incomeSources, expenses, savingsGoals, and balanceTracking
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).unique().notNull(), // RFC 5321 max length
    paddleId: varchar('paddleId', { length: 255 }).unique().notNull(), // Paddle customer ID
    subscriptionStatus: subscriptionStatusEnum('subscriptionStatus').default('free').notNull(),
    currency: currencyEnum('currency').default('NONE'),
    isDeleted: boolean('isDeleted').default(false).notNull(), // Soft-delete flag for data safety
    // --- Billing-event ordering + lifetime accounting (Story 5-19) -------------
    //
    // `entitlementUpdatedAt` is the ORDERING WATERMARK: the `occurred_at` (epoch
    // ms) of the newest Paddle event that has changed this user's entitlement.
    // Every entitlement-changing webhook path requires an event STRICTLY NEWER
    // than this, so a late retry cannot flip entitlement backwards — Paddle
    // re-signs each retry with a fresh `ts`, so the signature freshness window
    // filters nothing here (AC-2). NULL = no billing event processed yet.
    entitlementUpdatedAt: bigint('entitlementUpdatedAt', { mode: 'number' }),
    // The transaction that bought a `lifetime` grant, and its grand total in the
    // currency's lowest unit. Recorded at grant time so a later refund can be
    // judged FULL vs PARTIAL without a second Paddle API round trip (AC-1), and
    // so a zero-value / non-collecting transaction cannot grant lifetime (AC-8).
    lifetimeTransactionId: varchar('lifetimeTransactionId', { length: 255 }),
    lifetimeGrantTotal: bigint('lifetimeGrantTotal', { mode: 'number' }),
    // ⚠️ There is deliberately NO `lifetimeRefundedTotal` counter here. An
    // earlier draft of this story had one and incremented it in place, which
    // was wrong twice over: it was never reset when a new grant was recorded
    // (so a re-purchase inherited the previous grant's refunds, and a €1 refund
    // revoked a fresh €99 entitlement), and an incremented counter cannot be
    // made idempotent against Paddle's duplicate deliveries. The refunded total
    // is DERIVED instead, by summing `paddleAdjustments` for the transaction
    // that granted the entitlement — see that table's docblock.
    // Session revocation watermark (Story 5-8): epoch-ms timestamp of the user's
    // last logout/"sign out everywhere". A signed session token is rejected when
    // its issued-at (`iat`) is at or before this value, so an exfiltrated token
    // can be invalidated server-side before its 7-day TTL. NULL = never revoked.
    sessionsRevokedAt: bigint('sessionsRevokedAt', { mode: 'number' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    // CHECK constraints: Prevent empty strings for required fields
    emailNotEmpty: check('users_email_not_empty', sql`${table.email} <> ''`),
    paddleIdNotEmpty: check('users_paddleId_not_empty', sql`${table.paddleId} <> ''`),
  })
)

// Income Sources table - camelCase name per architecture
export const incomeSources = pgTable(
  'incomeSources',
  {
    // Client-generatable uuid PK (Story 5-14): a row created offline holds the
    // SAME id everywhere, so a pull can reconcile by id with no duplicates. The
    // DB default covers server-originated rows; the client MAY supply the id.
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    amount: integer('amount').notNull(), // Amount in cents for precision (> 0 required)
    frequency: frequencyEnum('frequency').notNull(),
    // User-defined category (Story 30.4a, FR54). NULLABLE: uncategorized is a
    // permanently valid state, so every row predating this column stays valid
    // and no form gains a required field.
    categoryId: uuid('categoryId').references(() => categories.id),
    // Explicit display order (Story 34.1a, FR60). Zero-based integer scoped per
    // (userId, profileId) list. The CLIENT assigns it as max+1 on insert; the
    // server never computes or reshuffles it.
    //
    // ⚠️ "Dense" holds only immediately after the backfill. Deletes deliberately
    // leave GAPS (see below), so treat the values as ORDERED, never as contiguous
    // or as an index — 34.1b must not assume position N sits at sortOrder N.
    //
    // ⚠️ DELIBERATELY NOT UNIQUE and deliberately no CHECK (story 34.1a decision 4).
    // Duplicates are EXPECTED: two devices reordering the same list offline both
    // produce values in 0..n-1, and last-write-wins resolves each row independently.
    // A unique index would make the losing insert fail at the database — the same
    // failure class deferred-work.md records for `categories`. Convergence comes
    // from the read-time tiebreaker instead (sortOrder -> createdAt -> id, all three
    // device-independent). A CHECK would be inert regardless: drizzle-kit 0.23 emits
    // none (see the note on savingsGoals.monthlyAllocation below).
    //
    // Deletes leave GAPS on purpose — max+1 is gap-tolerant, and reindexing would
    // emit N sync updates for a single deletion (decision 3).
    sortOrder: integer('sortOrder').notNull().default(0),
    // Soft-delete tombstone (Story 4-18): cross-device delete propagation. A hard
    // DELETE can never be surfaced by a delta-by-updatedAt pull, so deletes are
    // soft (isDeleted=true + updatedAt bump) and filtered from normal reads.
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('incomeSources_userId_profileId_idx').on(
      table.userId,
      table.profileId
    ),
    // CHECK constraint: amount must be positive (> 0)
    amountPositive: check('incomeSources_amount_positive', sql`${table.amount} > 0`),
  })
)

// Expenses table - camelCase name per architecture
export const expenses = pgTable(
  'expenses',
  {
    // Client-generatable uuid PK (Story 5-14); see incomeSources note above.
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    amount: integer('amount').notNull(), // Amount in cents for precision (> 0 required)
    frequency: frequencyEnum('frequency').notNull(),
    // User-defined category (Story 30.4a, FR54); see incomeSources note above.
    categoryId: uuid('categoryId').references(() => categories.id),
    // Explicit display order (Story 34.1a, FR60); see incomeSources note above.
    sortOrder: integer('sortOrder').notNull().default(0),
    // Soft-delete tombstone (Story 4-18): see incomeSources note above.
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('expenses_userId_profileId_idx').on(table.userId, table.profileId),
    // CHECK constraint: amount must be positive (> 0)
    amountPositive: check('expenses_amount_positive', sql`${table.amount} > 0`),
  })
)

// Savings Goals table - camelCase name per architecture
export const savingsGoals = pgTable(
  'savingsGoals',
  {
    // Client-generatable uuid PK (Story 5-14); see incomeSources note above.
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    // Nullable (Story 16-1): null ⇒ savings account (no target), a positive
    // integer ⇒ goal — so "no target" is an ABSENT value, not a sentinel 0.
    // (This shape was originally described as mirroring
    // balanceTracking.maxContributionLimit, dropped by story 49.1 / FR75.)
    targetAmount: integer('targetAmount'), // Target amount in cents (> 0 if provided; null = account)
    currentBalance: integer('currentBalance').notNull().default(0), // Current balance in cents (>= 0 required)
    // Per-account monthly allocation (Story 26.1). Nullable cents (>= 0 if
    // provided; null = no manual amount) — mirrors targetAmount's optional shape.
    monthlyAllocation: integer('monthlyAllocation'),
    // Allocation mode (Story 26.1): 'manual' (fixed amount) or 'automatic' (even
    // share of the leftover pool). NOT NULL default 'automatic' so pre-26.1 rows
    // migrate non-destructively — mirrors balanceTracking.frequency's shape.
    allocationMode: allocationModeEnum('allocationMode').notNull().default('automatic'),
    // Explicit display order (Story 34.1a, FR60); see incomeSources note above.
    // ⚠️ This list previously ordered NEWEST-FIRST via core's `sortByCreationDate`;
    // 34.1a normalizes it to oldest-first + append-at-bottom, so the backfill below
    // (createdAt ASC) intentionally REVERSES the visible order once. Pre-launch, so
    // no user's data is affected.
    sortOrder: integer('sortOrder').notNull().default(0),
    // Soft-delete tombstone (Story 4-18): see incomeSources note above.
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('savingsGoals_userId_profileId_idx').on(
      table.userId,
      table.profileId
    ),
    // CHECK constraints: targetAmount must be positive if provided (null = account,
    // Story 16-1), currentBalance must be non-negative
    targetAmountPositive: check(
      'savingsGoals_targetAmount_positive',
      sql`${table.targetAmount} IS NULL OR ${table.targetAmount} > 0`
    ),
    currentBalanceNonNegative: check(
      'savingsGoals_currentBalance_non_negative',
      sql`${table.currentBalance} >= 0`
    ),
    // Story 26.1: monthlyAllocation non-negative if provided (null = no manual
    // amount). Doc-only, like the sibling checks — drizzle-kit 0.23 does not emit
    // CHECK constraints to migrations; app-layer validation (validateSavingsGoal +
    // the sync zod schemas) enforces the bound.
    monthlyAllocationNonNegative: check(
      'savingsGoals_monthlyAllocation_non_negative',
      sql`${table.monthlyAllocation} IS NULL OR ${table.monthlyAllocation} >= 0`
    ),
  })
)

// Balance Tracking table - camelCase name per architecture
export const balanceTracking = pgTable(
  'balanceTracking',
  {
    // Client-generatable uuid PK (Story 5-14); see incomeSources note above.
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    type: financeTypeEnum('type').notNull(), // investment, debt or asset
    name: varchar('name', { length: 255 }).notNull(),
    currentBalance: integer('currentBalance').notNull().default(0), // Current balance in cents (can be negative for debt)
    // Contribution amount in cents (>= 0 required). Story 16-2: no longer implicitly
    // monthly — `frequency` (below) is its cadence; the monthly-equivalent is derived
    // via the normalization engine. Column name retained for call-site stability.
    monthlyContribution: integer('monthlyContribution').notNull().default(0),
    // Story 16-2: cadence of `monthlyContribution`, reusing the shared frequency enum.
    // Defaults to 'monthly' so existing rows preserve their current (monthly) behavior.
    frequency: frequencyEnum('frequency').notNull().default('monthly'),
    // Story 45.1 (FR72): the user's statement that this row's `monthlyContribution`
    // is ALREADY recorded as an expense line, so the savings distributable pool must
    // not subtract it a second time. Defaults false = today's arithmetic, unchanged.
    // ⚠️ This is a USER-SUPPLIED distinguisher, not an inference. A same-money and a
    // different-money user are byte-identical in every other column, so nothing the
    // app can compute tells them apart — see `savingsAllocation.ts` and FR72.
    contributionRecordedAsExpense: boolean('contributionRecordedAsExpense')
      .notNull()
      .default(false),
    // Explicit display order (Story 34.1a, FR60); see incomeSources note above.
    // ⚠️ Like savingsGoals, this list was newest-first via `sortByCreationDate` and
    // is normalized to oldest-first here — the backfill reverses it once.
    sortOrder: integer('sortOrder').notNull().default(0),
    // Soft-delete tombstone (Story 4-18): see incomeSources note above.
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('balanceTracking_userId_profileId_idx').on(
      table.userId,
      table.profileId
    ),
    // CHECK constraint: monthlyContribution must be non-negative.
    // ⚠️ Story 49.1 removed `balanceTracking_maxContributionLimit_valid` alongside
    // the column it guarded. Doc-only, like the sibling checks — drizzle-kit 0.23
    // never emitted ANY of them to a migration, so nothing had to be dropped in SQL.
    monthlyContributionNonNegative: check(
      'balanceTracking_monthlyContribution_non_negative',
      sql`${table.monthlyContribution} >= 0`
    ),
  })
)

// User Profiles table - camelCase name per architecture
// Profiles allow users to organize their financial data for different purposes
// Only available for paid tier users
export const userProfiles = pgTable(
  'userProfiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    isDefault: boolean('isDefault').default(false).notNull(),
    currency: currencyEnum('currency').default('NONE'),
    // User-chosen avatar emoji (Story 54.2, FR78).
    //
    // ⚠️ NULLABLE ON PURPOSE, and there is deliberately no backfill. `null` means
    // "never chosen", and the client renders the hash-derived fallback it has
    // always rendered (`apps/web/src/lib/profile-appearance.ts`). That is what
    // makes this column invisible to every user who does not open the picker.
    //
    // ⚠️ NOT an enum and NOT CHECK-constrained, so the stored value is not
    // trustworthy: drizzle-kit 0.23 does not emit CHECK constraints to migrations
    // at all in this repo (see packages/core/src/sync/types.ts), so a constraint
    // here would be documentation, not enforcement. The real gate is
    // `isProfileIcon` at the render boundary, which falls back to the hash for
    // anything that is not one of the eight known emoji.
    //
    // 16 is comfortable for a multi-code-point emoji: '✈️' alone carries a
    // variation selector, and a flag or ZWJ sequence is longer still.
    icon: varchar('icon', { length: 16 }),
    // Soft-delete tombstone (Story 4-18): see incomeSources note above.
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('userProfiles_userId_idx').on(table.userId),
    // ⚠️ Partial unique index (Story 5-19, AC-4): AT MOST ONE default profile per
    // user, enforced by the DATABASE rather than by a read-then-write check.
    //
    // `createDefaultProfileForUser` is check-then-insert outside any transaction,
    // and one lifetime purchase emits BOTH `transaction.paid` and
    // `transaction.completed` — processed concurrently, both saw zero rows and
    // both inserted, leaving two "Main Profile" rows with `isDefault: true`,
    // after which profile-scoped reads pick arbitrarily and the buyer's data
    // appears to vanish between requests. No application-level guard closes that
    // window; only a constraint does.
    //
    // Tombstoned rows are excluded: a soft-deleted default (Story 4-18) must not
    // block creating a new one.
    oneDefaultPerUser: uniqueIndex('userProfiles_one_default_per_user')
      .on(table.userId)
      .where(sql`${table.isDefault} AND NOT ${table.isDeleted}`),
  })
)

// Categories table - user-defined income/expense categories (Story 30.4a, FR54)
//
// Premium capability. Modelled as a first-class entity rather than a
// denormalized string on each row because the feature requires rename and
// delete: renaming must update every referencing row with no per-row edit, and
// a denormalized copy cannot be renamed or deleted coherently.
//
// `incomeSources.categoryId` / `expenses.categoryId` reference this table and
// are NULLABLE — every pre-existing row stays valid and uncategorized, and no
// form gains a required field.
//
// ⚠️ This is the FIRST foreign key in this schema between two entities the user
// creates at will. Every other FK targets `users` or `userProfiles`, which
// always exist before any child row. Consequences the sync layer must respect:
//   - PUSH: a category must reach the server before any row referencing it.
//     Interactive use is safe because the queue is timestamp-FIFO, but
//     seedLocalData's free->paid backfill enqueues in hard-coded entity order,
//     so categories are seeded FIRST there (see lib/sync/seedLocalData.ts).
//   - PULL: changes are paginated by updatedAt, so a device can legitimately
//     receive a row whose category it has not pulled yet. There is no FK in
//     localStorage, so a dangling categoryId is a NORMAL client state that must
//     be rendered as "uncategorized" rather than assumed to resolve.
//     ⚠️ Code review 30.4a: this paragraph previously asserted "the UI resolves
//     it to uncategorized" as though that were implemented. It is not — no
//     resolver exists anywhere in the client, and the pickable-set filters do
//     not cover a cashflow row pointing at a category this device has never
//     seen. Story 30.4b OWNS building it; until then this is a documented
//     requirement, not a description of the code.
export const categories = pgTable(
  'categories',
  {
    // Client-generatable uuid PK, same rationale as incomeSources (Story 5-14).
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    kind: categoryKindEnum('kind').notNull(),
    // Soft-delete tombstone (Story 4-18), as on every other synced entity.
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('categories_userId_profileId_idx').on(table.userId, table.profileId),
    // Duplicate names are rejected per (user, profile, kind) — but ONLY among
    // LIVE rows. A plain `unique(...)` like forecastingProfiles' would collide
    // with the soft-delete tombstone above: deleting "Groceries" and creating it
    // again would hit a 23505 while the client store happily kept the new row —
    // silent client/server divergence that no test would surface.
    // forecastingProfiles has no isDeleted column, which is why its unmodified
    // pattern is not safe here.
    //
    // ⚠️ CASE-INSENSITIVE on `lower(name)` (code review 30.4a, Lucas's call;
    // migration 0012). The client's `isDuplicateName` has always compared
    // `trim().toLocaleLowerCase()`, so a case-SENSITIVE index disagreed with it
    // in both directions: it accepted "Groceries" and "groceries" as distinct
    // rows that every client then treated as duplicates and no code path
    // reconciled. Keep this expression and the client's `normalizeName` in step
    // — they are one rule expressed twice.
    liveNameUnique: uniqueIndex('categories_userId_profileId_kind_name_live_unique')
      .on(table.userId, table.profileId, table.kind, sql`lower(${table.name})`)
      .where(sql`${table.isDeleted} = false`),
  })
)

// Rate Limit table - unified server-side rate limiting (Story SEC-2).
//
// One fixed-window counter per (scope, subject, windowStart) bucket, shared
// across app instances so horizontal scaling can't multiply the effective limit.
// Backs BOTH the sync per-user limiter AND the auth limiters (magic-link
// request per-IP/per-email, verify per-IP), replacing the former in-memory
// single-instance `sliding-window.ts`. The Paddle OAuth callback route this
// once also rate-limited was deleted by story 5-3 (AC-1); its 'paddle-cb'
// scope was removed from the union with it — no CHECK constraint or prune
// query ever referenced the value, so this was doc-only drift.
//
// - `scope`   namespaces buckets so an IP/email/user can never consume another
//             bucket's budget: 'ip' | 'email' | 'login-verify' | 'sync'.
// - `subject` is the bucket key within a scope (IP string, lowercased email, or userId).
// - `userId`  is populated ONLY for the 'sync' scope (FK → users), so account
//             erasure (account.ts) still removes a user's sync counters; it is
//             NULL for IP/email buckets, which have no owning user.
// - `windowStart` is the fixed bucket boundary (floor(now / windowMs) * windowMs);
//             the UNIQUE (scope, subject, windowStart) index is the ON CONFLICT
//             target for the atomic upsert in server/rate-limit/db-window.ts.
export const rateLimits = pgTable(
  'rateLimits',
  {
    id: serial('id').primaryKey(),
    // Nullable now: only 'sync' rows carry an owning user; IP/email rows do not.
    userId: uuid('userId').references(() => users.id),
    scope: varchar('scope', { length: 32 }).notNull(),
    subject: text('subject').notNull(),
    requestCount: integer('requestCount').default(0).notNull(),
    windowStart: timestamp('windowStart').defaultNow().notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('rateLimits_userId_idx').on(table.userId),
    // Atomic-upsert conflict target: one row per bucket.
    scopeSubjectWindowIdx: uniqueIndex('rateLimits_scope_subject_window_idx').on(
      table.scope,
      table.subject,
      table.windowStart
    ),
  })
)

// Forecasting Profiles table - for saving premium forecasting scenarios
// Only available for paid tier users
// Allows users to save, load, and manage their forecasting scenarios
export const forecastingProfiles = pgTable(
  'forecastingProfiles',
  {
    id: serial('id').primaryKey(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    // Serialized forecasting scenario data
    scenarioData: text('scenarioData').notNull(), // JSON string
    // Version for schema evolution
    version: integer('version').default(1).notNull(),
    isDefault: boolean('isDefault').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('forecastingProfiles_userId_idx').on(table.userId),
    profileIdIdx: index('forecastingProfiles_profileId_idx').on(table.profileId),
    userIdProfileIdIdx: index('forecastingProfiles_userId_profileId_idx').on(
      table.userId,
      table.profileId
    ),
    // Prevent duplicate forecast names within the same user/profile (P6)
    userIdProfileIdNameUnique: unique('forecastingProfiles_userId_profileId_name_unique').on(
      table.userId,
      table.profileId,
      table.name
    ),
  })
)

// Login Tokens table - single-use magic-link tokens for passwordless re-auth (Story 5-16)
//
// Authentication is APP-OWNED email magic-link (ADR-003): a returning paid user
// requests a link, we email a one-time token, and consuming it mints the existing
// HMAC-signed session. We store ONLY the SHA-256 hash of the token (never the raw
// value), so a leaked database row cannot be replayed as a login link. Single-use
// is enforced by the `consumedAt` watermark inside one atomic UPDATE, which is
// naturally correct under Rapids horizontal scaling (unlike an in-memory cache).
//
// This table authenticates EXISTING users only — account creation happens at
// Paddle Billing checkout (Story 5-3). A request for an unknown email creates no
// row and no token.
export const loginTokens = pgTable(
  'loginTokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    // SHA-256 of the raw token, lowercase hex (64 chars). The raw token lives
    // only in the emailed link; we look up by re-hashing the presented value.
    tokenHash: varchar('tokenHash', { length: 64 }).unique().notNull(),
    // Short TTL (≤15 min, set in the token service). timestamptz so TTL math is
    // timezone-safe across the app server and DB.
    expiresAt: timestamp('expiresAt', { mode: 'date', withTimezone: true }).notNull(),
    // NULL until the link is opened; set atomically on consume to enforce single-use.
    consumedAt: timestamp('consumedAt', { mode: 'date', withTimezone: true }),
    // timestamptz to match expiresAt/consumedAt — one consistent tz convention
    // within the table (the column is currently audit-only, not used for TTL).
    createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('loginTokens_userId_idx').on(table.userId),
  })
)

// Paddle webhook event log (Story 5-19, AC-2) — the idempotency store.
//
// Signature + freshness were the only defences on the webhook, and NEITHER
// stops a duplicate: Paddle re-signs every retry with a fresh `ts`, so a retry
// is indistinguishable from a first delivery by signature alone.
//
// One row per Paddle event id. The PRIMARY KEY is the dedup mechanism: the
// handler inserts BEFORE doing any work, and a conflict means "already seen" →
// return a terminal 200 and do nothing. There is deliberately no FK to `users`:
// an event can arrive for a customer we have no row for yet (that is the
// first-seen-buyer path), and the log must survive account erasure so a replay
// after deletion is still recognised as a replay.
export const paddleWebhookEvents = pgTable(
  'paddleWebhookEvents',
  {
    // Paddle's own event id (`evt_...`), or `data.id` when the envelope omits
    // one. Supplied by us, never generated — it IS the identity of the delivery.
    eventId: varchar('eventId', { length: 255 }).primaryKey(),
    eventType: varchar('eventType', { length: 255 }).notNull(),
    // Nullable: a few event types carry no customer (and we still want the
    // delivery deduplicated).
    customerId: varchar('customerId', { length: 255 }),
    // The event's own `occurred_at`, epoch ms — the ordering key. NOT arrival
    // time: arrival order is exactly what cannot be trusted here.
    occurredAt: bigint('occurredAt', { mode: 'number' }),
    processedAt: timestamp('processedAt', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    customerIdx: index('paddleWebhookEvents_customerId_idx').on(table.customerId),
  })
)

// Paddle adjustment ledger (Story 5-19 review) — one row per ADJUSTMENT.
//
// ⚠️ This exists because the webhook-event store cannot do this job. Paddle
// emits BOTH `adjustment.created` and `adjustment.updated` for the SAME
// adjustment, as two deliveries with two different `event_id`s. Event-level
// dedup therefore lets both through, and an accumulator keyed on the customer
// counted one €50 partial refund twice — revoking a €99 lifetime grant that
// was only half refunded.
//
// The refunded total is now DERIVED by summing this table rather than
// incremented in place, so replaying any delivery any number of times cannot
// change the result. `adjustmentId` is the primary key; re-delivery is an
// `ON CONFLICT DO NOTHING`.
export const paddleAdjustments = pgTable(
  'paddleAdjustments',
  {
    // Paddle's adjustment id (`adj_...`) — the identity of the MONEY MOVEMENT,
    // as distinct from the identity of the delivery that told us about it.
    adjustmentId: varchar('adjustmentId', { length: 255 }).primaryKey(),
    customerId: varchar('customerId', { length: 255 }).notNull(),
    // The transaction the adjustment is against, so a refund can be matched to
    // the grant it belongs to rather than to the customer at large.
    transactionId: varchar('transactionId', { length: 255 }),
    /** `refund` | `credit` | `chargeback` | `chargeback_warning` | reversals. */
    action: varchar('action', { length: 64 }).notNull(),
    /** Amount in the currency's lowest unit. */
    total: bigint('total', { mode: 'number' }).notNull(),
    createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    customerIdx: index('paddleAdjustments_customerId_idx').on(table.customerId),
    transactionIdx: index('paddleAdjustments_transactionId_idx').on(table.transactionId),
  })
)

// Type exports for TypeScript type safety
// Note: Using InferSelectModel instead of deprecated InferModel
export type User = InferSelectModel<typeof users>
export type NewUser = InferInsertModel<typeof users>

export type IncomeSource = InferSelectModel<typeof incomeSources>
export type NewIncomeSource = InferInsertModel<typeof incomeSources>

export type Expense = InferSelectModel<typeof expenses>
export type NewExpense = InferInsertModel<typeof expenses>

export type SavingsGoal = InferSelectModel<typeof savingsGoals>
export type NewSavingsGoal = InferInsertModel<typeof savingsGoals>

export type BalanceTracking = InferSelectModel<typeof balanceTracking>
export type NewBalanceTracking = InferInsertModel<typeof balanceTracking>

export type UserProfile = InferSelectModel<typeof userProfiles>
export type NewUserProfile = InferInsertModel<typeof userProfiles>

export type RateLimit = InferSelectModel<typeof rateLimits>
export type NewRateLimit = InferInsertModel<typeof rateLimits>

export type ForecastingProfile = InferSelectModel<typeof forecastingProfiles>
export type NewForecastingProfile = InferInsertModel<typeof forecastingProfiles>

export type LoginToken = InferSelectModel<typeof loginTokens>
export type NewLoginToken = InferInsertModel<typeof loginTokens>

export type Category = InferSelectModel<typeof categories>
export type NewCategory = InferInsertModel<typeof categories>

export type PaddleWebhookEvent = InferSelectModel<typeof paddleWebhookEvents>
export type NewPaddleWebhookEvent = InferInsertModel<typeof paddleWebhookEvents>

export type PaddleAdjustment = InferSelectModel<typeof paddleAdjustments>
export type NewPaddleAdjustment = InferInsertModel<typeof paddleAdjustments>

// Frequency enum type
export type Frequency = (typeof frequencyEnum.enumValues)[number]

// Finance type enum type
export type FinanceType = (typeof financeTypeEnum.enumValues)[number]

// Subscription status enum type
export type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number]

// Currency enum type
export type Currency = (typeof currencyEnum.enumValues)[number]

// Category kind enum type (Story 30.4a)
export type CategoryKind = (typeof categoryKindEnum.enumValues)[number]

// Export all tables for use in migrations and queries
export const allTables = {
  users,
  incomeSources,
  expenses,
  savingsGoals,
  balanceTracking,
  userProfiles,
  rateLimits,
  forecastingProfiles,
  loginTokens,
  categories,
  paddleWebhookEvents,
  paddleAdjustments,
}

// NOTE: Database constraint testing requires a live PostgreSQL connection (DATABASE_URL)
// Unit tests for schema validation will be added when database is configured
// See: pnpm --filter db db:generate (requires DATABASE_URL)
