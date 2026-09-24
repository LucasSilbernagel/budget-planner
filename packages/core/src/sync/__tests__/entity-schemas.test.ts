/**
 * The per-entity sync schemas, run against REAL pulled-row shapes (Story 66.2, FR103).
 *
 * ## Why this file exists
 *
 * `types.ts`'s per-entity schemas (`incomeSourceSchema`, `expenseSchema`,
 * `savingsGoalSchema`, `balanceTrackingSchema`, `userProfileSchema`,
 * `categorySchema`) were declared for parity and, until this story, imported by
 * no PRODUCTION code. (Not "nothing" — `ends-before-retirement-gates.test.ts`
 * already reached `expenseSchema` through a dynamic `await import`. The story
 * first recorded the stronger claim; its code review caught it, the same way
 * 66.1's review caught a claim that had checked static importers only.)
 * Story 66.2 gives them their first real consumer: `apps/web/src/lib/sync/applyServerChanges.ts` validates every pulled
 * server row against them before writing it into a client store.
 *
 * ⚠️⚠️ That exposed three disagreements between these schemas and the DATABASE
 * COLUMNS they mirror. None had ever fired, because the only path that ran a zod
 * gate was PUSH — and `toServerPayload` omits a null rather than sending one
 * (`syncBridge.ts`, `if (entity['description'] != null)`). A PULLED row is the
 * whole drizzle row, so it carries every null the column allows:
 *
 *   1. `savingsGoals.targetAmount` is NULLABLE — "null ⇒ savings account, no
 *      target" (story 16-1). The schema required a number, so it rejected EVERY
 *      savings account.
 *   2. `userProfiles.description` is NULLABLE, and `.optional()` does NOT accept
 *      `null` — only an absent key. Drizzle returns `null`, so the schema
 *      rejected nearly every profile.
 *   3. `userProfiles.currency` has NO `.notNull()`, so a null is storable, and
 *      the schema required the enum.
 *
 * A false rejection here is worse than the defect the story fixes: the guard
 * would silently refuse the user's legitimate rows. These cases are the
 * regression fence around that.
 *
 * ## Shape discipline
 *
 * Every fixture below is the WHOLE row as `getSyncChanges` emits it (`data: row`)
 * after JSON transport — so `createdAt`/`updatedAt` are ISO STRINGS, `userId` is
 * a uuid STRING (not the client store type's number), and `profileId`,
 * `sortOrder`, `categoryId` and `isDeleted` all ride along. A fixture that is not
 * production-shaped proves nothing about production.
 */

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

/** Columns every synced entity row carries back from a pull. */
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
    // packages/db/src/schema.ts — `targetAmount: integer('targetAmount')`, nullable.
    // "null ⇒ savings account (no target); a positive int ⇒ goal" (story 16-1).
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
    // `.optional()` accepts an ABSENT key, never an explicit `null`. The column is
    // `text('description')` — nullable — and drizzle returns `null`.
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
    // `800000 + "300000"` is a STRING CONCATENATION, so netWorthFromTotals returns
    // a large, finite, entirely plausible wrong number (deferred-work.md:1031).
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
    // `z.number()` alone ACCEPTS Infinity; `.int()` is what closes it. Every money
    // field in these schemas is `.int()`, so this is the contract, not an accident.
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
    // ⚠️ This is what `syncOperationDataSchema` (the PUSH queue gate) cannot do:
    // every field there is `.optional()`, so it accepts `{}`. That asymmetry is
    // why the per-entity schemas are the right gate for a PULLED row.
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
    // The applier uses `safeParse` for the VERDICT ONLY and writes
    // `{ ...change.data, id }` unchanged. Writing the parse output would delete
    // `profileId` (profile-scoped reads, story 54.4) and `sortOrder` (ordering,
    // story 34.1a) from every synced row.
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
  // `.default(x)` makes a key OPTIONAL on input. Before the code review of 66.2
  // every schema below used one, so a row that simply omitted its balance passed
  // the guard, entered the store with the key absent, and made
  // `sum + entry.currentBalance` produce NaN — the same failure class the gate
  // exists to stop.
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
  // The lockout this pins: `userProfileSchema.currency` carried 11 of the
  // column's 21 values, while the Paddle webhook writes any of the 21 onto
  // `users.currency` and the default profile copies it. A profile billed in PLN
  // was refused on pull, so `reconcileActiveProfile` never ran and the push
  // bridge never registered — a permanent sync deadlock behind a console.warn.
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
