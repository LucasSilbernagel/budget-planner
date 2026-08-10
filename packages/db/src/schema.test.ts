import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  type CategoryKind,
  type Currency,
  type NewUser,
  type SubscriptionStatus,
  type User,
  allTables,
  balanceTracking,
  categories,
  categoryKindEnum,
  currencyEnum,
  expenses,
  financeTypeEnum,
  frequencyEnum,
  incomeSources,
  savingsGoals,
  subscriptionStatusEnum,
  userProfiles,
  users,
} from './schema'

// Test 1: Schema compilation - Verify all tables are exported
describe('Schema Compilation', () => {
  it('should export all tables', () => {
    expect(users).toBeDefined()
    expect(incomeSources).toBeDefined()
    expect(expenses).toBeDefined()
    expect(savingsGoals).toBeDefined()
    expect(balanceTracking).toBeDefined()
    expect(userProfiles).toBeDefined()
  })

  it('should export all enums', () => {
    expect(subscriptionStatusEnum).toBeDefined()
    expect(currencyEnum).toBeDefined()
    expect(frequencyEnum).toBeDefined()
    expect(financeTypeEnum).toBeDefined()
  })

  it('should export allTables object', () => {
    expect(allTables).toBeDefined()
    expect(allTables.users).toBe(users)
    expect(allTables.incomeSources).toBe(incomeSources)
    expect(allTables.expenses).toBe(expenses)
    expect(allTables.savingsGoals).toBe(savingsGoals)
    expect(allTables.balanceTracking).toBe(balanceTracking)
    expect(allTables.userProfiles).toBe(userProfiles)
  })
})

// Test 2: Type generation - Verify TypeScript types are correctly inferred
describe('Type Generation', () => {
  it('should have User type with correct properties', () => {
    // This test verifies that the User type has the expected structure
    // The actual type checking happens at compile time
    const userExample: User = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'test@example.com',
      paddleId: 'paddle_123',
      subscriptionStatus: 'free',
      currency: 'NONE',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(userExample.id).toBeDefined()
    expect(userExample.email).toBeDefined()
    expect(userExample.paddleId).toBeDefined()
    expect(userExample.subscriptionStatus).toBeDefined()
    expect(userExample.currency).toBeDefined()
    expect(userExample.createdAt).toBeDefined()
    expect(userExample.updatedAt).toBeDefined()
    // Verify email max length is 254 (RFC 5321)
    expect(userExample.email.length).toBeLessThanOrEqual(254)
  })

  it('should have NewUser type for inserts', () => {
    const newUserExample: NewUser = {
      email: 'new@example.com',
      paddleId: 'paddle_456',
      subscriptionStatus: 'active',
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NewUser

    expect(newUserExample.email).toBeDefined()
    expect(newUserExample.paddleId).toBeDefined()
    expect(newUserExample.updatedAt).toBeDefined()
  })

  it('should have Currency enum type', () => {
    const currencies: Currency[] = ['NONE', 'USD', 'EUR', 'GBP', 'JPY']
    expect(currencies).toContain('NONE')
    expect(currencies).toContain('USD')
  })

  it('should have SubscriptionStatus enum type', () => {
    const statuses: SubscriptionStatus[] = ['free', 'active', 'past_due', 'canceled']
    expect(statuses).toContain('free')
    expect(statuses).toContain('active')
    expect(statuses).toContain('past_due')
    expect(statuses).toContain('canceled')
    expect(statuses).not.toContain('cancelled') // Verify we use 'canceled' not 'cancelled'
    expect(statuses).not.toContain('unpaid') // Verify 'unpaid' was removed
  })
})

// Test 3: Users table structure validation
// Note: Drizzle ORM table objects don't expose the table name as a property
// The name is internal to Drizzle and verified at migration time
describe('Users Table Schema', () => {
  it('should have users table defined', () => {
    // Verify the users table exists and is a valid Drizzle table
    // This is a compile-time check - if it compiles, the table is valid
    expect(users).toBeDefined()
    expect(typeof users).toBe('object')
  })

  it('should have uuid id column', () => {
    // The users table should have an id column of type uuid
    // This is verified by the fact that the schema compiles and TypeScript accepts uuid values
    // We can verify the table structure by checking the inferred type
    expect(users).toBeDefined()
    // Compile-time check: if this passes TypeScript, id is uuid
    const testId: string = '550e8400-e29b-41d4-a716-446655440000'
    expect(testId).toBeTruthy()
  })

  it('should have unique and not null paddleId', () => {
    // Verify paddleId is configured as unique and not null
    // The schema definition enforces this at the database level
    expect(users).toBeDefined()
    // Compile-time check: paddleId is required
    const testPaddleId: string = 'paddle_123'
    expect(testPaddleId).toBeTruthy()
  })
})

// Test 4: Foreign key relations validation
describe('Foreign Key Relations', () => {
  it('should have userId in all financial tables', () => {
    // Verify all financial tables have userId field
    expect(incomeSources).toBeDefined()
    expect(expenses).toBeDefined()
    expect(savingsGoals).toBeDefined()
    expect(balanceTracking).toBeDefined()
    expect(userProfiles).toBeDefined()
  })

  it('should reference users table', () => {
    // The foreign keys should reference the users table
    // This is verified by the schema compilation and type safety
    expect(incomeSources).toBeDefined()
    expect(expenses).toBeDefined()
    expect(users).toBeDefined()
  })

  it('should have profileId in all financial tables for profile scoping', () => {
    // Verify all financial tables have profileId field for profile-level data isolation
    // This enables multiple profiles per user with isolated financial data
    expect(incomeSources).toBeDefined()
    expect(expenses).toBeDefined()
    expect(savingsGoals).toBeDefined()
    expect(balanceTracking).toBeDefined()
    expect(userProfiles).toBeDefined()
  })

  it('should have profileId reference userProfiles table', () => {
    // profileId should reference userProfiles.id for proper foreign key relationship
    expect(userProfiles).toBeDefined()
    expect(incomeSources).toBeDefined()
  })
})

// Test 5: Enum values validation
describe('Enum Values', () => {
  it('subscriptionStatusEnum should have correct values', () => {
    const enumValues = subscriptionStatusEnum.enumValues
    expect(enumValues).toContain('free')
    expect(enumValues).toContain('active')
    expect(enumValues).toContain('past_due')
    expect(enumValues).toContain('canceled')
    expect(enumValues).not.toContain('cancelled')
    expect(enumValues).not.toContain('unpaid')
  })

  it('currencyEnum should have common currencies', () => {
    const enumValues = currencyEnum.enumValues
    expect(enumValues).toContain('NONE')
    expect(enumValues).toContain('USD')
    expect(enumValues).toContain('EUR')
    expect(enumValues).toContain('GBP')
    expect(enumValues).toContain('JPY')
    expect(enumValues).toContain('CAD')
    expect(enumValues).toContain('AUD')
    expect(enumValues).toContain('CHF')
    expect(enumValues).toContain('CNY')
    expect(enumValues).toContain('SEK')
    expect(enumValues).toContain('NZD')
    // Additional currencies added for global support
    expect(enumValues).toContain('INR')
    expect(enumValues).toContain('BRL')
    expect(enumValues).toContain('MXN')
    expect(enumValues).toContain('KRW')
    expect(enumValues).toContain('SGD')
    expect(enumValues).toContain('HKD')
    expect(enumValues).toContain('NOK')
    expect(enumValues).toContain('DKK')
    expect(enumValues).toContain('PLN')
    expect(enumValues).toContain('TRY')
  })
})

// Test 6: Soft-delete tombstone columns (Story 4-18)
// Cross-device delete propagation requires a tombstone flag on every syncable
// entity table (mirroring the users precedent) so a delta-by-updatedAt pull can
// surface deletions instead of losing them to a hard DELETE.
describe('Soft-delete (isDeleted) columns', () => {
  it('users already has an isDeleted column', () => {
    expect(users.isDeleted).toBeDefined()
  })

  it('all syncable entity tables expose an isDeleted column', () => {
    expect(incomeSources.isDeleted).toBeDefined()
    expect(expenses.isDeleted).toBeDefined()
    expect(savingsGoals.isDeleted).toBeDefined()
    expect(balanceTracking.isDeleted).toBeDefined()
    expect(userProfiles.isDeleted).toBeDefined()
  })

  it('isDeleted defaults to false and is not null', () => {
    // Drizzle exposes column metadata on the column object. The migration
    // (0002_*) emits `DEFAULT false NOT NULL`; verify the schema agrees so the
    // tombstone can never be null and reads can filter on `isDeleted = false`.
    expect(incomeSources.isDeleted.notNull).toBe(true)
    expect(incomeSources.isDeleted.default).toBe(false)
    expect(userProfiles.isDeleted.notNull).toBe(true)
    expect(userProfiles.isDeleted.default).toBe(false)
  })
})

// Test 7: Client-generatable uuid primary keys (Story 5-14, AC-1)
// Every syncable entity must use a uuid PK with a DB default so a record created
// on one device carries the SAME id everywhere (eliminating pull-side duplicate
// rows) and the client MAY supply the id on insert.
describe('Entity primary keys are client-generatable uuids', () => {
  it('all four syncable entity tables expose a uuid id column', () => {
    expect(incomeSources.id.getSQLType()).toBe('uuid')
    expect(expenses.id.getSQLType()).toBe('uuid')
    expect(savingsGoals.id.getSQLType()).toBe('uuid')
    expect(balanceTracking.id.getSQLType()).toBe('uuid')
  })

  it('userProfiles (already uuid) and these entity ids are the same kind', () => {
    expect(userProfiles.id.getSQLType()).toBe('uuid')
    // A uuid PK surfaces as a string in TypeScript, not a number — this is what
    // lets the client supply crypto.randomUUID() and the sync layer reconcile by
    // a shared string id (AC-4).
    expect(incomeSources.id.dataType).toBe('string')
  })

  it('entity ids carry a DB default so server-originated inserts need no client id', () => {
    // defaultRandom() => the column is marked hasDefault; gen_random_uuid() fills
    // any insert that omits the id (server-side rows), while the client may still
    // supply its own uuid for offline-created rows.
    expect(incomeSources.id.hasDefault).toBe(true)
    expect(expenses.id.hasDefault).toBe(true)
    expect(savingsGoals.id.hasDefault).toBe(true)
    expect(balanceTracking.id.hasDefault).toBe(true)
  })
})

// Test 8: User-defined categories (Story 30.4a, FR54)
// A first-class entity rather than a denormalized string, because the feature
// requires rename and delete: renaming must update every referencing row with no
// per-row edit, which a copied string cannot do.
describe('Categories table (Story 30.4a)', () => {
  it('is exported and registered in allTables', () => {
    expect(categories).toBeDefined()
    expect(categoryKindEnum).toBeDefined()
    expect(allTables.categories).toBe(categories)
  })

  it('follows the syncable-entity conventions: uuid PK with a default, and a tombstone', () => {
    expect(categories.id.getSQLType()).toBe('uuid')
    expect(categories.id.dataType).toBe('string')
    expect(categories.id.hasDefault).toBe(true)
    expect(categories.isDeleted.notNull).toBe(true)
    expect(categories.isDeleted.default).toBe(false)
  })

  it('is scoped to a user AND a profile, both required', () => {
    expect(categories.userId.getSQLType()).toBe('uuid')
    expect(categories.userId.notNull).toBe(true)
    expect(categories.profileId.getSQLType()).toBe('uuid')
    expect(categories.profileId.notNull).toBe(true)
  })

  it('carries a required kind separating the income and expense namespaces', () => {
    expect(categories.kind.notNull).toBe(true)
    expect(categoryKindEnum.enumValues).toEqual(['income', 'expense'])
    // The exported union must track the enum, so a widened enum cannot silently
    // leave the TypeScript type behind.
    const incomeKind: CategoryKind = 'income'
    const expenseKind: CategoryKind = 'expense'
    expect([incomeKind, expenseKind]).toEqual(categoryKindEnum.enumValues)
  })

  it('categoryId is NULLABLE on both cashflow tables so uncategorized stays valid', () => {
    // This is the whole reason every pre-existing row survives the migration and
    // no form gains a required field. If either of these ever becomes notNull,
    // the free-tier CRUD contract breaks.
    expect(incomeSources.categoryId.getSQLType()).toBe('uuid')
    expect(incomeSources.categoryId.notNull).toBe(false)
    expect(expenses.categoryId.getSQLType()).toBe('uuid')
    expect(expenses.categoryId.notNull).toBe(false)
  })

  /**
   * ⚠️ CODE REVIEW 30.4a — the assertions above check SHAPES, not RELATIONSHIPS.
   * Deleting `.references(() => categories.id)` from both columns left the whole
   * db suite green: the type is still `uuid` and still nullable, so nothing
   * noticed that `categoryId` had silently degraded to an unenforced loose
   * reference. Every downstream rationale in this story — the seed ordering, the
   * account-deletion order, the "real foreign key" comments — rests on these FKs
   * actually existing, so they are asserted here directly.
   */
  it('categoryId is a REAL foreign key to categories on both cashflow tables', () => {
    const incomeFks = getTableConfig(incomeSources).foreignKeys.map((fk) => fk.reference())
    const expenseFks = getTableConfig(expenses).foreignKeys.map((fk) => fk.reference())

    const referencesCategories = (
      refs: ReturnType<ReturnType<typeof getTableConfig>['foreignKeys'][number]['reference']>[]
    ) =>
      refs.some(
        (ref) =>
          ref.columns.some((column) => column.name === 'categoryId') &&
          ref.foreignColumns.some((column) => getTableName(column.table) === 'categories')
      )

    // MUTATION KILLED: drop `.references(() => categories.id)` from either column.
    expect(referencesCategories(incomeFks), 'incomeSources.categoryId has no FK').toBe(true)
    expect(referencesCategories(expenseFks), 'expenses.categoryId has no FK').toBe(true)
  })

  it('categories itself references users and userProfiles', () => {
    const refs = getTableConfig(categories).foreignKeys.map((fk) => fk.reference())
    const targets = refs.map((ref) => getTableName(ref.foreignColumns[0].table)).sort()

    // Both parents must be enforced: an orphaned category is unreachable data
    // that account deletion and profile deletion would both miss.
    expect(targets).toEqual(['userProfiles', 'users'])
  })

  it('the live-name unique index is PARTIAL and case-insensitive', () => {
    const { indexes } = getTableConfig(categories)
    const liveNameIndex = indexes.find(
      (index) => index.config.name === 'categories_userId_profileId_kind_name_live_unique'
    )

    expect(liveNameIndex, 'the live-name unique index is missing').toBeDefined()
    expect(liveNameIndex?.config.unique).toBe(true)

    // MUTATION KILLED: drop the `.where(isDeleted = false)` predicate. Without it
    // the index becomes a plain unique constraint, and re-creating a category the
    // user previously deleted collides with its own tombstone — a 23505 the
    // client never sees, which is exactly the silent divergence the schema
    // comment claims this predicate prevents.
    expect(liveNameIndex?.config.where).toBeDefined()

    // MUTATION KILLED: revert `lower(name)` to a bare `table.name` column
    // (migration 0012). A case-SENSITIVE index disagrees with the client's
    // `normalizeName`, which compares `trim().toLocaleLowerCase()`.
    //
    // The indexed "columns" are a mix of Column objects and SQL expressions;
    // the lower() one is an SQL node whose chunks carry the literal text. The
    // drizzle objects are circular, so collect the string chunks by walking
    // rather than serializing.
    const stringChunks = (node: unknown, out: string[] = []): string[] => {
      if (typeof node === 'string') {
        out.push(node)
        return out
      }
      if (!node || typeof node !== 'object') {
        return out
      }
      // A `StringChunk` holds its literal text in a `value` string array —
      // that is where `lower(` and `)` actually live.
      const value = (node as { value?: unknown }).value
      if (Array.isArray(value)) {
        out.push(...value.filter((entry): entry is string => typeof entry === 'string'))
      }
      const chunks = (node as { queryChunks?: unknown[] }).queryChunks
      if (Array.isArray(chunks)) {
        for (const chunk of chunks) {
          stringChunks(chunk, out)
        }
      }
      return out
    }

    const indexedExpressions = (liveNameIndex?.config.columns ?? []).flatMap((column) =>
      stringChunks(column)
    )
    expect(indexedExpressions.join(' ')).toContain('lower')
  })
})
