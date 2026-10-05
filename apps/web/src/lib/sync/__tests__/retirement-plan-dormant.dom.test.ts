/**
 * DORMANT: in story 99.2 no client path queues a `retirementPlan` op (AC-8).
 *
 * 99.2 is Part A of a split (Lucas, 2026-10-05): the server holds and serves the
 * plan, but the client PUSH, with its debounce and echo rules, is story 99.3's.
 * Merged alone, 99.2 must therefore queue NOTHING for the plan. This file drives
 * every writer of the retirement store with a LIVE sync bridge and asserts zero
 * plan ops.
 *
 * ⚠️ Story 99.3 deliberately INVERTS the setter half of this test (its intent
 * setters push); `resetPlan`, the claim, the applier and the seed must stay at
 * zero there too.
 *
 * ⚠️ POSITIVE ANCHOR: the same bridge records the income row the seed uploads,
 * so "zero plan ops" cannot pass because the bridge recorded nothing at all.
 */

import type { ServerChange } from '@budget-planner/core/sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIncomeStore } from '../../../stores/incomeStore'
import {
  RETIREMENT_PLAN_DEFAULTS,
  claimRetirementPlanFor,
  useRetirementPlannerStore,
} from '../../../stores/retirementPlannerStore'
import { applyServerChangesToStores } from '../applyServerChanges'
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

/** Every entity type the bridge was asked to queue, in order. */
function queuedEntityTypes(): string[] {
  return [
    ...handle.queueCreate.mock.calls.map((call) => call[0]),
    ...handle.queueUpdate.mock.calls.map((call) => call[0]),
    ...handle.queueDelete.mock.calls.map((call) => call[0]),
  ]
}

beforeEach(() => {
  localStorage.clear()
  useRetirementPlannerStore.setState({
    plan: { ...RETIREMENT_PLAN_DEFAULTS },
    ownerUserId: USER,
    serverUpdatedAt: null,
  })
  useIncomeStore.setState({ incomeSources: [] })
  handle = makeHandle()
  registerSyncBridge(handle)
})

afterEach(() => {
  clearSyncBridge()
})

describe('AC-8: nothing queues a retirementPlan op in story 99.2', () => {
  it('every store setter, resetPlan and the claim queue no plan op', () => {
    const s = useRetirementPlannerStore.getState()
    s.setCurrentAgeInput('41')
    s.setCurrentAgeInput((previous) => `${previous}0`)
    s.setLifeExpectancyInput('87')
    s.setDesiredIncomeInput('55,000.00')
    s.markDesiredIncomeAuthored('en-US')
    s.setDesiredIncomeForLocale('55.000,00', 'de-DE')
    s.setAdoptedMonthlyCents(240_000)
    s.setAdoptedMonthlyCents(null)
    s.setIncomeBasis('monthly')
    s.setAnnualReturnInput('5.5')
    s.setPostRetirementReturn('3.0')
    s.setModel('perpetual')
    // The setters really ran (99.2 review: this was claimed below, never checked).
    expect(useRetirementPlannerStore.getState().plan).toMatchObject({
      currentAgeInput: '410',
      desiredIncomeInput: '55.000,00',
      incomeBasis: 'monthly',
      model: 'perpetual',
    })
    s.resetPlan()
    claimRetirementPlanFor(OTHER)
    claimRetirementPlanFor(USER)
    claimRetirementPlanFor('')

    // The claims really ran, and nothing was queued.
    expect(useRetirementPlannerStore.getState().ownerUserId).toBe('')
    expect(queuedEntityTypes()).toEqual([])
  })

  it('the pull applier queues no plan op', () => {
    const change: ServerChange = {
      entityType: 'retirementPlan',
      entityId: USER,
      data: { id: USER, userId: USER, plan: { ...RETIREMENT_PLAN_DEFAULTS, model: 'perpetual' } },
      updatedAt: 2_000,
      isDeleted: false,
    }
    applyServerChangesToStores([change], USER)

    expect(useRetirementPlannerStore.getState().plan.model).toBe('perpetual')
    expect(queuedEntityTypes()).toEqual([])
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
    useRetirementPlannerStore.getState().setModel('perpetual')

    await seedOnce(USER)

    // Positive anchor: the seed ran against this live bridge.
    expect(queuedEntityTypes()).toEqual(['incomeSource'])
  })
})
