/**
 * `sortOrder` sync-contract gates (Story 34.1a, AC-4).
 *
 * A new FIELD on four EXISTING entities has to be declared at five independent
 * places, and FOUR of them fail silently if missed. There is no end-to-end path
 * to lean on instead: server-side sync CREATE is broken for all four entities
 * today (`syncOperationSchema` declares no `profileId` and no per-entity schema
 * declares `id`, so `createEntity` inserts `profileId: undefined` against four
 * NOT NULL columns — deferred-work.md:11/:29/:31, deferred twice by Lucas and
 * explicitly fenced out of this story). So each gate is pinned individually.
 *
 * ⚠️ NOTHING HERE CLAIMS A LIVE ROUND-TRIP SUCCEEDS. These are contract tests.
 *
 * ⚠️ CORRECTION TO THE STORY'S GATE INVENTORY, verified by probing rather than
 * assumed. §1 lists gate 4's failure mode as "stripped at .parse(), never reaches
 * the insert". That is NOT what happens. The per-entity schemas are invoked as
 * `incomeSourceSchema.parse(entityData)` INSIDE `syncOperationSchema`'s
 * `superRefine`, and superRefine DISCARDS its callback's return value — only
 * raised issues survive. The operation's `data` is typed `z.record(z.unknown())`
 * at the top level, so it passes through UNSTRIPPED, and `applyOperation` reads
 * that raw record. Measured: an op carrying `sortOrder: 5` parses to a `data`
 * object that still contains `sortOrder: 5`.
 *
 * What the server gate therefore really provides is VALIDATION, not stripping —
 * and that is a genuine guarantee worth pinning, because without the declaration
 * a negative, fractional or over-int32 position would sail through and fail at
 * the INSERT instead. The gate-4 tests below assert rejection, which is the
 * property that actually exists.
 */

// Deep import: `syncOperationDataSchema` is deliberately not re-exported from
// core's `sync` barrel, so the barrel path resolves to `undefined` and every
// assertion below would fail with "Cannot read properties of undefined".
import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import {
  clearSyncBridge,
  registerSyncBridge,
  syncEntityCreate,
  syncEntityUpdate,
} from '../syncBridge'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeHandle() {
  return {
    userId: SESSION_USER_ID,
    queueCreate: vi.fn(async () => {}),
    queueUpdate: vi.fn(async () => {}),
    queueDelete: vi.fn(async () => {}),
  }
}

let handle: ReturnType<typeof makeHandle>

beforeEach(() => {
  handle = makeHandle()
  registerSyncBridge(handle)
})

afterEach(() => {
  clearSyncBridge()
  vi.restoreAllMocks()
})

/**
 * GATE 2 — `toServerPayload` (syncBridge.ts).
 *
 * Fails SILENTLY: the function returns `Record<string, unknown>`, so a forgotten
 * key is not a type error and the field simply never leaves the browser. All
 * THREE branches are covered — income/expense share one, savingsGoal and
 * balanceTracking have their own.
 *
 * MUTATION KILLED (M1): delete `sortOrder` from the incomeSource/expense branch.
 */
describe('Gate 2 — the push payload carries sortOrder on every branch', () => {
  const CASES = [
    {
      entityType: 'incomeSource' as const,
      entity: {
        id: ROW_ID,
        userId: 0,
        name: 'Salary',
        amount: 1000,
        frequency: 'monthly',
        sortOrder: 3,
      },
    },
    {
      entityType: 'expense' as const,
      entity: {
        id: ROW_ID,
        userId: 0,
        name: 'Rent',
        amount: 1000,
        frequency: 'monthly',
        sortOrder: 4,
      },
    },
    {
      entityType: 'savingsGoal' as const,
      entity: { id: ROW_ID, name: 'Fund', targetAmount: 5000, currentBalance: 0, sortOrder: 5 },
    },
    {
      entityType: 'balanceTracking' as const,
      entity: {
        id: ROW_ID,
        type: 'investment',
        name: 'Brokerage',
        currentBalance: 1000,
        monthlyContribution: 0,
        frequency: 'monthly',
        sortOrder: 6,
      },
    },
  ]

  it.each(CASES)('create forwards sortOrder for $entityType', ({ entityType, entity }) => {
    syncEntityCreate(entityType, entity)
    expect(handle.queueCreate).toHaveBeenCalledTimes(1)
    expect(handle.queueCreate.mock.calls[0][2]).toMatchObject({ sortOrder: entity.sortOrder })
  })

  /**
   * ⚠️ `sortOrder` must be sent on EVERY update, never conditionally omitted.
   * `updateEntity` does a partial `.set()`, so an omitted key leaves the previous
   * server value in place — a reorder would appear to succeed and silently not
   * persist. This asserts the key is PRESENT even when the value is 0, the case a
   * truthiness-based `if (entity.sortOrder)` guard would drop.
   */
  it.each(CASES)(
    'update forwards sortOrder for $entityType, including 0',
    ({ entityType, entity }) => {
      syncEntityUpdate(entityType, { ...entity, sortOrder: 0 })
      expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
      const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>
      expect(Object.hasOwn(payload, 'sortOrder')).toBe(true)
      expect(payload.sortOrder).toBe(0)
    }
  )
})

/**
 * GATE 3 — `syncOperationDataSchema` (packages/core/src/sync/types.ts).
 *
 * Fails SILENTLY and is the most dangerous of the five: this gate STRIPS
 * undeclared keys, so an omitted declaration drops `sortOrder` before the op is
 * ever queued. No error, no rejection — the sync just "succeeds" without the
 * user's ordering.
 *
 * MUTATION KILLED (M2): delete `sortOrder` from syncOperationDataSchema.
 */
describe('Gate 3 — the client zod gate does not strip sortOrder', () => {
  it('preserves sortOrder through a parse', () => {
    const parsed = syncOperationDataSchema.parse({
      name: 'Salary',
      amount: 1000,
      frequency: 'monthly',
      sortOrder: 7,
      userId: SESSION_USER_ID,
    })
    expect(parsed.sortOrder).toBe(7)
  })

  it('preserves an explicit 0 rather than dropping it', () => {
    const parsed = syncOperationDataSchema.parse({ name: 'Salary', sortOrder: 0 })
    expect(Object.hasOwn(parsed, 'sortOrder')).toBe(true)
    expect(parsed.sortOrder).toBe(0)
  })

  /**
   * Proves the assertion above is discriminating: this gate really does strip,
   * so "the key survived" is evidence the declaration exists, not a tautology.
   */
  it('DOES strip a genuinely undeclared key (so the check above is meaningful)', () => {
    const parsed = syncOperationDataSchema.parse({
      name: 'Salary',
      notARealField: 'dropped',
    } as Record<string, unknown>)
    expect(Object.hasOwn(parsed, 'notARealField')).toBe(false)
  })

  it.each([-1, 1.5, 2_147_483_648])('rejects an out-of-range sortOrder (%s)', (bad) => {
    expect(() => syncOperationDataSchema.parse({ name: 'Salary', sortOrder: bad })).toThrow()
  })
})

/**
 * GATE 4 — the four per-entity schemas in server/api/sync.ts.
 *
 * See the correction in this file's header: these VALIDATE, they do not strip.
 * Without the declaration an invalid position reaches the INSERT instead of being
 * rejected at the boundary.
 *
 * MUTATION KILLED (M3): delete `sortOrder` from balanceTrackingSchema — the
 * rejection cases below stop rejecting.
 */
describe('Gate 4 — the server gates validate sortOrder for all four entities', () => {
  const op = (entityType: string, data: Record<string, unknown>) => ({
    id: 'op-1',
    type: 'create',
    entityType,
    entityId: ROW_ID,
    timestamp: 1_700_000_000_000,
    deviceId: 'device-1',
    userId: SESSION_USER_ID,
    data: { ...data, userId: SESSION_USER_ID },
  })

  const ENTITIES = [
    { entityType: 'incomeSource', base: { name: 'Salary', amount: 1000, frequency: 'monthly' } },
    { entityType: 'expense', base: { name: 'Rent', amount: 1000, frequency: 'monthly' } },
    { entityType: 'savingsGoal', base: { name: 'Fund', targetAmount: 5000, currentBalance: 0 } },
    {
      entityType: 'balanceTracking',
      base: {
        type: 'investment',
        name: 'Brokerage',
        currentBalance: 1000,
        monthlyContribution: 0,
        frequency: 'monthly',
      },
    },
  ]

  it.each(ENTITIES)(
    '$entityType accepts a valid sortOrder and keeps it in data',
    ({ entityType, base }) => {
      const parsed = syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 5 }))
      // Retained, not stripped — see the header correction.
      expect((parsed.data as Record<string, unknown>).sortOrder).toBe(5)
    }
  )

  it.each(ENTITIES)('$entityType accepts an explicit 0', ({ entityType, base }) => {
    expect(() => syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 0 }))).not.toThrow()
  })

  it.each(ENTITIES)('$entityType REJECTS a negative sortOrder', ({ entityType, base }) => {
    expect(() => syncOperationSchema.parse(op(entityType, { ...base, sortOrder: -1 }))).toThrow()
  })

  it.each(ENTITIES)('$entityType REJECTS a fractional sortOrder', ({ entityType, base }) => {
    expect(() => syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 1.5 }))).toThrow()
  })

  it.each(ENTITIES)(
    '$entityType REJECTS a sortOrder past the int32 column ceiling',
    ({ entityType, base }) => {
      expect(() =>
        syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 2_147_483_648 }))
      ).toThrow()
    }
  )

  it.each(ENTITIES)('$entityType REJECTS a non-numeric sortOrder', ({ entityType, base }) => {
    expect(() => syncOperationSchema.parse(op(entityType, { ...base, sortOrder: 'top' }))).toThrow()
  })

  /**
   * `sortOrder` is optional at the gate because rows predating the field, and the
   * two entity types with no ordering at all, must still validate.
   */
  it.each(ENTITIES)(
    '$entityType still accepts an operation with no sortOrder',
    ({ entityType, base }) => {
      expect(() => syncOperationSchema.parse(op(entityType, base))).not.toThrow()
    }
  )
})
