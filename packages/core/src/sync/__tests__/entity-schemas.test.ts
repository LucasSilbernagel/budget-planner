// Fixtures are whole pulled rows after JSON transport (ISO string dates, nullable columns
// as null): a fixture that isn't production-shaped proves nothing.

import { currencyEnum } from '@budget-planner/db'
import { describe, expect, it } from 'vitest'
import {
  SYNC_CURRENCIES,
  balanceTrackingSchema,
  categorySchema,
  expenseSchema,
  incomeSourceSchema,
  savingsGoalSchema,
  userProfileSchema,
} from '../types'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '22222222-2222-4222-8222-222222222222'
const ROW_ID = '33333333-3333-4333-8333-333333333333'
const ISO = '2026-09-01T00:00:00.000Z'

const rowChrome = {
  id: ROW_ID,
  userId: USER_ID,
  profileId: PROFILE_ID,
  isDeleted: false,
  createdAt: ISO,
  updatedAt: ISO,
}

describe('per-entity schemas accept a healthy pulled row (the control)', () => {
  it('incomeSource', () => {
    expect(
      incomeSourceSchema.safeParse({
        ...rowChrome,
        name: 'Salary',
        amount: 500_000,
        frequency: 'monthly',
        categoryId: null,
        sortOrder: 0,
      }).success
    ).toBe(true)
  })

  it('expense', () => {
    expect(
      expenseSchema.safeParse({
        ...rowChrome,
        name: 'Rent',
        amount: 180_000,
        frequency: 'monthly',
        endsBeforeRetirement: false,
        categoryId: null,
        sortOrder: 0,
      }).success
    ).toBe(true)
  })

  it('balanceTracking', () => {
    expect(
      balanceTrackingSchema.safeParse({
        ...rowChrome,
        type: 'investment',
        name: 'Brokerage',
        currentBalance: 300_000,
        monthlyContribution: 50_000,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
        sortOrder: 0,
      }).success
    ).toBe(true)
  })

  it('category', () => {
    expect(
      categorySchema.safeParse({ ...rowChrome, name: 'Groceries', kind: 'expense' }).success
    ).toBe(true)
  })
})

describe('⚠️ nullable COLUMNS must not be false-rejected (story 66.2)', () => {
  it('savingsGoal: targetAmount null is a savings ACCOUNT, not a malformed row', () => {
    const result = savingsGoalSchema.safeParse({
      ...rowChrome,
      name: 'Emergency fund',
      targetAmount: null,
      currentBalance: 250_000,
      monthlyAllocation: null,
      allocationMode: 'automatic',
      sortOrder: 0,
    })
    expect(result.success).toBe(true)
  })

  it('savingsGoal: a positive targetAmount is still a GOAL', () => {
    expect(
      savingsGoalSchema.safeParse({
        ...rowChrome,
        name: 'New car',
        targetAmount: 2_000_000,
        currentBalance: 250_000,
        monthlyAllocation: null,
        allocationMode: 'automatic',
        sortOrder: 0,
      }).success
    ).toBe(true)
  })

  it('userProfile: description null (the normal state) is accepted', () => {
    // `.optional()` accepts an absent key, never `null`; drizzle returns `null`.
    const result = userProfileSchema.safeParse({
      id: PROFILE_ID,
      userId: USER_ID,
      name: 'Main Profile',
      description: null,
      isDefault: true,
      currency: 'USD',
      icon: null,
      isDeleted: false,
      createdAt: ISO,
      updatedAt: ISO,
    })
    expect(result.success).toBe(true)
  })

  it('userProfile: currency null is accepted (the column has no NOT NULL)', () => {
    const result = userProfileSchema.safeParse({
      id: PROFILE_ID,
      userId: USER_ID,
      name: 'Main Profile',
      description: 'Household',
      isDefault: true,
      currency: null,
      icon: null,
      isDeleted: false,
      createdAt: ISO,
      updatedAt: ISO,
    })
    expect(result.success).toBe(true)
  })

  it('userProfile: an ABSENT description still works (the .optional() half)', () => {
    expect(
      userProfileSchema.safeParse({
        id: PROFILE_ID,
        userId: USER_ID,
        name: 'Main Profile',
        isDefault: false,
        currency: 'EUR',
        isDeleted: false,
        createdAt: ISO,
        updatedAt: ISO,
      }).success
    ).toBe(true)
  })
})

describe('⚠️ the corrupt-row class these schemas exist to stop (AC-3)', () => {
  it('rejects a STRING currentBalance — the concatenation mode, no NaN to flag it', () => {
    // `800000 + "300000"` concatenates, giving a plausible wrong number.
    expect(
      balanceTrackingSchema.safeParse({
        ...rowChrome,
        type: 'investment',
        name: 'Brokerage',
        currentBalance: '300000',
        monthlyContribution: 0,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
        sortOrder: 0,
      }).success
    ).toBe(false)
  })

  it('rejects a STRING amount on a cashflow row', () => {
    expect(
      incomeSourceSchema.safeParse({
        ...rowChrome,
        name: 'Salary',
        amount: '500000',
        frequency: 'monthly',
      }).success
    ).toBe(false)
  })

  it('rejects a non-finite amount (Infinity), which plain z.number() would allow', () => {
    // `z.number()` alone accepts Infinity; `.int()` closes it.
    expect(
      incomeSourceSchema.safeParse({
        ...rowChrome,
        name: 'Salary',
        amount: Number.POSITIVE_INFINITY,
        frequency: 'monthly',
      }).success
    ).toBe(false)
  })

  it('rejects an unknown frequency', () => {
    expect(
      incomeSourceSchema.safeParse({
        ...rowChrome,
        name: 'Salary',
        amount: 500_000,
        frequency: 'fortnightly',
      }).success
    ).toBe(false)
  })

  it('rejects a row missing its required fields entirely', () => {
    // The push gate's all-optional schema accepts `{}`, which is why pulled rows use these.
    expect(incomeSourceSchema.safeParse({ ...rowChrome }).success).toBe(false)
  })
})

describe('these schemas are NOT a reshaper — extra columns are ignored, not rejected', () => {
  it('a pulled row keeps passing when the server adds a column the schema does not know', () => {
    expect(
      incomeSourceSchema.safeParse({
        ...rowChrome,
        name: 'Salary',
        amount: 500_000,
        frequency: 'monthly',
        somethingAddedLater: 'whatever',
      }).success
    ).toBe(true)
  })

  it('⚠️ but .parse() STRIPS those keys — which is why the applier must never write its output', () => {
    // The applier uses safeParse for the verdict only: writing the parse output would strip
    // `profileId` and `sortOrder` from every synced row.
    const parsed = incomeSourceSchema.parse({
      ...rowChrome,
      name: 'Salary',
      amount: 500_000,
      frequency: 'monthly',
      sortOrder: 7,
    })
    expect(parsed).not.toHaveProperty('profileId')
    expect(parsed).not.toHaveProperty('sortOrder')
  })
})

describe('⚠️⚠️ the REQUIRED/NULLABLE rule: a NOT NULL column may not be omitted', () => {
  // `.default(x)` makes a key optional on input, letting a balance-less row through to NaN sums.
  it('balanceTracking: a row with NO currentBalance is refused', () => {
    expect(
      balanceTrackingSchema.safeParse({
        ...rowChrome,
        type: 'investment',
        name: 'Brokerage',
        monthlyContribution: 0,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
      }).success
    ).toBe(false)
  })

  it('balanceTracking: a row with NO frequency or contribution flag is refused', () => {
    expect(
      balanceTrackingSchema.safeParse({
        ...rowChrome,
        type: 'investment',
        name: 'Brokerage',
        currentBalance: 1,
      }).success
    ).toBe(false)
  })

  it('savingsGoal: a row with NO currentBalance is refused', () => {
    expect(
      savingsGoalSchema.safeParse({
        ...rowChrome,
        name: 'Fund',
        targetAmount: null,
        monthlyAllocation: null,
        allocationMode: 'automatic',
      }).success
    ).toBe(false)
  })

  it('savingsGoal: a NEGATIVE currentBalance is refused, and balanceTracking still ACCEPTS one (story 66.5)', () => {
    // Savings balances mirror a DB >= 0 constraint; balanceTracking stays negative-capable.
    // The second assertion stops anyone aligning the two.
    expect(
      savingsGoalSchema.safeParse({
        ...rowChrome,
        name: 'Overdrawn',
        targetAmount: null,
        currentBalance: -1,
        monthlyAllocation: null,
        allocationMode: 'automatic',
      }).success
    ).toBe(false)

    expect(
      savingsGoalSchema.safeParse({
        ...rowChrome,
        name: 'Brand new',
        targetAmount: null,
        currentBalance: 0,
        monthlyAllocation: null,
        allocationMode: 'automatic',
      }).success
    ).toBe(true)

    expect(
      balanceTrackingSchema.safeParse({
        ...rowChrome,
        type: 'debt',
        name: 'Mortgage',
        currentBalance: -250_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
      }).success
    ).toBe(true)
  })

  it('savingsGoal: a row with NO allocationMode is refused', () => {
    expect(
      savingsGoalSchema.safeParse({
        ...rowChrome,
        name: 'Fund',
        targetAmount: null,
        currentBalance: 1,
        monthlyAllocation: null,
      }).success
    ).toBe(false)
  })

  it('expense: a row with NO endsBeforeRetirement is refused', () => {
    expect(
      expenseSchema.safeParse({
        ...rowChrome,
        name: 'Rent',
        amount: 1,
        frequency: 'monthly',
      }).success
    ).toBe(false)
  })

  it('userProfile: a row with NO isDefault is refused', () => {
    expect(
      userProfileSchema.safeParse({
        id: PROFILE_ID,
        userId: USER_ID,
        name: 'Main Profile',
        description: null,
        currency: 'USD',
        icon: null,
      }).success
    ).toBe(false)
  })
})

describe('⚠️⚠️ currency parity with the DATABASE enum', () => {
  // A currency missing here refused that profile on pull: a permanent sync deadlock.
  it('SYNC_CURRENCIES matches currencyEnum exactly, in the same order', () => {
    expect([...SYNC_CURRENCIES]).toEqual([...currencyEnum.enumValues])
  })

  it('every DB currency is accepted on a pulled profile', () => {
    for (const currency of currencyEnum.enumValues) {
      const result = userProfileSchema.safeParse({
        id: PROFILE_ID,
        userId: USER_ID,
        name: 'Main Profile',
        description: null,
        isDefault: true,
        currency,
        icon: null,
      })
      expect(result.success, `currency ${currency} must be accepted`).toBe(true)
    }
  })

  it('a currency the DB cannot hold is still refused', () => {
    expect(
      userProfileSchema.safeParse({
        id: PROFILE_ID,
        userId: USER_ID,
        name: 'Main Profile',
        description: null,
        isDefault: true,
        currency: 'XYZ',
        icon: null,
      }).success
    ).toBe(false)
  })
})
