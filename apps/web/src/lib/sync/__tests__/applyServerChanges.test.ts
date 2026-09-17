/**
 * Tests for applyServerChangesToStores — uuid reconciliation (Story 5-14).
 *
 * The headline guarantee (AC-4): a row created on Device A with a client uuid,
 * then pulled on Device B, yields EXACTLY ONE row keyed by that shared uuid — no
 * duplicate. This is the whole reason entity PKs became client-generatable uuids:
 * the old serial-int PKs meant a pulled server row could never be matched to the
 * locally-created row, so it duplicated.
 */

import type { ServerChange } from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useCategoryStore } from '../../../stores/categoryStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { applyServerChangesToStores } from '../applyServerChanges'

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function incomeChange(overrides: Partial<ServerChange> = {}): ServerChange {
  return {
    entityType: 'incomeSource',
    entityId: UUID_A,
    data: {
      id: UUID_A,
      userId: 0,
      name: 'Salary',
      amount: 500000,
      frequency: 'monthly',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    },
    updatedAt: 2000,
    isDeleted: false,
    ...overrides,
  }
}

describe('applyServerChangesToStores — uuid reconciliation (Story 5-14)', () => {
  beforeEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useSavingsStore.setState({ savingsGoals: [] })
  })

  it('AC-4: a client-created row pulled back yields exactly ONE row (no duplicate)', () => {
    // Device A created this row locally with a client uuid, pushed it, and now the
    // server pull returns the SAME uuid back (e.g. on Device B, or a re-pull on A).
    useIncomeStore.setState({
      incomeSources: [
        {
          id: UUID_A,
          userId: 0,
          name: 'Salary (local)',
          amount: 500000,
          frequency: 'monthly',
          createdAt: '2026-06-28T00:00:00.000Z',
          updatedAt: '2026-06-28T00:00:00.000Z',
        },
      ],
    })

    applyServerChangesToStores([
      incomeChange({ data: { ...incomeChange().data, name: 'Salary (server)' } }),
    ])

    const rows = useIncomeStore.getState().incomeSources.filter((s) => s.id === UUID_A)
    // Exactly one row — the server row REPLACED the local one (not appended).
    expect(rows).toHaveLength(1)
    // And it is keyed by the shared uuid, carrying the authoritative server data.
    expect(rows[0].name).toBe('Salary (server)')
    expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
  })

  it('inserts a brand-new pulled row keyed by its uuid', () => {
    applyServerChangesToStores([
      incomeChange({ entityId: UUID_B, data: { ...incomeChange().data, id: UUID_B } }),
    ])

    const sources = useIncomeStore.getState().incomeSources
    expect(sources).toHaveLength(1)
    expect(sources[0].id).toBe(UUID_B)
  })

  it('a tombstone removes the row matched by uuid', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: UUID_A,
          userId: 0,
          name: 'Salary',
          amount: 500000,
          frequency: 'monthly',
          createdAt: '2026-06-28T00:00:00.000Z',
          updatedAt: '2026-06-28T00:00:00.000Z',
        },
      ],
    })

    applyServerChangesToStores([incomeChange({ isDeleted: true, updatedAt: 3000 })])

    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })

  it('P3: skips a change with a missing/empty entityId instead of inserting an orphan', () => {
    applyServerChangesToStores([incomeChange({ entityId: '' })])
    // No `{ id: '' }` orphan written — the store stays empty.
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })

  it('reconciles each entity type by uuid into its own store/collection', () => {
    // savingsGoal maps to a different store + collection ('savingsGoals'); prove the
    // generic binding writes there too.
    applyServerChangesToStores([
      {
        entityType: 'savingsGoal',
        entityId: UUID_B,
        data: {
          id: UUID_B,
          name: 'Emergency fund',
          targetAmount: 1000000,
          currentBalance: 250000,
          createdAt: '2026-06-28T00:00:00.000Z',
          updatedAt: '2026-06-28T00:00:00.000Z',
        },
        updatedAt: 2000,
        isDeleted: false,
      },
    ])

    const goals = useSavingsStore.getState().savingsGoals
    expect(goals).toHaveLength(1)
    expect(goals[0].id).toBe(UUID_B)
  })
})

const SERVER_PROFILE_DEFAULT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SERVER_PROFILE_OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function profileChange(id: string, isDefault: boolean, name: string): ServerChange {
  return {
    entityType: 'userProfile',
    entityId: id,
    data: {
      id,
      userId: 'u-1',
      name,
      isDefault,
      currency: 'NONE',
    },
    updatedAt: 2000,
    isDeleted: false,
  }
}

describe('applyServerChangesToStores — active-profile reconciliation (Story 5-15)', () => {
  beforeEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    // Start from the client default: a locally-generated profile id that does NOT
    // exist server-side (the bootstrap gap 5-15 closes).
    useProfileStore.setState({
      profiles: [
        {
          id: 'local-default',
          userId: '',
          name: 'Main Profile',
          isDefault: true,
          currency: 'NONE',
        },
      ],
      activeProfileId: 'local-default',
    })
  })

  it('repoints a stale active profile to the pulled DEFAULT server profile', () => {
    applyServerChangesToStores([
      profileChange(SERVER_PROFILE_OTHER, false, 'Side'),
      profileChange(SERVER_PROFILE_DEFAULT, true, 'Main'),
    ])

    // The locally-generated active id was not among the pulled profiles, so it is
    // repointed to the server's default profile — not just the first one.
    expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_DEFAULT)
  })

  it('falls back to the first profile when none is marked default', () => {
    applyServerChangesToStores([profileChange(SERVER_PROFILE_OTHER, false, 'Side')])
    expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_OTHER)
  })

  it('leaves an already-valid active profile untouched', () => {
    useProfileStore.setState({
      profiles: [
        {
          id: SERVER_PROFILE_DEFAULT,
          userId: 'u-1',
          name: 'Main',
          isDefault: true,
          currency: 'NONE',
        },
      ],
      activeProfileId: SERVER_PROFILE_DEFAULT,
    })

    applyServerChangesToStores([profileChange(SERVER_PROFILE_OTHER, false, 'Side')])

    // The user's selection is still valid (it is in the set), so it is preserved
    // even though another profile arrived.
    expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_DEFAULT)
  })

  it('does NOT touch the active profile on a non-profile (income) pull', () => {
    applyServerChangesToStores([incomeChange()])
    expect(useProfileStore.getState().activeProfileId).toBe('local-default')
  })
})

describe('applyServerChangesToStores — placeholder re-home on reconcile (Story 54.4, AC-6)', () => {
  const TS = '2026-09-15T00:00:00.000Z'
  const OTHER_REAL = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

  beforeEach(() => {
    useProfileStore.setState({
      profiles: [
        {
          id: 'local-default',
          userId: '',
          name: 'Main Profile',
          isDefault: true,
          currency: 'NONE',
        },
      ],
      activeProfileId: 'local-default',
    })
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'stamped-placeholder',
          profileId: 'local-default',
          userId: 0,
          name: 'Added before the server profile arrived',
          amount: 1,
          frequency: 'monthly',
          categoryId: null,
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'stamped-other-real',
          profileId: OTHER_REAL,
          userId: 0,
          name: 'Belongs to a different real profile',
          amount: 2,
          frequency: 'monthly',
          categoryId: null,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
    useExpenseStore.setState({
      expenses: [
        {
          id: 'exp-placeholder',
          profileId: 'local-default',
          userId: 0,
          name: 'Rent',
          amount: 1,
          frequency: 'monthly',
          categoryId: null,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 'sav-placeholder',
          profileId: 'local-default',
          name: 'Fund',
          targetAmount: null,
          currentBalance: 1,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
    useBalanceStore.setState({
      entries: [
        {
          id: 'bal-placeholder',
          profileId: 'local-default',
          type: 'investment',
          name: 'ISA',
          currentBalance: 1,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
    useCategoryStore.setState({
      categories: [
        {
          id: 'cat-placeholder',
          userId: 0,
          profileId: 'local-default',
          name: 'Groceries',
          kind: 'expense',
          isDeleted: false,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  })

  it('re-homes rows and categories stamped with a dropped placeholder onto the new active profile', () => {
    applyServerChangesToStores([profileChange(SERVER_PROFILE_DEFAULT, true, 'Main')])

    expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_DEFAULT)
    const income = useIncomeStore.getState().incomeSources
    expect(income.find((row) => row.id === 'stamped-placeholder')?.profileId).toBe(
      SERVER_PROFILE_DEFAULT
    )
    expect(useExpenseStore.getState().expenses[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
    expect(useSavingsStore.getState().savingsGoals[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
    expect(useBalanceStore.getState().entries[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
    expect(useCategoryStore.getState().categories[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
  })

  it('leaves a row stamped with a different REAL profile untouched', () => {
    // The other real profile is IN the store (code review 54.4): a guard that
    // compared profile objects by identity rather than id would re-home its rows.
    useProfileStore.setState({
      profiles: [
        {
          id: 'local-default',
          userId: '',
          name: 'Main Profile',
          isDefault: true,
          currency: 'NONE',
        },
        { id: OTHER_REAL, userId: 'u-1', name: 'Real', isDefault: false, currency: 'NONE' },
      ],
      activeProfileId: 'local-default',
    })

    applyServerChangesToStores([profileChange(SERVER_PROFILE_DEFAULT, true, 'Main')])

    const income = useIncomeStore.getState().incomeSources
    expect(income.find((row) => row.id === 'stamped-other-real')?.profileId).toBe(OTHER_REAL)
  })

  it('re-homes nothing when no placeholder was dropped', () => {
    useProfileStore.setState({
      profiles: [
        { id: OTHER_REAL, userId: 'u-1', name: 'Real', isDefault: true, currency: 'NONE' },
      ],
      activeProfileId: OTHER_REAL,
    })

    applyServerChangesToStores([profileChange(SERVER_PROFILE_OTHER, false, 'Side')])

    // 'local-default' is not a profile in the store at all, so it was not dropped
    // by this reconcile and must not be rewritten.
    const income = useIncomeStore.getState().incomeSources
    expect(income.find((row) => row.id === 'stamped-placeholder')?.profileId).toBe('local-default')
  })

  it('keeps the placeholder when a store write throws, so the next reconcile finishes the re-home', () => {
    const original = useExpenseStore.setState
    useExpenseStore.setState = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      applyServerChangesToStores([profileChange(SERVER_PROFILE_DEFAULT, true, 'Main')])
    } finally {
      useExpenseStore.setState = original
    }

    // The failed reconcile must not have dropped the placeholder...
    expect(useProfileStore.getState().profiles.map((p) => p.id)).toContain('local-default')

    // ...so the next pull that delivers profiles completes the re-home.
    applyServerChangesToStores([profileChange(SERVER_PROFILE_DEFAULT, true, 'Main')])
    expect(useExpenseStore.getState().expenses[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
    expect(useProfileStore.getState().profiles.map((p) => p.id)).not.toContain('local-default')
  })
})

/**
 * Story 54.2 (FR78): the PULL half of the icon round trip.
 *
 * There is no per-field gate on this side — `getSyncChanges` selects whole rows
 * (`db.select()`) and `applyOne` spreads `change.data` — so what these assert is
 * that the structural path really is structural, and that a `null` icon survives
 * it rather than being dropped or coerced.
 */
describe('applyServerChangesToStores — profile icon (Story 54.2)', () => {
  beforeEach(() => {
    useProfileStore.setState({ profiles: [], activeProfileId: null })
  })

  it('lands a pulled icon in the store', () => {
    applyServerChangesToStores([
      {
        entityType: 'userProfile',
        entityId: SERVER_PROFILE_OTHER,
        data: {
          id: SERVER_PROFILE_OTHER,
          userId: 'u-1',
          name: 'Business',
          isDefault: false,
          currency: 'EUR',
          icon: '✈️',
        },
        updatedAt: 2000,
        isDeleted: false,
      },
    ])

    const stored = useProfileStore.getState().profiles.find((p) => p.id === SERVER_PROFILE_OTHER)
    expect(stored?.icon).toBe('✈️')
  })

  it('lands an explicit null icon without dropping the key or throwing', () => {
    applyServerChangesToStores([
      {
        entityType: 'userProfile',
        entityId: SERVER_PROFILE_OTHER,
        data: {
          id: SERVER_PROFILE_OTHER,
          userId: 'u-1',
          name: 'Business',
          isDefault: false,
          currency: 'EUR',
          icon: null,
        },
        updatedAt: 2000,
        isDeleted: false,
      },
    ])

    const stored = useProfileStore.getState().profiles.find((p) => p.id === SERVER_PROFILE_OTHER)
    expect(stored).toBeDefined()
    expect(stored?.icon).toBeNull()
  })
})
