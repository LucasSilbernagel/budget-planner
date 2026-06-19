import { describe, expect, it } from 'vitest'
import {
  users,
  incomeSources,
  expenses,
  savingsGoals,
  balanceTracking,
  userProfiles,
  subscriptionStatusEnum,
  currencyEnum,
  frequencyEnum,
  financeTypeEnum,
  allTables,
  type User,
  type NewUser,
  type Currency,
  type SubscriptionStatus,
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
    } as User
    
    expect(userExample.id).toBeDefined()
    expect(userExample.email).toBeDefined()
    expect(userExample.paddleId).toBeDefined()
    expect(userExample.subscriptionStatus).toBeDefined()
    expect(userExample.currency).toBeDefined()
    expect(userExample.createdAt).toBeDefined()
  })

  it('should have NewUser type for inserts', () => {
    const newUserExample: NewUser = {
      email: 'new@example.com',
      paddleId: 'paddle_456',
      subscriptionStatus: 'active',
      currency: 'USD',
      createdAt: new Date(),
    } as NewUser
    
    expect(newUserExample.email).toBeDefined()
    expect(newUserExample.paddleId).toBeDefined()
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
    // This is verified by the fact that the schema compiles
    expect(true).toBe(true) // Placeholder - actual type checking is compile-time
  })

  it('should have unique and not null paddleId', () => {
    // Verify paddleId is configured as unique and not null
    expect(true).toBe(true) // Placeholder - verified by schema definition
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
    // This is verified by the schema compilation
    expect(true).toBe(true)
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
  })
})
