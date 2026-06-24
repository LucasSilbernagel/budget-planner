import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  index,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// `sql` is exported from the drizzle-orm package root (NOT pg-core) in
// drizzle-orm 0.30.x; importing it from pg-core yields undefined and throws
// "sql is not a function" when drizzle() walks the schema's CHECK constraints.
import { sql } from 'drizzle-orm'

// Type imports for Drizzle
// Note: Using InferSelectModel and InferInsertModel (InferModel is deprecated)
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'

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
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 254 }).unique().notNull(), // RFC 5321 max length
  paddleId: varchar('paddleId', { length: 255 }).unique().notNull(), // Paddle customer ID
  subscriptionStatus: subscriptionStatusEnum('subscriptionStatus').default('free').notNull(),
  currency: currencyEnum('currency').default('NONE'),
  isDeleted: boolean('isDeleted').default(false).notNull(), // Soft-delete flag for data safety
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  // CHECK constraints: Prevent empty strings for required fields
  sql`CHECK (${table.email} <> '')`,
  sql`CHECK (${table.paddleId} <> '')`,
])

// Income Sources table - camelCase name per architecture
export const incomeSources = pgTable('incomeSources', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id)
    .notNull(),
  profileId: uuid('profileId')
    .references(() => userProfiles.id)
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  amount: integer('amount').notNull(), // Amount in cents for precision (> 0 required)
  frequency: frequencyEnum('frequency').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  index('incomeSources_userId_profileId_idx').on(table.userId, table.profileId),
  // CHECK constraint: amount must be positive (> 0)
  sql`CHECK (${table.amount} > 0)`,
])

// Expenses table - camelCase name per architecture
export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id)
    .notNull(),
  profileId: uuid('profileId')
    .references(() => userProfiles.id)
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  amount: integer('amount').notNull(), // Amount in cents for precision (> 0 required)
  frequency: frequencyEnum('frequency').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  index('expenses_userId_profileId_idx').on(table.userId, table.profileId),
  // CHECK constraint: amount must be positive (> 0)
  sql`CHECK (${table.amount} > 0)`,
])

// Savings Goals table - camelCase name per architecture
export const savingsGoals = pgTable('savingsGoals', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id)
    .notNull(),
  profileId: uuid('profileId')
    .references(() => userProfiles.id)
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  targetAmount: integer('targetAmount').notNull(), // Target amount in cents (> 0 required)
  currentBalance: integer('currentBalance').notNull().default(0), // Current balance in cents (>= 0 required)
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  index('savingsGoals_userId_profileId_idx').on(table.userId, table.profileId),
  // CHECK constraints: targetAmount must be positive, currentBalance must be non-negative
  sql`CHECK (${table.targetAmount} > 0)`,
  sql`CHECK (${table.currentBalance} >= 0)`,
])

// Balance Tracking table - camelCase name per architecture
export const balanceTracking = pgTable('balanceTracking', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id)
    .notNull(),
  profileId: uuid('profileId')
    .references(() => userProfiles.id)
    .notNull(),
  type: financeTypeEnum('type').notNull(), // investment or debt
  name: varchar('name', { length: 255 }).notNull(),
  currentBalance: integer('currentBalance').notNull().default(0), // Current balance in cents (can be negative for debt)
  maxContributionLimit: integer('maxContributionLimit'), // Optional: max contribution limit in cents (> 0 if provided)
  monthlyContribution: integer('monthlyContribution').notNull().default(0), // Monthly contribution in cents (>= 0 required)
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  index('balanceTracking_userId_profileId_idx').on(table.userId, table.profileId),
  // CHECK constraints: maxContributionLimit must be positive if provided, monthlyContribution must be non-negative
  sql`CHECK (${table.maxContributionLimit} IS NULL OR ${table.maxContributionLimit} > 0)`,
  sql`CHECK (${table.monthlyContribution} >= 0)`,
])

// User Profiles table - camelCase name per architecture
// Profiles allow users to organize their financial data for different purposes
// Only available for paid tier users
export const userProfiles = pgTable('userProfiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId')
    .references(() => users.id)
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isDefault: boolean('isDefault').default(false).notNull(),
  currency: currencyEnum('currency').default('NONE'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  index('userProfiles_userId_idx').on(table.userId),
])

// Rate Limit table - for server-side rate limiting
// Stores request counts per user for rate limiting purposes
export const rateLimits = pgTable('rateLimits', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .references(() => users.id)
    .notNull(),
  requestCount: integer('requestCount').default(0).notNull(),
  windowStart: timestamp('windowStart').defaultNow().notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  index('rateLimits_userId_idx').on(table.userId),
])

// Forecasting Profiles table - for saving premium forecasting scenarios
// Only available for paid tier users
// Allows users to save, load, and manage their forecasting scenarios
export const forecastingProfiles = pgTable('forecastingProfiles', {
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
}, (table) => [
  index('forecastingProfiles_userId_idx').on(table.userId),
  index('forecastingProfiles_profileId_idx').on(table.profileId),
  index('forecastingProfiles_userId_profileId_idx').on(table.userId, table.profileId),
])

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
  forecastingProfiles,
}

// NOTE: Database constraint testing requires a live PostgreSQL connection (DATABASE_URL)
// Unit tests for schema validation will be added when database is configured
// See: pnpm --filter db db:generate (requires DATABASE_URL)
