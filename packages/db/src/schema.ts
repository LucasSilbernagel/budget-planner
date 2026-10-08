// `sql` must come from the drizzle-orm root, not pg-core, where it is undefined in 0.30.x.
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
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

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

// Money is integer cents. CHECKs reach SQL via a hand-authored migration: drizzle-kit 0.23 emits
// no CHECK DDL, so a regeneration silently drops them.

export const frequencyEnum = pgEnum('frequency', ['weekly', 'biweekly', 'monthly', 'annually'])

// `asset` is owned outright and carries no contribution: it changes value by appreciation.
export const financeTypeEnum = pgEnum('financeType', ['investment', 'debt', 'asset'])

// Derived from the enum: a `satisfies` tuple would compile with a member missing. Client code must
// import this from `src/schema`, not the barrel, which pulls in the server-only client.
export const ALL_FINANCE_TYPES = financeTypeEnum.enumValues

// 'manual' holds a fixed monthlyAllocation; 'automatic' gets an even share of the leftover pool.
export const allocationModeEnum = pgEnum('allocationMode', ['manual', 'automatic'])

// A new enum on purpose: `ALTER TYPE ... ADD VALUE` can't run inside a transaction on older PG.
export const categoryKindEnum = pgEnum('categoryKind', ['income', 'expense'])

export const subscriptionStatusEnum = pgEnum('subscriptionStatus', [
  'free',
  'active',
  'past_due',
  'canceled',
  // Distinct from 'active' so a subscription event can never downgrade a lifetime buyer.
  'lifetime',
])

// From Paddle's top-level `billing_cycle`; a cadence not sold here is stored as NULL.
export const billingIntervalEnum = pgEnum('billingInterval', ['month', 'year'])

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

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).unique().notNull(),
    paddleId: varchar('paddleId', { length: 255 }).unique().notNull(),
    subscriptionStatus: subscriptionStatusEnum('subscriptionStatus').default('free').notNull(),
    // Written only alongside `subscriptionStatus`, in a write that advances `entitlementUpdatedAt`.
    // Not an entitlement signal: access depends on `subscriptionStatus` alone.
    billingInterval: billingIntervalEnum('billingInterval'),
    currency: currencyEnum('currency').default('NONE'),
    isDeleted: boolean('isDeleted').default(false).notNull(),
    // Ordering watermark: entitlement changes need a strictly newer event, since Paddle re-signs
    // retries with a fresh `ts` and signature freshness filters nothing.
    entitlementUpdatedAt: bigint('entitlementUpdatedAt', { mode: 'number' }),
    // Separate from `entitlementUpdatedAt`: sharing it would make a later legitimate entitlement event
    // with an earlier `occurred_at` look stale and be dropped.
    emailUpdatedAt: bigint('emailUpdatedAt', { mode: 'number' }),
    // Recorded at grant so a refund can be judged full vs partial. A 100%-coupon grant records 0.
    lifetimeTransactionId: varchar('lifetimeTransactionId', { length: 255 }),
    lifetimeGrantTotal: bigint('lifetimeGrantTotal', { mode: 'number' }),
    // No refunded-total counter: it is summed from `paddleAdjustments`, which stays idempotent.
    // A session whose `iat` is at or before `sessionsRevokedAt` is rejected.
    sessionsRevokedAt: bigint('sessionsRevokedAt', { mode: 'number' }),
    // Not `entitlementUpdatedAt`: a further unentitled event must keep this, not restart the
    // retention clock. Not an entitlement signal.
    accessEndedAt: bigint('accessEndedAt', { mode: 'number' }),
    // The purge requires this to be 30+ days old and not older than `accessEndedAt`: never delete unwarned.
    retentionNoticeSentAt: bigint('retentionNoticeSentAt', { mode: 'number' }),
    // Candidates go oldest-attempt-first, so a refused address rotates back instead of blocking the queue.
    retentionNoticeAttemptedAt: bigint('retentionNoticeAttemptedAt', { mode: 'number' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    emailNotEmpty: check('users_email_not_empty', sql`${table.email} <> ''`),
    paddleIdNotEmpty: check('users_paddleId_not_empty', sql`${table.paddleId} <> ''`),
  })
)

export const incomeSources = pgTable(
  'incomeSources',
  {
    // The client may supply the id, so an offline-created row has the same id everywhere.
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    amount: integer('amount').notNull(),
    frequency: frequencyEnum('frequency').notNull(),
    // Nullable: uncategorized is a permanently valid state.
    categoryId: uuid('categoryId').references(() => categories.id),
    // Not unique, no CHECK: duplicates are expected under two-device LWW, and reads converge on a
    // tiebreaker. Deletes leave gaps, so treat values as ordered, never contiguous.
    sortOrder: integer('sortOrder').notNull().default(0),
    // Soft delete: a hard DELETE can't be surfaced by a delta-by-updatedAt pull.
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('incomeSources_userId_profileId_idx').on(
      table.userId,
      table.profileId
    ),
    amountPositive: check('incomeSources_amount_positive', sql`${table.amount} > 0`),
  })
)

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    amount: integer('amount').notNull(),
    frequency: frequencyEnum('frequency').notNull(),
    categoryId: uuid('categoryId').references(() => categories.id),
    // A user-supplied prediction: the app cannot compute whether an expense ends.
    endsBeforeRetirement: boolean('endsBeforeRetirement').notNull().default(false),
    sortOrder: integer('sortOrder').notNull().default(0),
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('expenses_userId_profileId_idx').on(table.userId, table.profileId),
    amountPositive: check('expenses_amount_positive', sql`${table.amount} > 0`),
  })
)

export const savingsGoals = pgTable(
  'savingsGoals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    // Nullable: null means a savings account with no target, not a sentinel 0.
    targetAmount: integer('targetAmount'),
    currentBalance: integer('currentBalance').notNull().default(0),
    monthlyAllocation: integer('monthlyAllocation'),
    allocationMode: allocationModeEnum('allocationMode').notNull().default('automatic'),
    sortOrder: integer('sortOrder').notNull().default(0),
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('savingsGoals_userId_profileId_idx').on(
      table.userId,
      table.profileId
    ),
    targetAmountPositive: check(
      'savingsGoals_targetAmount_positive',
      sql`${table.targetAmount} IS NULL OR ${table.targetAmount} > 0`
    ),
    currentBalanceNonNegative: check(
      'savingsGoals_currentBalance_non_negative',
      sql`${table.currentBalance} >= 0`
    ),
    monthlyAllocationNonNegative: check(
      'savingsGoals_monthlyAllocation_non_negative',
      sql`${table.monthlyAllocation} IS NULL OR ${table.monthlyAllocation} >= 0`
    ),
  })
)

export const balanceTracking = pgTable(
  'balanceTracking',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    type: financeTypeEnum('type').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    // A non-negative magnitude (a debt is the amount owed), refused only by the client validator.
    currentBalance: integer('currentBalance').notNull().default(0),
    // Its cadence is `frequency`; the name is kept for call-site stability.
    monthlyContribution: integer('monthlyContribution').notNull().default(0),
    frequency: frequencyEnum('frequency').notNull().default('monthly'),
    // User-supplied: the contribution is already an expense line, so the savings pool must not
    // subtract it twice. Nothing else distinguishes such rows.
    contributionRecordedAsExpense: boolean('contributionRecordedAsExpense')
      .notNull()
      .default(false),
    // Deliberately no `.references()`: a dangling link is a normal state, and a 23503 on push would
    // replay until the circuit breaker stops all sync.
    paymentExpenseId: uuid('paymentExpenseId'),
    sortOrder: integer('sortOrder').notNull().default(0),
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('balanceTracking_userId_profileId_idx').on(
      table.userId,
      table.profileId
    ),
    // No CHECK on `currentBalance` here: a 23514 past the client's sync queue is never cleared, so a
    // legacy negative debt could never be pushed.
    monthlyContributionNonNegative: check(
      'balanceTracking_monthlyContribution_non_negative',
      sql`${table.monthlyContribution} >= 0`
    ),
  })
)

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
    // Nullable (never chosen) and unconstrained: `isProfileIcon` at render is the real gate.
    // 16 fits multi-code-point emoji.
    icon: varchar('icon', { length: 16 }),
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('userProfiles_userId_idx').on(table.userId),
    // At most one default profile per user, enforced by the database: concurrent webhooks raced
    // the app-level check-then-insert.
    oneDefaultPerUser: uniqueIndex('userProfiles_one_default_per_user')
      .on(table.userId)
      .where(sql`${table.isDefault} AND NOT ${table.isDeleted}`),
  })
)

// First FK between user-created entities: categories must push before rows referencing them, and
// a pulled row may reference a category not yet pulled.
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    profileId: uuid('profileId')
      .references(() => userProfiles.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    kind: categoryKindEnum('kind').notNull(),
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdProfileIdIdx: index('categories_userId_profileId_idx').on(table.userId, table.profileId),
    // Unique only among live rows, or re-creating a deleted name hits its tombstone. Case-insensitive
    // to match the client's `normalizeName`; keep the two in step.
    liveNameUnique: uniqueIndex('categories_userId_profileId_kind_name_live_unique')
      .on(table.userId, table.profileId, table.kind, sql`lower(${table.name})`)
      .where(sql`${table.isDeleted} = false`),
  })
)

// Fixed-window counters shared across instances. `userId` is set only for the 'sync' scope, so
// account erasure removes it; email buckets are erased by `subject`.
export const rateLimits = pgTable(
  'rateLimits',
  {
    id: serial('id').primaryKey(),
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
    // The reaper deletes on `windowStart` alone, which the unique index (leading with `scope`) can't serve.
    windowStartIdx: index('rateLimits_windowStart_idx').on(table.windowStart),
    // Atomic-upsert conflict target: one row per bucket.
    scopeSubjectWindowIdx: uniqueIndex('rateLimits_scope_subject_window_idx').on(
      table.scope,
      table.subject,
      table.windowStart
    ),
  })
)

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
    scenarioData: text('scenarioData').notNull(),
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
    userIdProfileIdNameUnique: unique('forecastingProfiles_userId_profileId_name_unique').on(
      table.userId,
      table.profileId,
      table.name
    ),
  })
)

// One row per user, `id` = the user's id. No `profileId` (its absence routes plan ops past
// profile checks) and no `check()`: a push-side DB rejection replays until sync stops.
export const retirementPlans = pgTable(
  'retirementPlans',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    plan: jsonb('plan').notNull(),
    isDeleted: boolean('isDeleted').default(false).notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('retirementPlans_userId_idx').on(table.userId),
  })
)

// Stores only the SHA-256 of each token; single-use via `consumedAt` in one atomic UPDATE.
export const loginTokens = pgTable(
  'loginTokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .references(() => users.id)
      .notNull(),
    tokenHash: varchar('tokenHash', { length: 64 }).unique().notNull(),
    expiresAt: timestamp('expiresAt', { mode: 'date', withTimezone: true }).notNull(),
    consumedAt: timestamp('consumedAt', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('loginTokens_userId_idx').on(table.userId),
  })
)

// Idempotency store: the PK dedups, since Paddle re-signs retries. No FK to users, so it
// survives erasure and handles first-seen buyers.
export const paddleWebhookEvents = pgTable(
  'paddleWebhookEvents',
  {
    eventId: varchar('eventId', { length: 255 }).primaryKey(),
    eventType: varchar('eventType', { length: 255 }).notNull(),
    customerId: varchar('customerId', { length: 255 }),
    // The event's own `occurred_at`; arrival order can't be trusted.
    occurredAt: bigint('occurredAt', { mode: 'number' }),
    processedAt: timestamp('processedAt', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    customerIdx: index('paddleWebhookEvents_customerId_idx').on(table.customerId),
  })
)

// One row per adjustment: Paddle sends created and updated for the same one under different event
// ids. Refunded totals are summed from here, so replays can't change them.
export const paddleAdjustments = pgTable(
  'paddleAdjustments',
  {
    adjustmentId: varchar('adjustmentId', { length: 255 }).primaryKey(),
    customerId: varchar('customerId', { length: 255 }).notNull(),
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

// `leaseUntil` is claimed by one atomic conditional UPDATE and self-heals on expiry.
// `lastCompletedAt` lets a backstop notice a stopped schedule (GitHub disables idle ones).
export const jobRuns = pgTable('jobRuns', {
  name: varchar('name', { length: 64 }).primaryKey(),
  leaseUntil: bigint('leaseUntil', { mode: 'number' }),
  lastCompletedAt: bigint('lastCompletedAt', { mode: 'number' }),
})

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

export type RetirementPlanRow = InferSelectModel<typeof retirementPlans>
export type NewRetirementPlanRow = InferInsertModel<typeof retirementPlans>

export type LoginToken = InferSelectModel<typeof loginTokens>
export type NewLoginToken = InferInsertModel<typeof loginTokens>

export type Category = InferSelectModel<typeof categories>
export type NewCategory = InferInsertModel<typeof categories>

export type JobRun = InferSelectModel<typeof jobRuns>
export type PaddleWebhookEvent = InferSelectModel<typeof paddleWebhookEvents>
export type NewPaddleWebhookEvent = InferInsertModel<typeof paddleWebhookEvents>

export type PaddleAdjustment = InferSelectModel<typeof paddleAdjustments>
export type NewPaddleAdjustment = InferInsertModel<typeof paddleAdjustments>

export type Frequency = (typeof frequencyEnum.enumValues)[number]

export type FinanceType = (typeof financeTypeEnum.enumValues)[number]

export type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number]

export type Currency = (typeof currencyEnum.enumValues)[number]
export type BillingInterval = (typeof billingIntervalEnum.enumValues)[number]

export type CategoryKind = (typeof categoryKindEnum.enumValues)[number]

export const allTables = {
  users,
  incomeSources,
  expenses,
  savingsGoals,
  balanceTracking,
  userProfiles,
  rateLimits,
  forecastingProfiles,
  retirementPlans,
  loginTokens,
  categories,
  paddleWebhookEvents,
  paddleAdjustments,
  jobRuns,
}
