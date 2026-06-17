import {
  integer,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

// Type imports for Drizzle
export type { InferModel, InferInsertModel } from 'drizzle-orm'

// Frequency enum for income and expense recurrence
// Values use snake_case as per architecture: weekly, biweekly, monthly, annually
export const frequencyEnum = pgEnum('frequency', [
  'weekly',
  'biweekly',
  'monthly',
  'annually',
])

// Users table - referenced by incomeSources and expenses
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  // Additional user fields will be added in future stories (auth, profiles, etc.)
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Income Sources table - camelCase name per architecture
export const incomeSources = pgTable('incomeSources', {
  id: serial('id').primaryKey(),
  userId: integer('userId')
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
  userId: integer('userId')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  amount: integer('amount').notNull(), // Amount in cents for precision (positive values expected)
  frequency: frequencyEnum('frequency').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

// Type exports for TypeScript type safety
export type User = InferModel<typeof users>
export type NewUser = InferInsertModel<typeof users>

export type IncomeSource = InferModel<typeof incomeSources>
export type NewIncomeSource = InferInsertModel<typeof incomeSources>

export type Expense = InferModel<typeof expenses>
export type NewExpense = InferInsertModel<typeof expenses>

// Frequency enum type
export type Frequency = (typeof frequencyEnum.enumValues)[number]

// Export all tables for use in migrations and queries
export const allTables = {
  users,
  incomeSources,
  expenses,
}
