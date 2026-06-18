import { integer, pgEnum, pgTable, serial, timestamp, varchar, } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
// VALIDATION STRATEGY:
// - Database-level CHECK constraints provide the last line of defense for data integrity
// - Application-layer validation (Zod schemas) will be added in Story 2-2 for better UX/error messages
// - All monetary amounts use integer type (cents) for precision
// - Positive constraints: > 0 for strictly positive, >= 0 for non-negative, NULL allowed where optional
// Frequency enum for income and expense recurrence
// Values use snake_case as per architecture: weekly, biweekly, monthly, annually
export const frequencyEnum = pgEnum('frequency', [
    'weekly',
    'biweekly',
    'monthly',
    'annually',
]);
// Finance type enum for balance tracking
// Values use snake_case as per architecture
export const financeTypeEnum = pgEnum('financeType', [
    'investment',
    'debt',
]);
// Subscription status enum for user accounts
// Values use snake_case as per architecture
export const subscriptionStatusEnum = pgEnum('subscriptionStatus', [
    'free',
    'active',
    'cancelled',
    'past_due',
    'unpaid',
]);
// Users table - referenced by incomeSources and expenses
// Note: Using integer IDs for now to maintain compatibility with existing foreign keys
// Future migration to UUID can be done when needed
export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 255 }).unique().notNull(),
    paddleId: varchar('paddleId', { length: 255 }),
    subscriptionStatus: subscriptionStatusEnum('subscriptionStatus').default('free').notNull(),
    currency: varchar('currency', { length: 3 }).default('NONE'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});
// Income Sources table - camelCase name per architecture
export const incomeSources = pgTable('incomeSources', {
    id: serial('id').primaryKey(),
    userId: integer('userId')
        .references(() => users.id, { onDelete: 'cascade' })
        .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    amount: integer('amount').notNull(),
    frequency: frequencyEnum('frequency').notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
    // Consistency: ensure amount is positive across all monetary fields
    sql `check (${table.amount} > 0)`.named('income_sources_amount_positive'),
]);
// Expenses table - camelCase name per architecture
export const expenses = pgTable('expenses', {
    id: serial('id').primaryKey(),
    userId: integer('userId')
        .references(() => users.id, { onDelete: 'cascade' })
        .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    amount: integer('amount').notNull(),
    frequency: frequencyEnum('frequency').notNull(),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
    // Consistency: ensure amount is positive across all monetary fields
    sql `check (${table.amount} > 0)`.named('expenses_amount_positive'),
]);
// Savings Goals table - camelCase name per architecture
export const savingsGoals = pgTable('savingsGoals', {
    id: serial('id').primaryKey(),
    userId: integer('userId')
        .references(() => users.id, { onDelete: 'cascade' })
        .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    targetAmount: integer('targetAmount').notNull(),
    currentBalance: integer('currentBalance').notNull().default(0),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
    // AC 4: targetAmount must be positive (savings goals cannot have negative or zero targets)
    sql `check (${table.targetAmount} > 0)`.named('savings_goals_target_amount_positive'),
]);
// Balance Tracking table - camelCase name per architecture
export const balanceTracking = pgTable('balanceTracking', {
    id: serial('id').primaryKey(),
    userId: integer('userId')
        .references(() => users.id, { onDelete: 'cascade' })
        .notNull(),
    type: financeTypeEnum('type').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    currentBalance: integer('currentBalance').notNull().default(0),
    maxContributionLimit: integer('maxContributionLimit'),
    monthlyContribution: integer('monthlyContribution').notNull().default(0),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
    // Consistency: ensure optional limit is non-negative if provided
    sql `check (${table.maxContributionLimit} IS NULL OR ${table.maxContributionLimit} >= 0)`.named('balance_tracking_limit_non_negative'),
]);
// User Profiles table - camelCase name per architecture
// Profiles allow users to organize their financial data for different purposes
// Only available for paid tier users
export const userProfiles = pgTable('userProfiles', {
    id: serial('id').primaryKey(),
    userId: integer('userId')
        .references(() => users.id, { onDelete: 'cascade' })
        .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: varchar('description', { length: 500 }),
    isDefault: boolean('isDefault').default(false).notNull(),
    currency: varchar('currency', { length: 3 }).default('NONE'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});
// Export all tables for use in migrations and queries
export const allTables = {
    users,
    incomeSources,
    expenses,
    savingsGoals,
    balanceTracking,
    userProfiles,
};
// NOTE: Database constraint testing requires a live PostgreSQL connection (DATABASE_URL)
// Unit tests for schema validation will be added when database is configured
// See: pnpm --filter db db:generate (requires DATABASE_URL)
//# sourceMappingURL=schema.js.map