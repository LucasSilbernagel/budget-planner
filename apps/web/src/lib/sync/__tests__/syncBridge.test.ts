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
import {
  RETIREMENT_PLAN_STRING_MAX,
  retirementPlanSyncSchema,
} from '@budget-planner/core/sync/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type SyncBridgeHandle,
  clearSyncBridge,
  isSyncActive,
  registerSyncBridge,
  syncEntityCreate,
  syncEntityDelete,
  syncEntityUpdate,
  toServerPayload,
} from '../syncBridge'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

// Each mock takes the REAL handle signature, so `mock.calls[i]` is typed by it.
// Untyped, `vi.fn(async () => {})` records zero parameters and every read of a
// call's argument was a type error hidden behind a cast (story 78.2).
function makeHandle() {
  return {
    userId: SESSION_USER_ID,
    queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
    queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
    queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
  }
}

/**
 * A store row as the bridge receives it. `ClientEntity` declares only `id` and
 * `updatedAt` on purpose (the bridge reads domain fields through a record view),
 * so a fresh literal carrying domain fields trips the excess-property check.
 * Stores hand the bridge typed rows, never literals; passing the fixture
 * through this generic mirrors that and keeps every field's own type.
 */
const row = <T extends { id: string; updatedAt?: string }>(entity: T): T => entity

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
    syncEntityCreate(
      'incomeSource',
      row({
        id: 'inc-1',
        userId: 0, // free-tier local placeholder — must be replaced
        name: 'Salary',
        amount: 500000,
        frequency: 'monthly',
      })
    )

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
          // Story 45.1 (FR72): stamped false when the row omits it. The server's
          // `.default(false)` does NOT reach the stored row — `syncOperationSchema`
          // validates `data` in a superRefine that DISCARDS its parse result — so
          // the wire value is whatever the bridge sends and nothing else.
          contributionRecordedAsExpense: false,
          // Story 102.1 (FR169): the debt-payment link, emitted as an explicit
          // null when unlinked so an unlink lands (partial `.set()`).
          paymentExpenseId: null,
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
    const payload = handle.queueCreate.mock.calls[0][2]
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
    const payload = handle.queueUpdate.mock.calls[0][2]
    expect(payload.allocationMode).toBe('automatic')
    expect('monthlyAllocation' in payload).toBe(true)
    expect(payload.monthlyAllocation).toBeNull()
  })

  /**
   * Story 49.1 (FR75). Replaces 'omits an absent optional maxContributionLimit',
   * which proved the bridge's one conditional forwarding rule. The field is gone
   * from all five gates, so that rule is gone with it and the branch it guarded
   * no longer exists.
   *
   * ⚠️ Asserted as the EXACT key set, not as `'maxContributionLimit' in payload
   * === false`. That absence check would now pass against ANY payload forever —
   * including one that silently stopped forwarding `frequency` or `sortOrder`.
   * The exact set reddens on a re-added key AND on a dropped one, which is the
   * property the partial-`.set()` hazard in `syncBridge.ts` actually needs.
   */
  it('puts exactly the balanceTracking columns on the wire, and no retired ones', () => {
    syncEntityCreate(
      'balanceTracking',
      row({
        id: 'b2',
        type: 'debt',
        name: 'Loan',
        currentBalance: -5000,
        monthlyContribution: 100,
      })
    )
    const payload = handle.queueCreate.mock.calls[0][2]
    expect(Object.keys(payload).sort()).toEqual(
      [
        'type',
        'name',
        'currentBalance',
        'monthlyContribution',
        'contributionRecordedAsExpense',
        // Story 102.1 (FR169): always on the wire (null when unlinked).
        'paymentExpenseId',
        'frequency',
        'sortOrder',
        'userId',
      ].sort()
    )
  })

  it('defaults a missing frequency to monthly in the payload (Story 16-2)', () => {
    syncEntityCreate(
      'balanceTracking',
      row({
        id: 'b3',
        type: 'debt',
        name: 'Loan',
        currentBalance: -5000,
        monthlyContribution: 100,
      })
    )
    const payload = handle.queueCreate.mock.calls[0][2]
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
    syncEntityDelete(
      'expense',
      row({
        id: 'exp-1',
        name: 'Rent',
        amount: 100000,
        frequency: 'monthly',
        updatedAt: '2026-06-28T00:00:00.000Z',
      })
    )
    expect(handle.queueDelete).toHaveBeenCalledWith(
      'expense',
      'exp-1',
      Date.parse('2026-06-28T00:00:00.000Z')
    )
  })

  it('passes baseVersion undefined when updatedAt is missing/unparseable', () => {
    syncEntityDelete(
      'userProfile',
      row({ id: 'p1', name: 'Main', isDefault: false, currency: 'NONE' })
    )
    expect(handle.queueDelete).toHaveBeenCalledWith('userProfile', 'p1', undefined)
  })

  it('swallows a queue rejection (a sync hiccup must not break the local edit)', async () => {
    handle.queueCreate.mockRejectedValueOnce(new Error('offline'))
    expect(() =>
      syncEntityCreate(
        'incomeSource',
        row({
          id: 'inc-9',
          name: 'X',
          amount: 1,
          frequency: 'monthly',
        })
      )
    ).not.toThrow()
    // Allow the rejected promise's .catch to settle.
    await Promise.resolve()
  })
})

describe('syncBridge — an asset row reaches the queue (Story 43.4, gate 2 falsifier)', () => {
  beforeEach(() => {
    registerSyncBridge(handle)
  })
  afterEach(() => {
    clearSyncBridge()
  })

  it('forwards an asset balanceTracking row to queueCreate without dropping it', () => {
    // ⚠️ THE DIRECT FALSIFIER for the silent-drop path. If any gate rejected
    // `type: 'asset'`, `syncOperationDataSchema.parse` would throw inside
    // `queueCreate` BEFORE `queue.add`, and `onQueueError` would swallow it into a
    // bare console.error — the row persists locally and never leaves the device,
    // with no toast, no error state and nothing in the sync UI. Parsing the schema
    // directly (as `finance-type-gates.test.ts` does) proves the SCHEMA; this
    // proves the BRIDGE actually hands the row on.
    syncEntityCreate(
      'balanceTracking',
      row({
        id: 'asset-1',
        type: 'asset',
        name: 'Condo',
        currentBalance: 40_000_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        sortOrder: 0,
      })
    )

    expect(handle.queueCreate).toHaveBeenCalledWith('balanceTracking', 'asset-1', {
      type: 'asset',
      name: 'Condo',
      currentBalance: 40_000_000,
      monthlyContribution: 0,
      frequency: 'monthly',
      // Story 45.1 (FR72): stamped false rather than omitted — see below.
      contributionRecordedAsExpense: false,
      // Story 102.1: an asset is never linked, so the explicit null.
      paymentExpenseId: null,
      sortOrder: 0,
      userId: SESSION_USER_ID,
    })
  })

  // --- Story 45.1 (FR72), AC-10 gate 3: the bridge payload ------------------
  it('forwards contributionRecordedAsExpense: true on an investment row', () => {
    syncEntityCreate(
      'balanceTracking',
      row({
        id: 'tfsa-1',
        type: 'investment',
        name: 'TFSA',
        currentBalance: 1_000_000,
        monthlyContribution: 50_000,
        frequency: 'monthly',
        contributionRecordedAsExpense: true,
        sortOrder: 0,
      })
    )

    expect(handle.queueCreate).toHaveBeenCalledWith(
      'balanceTracking',
      'tfsa-1',
      expect.objectContaining({ contributionRecordedAsExpense: true })
    )
  })

  it('STAMPS the flag false when the row omits it, so the key is always on the wire', () => {
    // ⚠️ This is the assertion that makes `?? false` load-bearing rather than
    // defensive noise. `JSON.stringify` DROPS an `undefined`-valued key and
    // `updateEntity` does a PARTIAL `.set()`, so an unstamped row would leave the
    // previous server value in place — a user unticking the box on one device
    // would see the change never land anywhere else. `toHaveProperty` is the
    // point here: asserting `toBe(false)` alone passes on an absent key too.
    syncEntityCreate(
      'balanceTracking',
      row({
        id: 'tfsa-2',
        type: 'investment',
        name: 'TFSA',
        currentBalance: 1_000_000,
        monthlyContribution: 50_000,
        frequency: 'monthly',
        sortOrder: 0,
      })
    )

    const payload = handle.queueCreate.mock.calls.at(-1)?.[2]
    expect(payload).toHaveProperty('contributionRecordedAsExpense')
    expect(payload?.contributionRecordedAsExpense).toBe(false)
    expect(JSON.parse(JSON.stringify(payload))).toHaveProperty('contributionRecordedAsExpense')
  })
})

/**
 * Story 99.2 (G11): the retirement plan's payload. DORMANT in 99.2 (no app code
 * queues one; story 99.3 adds the push), but compile-forced by the `never`
 * default, and pinned here so the case cannot ship wrong.
 */
describe('toServerPayload — retirementPlan (story 99.2)', () => {
  const PLAN = {
    currentAgeInput: '',
    lifeExpectancyInput: '87',
    desiredIncomeInput: '55.000,00',
    desiredIncomeTouched: true,
    desiredIncomeLocale: 'de-DE',
    adoptedMonthlyCents: null,
    incomeBasis: 'monthly',
    annualReturnInput: '5.5',
    postRetirementReturnInput: '3.0',
    postRetirementTouched: true,
    model: 'perpetual',
  }

  it('sends the WHOLE plan and the session user, nothing else', () => {
    const payload = toServerPayload(
      'retirementPlan',
      { id: SESSION_USER_ID, plan: PLAN } as never,
      SESSION_USER_ID
    )
    expect(payload).toEqual({ plan: PLAN, userId: SESSION_USER_ID })
  })

  it("keeps '' (cleared) and null (never adopted) through JSON.stringify", () => {
    const payload = toServerPayload(
      'retirementPlan',
      { id: SESSION_USER_ID, plan: PLAN } as never,
      SESSION_USER_ID
    )
    const wire = JSON.parse(JSON.stringify(payload)) as { plan: Record<string, unknown> }
    expect(wire.plan['currentAgeInput']).toBe('')
    expect(Object.prototype.hasOwnProperty.call(wire.plan, 'adoptedMonthlyCents')).toBe(true)
    expect(wire.plan['adoptedMonthlyCents']).toBeNull()
    expect(Object.keys(wire.plan).sort()).toEqual(Object.keys(PLAN).sort())
  })

  it('coerces: a missing or malformed field is sent as its default, never as a dropped key', () => {
    const payload = toServerPayload(
      'retirementPlan',
      { id: SESSION_USER_ID, plan: { currentAgeInput: 42, injected: 'x' } } as never,
      SESSION_USER_ID
    ) as { plan: Record<string, unknown> }
    expect(payload.plan['currentAgeInput']).toBe('35')
    expect(payload.plan).not.toHaveProperty('injected')
    expect(Object.keys(payload.plan).sort()).toEqual(Object.keys(PLAN).sort())
  })

  it('an over-long string is clamped to the push gate’s bound, so the payload is always pushable (99.2 review)', () => {
    // The plan's inputs have no maxLength and localStorage is user-editable, so a
    // string past RETIREMENT_PLAN_STRING_MAX is reachable. Unclamped, core's G2
    // gate throws a ZodError on every push of that plan, and it never syncs.
    const long = '9'.repeat(RETIREMENT_PLAN_STRING_MAX + 45)
    const payload = toServerPayload(
      'retirementPlan',
      {
        id: SESSION_USER_ID,
        plan: { ...PLAN, desiredIncomeInput: long, desiredIncomeLocale: long },
      } as never,
      SESSION_USER_ID
    ) as { plan: Record<string, unknown> }
    expect(retirementPlanSyncSchema.safeParse(payload.plan).success).toBe(true)
    expect(payload.plan['desiredIncomeInput']).toBe(long.slice(0, RETIREMENT_PLAN_STRING_MAX))
    expect(payload.plan['lifeExpectancyInput']).toBe('87')
  })

  it('a NUL, a lone surrogate, or a clamp through a surrogate pair still yields a pushable payload (99.2 review)', () => {
    // jsonb refuses a NUL and a lone surrogate, so the gate refuses them too; the
    // bridge must therefore never PRODUCE one, including by cutting an emoji in two
    // at the length bound (255 is odd, so 200 pairs are cut mid-pair).
    const emoji = '😀'.repeat(200)
    const payload = toServerPayload(
      'retirementPlan',
      {
        id: SESSION_USER_ID,
        plan: {
          ...PLAN,
          currentAgeInput: '4\u00002',
          lifeExpectancyInput: '\ud80087',
          desiredIncomeInput: emoji,
        },
      } as never,
      SESSION_USER_ID
    ) as { plan: Record<string, unknown> }
    expect(retirementPlanSyncSchema.safeParse(payload.plan).success).toBe(true)
    expect(payload.plan['currentAgeInput']).toBe('42')
    expect(payload.plan['lifeExpectancyInput']).toBe('\ufffd87')
    expect(payload.plan['desiredIncomeInput']).toBe('😀'.repeat(127))
  })
})
