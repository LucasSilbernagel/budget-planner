/**
 * A persisted string amount turns `+` into concatenation, so totals look plausible instead of
 * NaN; the guard must check `typeof`, not finiteness.
 */

import { createSynchronizationService } from '@budget-planner/core/sync'
import type { PullResult, ServerChange } from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import {
  RETIREMENT_PLAN_DEFAULTS,
  useRetirementPlannerStore,
} from '../../../stores/retirementPlannerStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { netWorthFromTotals } from '../../net-worth'
import { applyServerChangesToStores, reportRefusedServerChanges } from '../applyServerChanges'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '22222222-2222-4222-8222-222222222222'
const ROW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROW_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ISO = '2026-09-01T00:00:00.000Z'

function balanceChange(data: Record<string, unknown>, overrides: Partial<ServerChange> = {}) {
  return {
    entityType: 'balanceTracking',
    entityId: ROW_A,
    data: {
      id: ROW_A,
      userId: USER_ID,
      profileId: PROFILE_ID,
      type: 'investment',
      name: 'Brokerage',
      currentBalance: 300_000,
      monthlyContribution: 0,
      frequency: 'monthly',
      contributionRecordedAsExpense: false,
      sortOrder: 0,
      isDeleted: false,
      createdAt: ISO,
      updatedAt: ISO,
      ...data,
    },
    updatedAt: 2000,
    isDeleted: false,
    ...overrides,
  } satisfies ServerChange
}

function incomeChange(data: Record<string, unknown>, overrides: Partial<ServerChange> = {}) {
  return {
    entityType: 'incomeSource',
    entityId: ROW_A,
    data: {
      id: ROW_A,
      userId: USER_ID,
      profileId: PROFILE_ID,
      name: 'Salary',
      amount: 500_000,
      frequency: 'monthly',
      categoryId: null,
      sortOrder: 0,
      isDeleted: false,
      createdAt: ISO,
      updatedAt: ISO,
      ...data,
    },
    updatedAt: 2000,
    isDeleted: false,
    ...overrides,
  } satisfies ServerChange
}

function savingsChange(data: Record<string, unknown>, overrides: Partial<ServerChange> = {}) {
  return {
    entityType: 'savingsGoal',
    entityId: ROW_A,
    data: {
      id: ROW_A,
      userId: USER_ID,
      profileId: PROFILE_ID,
      name: 'Emergency fund',
      targetAmount: null,
      currentBalance: 250_000,
      monthlyAllocation: null,
      allocationMode: 'automatic',
      sortOrder: 0,
      isDeleted: false,
      createdAt: ISO,
      updatedAt: ISO,
      ...data,
    },
    updatedAt: 2000,
    isDeleted: false,
    ...overrides,
  } satisfies ServerChange
}

async function pullThrough(changes: ServerChange[]): Promise<PullResult> {
  const fetchServerChanges = vi.fn(async () => changes)
  const service = createSynchronizationService(USER_ID, {
    autoSync: false,
    debug: false,
    processOperation: async () => ({ success: true }),
    fetchServerChanges,
  })
  service.onChangesPulled((pulled) => applyServerChangesToStores(pulled, USER_ID))
  service.onServerChangesRefused(reportRefusedServerChanges)
  try {
    const result = await service.pull()
    expect(fetchServerChanges).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    return result
  } finally {
    service.destroy()
  }
}

beforeEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
  useProfileStore.setState({ profiles: [], activeProfileId: null })
})

describe('AC-1/AC-3: a malformed server row is refused, not written', () => {
  it('a STRING currentBalance never reaches the store', async () => {
    const result = await pullThrough([balanceChange({ currentBalance: '300000' })])
    expect(useBalanceStore.getState().entries).toHaveLength(0)
    expect(result.refused).toEqual([
      { entityType: 'balanceTracking', entityId: ROW_A, fields: ['currentBalance:invalid_type'] },
    ])
    expect(result.applied).toEqual([])
  })

  it('⚠️ the consequence: the concatenated total can no longer be produced', async () => {
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: ROW_B,
          userId: USER_ID,
          profileId: PROFILE_ID,
          name: 'Pension',
          targetAmount: null,
          currentBalance: 800_000,
          monthlyAllocation: null,
          allocationMode: 'automatic',
          sortOrder: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ] as any,
    })

    await pullThrough([savingsChange({ currentBalance: '300000' })])

    const savingsCents = useSavingsStore.getState().getTotalSavings()
    const net = netWorthFromTotals({
      investmentsCents: 0,
      savingsCents,
      assetsCents: 0,
      debtsCents: 15_000_000,
    })

    expect(savingsCents).toBe(800_000)
    expect(net).toBe(-14_200_000)
    expect(typeof savingsCents).toBe('number')
    expect(typeof net).toBe('number')
  })

  it('a STRING amount on a cashflow row never reaches the store', async () => {
    await pullThrough([incomeChange({ amount: '500000' })])
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })

  it('a non-finite amount never reaches the store', async () => {
    await pullThrough([incomeChange({ amount: Number.POSITIVE_INFINITY })])
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })

  it('an unknown frequency never reaches the store', async () => {
    await pullThrough([incomeChange({ frequency: 'fortnightly' })])
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })

  it('a row missing its required fields never reaches the store', async () => {
    await pullThrough([
      {
        entityType: 'incomeSource',
        entityId: ROW_A,
        data: { id: ROW_A, userId: USER_ID, profileId: PROFILE_ID },
        updatedAt: 2000,
        isDeleted: false,
      },
    ])
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })
})

describe('AC-1: a VALID row is written exactly as before — byte for byte', () => {
  it('writes the whole server payload, not a reshaped copy', async () => {
    await pullThrough([incomeChange({})])

    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(1)
    const row = rows[0] as unknown as Record<string, unknown>

    // `z.object` strips undeclared keys, so writing the parse output instead of `change.data`
    // would silently drop every row's profile scope and ordering.
    expect(row['profileId']).toBe(PROFILE_ID)
    expect(row['sortOrder']).toBe(0)
    expect(row['categoryId']).toBeNull()
    expect(row['createdAt']).toBe(ISO)
    expect(row['updatedAt']).toBe(ISO)
    expect(row['name']).toBe('Salary')
    expect(row['amount']).toBe(500_000)
  })

  it('a savings ACCOUNT (targetAmount null) is written, not refused', async () => {
    // `targetAmount: null` means a savings account with no target.
    await pullThrough([
      {
        entityType: 'savingsGoal',
        entityId: ROW_A,
        data: {
          id: ROW_A,
          userId: USER_ID,
          profileId: PROFILE_ID,
          name: 'Emergency fund',
          targetAmount: null,
          currentBalance: 250_000,
          monthlyAllocation: null,
          allocationMode: 'automatic',
          sortOrder: 0,
          isDeleted: false,
          createdAt: ISO,
          updatedAt: ISO,
        },
        updatedAt: 2000,
        isDeleted: false,
      },
    ])
    expect(useSavingsStore.getState().savingsGoals).toHaveLength(1)
  })

  it('a profile with a null description and null currency is written, not refused', async () => {
    await pullThrough([
      {
        entityType: 'userProfile',
        entityId: PROFILE_ID,
        data: {
          id: PROFILE_ID,
          userId: USER_ID,
          name: 'Main Profile',
          description: null,
          isDefault: true,
          currency: null,
          icon: null,
          isDeleted: false,
          createdAt: ISO,
          updatedAt: ISO,
        },
        updatedAt: 2000,
        isDeleted: false,
      },
    ])
    expect(useProfileStore.getState().profiles).toHaveLength(1)
  })
})

describe('AC-6: a tombstone is never validated', () => {
  it('a tombstone carrying NO payload at all still deletes the row', async () => {
    useBalanceStore.setState({
      entries: [
        {
          id: ROW_A,
          userId: USER_ID,
          profileId: PROFILE_ID,
          type: 'investment',
          name: 'Brokerage',
          currentBalance: 300_000,
          monthlyContribution: 0,
          frequency: 'monthly',
          contributionRecordedAsExpense: false,
          sortOrder: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ] as any,
    })

    // A tombstone carries no well-formed payload; validating it would stop deletes propagating.
    await pullThrough([
      {
        entityType: 'balanceTracking',
        entityId: ROW_A,
        data: {},
        updatedAt: 3000,
        isDeleted: true,
      },
    ])

    expect(useBalanceStore.getState().entries).toHaveLength(0)
  })

  it('a tombstone whose payload is MALFORMED still deletes the row', async () => {
    useBalanceStore.setState({
      entries: [
        {
          id: ROW_A,
          userId: USER_ID,
          profileId: PROFILE_ID,
          type: 'investment',
          name: 'Brokerage',
          currentBalance: 300_000,
          monthlyContribution: 0,
          frequency: 'monthly',
          contributionRecordedAsExpense: false,
          sortOrder: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ] as any,
    })

    await pullThrough([
      balanceChange({ currentBalance: '300000' }, { isDeleted: true, updatedAt: 3000 }),
    ])

    expect(useBalanceStore.getState().entries).toHaveLength(0)
  })
})

describe('AC-7: a pull whose only row was refused does not perturb ordering or the active profile', () => {
  it('the empty-id refusal inside the applier does not re-sort the collection', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: ROW_B,
          userId: USER_ID,
          profileId: PROFILE_ID,
          name: 'Salary',
          amount: 1,
          frequency: 'monthly',
          createdAt: ISO,
          updatedAt: ISO,
        },
      ] as any,
    })
    const before = useIncomeStore.getState().incomeSources
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      applyServerChangesToStores([incomeChange({}, { entityId: '' })], USER_ID)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
    expect(useIncomeStore.getState().incomeSources).toBe(before)
  })

  it('does not re-sort a collection whose only change was rejected', async () => {
    // `stampMissingSortOrder` assigns positions to rows lacking one, so an all-refused batch must
    // not trigger it or a rejected pull rewrites the user's ordering.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: ROW_B,
          userId: USER_ID,
          profileId: PROFILE_ID,
          name: 'Salary',
          amount: 1,
          frequency: 'monthly',
          createdAt: ISO,
          updatedAt: ISO,
        },
      ] as any,
    })
    const before = useIncomeStore.getState().incomeSources

    await pullThrough([incomeChange({ amount: '500000' })])

    expect(useIncomeStore.getState().incomeSources).toBe(before)
  })

  it('does not reconcile the active profile when the only profile change was rejected', async () => {
    // A rejected `userProfile` must not set `appliedProfile`, or `reconcileActiveProfile` can
    // repoint the active profile against an incomplete list.
    useProfileStore.setState({
      profiles: [{ id: 'local-default', name: 'Main Profile', userId: '', isDefault: true }] as any,
      activeProfileId: 'local-default',
    })
    const profilesBefore = useProfileStore.getState().profiles

    await pullThrough([
      {
        entityType: 'userProfile',
        entityId: PROFILE_ID,
        data: { id: PROFILE_ID, userId: USER_ID, isDefault: true, currency: 'USD' },
        updatedAt: 2000,
        isDeleted: false,
      },
    ])

    expect(useProfileStore.getState().activeProfileId).toBe('local-default')
    // Array identity, not length: any run of `reconcileActiveProfile` replaces this array.
    expect(useProfileStore.getState().profiles).toBe(profilesBefore)
  })

  it('one rejected row does not block the valid rows in the same batch', async () => {
    await pullThrough([
      incomeChange({ amount: '500000' }),
      incomeChange({ id: ROW_B }, { entityId: ROW_B }),
    ])

    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(ROW_B)
  })
})

describe('AC-5: a refusal is reported, not swallowed', () => {
  it('warns once per rejected row, without leaking the financial value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await pullThrough([balanceChange({ currentBalance: '300000' })])

      expect(warn).toHaveBeenCalledTimes(1)
      const [message, context] = warn.mock.calls[0] ?? []
      expect(String(message)).toContain('[applyServerChanges]')
      // A client-side warning has no redaction pass, so the money value must never be in the message.
      expect(JSON.stringify(context)).toContain('balanceTracking')
      expect(JSON.stringify(context)).not.toContain('300000')
      const { fields } = context as { fields: string[] }
      expect(fields).toEqual(['currentBalance:invalid_type'])
    } finally {
      warn.mockRestore()
    }
  })

  it('says nothing for a batch in which every row is valid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await pullThrough([incomeChange({})])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('AC-5: the empty-id refusal is reported too', () => {
  it('warns when a change carries no entityId, instead of dropping it silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await pullThrough([incomeChange({}, { entityId: '' })])
      expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      const [, context] = warn.mock.calls[0] ?? []
      expect((context as { fields: string[] }).fields).toEqual(['entityId:too_small'])
    } finally {
      warn.mockRestore()
    }
  })
})

describe('an unknown entity type is still ignored defensively, not warned about', () => {
  it('a future server-side entity type does not crash an older client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await pullThrough([
        {
          entityType: 'somethingNew' as any,
          entityId: ROW_A,
          data: { id: ROW_A },
          updatedAt: 2000,
          isDeleted: false,
        },
      ])
      expect(result.applied).toHaveLength(1)
      expect(result.refused).toEqual([])
      // An older client seeing a newer entity type is not a corrupt row.
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('story 75.4: the applier itself no longer validates — ONE validator, in core', () => {
  it('writes a row the schema would refuse, when it is called directly', () => {
    // Validation belongs in core's `pull()`, before last-writer-wins drops the queued edit;
    // a second `safeParse` in `applyOne` turns this red.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      applyServerChangesToStores([incomeChange({ amount: '500000' })], USER_ID)
      const rows = useIncomeStore.getState().incomeSources
      expect(rows).toHaveLength(1)
      expect((rows[0] as unknown as Record<string, unknown>)['amount']).toBe('500000')
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

/** The plan's pull gate is lenient on fields and strict on the envelope. */
describe('the retirement plan through core pull (story 99.2)', () => {
  const LOCAL = { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '50' }
  const planChange = (plan: unknown): ServerChange => ({
    entityType: 'retirementPlan',
    entityId: USER_ID,
    data: { id: USER_ID, userId: USER_ID, plan, isDeleted: false },
    updatedAt: 3000,
    isDeleted: false,
  })

  beforeEach(() => {
    useRetirementPlannerStore.setState({ plan: { ...LOCAL }, ownerUserId: USER_ID })
  })

  it('AC-6g: a non-object plan is REFUSED by core; the local plan is kept', async () => {
    const result = await pullThrough([planChange('not a plan')])
    expect(result.refused).toEqual([
      { entityType: 'retirementPlan', entityId: USER_ID, fields: ['plan:invalid_type'] },
    ])
    expect(useRetirementPlannerStore.getState().plan).toEqual(LOCAL)
  })

  it('a plan from a NEWER client (unknown field, unknown model) is applied, coerced', async () => {
    const result = await pullThrough([
      planChange({ ...LOCAL, currentAgeInput: '44', model: 'hybrid', futureField: 1 }),
    ])
    expect(result.refused).toEqual([])
    expect(useRetirementPlannerStore.getState().plan).toEqual({
      ...LOCAL,
      currentAgeInput: '44',
      model: 'deplete',
    })
  })
})
