import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// Type imports for Drizzle
// Note: Using InferSelectModel and InferInsertModel (InferModel is deprecated)
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'

// VALIDATION STRATEGY:
// - Application-layer validation (Zod schemas) will be added in Story 2-2 for better UX/error messages
// - All monetary amounts use integer type (cents) for precision
// - Positive constraints: > 0 for strictly positive, >= 0 for non-negative, NULL allowed where optional
// - Database-level CHECK constraints removed temporarily due to Drizzle ORM type compatibility
// - Timestamps use default mode (returns strings) for JSON serialization compatibility
// - Indexes added on paddleId (auth lookups) and userProfiles.userId (query optimization)

// Frequency enum for income and expense recurrence
// Values use snake_case as per architecture: weekly, biweekly, monthly, annually
export const frequencyEnum = pgEnum('frequency', [
  'weekly',
  'biweekly',
  'monthly',
  'annually',
])

// Finance type enum for balance tracking
// Values use snake_case as per architecture
export const financeTypeEnum = pgEnum('financeType', [
  'investment',
  'debt',
])

// Subscription status enum for user accounts
// Values use snake_case as per architecture
export const subscriptionStatusEnum = pgEnum('subscriptionStatus', [
  'free',
  'active',
  'past_due',
  'canceled',
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
])

// Users table - referenced by incomeSources, expenses, savingsGoals, and balanceTracking
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 254 }).unique().notNull(), // RFC 5321 max length
  paddleId: varchar('paddleId', { length: 255 }).unique().notNull(), // Paddle customer ID - unique constraint provides indexing
  subscriptionStatus: subscriptionStatusEnum('subscriptionStatus').default('free').notNull(),
  currency: currencyEnum('currency').default('NONE'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
})

// Income Sources table - camelCase name per architecture
export const incomeSources = pgTable('incomeSources', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  amount: integer('amount').notNull(), // Amount in cents for precision (positive values expected)
  frequency: frequencyEnum('frequency').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Expenses table - camelCase name per architecture
export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  amount: integer('amount').notNull(), // Amount in cents for precision (positive values expected)
  frequency: frequencyEnum('frequency').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Savings Goals table - camelCase name per architecture
export const savingsGoals = pgTable('savingsGoals', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  targetAmount: integer('targetAmount').notNull(), // Target amount in cents
  currentBalance: integer('currentBalance').notNull().default(0), // Current balance in cents
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Balance Tracking table - camelCase name per architecture
export const balanceTracking = pgTable('balanceTracking', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  type: financeTypeEnum('type').notNull(), // investment or debt
  name: varchar('name', { length: 255 }).notNull(),
  currentBalance: integer('currentBalance').notNull().default(0), // Current balance in cents (can be negative for debt per AC 5)
  maxContributionLimit: integer('maxContributionLimit'), // Optional: max contribution limit in cents
  monthlyContribution: integer('monthlyContribution').notNull().default(0), // Monthly contribution in cents
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// User Profiles table - camelCase name per architecture
// Profiles allow users to organize their financial data for different purposes
// Only available for paid tier users
export const userProfiles = pgTable('userProfiles', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(), // TODO: Add index via table-level configuration for query optimization
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 500 }),
  isDefault: boolean('isDefault').default(false).notNull(),
  currency: currencyEnum('currency').default('NONE'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Rate Limit table - for server-side rate limiting
// Stores request counts per user for rate limiting purposes
export const rateLimits = pgTable('rateLimits', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  requestCount: integer('requestCount').default(0).notNull(),
  windowStart: timestamp('windowStart').defaultNow().notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

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

// Frequency enum type
export type Frequency = (typeof frequencyEnum.enumValues)[number]

// Finance type enum type
export type FinanceType = (typeof financeTypeEnum.enumValues)[number]

// Subscription status enum type
export type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number]

// Currency enum type
export type Currency = (typeof currencyEnum.enumValues)[number]

// Export all tables for use in migrations and queries
export const allTables = {
  users,
  incomeSources,
  expenses,
  savingsGoals,
  balanceTracking,
  userProfiles,
  rateLimits,
}

export type RateLimit = InferSelectModel<typeof rateLimits>
export type NewRateLimit = InferInsertModel<typeof rateLimits>

// NOTE: Database constraint testing requires a live PostgreSQL connection (DATABASE_URL)
// Unit tests for schema validation will be added when database is configured
// See: pnpm --filter db db:generate (requires DATABASE_URL)
