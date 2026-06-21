# Migration: Add rateLimits Table

## Overview

This migration adds the `rateLimits` table for database-backed rate limiting in support of Story 4-3: Implement multi-device data synchronization for paid tier.

## Details

**Migration File:** `0001_add_rate_limits_table.sql`  
**Story:** 4-3-implement-multi-device-data-synchronization-for-paid-tier  
**Created:** 2026-06-20  
**Priority:** HIGH (NFR1, NFR2 compliance)

## Purpose

Implements database-backed rate limiting to:
- **Maintain data sovereignty** (NFR1, NFR2) - No external dependencies
- **Persist rate limits across server restarts** - In-memory rate limiting was flagged as a critical issue
- **Prevent rate limit bypass attacks** - Server restart no longer clears rate limiting state

## Schema Changes

### New Table: `rateLimits`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `serial` | Primary key, auto-incrementing |
| `userId` | `uuid` | Foreign key to users table (ON DELETE CASCADE) |
| `requestCount` | `integer` | Number of requests in current window |
| `windowStart` | `timestamp` | Start time of current rate limit window |
| `createdAt` | `timestamp` | When the record was created |
| `updatedAt` | `timestamp` | When the record was last updated |

### Indexes

1. **rateLimits_userId_idx** - Index on userId for fast lookups
2. **rateLimits_windowStart_idx** - Index on windowStart for window expiration queries
3. **rateLimits_userId_windowStart_idx** - Composite index for query optimization

### Foreign Key

- `rateLimits.userId` references `users.id` with `ON DELETE CASCADE`
- When a user is deleted, their rate limit entries are automatically deleted

## Configuration

Rate limiting is configured in `apps/web/src/server/api/sync.ts`:

```typescript
const RATE_LIMIT_CONFIG = {
  maxRequests: 100,      // Max requests per window
  windowMs: 60 * 1000,  // 1 minute window
}
```

## Implementation

The `checkRateLimit()` function:
1. Checks for existing rate limit entry for user within current window
2. If exists and under limit: increments request count
3. If exists and at limit: returns `allowed: false`
4. If doesn't exist: creates new entry with count = 1
5. Falls back to in-memory rate limiting if database fails

## Fallback Strategy

If the database is unavailable:
- Falls back to in-memory rate limiting array
- Logs error for debugging
- Maintains functionality even without database

## When to Apply

| Scenario | Need Migration? | Action |
|----------|----------------|--------|
| **New database** | ❌ No | Just deploy - DDL will create table |
| **Existing database** | ✅ Yes | Run migration before deploying Story 4-3 |
| **Development** | ✅ Yes | Run migration to test rate limiting |

## How to Apply

### Using Drizzle Kit

```bash
# Ensure DATABASE_URL is set in .env
pnpm --filter db db:generate  # Optional: if you want Drizzle to manage
pnpm --filter db db:migrate   # Apply all migrations
```

### Manual Application

```bash
# Apply this specific migration
psql -U username -d budget_planner -f packages/db/migrations/0001_add_rate_limits_table.sql
```

## Verification

After applying the migration:

```sql
-- Verify table exists
SELECT * FROM rateLimits LIMIT 1;

-- Verify foreign key
SELECT conname FROM pg_constraint WHERE conrelid = 'rateLimits'::regclass;

-- Verify indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'ratelimits';
```

## Rolling Back

To rollback this migration, you would need to manually drop the table:

```sql
DROP TABLE IF EXISTS "rateLimits" CASCADE;
```

**Note:** This is a safe operation as rate limit data is ephemeral and can be regenerated.

## Related Changes

- **Schema:** `packages/db/src/schema.ts` - Added `rateLimits` table definition
- **API:** `apps/web/src/server/api/sync.ts` - Updated `checkRateLimit()` to use database
- **Types:** Added `RateLimit` and `NewRateLimit` type exports

## NFR Compliance

✅ **NFR1 (Data Sovereignty):** All rate limit data stored in DanubeData PostgreSQL (Germany - EU)  
✅ **NFR2 (Zero US Data Residency):** No US-based storage or third-party dependencies  
✅ **Zero Tolerance for Data Loss:** Fallback to in-memory ensures functionality even on DB failure

## References

- **Story:** 4-3-implement-multi-device-data-synchronization-for-paid-tier.md
- **Code Review Finding:** In-Memory Rate Limiting Allows Bypass on Restart (HIGH severity)
- **Triage ID:** 4
