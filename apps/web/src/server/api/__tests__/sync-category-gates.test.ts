// One op with an unrecognised entityType fails the whole batch, so these gates fail silently
// and destructively.

import type { SyncEntityType } from '@budget-planner/core'
import { subscriptionStatusEnum } from '@budget-planner/db'
import { getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  PAID_ACCESS_STATUSES,
  PREMIUM_FEATURE_STATUSES,
  hasPaidAccess,
} from '../../../lib/premium/access-statuses'
import { batchSyncRequestSchema, entityTableMap, syncOperationSchema } from '../sync'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CATEGORY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const op = (overrides: Record<string, unknown>) => ({
  id: 'op-1',
  type: 'create',
  entityId: ROW_ID,
  timestamp: 1_700_000_000_000,
  deviceId: 'device-1',
  userId: USER_ID,
  ...overrides,
})

const categoryOp = () =>
  op({
    id: 'op-cat',
    entityType: 'category',
    entityId: CATEGORY_ID,
    data: { name: 'Groceries', kind: 'expense', userId: USER_ID },
  })

const incomeOp = () =>
  op({
    id: 'op-inc',
    entityType: 'incomeSource',
    data: {
      name: 'Salary',
      amount: 500000,
      frequency: 'monthly',
      categoryId: CATEGORY_ID,
      userId: USER_ID,
    },
  })

describe('syncOperationSchema — the category entity type is accepted', () => {
  it('accepts a well-formed category operation', () => {
    expect(syncOperationSchema.safeParse(categoryOp()).success).toBe(true)
  })

  it('rejects a category whose kind is not a real ledger side', () => {
    const bad = op({
      entityType: 'category',
      data: { name: 'Groceries', kind: 'liability', userId: USER_ID },
    })
    const result = syncOperationSchema.safeParse(bad)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['data', 'kind'])
  })

  it('rejects a category with an empty name', () => {
    const bad = op({
      entityType: 'category',
      data: { name: '', kind: 'expense', userId: USER_ID },
    })
    const result = syncOperationSchema.safeParse(bad)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['data', 'name'])
  })

  it('still rejects a genuinely unknown entity type (the enum was widened, not removed)', () => {
    // Negative control: the enum is not a passthrough.
    const bad = op({ entityType: 'notAnEntity', data: { name: 'x', userId: USER_ID } })
    expect(syncOperationSchema.safeParse(bad).success).toBe(false)
  })
})

describe('batchSyncRequestSchema — one category operation must not poison the batch', () => {
  it('a MIXED batch containing a category op still validates as a whole', () => {
    // z.array fails atomically: without 'category' in the enum the valid income op fails too.
    const parsed = batchSyncRequestSchema.safeParse({
      operations: [categoryOp(), incomeOp()],
      clientTimestamp: 1_700_000_000_000,
      deviceId: 'device-1',
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.operations).toHaveLength(2)
  })

  it('a batch of ONLY category operations validates', () => {
    const parsed = batchSyncRequestSchema.safeParse({
      operations: [categoryOp()],
      clientTimestamp: 1_700_000_000_000,
      deviceId: 'device-1',
    })
    expect(parsed.success).toBe(true)
  })

  it('demonstrates the atomic-failure hazard: one bad op fails the whole batch', () => {
    const parsed = batchSyncRequestSchema.safeParse({
      operations: [incomeOp(), op({ entityType: 'notAnEntity', data: {} })],
      clientTimestamp: 1_700_000_000_000,
      deviceId: 'device-1',
    })
    expect(parsed.success).toBe(false)
  })
})

describe('a cashflow operation may carry a categoryId (AC-5)', () => {
  it('accepts a concrete category reference', () => {
    expect(syncOperationSchema.safeParse(incomeOp()).success).toBe(true)
  })

  it('accepts an explicit null — un-categorizing must reach the server', () => {
    const clearing = op({
      type: 'update',
      entityType: 'expense',
      data: {
        name: 'Rent',
        amount: 150000,
        frequency: 'monthly',
        categoryId: null,
        userId: USER_ID,
      },
    })
    expect(syncOperationSchema.safeParse(clearing).success).toBe(true)
  })

  it('rejects a categoryId that is not a uuid', () => {
    const bad = op({
      entityType: 'expense',
      data: {
        name: 'Rent',
        amount: 150000,
        frequency: 'monthly',
        categoryId: 'not-a-uuid',
        userId: USER_ID,
      },
    })
    const result = syncOperationSchema.safeParse(bad)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['data', 'categoryId'])
  })
})

describe('entityTableMap — every syncable entity resolves to a table (AC-6)', () => {
  // `satisfies` alone accepts a subset; the `Missing` check makes tsc reject an omitted member.
  const ALL_SYNC_ENTITIES = [
    'incomeSource',
    'expense',
    'savingsGoal',
    'balanceTracking',
    'userProfile',
    'category',
    'retirementPlan',
  ] as const satisfies readonly SyncEntityType[]
  type Missing = Exclude<SyncEntityType, (typeof ALL_SYNC_ENTITIES)[number]>
  const listIsExhaustive: [Missing] extends [never] ? true : false = true

  it('has an entry for every SyncEntityType', () => {
    expect(listIsExhaustive).toBe(true)
    for (const entityType of ALL_SYNC_ENTITIES) {
      expect(entityTableMap[entityType], `no table mapped for '${entityType}'`).toBeDefined()
    }
  })

  it('maps category to the categories table specifically', () => {
    // A wrong mapping is as broken as a missing one, and the assertion above would not notice.
    expect(getTableName(entityTableMap.category)).toBe('categories')
  })

  it('maps retirementPlan to the retirementPlans table specifically (story 99.2)', () => {
    expect(getTableName(entityTableMap.retirementPlan)).toBe('retirementPlans')
  })

  it('the server entityType enum is EXACTLY the core union, both ways (story 99.2, AC-5b)', () => {
    const serverEnum = syncOperationSchema.innerType().shape.entityType.options
    expect([...serverEnum].sort()).toEqual([...ALL_SYNC_ENTITIES].sort())
  })

  it('contains no entry that is not a SyncEntityType', () => {
    expect(Object.keys(entityTableMap).sort()).toEqual([...ALL_SYNC_ENTITIES].sort())
  })
})

describe('the sync gate (hasPaidAccess) — every premium-bearing status may sync (AC-8)', () => {
  it('contains only real subscription statuses', () => {
    for (const status of PAID_ACCESS_STATUSES) {
      expect(subscriptionStatusEnum.enumValues).toContain(status)
    }
  })

  it('includes every status that grants premium access', () => {
    // Sync is more lenient than premium (past_due), so the invariant is one-directional.
    for (const premiumStatus of PREMIUM_FEATURE_STATUSES) {
      expect(hasPaidAccess(premiumStatus)).toBe(true)
    }
  })

  it('permits exactly active, past_due and lifetime', () => {
    expect([...PAID_ACCESS_STATUSES].sort()).toEqual(['active', 'lifetime', 'past_due'])
  })

  it('permits a lifetime subscriber', () => {
    expect(hasPaidAccess('lifetime')).toBe(true)
  })

  it('still excludes the non-paying statuses', () => {
    for (const status of ['free', 'canceled']) {
      expect(hasPaidAccess(status)).toBe(false)
    }
  })
})
