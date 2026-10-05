/**
 * The retirement plan's client push (story 99.3, FR161), driven through the REAL
 * retirement store, push module, sync bridge and pull applier, with fake timers
 * and a recording bridge handle.
 *
 * Story 99.2 shipped this file as a DORMANCY test (no client path queued a plan
 * op). 99.3 inverts its setter half, as 99.2 directed: the intent setters push.
 * `resetPlan`, the claim, the applier, `setDesiredIncomeForLocale` (the planner's
 * effects) and `seedOnce` still queue nothing.
 *
 * ⚠️ POSITIVE ANCHORS: every "queues nothing" test either shows a pushing control
 * on the same bridge, or the seed's income row, so "zero plan ops" cannot pass
 * because the bridge recorded nothing at all.
 */

import type { ServerChange, SyncOperation } from '@budget-planner/core/sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIncomeStore } from '../../../stores/incomeStore'
import {
  RETIREMENT_PLANNER_STORAGE_KEY,
  RETIREMENT_PLAN_DEFAULTS,
  type RetirementPlan,
  claimRetirementPlanFor,
  useRetirementPlannerStore,
} from '../../../stores/retirementPlannerStore'
import { applyServerChangesToStores, stampSyncedOwner } from '../applyServerChanges'
import { type RefusalHandlerDeps, handleRejectedOperations } from '../refusedEdits'
import {
  PLAN_PUSH_DEBOUNCE_MS,
  hasPendingPlanEdit,
  resetRetirementPlanPushForTests,
  seedRetirementPlanIfServerHasNone,
} from '../retirementPlanPush'
import { seedOnce } from '../seedLocalData'
import { type SyncBridgeHandle, clearSyncBridge, registerSyncBridge } from '../syncBridge'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

function makeHandle() {
  return {
    userId: USER,
    queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
    queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
    queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
  }
}

let handle: ReturnType<typeof makeHandle>

/** Every entity type the bridge was asked to queue, as `<type> <entityType>`. */
function queued(): string[] {
  return [
    ...handle.queueCreate.mock.calls.map((call) => `create ${call[0]}`),
    ...handle.queueUpdate.mock.calls.map((call) => `update ${call[0]}`),
    ...handle.queueDelete.mock.calls.map((call) => `delete ${call[0]}`),
  ]
}

/** The plan update calls, as what reached the bridge. */
function planUpdates(): { entityId: string; plan: RetirementPlan; baseVersion?: number }[] {
  return handle.queueUpdate.mock.calls
    .filter((call) => call[0] === 'retirementPlan')
    .map((call) => ({
      entityId: call[1],
      plan: call[2]['plan'] as RetirementPlan,
      baseVersion: call[4],
    }))
}

function quiet(): void {
  vi.advanceTimersByTime(PLAN_PUSH_DEBOUNCE_MS)
}

function pulledPlan(plan: RetirementPlan, updatedAt: number, id = USER): ServerChange {
  return {
    entityType: 'retirementPlan',
    entityId: id,
    data: { id, userId: id, plan },
    updatedAt,
    isDeleted: false,
  }
}

const store = () => useRetirementPlannerStore.getState()

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  resetRetirementPlanPushForTests()
  useRetirementPlannerStore.setState({
    plan: { ...RETIREMENT_PLAN_DEFAULTS },
    ownerUserId: USER,
    serverUpdatedAt: null,
    localPlanDiverged: false,
  })
  useIncomeStore.setState({ incomeSources: [] })
  handle = makeHandle()
  registerSyncBridge(handle)
})

afterEach(() => {
  clearSyncBridge()
  resetRetirementPlanPushForTests()
  vi.useRealTimers()
})

describe('AC-2: only the user-intent setters push', () => {
  const intent: [string, () => void][] = [
    ['setCurrentAgeInput', () => store().setCurrentAgeInput('41')],
    ['setLifeExpectancyInput', () => store().setLifeExpectancyInput('87')],
    ['setDesiredIncomeInput', () => store().setDesiredIncomeInput('55,000.00')],
    ['markDesiredIncomeAuthored', () => store().markDesiredIncomeAuthored('en-US')],
    ['setAdoptedMonthlyCents', () => store().setAdoptedMonthlyCents(240_000)],
    ['setIncomeBasis', () => store().setIncomeBasis('monthly')],
    ['setAnnualReturnInput', () => store().setAnnualReturnInput('5.5')],
    ['setPostRetirementReturn', () => store().setPostRetirementReturn('3.0')],
    ['setModel', () => store().setModel('perpetual')],
  ]

  it.each(intent)('%s queues ONE update of the whole plan, under the account id', (_, edit) => {
    edit()
    expect(queued()).toEqual([])
    quiet()
    expect(queued()).toEqual(['update retirementPlan'])
    const [update] = planUpdates()
    expect(update?.entityId).toBe(USER)
    // The plan on the wire is the plan on screen, which really moved.
    expect(update?.plan).toEqual(store().plan)
    expect(store().plan).not.toEqual(RETIREMENT_PLAN_DEFAULTS)
  })

  it('setDesiredIncomeForLocale (the effects’ writer) queues nothing; an intent setter after it does', () => {
    store().setDesiredIncomeForLocale('55.000,00', 'de-DE')
    quiet()
    expect(store().plan.desiredIncomeInput).toBe('55.000,00')
    expect(queued()).toEqual([])
    // Positive control on the same bridge.
    store().setModel('perpetual')
    quiet()
    expect(queued()).toEqual(['update retirementPlan'])
  })

  it('resetPlan, the claim and the pull applier queue nothing', () => {
    store().setDesiredIncomeForLocale('1', 'en-US')
    store().resetPlan()
    claimRetirementPlanFor(OTHER)
    claimRetirementPlanFor(USER)
    claimRetirementPlanFor('')
    expect(store().ownerUserId).toBe('')
    claimRetirementPlanFor(USER)
    applyServerChangesToStores(
      [pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, model: 'perpetual' }, 2_000)],
      USER
    )
    quiet()
    // The applier really ran.
    expect(store().plan.model).toBe('perpetual')
    expect(queued()).toEqual([])
  })

  it('resetPlan DROPS a pending edit (AC-9: Clear local data never pushes)', () => {
    store().setModel('perpetual')
    expect(hasPendingPlanEdit()).toBe(true)
    store().resetPlan()
    quiet()
    expect(hasPendingPlanEdit()).toBe(false)
    expect(queued()).toEqual([])
  })

  it('an owner change DROPS a pending edit (AC-8): the plan it brings back is never pushed by it', () => {
    // An unclaimed plan edited under this session's bridge (its flush would skip:
    // not the session's), then the claim brings back the session's PARKED plan.
    // Without the drop the old timer would push that parked plan as an "edit".
    localStorage.setItem(
      `${RETIREMENT_PLANNER_STORAGE_KEY}:${USER}`,
      JSON.stringify({ ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '58' })
    )
    useRetirementPlannerStore.setState({ ownerUserId: '' })
    store().setModel('perpetual')
    claimRetirementPlanFor(USER)
    expect(store().plan.currentAgeInput).toBe('58')
    quiet()
    expect(queued()).toEqual([])
    // CONTROL: the session's own next edit does push.
    store().setModel('perpetual')
    quiet()
    expect(queued()).toEqual(['update retirementPlan'])
  })

  it('the free → paid seed uploads local rows but never the plan', async () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          userId: 0,
          name: 'Salary',
          amount: 500_000,
          frequency: 'monthly',
        } as never,
      ],
    })
    useRetirementPlannerStore.setState({
      plan: { ...RETIREMENT_PLAN_DEFAULTS, model: 'perpetual' },
    })

    await seedOnce(USER)

    // Positive anchor: the seed ran against this live bridge.
    expect(queued()).toEqual(['create incomeSource'])
  })
})

describe('AC-4: keystrokes coalesce', () => {
  it('20 keystrokes inside the window queue exactly ONE op, carrying the LAST value', () => {
    for (let i = 1; i <= 20; i += 1) {
      store().setDesiredIncomeInput((previous) => `${previous}${i % 10}`)
      vi.advanceTimersByTime(PLAN_PUSH_DEBOUNCE_MS - 1)
    }
    expect(queued()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(queued()).toEqual(['update retirementPlan'])
    expect(planUpdates()[0]?.plan.desiredIncomeInput).toBe('12345678901234567890')
  })

  it('a blur re-echo that formats to the same string queues nothing', () => {
    applyServerChangesToStores(
      [pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, desiredIncomeInput: '55,000.00' }, 2_000)],
      USER
    )
    // `reEcho` calls the setter with an updater that returns the same string.
    store().setDesiredIncomeInput((previous) => previous)
    quiet()
    expect(queued()).toEqual([])
    // CONTROL: a real change after it does push.
    store().setDesiredIncomeInput('56,000.00')
    quiet()
    expect(queued()).toEqual(['update retirementPlan'])
  })

  it('a plan equal to the last one PUSHED queues nothing; a change after it does', () => {
    store().setModel('perpetual')
    quiet()
    store().setModel('perpetual')
    quiet()
    expect(queued()).toEqual(['update retirementPlan'])
    store().setModel('deplete')
    quiet()
    expect(queued()).toEqual(['update retirementPlan', 'update retirementPlan'])
  })

  it('an edit back to the plan last PULLED queues nothing', () => {
    applyServerChangesToStores([pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS }, 2_000)], USER)
    store().setModel('perpetual')
    store().setModel('deplete')
    quiet()
    expect(queued()).toEqual([])
  })

  it.each([
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
    [
      'visibilitychange: hidden',
      () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
      },
    ],
  ])('%s flushes a pending edit into the queue at once', (_, leave) => {
    store().setModel('perpetual')
    leave()
    expect(queued()).toEqual(['update retirementPlan'])
    expect(hasPendingPlanEdit()).toBe(false)
    // Nothing is sent twice when the timer would have fired.
    quiet()
    expect(queued()).toEqual(['update retirementPlan'])
  })

  it('visibilitychange while still VISIBLE flushes nothing', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    store().setModel('perpetual')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(queued()).toEqual([])
    expect(hasPendingPlanEdit()).toBe(true)
  })
})

describe('AC-5: a pull never overwrites un-pushed typing', () => {
  it('type → push → type again → a pull of this device’s OWN earlier write: the newer value stays and is what is sent, based on that write', () => {
    useRetirementPlannerStore.setState({ serverUpdatedAt: new Date(1_000).toISOString() })
    store().setCurrentAgeInput('40')
    quiet()
    const first = planUpdates()[0]
    expect(first?.plan.currentAgeInput).toBe('40')
    expect(first?.baseVersion).toBe(1_000)

    store().setCurrentAgeInput('41')
    // The server applied the first push at t=5000 and a pull delivers it.
    applyServerChangesToStores([pulledPlan(first?.plan as RetirementPlan, 5_000)], USER)
    expect(store().plan.currentAgeInput).toBe('41')

    quiet()
    const second = planUpdates()[1]
    expect(second?.plan.currentAgeInput).toBe('41')
    // Core keeps this op over the change the applier skipped (`5000 <= base`).
    expect(second?.baseVersion).toBe(5_000)
  })

  it('a skip never moves the recorded server version BACKWARDS', () => {
    useRetirementPlannerStore.setState({ serverUpdatedAt: new Date(9_000).toISOString() })
    store().setModel('perpetual')
    applyServerChangesToStores([pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS }, 4_000)], USER)
    expect(store().serverUpdatedAt).toBe(new Date(9_000).toISOString())
  })

  it('CONTROL: with nothing pending the same pull IS applied', () => {
    applyServerChangesToStores(
      [pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '50' }, 5_000)],
      USER
    )
    expect(store().plan.currentAgeInput).toBe('50')
    expect(store().serverUpdatedAt).toBe(new Date(5_000).toISOString())
  })
})

describe('AC-6: owner and session', () => {
  it('a plan owned by another account is never queued under this session', () => {
    useRetirementPlannerStore.setState({ ownerUserId: OTHER })
    store().setModel('perpetual')
    quiet()
    expect(queued()).toEqual([])
  })

  it('an unclaimed plan (owner "") is never queued', () => {
    useRetirementPlannerStore.setState({ ownerUserId: '' })
    store().setModel('perpetual')
    quiet()
    expect(queued()).toEqual([])
  })

  it('free / signed out (no bridge): no timer, no op, the edit stays local', () => {
    clearSyncBridge()
    store().setModel('perpetual')
    expect(hasPendingPlanEdit()).toBe(false)
    quiet()
    expect(store().plan.model).toBe('perpetual')
    expect(queued()).toEqual([])
  })

  it('downgraded mid-debounce: nothing is queued and the local plan is kept', () => {
    store().setModel('perpetual')
    clearSyncBridge()
    quiet()
    expect(queued()).toEqual([])
    expect(store().plan.model).toBe('perpetual')
  })
})

describe('AC-7: the first-sign-in seed', () => {
  it('the server has no plan (`serverUpdatedAt` null after the pull): ONE create with the whole plan', async () => {
    useRetirementPlannerStore.setState({
      plan: { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '44' },
    })
    await expect(seedRetirementPlanIfServerHasNone()).resolves.toBe(true)
    expect(queued()).toEqual(['create retirementPlan'])
    const [, entityId, data] = handle.queueCreate.mock.calls[0] ?? []
    expect(entityId).toBe(USER)
    expect((data as { plan: RetirementPlan }).plan.currentAgeInput).toBe('44')
    // The seeded plan counts as synced: an edit back to it sends nothing.
    store().setModel('perpetual')
    store().setModel('deplete')
    quiet()
    expect(queued()).toEqual(['create retirementPlan'])
  })

  it('the server has a plan (the pull set `serverUpdatedAt`): nothing is sent', async () => {
    applyServerChangesToStores([pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS }, 2_000)], USER)
    await expect(seedRetirementPlanIfServerHasNone()).resolves.toBe(false)
    expect(queued()).toEqual([])
  })

  it('another owner’s plan, no session, or a pending edit: nothing is seeded', async () => {
    useRetirementPlannerStore.setState({ ownerUserId: OTHER })
    await expect(seedRetirementPlanIfServerHasNone()).resolves.toBe(false)
    useRetirementPlannerStore.setState({ ownerUserId: USER })
    store().setModel('perpetual')
    await expect(seedRetirementPlanIfServerHasNone()).resolves.toBe(false)
    expect(queued()).toEqual([])
    clearSyncBridge()
    await expect(seedRetirementPlanIfServerHasNone()).resolves.toBe(false)
  })
})

describe('AC-12: a refused plan edit stays on this device until a push succeeds', () => {
  function refusedPlanOp(): SyncOperation {
    return {
      id: 'op-plan',
      type: 'update',
      entityType: 'retirementPlan',
      entityId: USER,
      data: { userId: USER, plan: store().plan },
      timestamp: 3_000,
      deviceId: 'd',
      userId: USER,
    } as SyncOperation
  }

  function refusalDeps(): RefusalHandlerDeps {
    return {
      queue: {
        getAll: () => [],
        discardBatch: vi.fn(async () => ({ removed: 0, persisted: true })),
      },
      discardOperationsForDeletedProfile: vi.fn(async () => []),
      applyChanges: vi.fn(),
      lookupLocalRow: vi.fn(() => undefined),
      requestFullRepull: vi.fn(),
      notify: vi.fn(),
    }
  }

  async function refuseTheLocalPlan(): Promise<RetirementPlan> {
    useRetirementPlannerStore.setState({
      plan: { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '47' },
      serverUpdatedAt: new Date(1_000).toISOString(),
    })
    await handleRejectedOperations([refusedPlanOp()], refusalDeps())
    return store().plan
  }

  it('refusal → full pull: the local plan is unchanged (the notice stays true)', async () => {
    const local = await refuseTheLocalPlan()
    expect(store().localPlanDiverged).toBe(true)
    applyServerChangesToStores([pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS }, 4_000)], USER)
    expect(store().plan).toEqual(local)
    // The skipped version is recorded, so the healing push is based on it.
    expect(store().serverUpdatedAt).toBe(new Date(4_000).toISOString())
  })

  it('a later SUCCESSFUL plan push clears the marker, and the next pull applies again', async () => {
    await refuseTheLocalPlan()
    stampSyncedOwner([{ ...refusedPlanOp(), id: 'op-plan-2' }], USER)
    expect(store().localPlanDiverged).toBe(false)
    applyServerChangesToStores(
      [pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '60' }, 6_000)],
      USER
    )
    expect(store().plan.currentAgeInput).toBe('60')
  })

  it('an accepted op of ANOTHER entity, or another account’s plan op, does not clear it', async () => {
    await refuseTheLocalPlan()
    stampSyncedOwner(
      [
        { ...refusedPlanOp(), id: 'x', entityType: 'expense', entityId: 'row' },
        { ...refusedPlanOp(), id: 'y', entityId: OTHER, userId: OTHER },
      ] as SyncOperation[],
      USER
    )
    expect(store().localPlanDiverged).toBe(true)
  })

  it('the same plan typed again after a refusal IS pushed (the refused one is not "synced")', async () => {
    useRetirementPlannerStore.setState({ serverUpdatedAt: new Date(1_000).toISOString() })
    store().setCurrentAgeInput('47')
    quiet()
    expect(queued()).toEqual(['update retirementPlan'])
    await handleRejectedOperations([refusedPlanOp()], refusalDeps())
    store().setCurrentAgeInput('47')
    quiet()
    expect(queued()).toEqual(['update retirementPlan', 'update retirementPlan'])
  })

  it('an owner change and Clear local data (resetPlan) each clear it', async () => {
    await refuseTheLocalPlan()
    claimRetirementPlanFor(OTHER)
    expect(store().localPlanDiverged).toBe(false)

    claimRetirementPlanFor(USER)
    await refuseTheLocalPlan()
    store().resetPlan()
    expect(store().localPlanDiverged).toBe(false)
  })

  it('a refusal of ANOTHER account’s plan op marks nothing', async () => {
    useRetirementPlannerStore.setState({ ownerUserId: OTHER })
    await handleRejectedOperations([refusedPlanOp()], refusalDeps())
    expect(store().localPlanDiverged).toBe(false)
  })

  it('is persisted only while set, and a non-boolean persisted value reads as unset', async () => {
    const persisted = () =>
      JSON.parse(localStorage.getItem(RETIREMENT_PLANNER_STORAGE_KEY) ?? '{}').state
    store().setModel('perpetual')
    expect(persisted()).not.toHaveProperty('localPlanDiverged')
    await refuseTheLocalPlan()
    expect(persisted().localPlanDiverged).toBe(true)

    localStorage.setItem(
      RETIREMENT_PLANNER_STORAGE_KEY,
      JSON.stringify({ state: { ...persisted(), localPlanDiverged: 'false' }, version: 1 })
    )
    await useRetirementPlannerStore.persist.rehydrate()
    expect(store().localPlanDiverged).toBe(false)
  })
})
