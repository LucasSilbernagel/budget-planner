/**
 * Server-side sync gates for the category entity (Story 30.4a, AC-6 / AC-8).
 *
 * Two gates are covered here, both of which fail SILENTLY and destructively if
 * a new entity type is added without touching them.
 *
 * 1. `syncOperationSchema.entityType` is a HARD-CODED z.enum, not derived from
 *    core's `SyncEntityType`. Because `batchSyncRequestSchema` applies it via
 *    `z.array(...)`, ONE operation with an unrecognised entityType fails the
 *    ENTIRE batch — `processBatchSync` then returns processedCount 0 with an
 *    empty failedOperationIds, the client retries the same batch, and NO
 *    entity's operations ever drain again. A missing enum value does not
 *    degrade the new feature; it stops sync for everything.
 *
 * 2. `PAID_SYNC_STATUSES` gates both push and pull. `lifetime` was missing from
 *    it between Story 25-2 and Story 30.4a, so a lifetime buyer saw every
 *    premium surface unlocked and got a 403 on every sync call.
 *
 * These assert the SCHEMA and the CONSTANT directly rather than mocking a
 * request, because that is where both defects lived.
 */

import type { SyncEntityType } from '@budget-planner/core'
import { subscriptionStatusEnum } from '@budget-planner/db'
import { getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  PAID_SYNC_STATUSES,
  batchSyncRequestSchema,
  entityTableMap,
  syncOperationSchema,
} from '../sync'

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

  // ⚠️ PRE-EXISTING QUIRK, pinned rather than fixed. The `.superRefine` in
  // syncOperationSchema validates entity data with `<entity>Schema.parse(...)`,
  // which THROWS instead of calling `ctx.addIssue`. A throw inside a refinement
  // escapes `safeParse`, so malformed ENTITY DATA raises rather than returning
  // `{ success: false }`. These assert the real behaviour; see the story's
  // Completion Notes and deferred-work for the consequence at the route layer.
  it('rejects a category whose kind is not a real ledger side', () => {
    const bad = op({
      entityType: 'category',
      data: { name: 'Groceries', kind: 'liability', userId: USER_ID },
    })
    expect(() => syncOperationSchema.safeParse(bad)).toThrow()
  })

  it('rejects a category with an empty name', () => {
    const bad = op({
      entityType: 'category',
      data: { name: '', kind: 'expense', userId: USER_ID },
    })
    expect(() => syncOperationSchema.safeParse(bad)).toThrow()
  })

  it('still rejects a genuinely unknown entity type (the enum was widened, not removed)', () => {
    // GREEN NEGATIVE CONTROL: proves adding 'category' did not turn the enum into
    // a passthrough. If this ever fails, someone "fixed" a rejected entity by
    // loosening the gate rather than declaring the entity.
    const bad = op({ entityType: 'notAnEntity', data: { name: 'x', userId: USER_ID } })
    expect(syncOperationSchema.safeParse(bad).success).toBe(false)
  })
})

describe('batchSyncRequestSchema — one category operation must not poison the batch', () => {
  it('a MIXED batch containing a category op still validates as a whole', () => {
    // ⚠️ THE POINT OF THIS FILE. z.array fails atomically: before 'category' was
    // added to syncOperationSchema.entityType, this batch failed ENTIRELY and the
    // income operation — perfectly valid — never processed either. Remove
    // 'category' from that enum and this goes red.
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
    // Not a category concern per se — this pins the MECHANISM that makes a
    // missing enum value catastrophic, so the reason the test above matters
    // cannot be lost to a future reader.
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
    // Throws rather than returning success:false — see the superRefine note above.
    expect(() => syncOperationSchema.safeParse(bad)).toThrow()
  })
})

/**
 * Gate: `entityTableMap` (code review 30.4a).
 *
 * ⚠️ This gate had NO coverage. Removing `category: categories` left 240/240
 * green across `src/server` + `src/lib/sync`, because nothing in the suite ever
 * invokes `processBatchSync` / `applyOperation` / `createEntity` with a category
 * — the route tests mock `processBatchSync` wholesale. With the entry gone,
 * `getTable('category')` throws `Unknown entity type` and every category push
 * fails at apply time while the client is told nothing.
 *
 * Pinned against the `SyncEntityType` union rather than a hand-copied list, so
 * the map cannot drift from the set of entities the client can actually queue.
 */
describe('entityTableMap — every syncable entity resolves to a table (AC-6)', () => {
  // Exhaustive by construction: `satisfies` makes tsc reject this array if a
  // SyncEntityType is missing or misspelled, so the runtime loop below is
  // guaranteed to walk the whole union.
  const ALL_SYNC_ENTITIES = [
    'incomeSource',
    'expense',
    'savingsGoal',
    'balanceTracking',
    'userProfile',
    'category',
  ] as const satisfies readonly SyncEntityType[]

  it('has an entry for every SyncEntityType', () => {
    for (const entityType of ALL_SYNC_ENTITIES) {
      // MUTATION KILLED: delete `category: categories` from entityTableMap.
      expect(entityTableMap[entityType], `no table mapped for '${entityType}'`).toBeDefined()
    }
  })

  it('maps category to the categories table specifically', () => {
    // A present-but-wrong mapping (e.g. pointing at `expenses`) is as broken as
    // a missing one, and the assertion above would not notice.
    expect(getTableName(entityTableMap.category)).toBe('categories')
  })

  it('contains no entry that is not a SyncEntityType', () => {
    // Negative control: keeps the map from accumulating dead entries that read
    // as supported entities.
    expect(Object.keys(entityTableMap).sort()).toEqual([...ALL_SYNC_ENTITIES].sort())
  })
})

describe('PAID_SYNC_STATUSES — every premium-bearing status may sync (AC-8)', () => {
  it('contains only real subscription statuses', () => {
    // `PAID_SYNC_STATUSES` is an inferred string[], so a typo like 'lifetme'
    // compiles cleanly and the exact-set assertion below would simply have been
    // written to match it. Anchoring on the DB enum makes that impossible.
    for (const status of PAID_SYNC_STATUSES) {
      expect(subscriptionStatusEnum.enumValues).toContain(status)
    }
  })

  it('includes every status that grants premium access', () => {
    // ⚠️ The source of truth for entitlement is usePremiumAccess.ts:79, which
    // treats `active` and `lifetime` as premium. Sync is deliberately MORE
    // lenient (it also allows `past_due`), so the invariant is one-directional:
    // anything premium must be syncable, not the reverse.
    //
    // ⚠️ RESIDUAL GAP, stated honestly: there is no shared constant, so this
    // list is still hand-copied from that hook. Adding a NEW premium status to
    // both the enum and usePremiumAccess while forgetting this file would still
    // pass. Closing that properly means extracting one shared constant both
    // sides import — recorded rather than done, because it touches a widely
    // consumed hook and belongs in its own change.
    for (const premiumStatus of ['active', 'lifetime']) {
      expect(PAID_SYNC_STATUSES).toContain(premiumStatus)
    }
  })

  it('permits exactly active, past_due and lifetime', () => {
    // Asserted as a SET, so adding a status without considering sync is a
    // deliberate act rather than an oversight. `lifetime` was missing here from
    // Story 25-2 until 30.4a: the UI unlocked every premium surface while both
    // sync routes returned 403.
    expect([...PAID_SYNC_STATUSES].sort()).toEqual(['active', 'lifetime', 'past_due'])
  })

  it('permits a lifetime subscriber', () => {
    expect(PAID_SYNC_STATUSES.includes('lifetime')).toBe(true)
  })

  it('still excludes the non-paying statuses', () => {
    // GREEN NEGATIVE CONTROL: the gate was widened for lifetime only, not opened.
    for (const status of ['free', 'canceled']) {
      expect(PAID_SYNC_STATUSES.includes(status)).toBe(false)
    }
  })
})
