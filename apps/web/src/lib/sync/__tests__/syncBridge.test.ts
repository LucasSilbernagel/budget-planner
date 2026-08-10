/**
 * Sync Bridge Tests (Story 5-15)
 *
 * Pins the store ↔ push-queue seam:
 *  - FREE tier (no registered handle) → every helper is a silent no-op, so the
 *    free path makes zero queue/network calls (AC-6).
 *  - PAID tier (registered handle) → create/update/delete enqueue ops with the
 *    server-shaped payload, the SESSION userId (never the local free-tier one),
 *    and a baseVersion derived from the pre-edit `updatedAt` (AC-5 / 4-18 D1).
 */

import type { SyncEntityType } from '@budget-planner/core/sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSyncBridge,
  isSyncActive,
  registerSyncBridge,
  syncEntityCreate,
  syncEntityDelete,
  syncEntityUpdate,
} from '../syncBridge'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

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
})

afterEach(() => {
  clearSyncBridge()
  vi.restoreAllMocks()
})

describe('syncBridge — free tier (no handle registered)', () => {
  it('reports inactive and no-ops all helpers', () => {
    expect(isSyncActive()).toBe(false)

    const income = { id: 'inc-1', userId: 0, name: 'Salary', amount: 1000, frequency: 'monthly' }
    // Must not throw and must not attempt to queue anything.
    expect(() => syncEntityCreate('incomeSource', income)).not.toThrow()
    expect(() => syncEntityUpdate('incomeSource', income)).not.toThrow()
    expect(() => syncEntityDelete('incomeSource', income)).not.toThrow()
  })
})

describe('syncBridge — paid tier (handle registered)', () => {
  beforeEach(() => {
    registerSyncBridge(handle)
  })

  it('isSyncActive() is true once registered, false after clear', () => {
    expect(isSyncActive()).toBe(true)
    clearSyncBridge()
    expect(isSyncActive()).toBe(false)
  })

  it('create forwards a server-shaped payload with the SESSION userId', () => {
    syncEntityCreate('incomeSource', {
      id: 'inc-1',
      userId: 0, // free-tier local placeholder — must be replaced
      name: 'Salary',
      amount: 500000,
      frequency: 'monthly',
    })

    expect(handle.queueCreate).toHaveBeenCalledWith('incomeSource', 'inc-1', {
      name: 'Salary',
      amount: 500000,
      frequency: 'monthly',
      // Story 30.4a: forwarded ALWAYS, including null — updateEntity does a
      // partial .set(), so omitting the key would leave a stale server-side
      // category and un-categorizing would never propagate.
      categoryId: null,
      userId: SESSION_USER_ID,
    })
  })

  it('maps each entity type to its server columns', () => {
    const cases: Array<{
      type: SyncEntityType
      entity: Record<string, unknown>
      expected: object
    }> = [
      {
        type: 'savingsGoal',
        entity: {
          id: 's1',
          name: 'Car',
          targetAmount: 200000,
          currentBalance: 5000,
          allocationMode: 'manual',
          monthlyAllocation: 30000,
        },
        expected: {
          name: 'Car',
          targetAmount: 200000,
          currentBalance: 5000,
          // Story 26.1: the allocation mode is always forwarded; a manual amount
          // is forwarded when present.
          allocationMode: 'manual',
          monthlyAllocation: 30000,
          userId: SESSION_USER_ID,
        },
      },
      {
        type: 'balanceTracking',
        entity: {
          id: 'b1',
          type: 'investment',
          name: 'Brokerage',
          currentBalance: 10000,
          monthlyContribution: 500,
          maxContributionLimit: 20000,
          frequency: 'biweekly',
        },
        expected: {
          type: 'investment',
          name: 'Brokerage',
          currentBalance: 10000,
          monthlyContribution: 500,
          // Story 16-2: the contribution cadence MUST be forwarded, else the server
          // defaults every synced entry to 'monthly' and non-monthly picks are lost.
          frequency: 'biweekly',
          maxContributionLimit: 20000,
          userId: SESSION_USER_ID,
        },
      },
      {
        type: 'userProfile',
        entity: { id: 'p1', name: 'Main', isDefault: true, currency: 'EUR' },
        expected: { name: 'Main', isDefault: true, currency: 'EUR', userId: SESSION_USER_ID },
      },
      {
        // Story 30.4a. `kind` separates the income and expense namespaces —
        // without it a synced category is unplaceable server-side. Note this
        // case ALSO guards the switch shape: `userProfile` used to be the bare
        // `default:` arm, so a new entity type silently inherited its payload
        // (shipping `isDefault`/`currency`, both of which survive the strip
        // gate). If this expectation ever starts matching userProfile's shape,
        // the named case has been lost.
        type: 'category',
        entity: { id: 'cat-1', name: 'Groceries', kind: 'expense', isDeleted: false },
        expected: { name: 'Groceries', kind: 'expense', userId: SESSION_USER_ID },
      },
    ]

    for (const { type, entity, expected } of cases) {
      handle.queueCreate.mockClear()
      syncEntityCreate(type, entity as { id: string })
      expect(handle.queueCreate).toHaveBeenCalledWith(type, entity.id, expected)
    }
  })

  it('defaults a missing savings allocationMode to automatic and sends monthlyAllocation: null (Story 26.1)', () => {
    syncEntityCreate('savingsGoal', {
      id: 's2',
      name: 'Leftover',
      targetAmount: null,
      currentBalance: 0,
    } as { id: string })
    const payload = handle.queueCreate.mock.calls[0][2] as Record<string, unknown>
    expect(payload.allocationMode).toBe('automatic')
    // An automatic account has no manual amount — the nullable column is forwarded
    // as an EXPLICIT null (not omitted) so a manual→automatic switch resets it on
    // the server + other devices (review 26-1 P1). Both gates are .nullable().
    expect('monthlyAllocation' in payload).toBe(true)
    expect(payload.monthlyAllocation).toBeNull()
  })

  it('a manual→automatic UPDATE forwards monthlyAllocation: null so the server clears the stale amount (Story 26.1, review P1)', () => {
    // The account was manual with 30000¢; the user switched it to automatic, which
    // sets the local monthlyAllocation to null. The UPDATE payload MUST carry the
    // explicit null, or updateEntity's partial `.set()` leaves the stale 30000¢.
    syncEntityUpdate(
      'savingsGoal',
      {
        id: 's3',
        name: 'Leftover',
        targetAmount: null,
        currentBalance: 0,
        allocationMode: 'automatic',
        monthlyAllocation: null,
        updatedAt: '2026-06-28T00:00:00.000Z',
      } as { id: string; updatedAt: string },
      {
        id: 's3',
        name: 'Leftover',
        targetAmount: null,
        currentBalance: 0,
        allocationMode: 'manual',
        monthlyAllocation: 30000,
        updatedAt: '2026-06-27T00:00:00.000Z',
      } as { id: string; updatedAt: string }
    )
    const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>
    expect(payload.allocationMode).toBe('automatic')
    expect('monthlyAllocation' in payload).toBe(true)
    expect(payload.monthlyAllocation).toBeNull()
  })

  it('omits an absent optional maxContributionLimit', () => {
    syncEntityCreate('balanceTracking', {
      id: 'b2',
      type: 'debt',
      name: 'Loan',
      currentBalance: -5000,
      monthlyContribution: 100,
    })
    const payload = handle.queueCreate.mock.calls[0][2] as Record<string, unknown>
    expect('maxContributionLimit' in payload).toBe(false)
  })

  it('defaults a missing frequency to monthly in the payload (Story 16-2)', () => {
    syncEntityCreate('balanceTracking', {
      id: 'b3',
      type: 'debt',
      name: 'Loan',
      currentBalance: -5000,
      monthlyContribution: 100,
    })
    const payload = handle.queueCreate.mock.calls[0][2] as Record<string, unknown>
    expect(payload.frequency).toBe('monthly')
  })

  it('update derives baseVersion from the pre-edit updatedAt (causal LWW)', () => {
    const previous = {
      id: 'inc-1',
      name: 'Salary',
      amount: 500000,
      frequency: 'monthly',
      updatedAt: '2026-06-28T00:00:00.000Z',
    }
    const updated = { ...previous, amount: 600000, updatedAt: '2026-06-29T00:00:00.000Z' }

    syncEntityUpdate('incomeSource', updated, previous)

    const [, , data, version, baseVersion] = handle.queueUpdate.mock.calls[0]
    expect(data).toMatchObject({ amount: 600000, userId: SESSION_USER_ID })
    expect(version).toBeUndefined()
    expect(baseVersion).toBe(Date.parse('2026-06-28T00:00:00.000Z'))
  })

  it('delete forwards id + baseVersion (tombstone source)', () => {
    syncEntityDelete('expense', {
      id: 'exp-1',
      name: 'Rent',
      amount: 100000,
      frequency: 'monthly',
      updatedAt: '2026-06-28T00:00:00.000Z',
    })
    expect(handle.queueDelete).toHaveBeenCalledWith(
      'expense',
      'exp-1',
      Date.parse('2026-06-28T00:00:00.000Z')
    )
  })

  it('passes baseVersion undefined when updatedAt is missing/unparseable', () => {
    syncEntityDelete('userProfile', { id: 'p1', name: 'Main', isDefault: false, currency: 'NONE' })
    expect(handle.queueDelete).toHaveBeenCalledWith('userProfile', 'p1', undefined)
  })

  it('swallows a queue rejection (a sync hiccup must not break the local edit)', async () => {
    handle.queueCreate.mockRejectedValueOnce(new Error('offline'))
    expect(() =>
      syncEntityCreate('incomeSource', {
        id: 'inc-9',
        name: 'X',
        amount: 1,
        frequency: 'monthly',
      })
    ).not.toThrow()
    // Allow the rejected promise's .catch to settle.
    await Promise.resolve()
  })
})
