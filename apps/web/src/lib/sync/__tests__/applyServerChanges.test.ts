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
import { useIncomeStore } from '../../../stores/incomeStore'
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
