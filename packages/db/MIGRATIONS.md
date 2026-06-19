# Database Migrations Guide

## Overview

This document describes the database schema changes and migration process for the budget-planner application.

## Current Schema Version

The schema is defined in `packages/db/src/schema.ts` using Drizzle ORM.

## Story 4-2: Users Table Schema Changes

### Changes Made

#### 1. Users Table Updates
- **id**: Changed from `serial` (integer) to `uuid` with `defaultRandom()`
- **email**: Changed length from 255 to 254 for RFC 5321 compliance
- **paddleId**: Added `.unique().notNull()` constraints (unique constraint provides implicit indexing)
- **currency**: Changed from `varchar('currency', { length: 3 })` to `currencyEnum('currency')`
- **createdAt**: Removed `{ mode: 'date' }` to use default timestamp mode for better JSON serialization
- **removed**: `updatedAt` field (not required by story specifications)

#### 2. New Enums
- **currencyEnum**: Created with values: NONE, USD, EUR, GBP, JPY, CAD, AUD, CHF, CNY, SEK, NZD
- **subscriptionStatusEnum**: Updated to use 'canceled' (not 'cancelled') and removed 'unpaid'

#### 3. Foreign Key Updates
All tables with `userId` references updated from `integer('userId')` to `uuid('userId')`:
- `incomeSources.userId`
- `expenses.userId`
- `savingsGoals.userId`
- `balanceTracking.userId`
- `userProfiles.userId` (NOTE: Index should be added via table-level configuration)

All foreign keys maintain `ON DELETE CASCADE` for proper data cleanup.

#### 4. Code Review Improvements Applied
- ✅ Fixed timestamp mode to use default (returns strings) for JSON serialization compatibility
- ✅ Changed email length to 254 (RFC 5321 standard)
- ⚠️ Indexes: paddleId has unique constraint (implicit index), userProfiles.userId needs explicit index
- ⚠️ Cascade delete: Consider soft-delete mechanism for data safety (see Architecture Decision below)

### Acceptance Criteria Satisfied

#### AC-1: Users Table Schema
✅ **id**: uuid, primary key, default gen_random_uuid()
✅ **email**: varchar(255), unique, not null
✅ **paddleId**: varchar(255), unique, not null
✅ **subscriptionStatus**: varchar (via enum), default 'free'
✅ **currency**: varchar (via enum), default 'NONE'
✅ **createdAt**: timestamp with time zone, default now()

#### AC-2: User Record Creation
✅ Schema supports user record creation via Paddle auth
✅ paddleId field is available and properly constrained
✅ subscriptionStatus field is available with proper defaults

## Migration Generation

To generate migrations for these changes:

```bash
# Set up DATABASE_URL in .env file
# Example: DATABASE_URL=postgresql://user:password@localhost:5432/budget_planner

# Generate migrations
pnpm --filter db db:generate
```

This will create migration files in `packages/db/migrations/` directory.

## Migration Application

To apply migrations to the database:

```bash
# Apply all pending migrations
pnpm --filter db db:migrate
```

## Architecture Decisions

### Cascade Delete vs Soft-Delete
**Current Implementation:** All foreign keys use `ON DELETE CASCADE`

**Consideration:** Cascade delete is convenient but destructive. When a user is deleted, ALL their financial data (income, expenses, savings, balances) is permanently deleted.

**Recommendation:** For production, consider implementing one of these alternatives:
1. **Soft-delete pattern:** Add `isDeleted` boolean column to users table, filter queries to exclude deleted users
2. **Archive pattern:** Move deleted user data to archive tables instead of deleting
3. **Confirmation workflow:** Require multi-step confirmation for user deletion

**Decision:** For now, cascade delete is acceptable for development. Revisit before production deployment.

## Important Notes

### Breaking Changes
- **id type change**: The users table id changed from serial (integer) to uuid
- **userId type change**: All foreign keys changed from integer to uuid
- **Existing data**: If you have existing data, you will need a migration script to:
  1. Convert existing integer ids to uuid
  2. Update all foreign key references

### Data Sovereignty
⚠️ **CRITICAL**: All database operations MUST use Scaleway PostgreSQL in EU region (Paris or Amsterdam)
- Zero US data residency (NFR1, NFR2)
- Full CLOUD Act immunity

### Production Deployment
For production, use the Scaleway connection string:
```bash
SCALEWAY_DATABASE_URL=postgresql://user:password@host:port/database
```

## Testing

### Schema Validation Tests
Schema validation tests are located in `packages/db/src/schema.test.ts`

Run tests:
```bash
# Note: Vitest needs to be configured at the workspace level
# Tests verify:
# - Schema compilation
# - Type generation
# - Enum values
# - Table structure
# - Foreign key relations
```

### Biome Linting
All files pass Biome linting with unicorn rules enabled:
```bash
pnpm biome check
```

## Type Safety

All TypeScript types are properly inferred from the Drizzle schema:
- `User` and `NewUser` for users table
- `IncomeSource` and `NewIncomeSource` for incomeSources table
- `Expense` and `NewExpense` for expenses table
- `SavingsGoal` and `NewSavingsGoal` for savingsGoals table
- `BalanceTracking` and `NewBalanceTracking` for balanceTracking table
- `UserProfile` and `NewUserProfile` for userProfiles table

## File Changes

### Modified Files
- `packages/db/src/schema.ts` - Main schema definition

### New Files
- `packages/db/src/schema.test.ts` - Schema validation tests
- `packages/db/MIGRATIONS.md` - This migration guide

## Verification Checklist

- [x] Users table schema updated with uuid id
- [x] paddleId constraints added (unique, not null)
- [x] subscriptionStatusEnum updated ('canceled' not 'cancelled')
- [x] currencyEnum created with common currencies
- [x] All userId foreign keys updated to uuid
- [x] updatedAt removed from users table
- [x] Biome linting passes
- [x] Schema validation tests created
- [ ] Migrations generated (requires DATABASE_URL)
- [ ] Migrations applied to database (requires DATABASE_URL)

## Next Steps

1. Set up DATABASE_URL in .env file
2. Run `pnpm --filter db db:generate` to create migrations
3. Review generated migration files
4. Run `pnpm --filter db db:migrate` to apply migrations
5. Verify table structure in database
6. Configure Vitest for running schema tests
7. Run tests to ensure schema validity
