/** applyOne removes then appends, so without the re-sort a pulled update moves its row to the bottom. */

import type { ServerChange } from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { applyServerChangesToStores } from '../applyServerChanges'

/** Server-shaped uuid, not the client store's free-tier `0`. */
const SERVER_USER_ID = '11111111-1111-4111-8111-111111111111'

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const at = (day: string) => `2026-01-${day}T00:00:00.000Z`

function incomeRow(id: string, name: string, sortOrder: number, createdAt: string) {
  return {
    id,
    userId: SERVER_USER_ID,
    name,
    amount: 1000,
    frequency: 'monthly' as const,
    categoryId: null,
    sortOrder,
    createdAt,
    updatedAt: createdAt,
  }
}

function change(
  overrides: Partial<ServerChange> & { data: Record<string, unknown> }
): ServerChange {
  return {
    entityType: 'incomeSource',
    entityId: ID_B,
    updatedAt: 2000,
    isDeleted: false,
    ...overrides,
  } as ServerChange
}

beforeEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
})

describe('applyServerChangesToStores — a pull cannot reorder the list (AC-5)', () => {
  it('a pulled UPDATE to a middle row does NOT move it to the bottom', () => {
    useIncomeStore.setState({
      incomeSources: [
        incomeRow(ID_A, 'first', 0, at('01')),
        incomeRow(ID_B, 'second', 1, at('02')),
        incomeRow(ID_C, 'third', 2, at('03')),
      ],
    })

    applyServerChangesToStores(
      [
        change({
          entityId: ID_B,
          data: { ...incomeRow(ID_B, 'second (edited)', 1, at('02')) },
        }),
      ],
      SERVER_USER_ID
    )

    const rows = useIncomeStore.getState().incomeSources
    expect(rows.map((r) => r.name)).toEqual(['first', 'second (edited)', 'third'])
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  it('a pulled CREATE lands at the position its sortOrder dictates, not merely last', () => {
    useIncomeStore.setState({
      incomeSources: [incomeRow(ID_A, 'first', 0, at('01')), incomeRow(ID_C, 'third', 2, at('03'))],
    })

    applyServerChangesToStores(
      [change({ entityId: ID_B, data: { ...incomeRow(ID_B, 'second', 1, at('02')) } })],
      SERVER_USER_ID
    )

    expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('a pulled DELETE preserves the order of the survivors', () => {
    useIncomeStore.setState({
      incomeSources: [
        incomeRow(ID_A, 'first', 0, at('01')),
        incomeRow(ID_B, 'second', 1, at('02')),
        incomeRow(ID_C, 'third', 2, at('03')),
      ],
    })

    applyServerChangesToStores(
      [change({ entityId: ID_A, isDeleted: true, data: { id: ID_A } })],
      SERVER_USER_ID
    )

    const rows = useIncomeStore.getState().incomeSources
    expect(rows.map((r) => r.name)).toEqual(['second', 'third'])
    // No reindex on delete: the gap is deliberate.
    expect(rows.map((r) => r.sortOrder)).toEqual([1, 2])
  })

  /** Equal sortOrder from two offline devices is legitimate; both must converge by createdAt then id. */
  it('duplicate sortOrder values from two devices converge deterministically', () => {
    useIncomeStore.setState({
      incomeSources: [
        incomeRow(ID_A, 'local-dupe', 1, at('05')),
        incomeRow(ID_C, 'anchor', 0, at('01')),
      ],
    })

    applyServerChangesToStores(
      [change({ entityId: ID_B, data: { ...incomeRow(ID_B, 'server-dupe', 1, at('03')) } })],
      SERVER_USER_ID
    )

    expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual([
      'anchor',
      'server-dupe',
      'local-dupe',
    ])
  })

  it('re-sorts EVERY ordered collection a mixed batch touched', () => {
    useIncomeStore.setState({
      incomeSources: [incomeRow(ID_A, 'inc-1', 0, at('01')), incomeRow(ID_C, 'inc-3', 2, at('03'))],
    })
    useExpenseStore.setState({
      expenses: [
        { ...incomeRow(ID_A, 'exp-1', 0, at('01')) },
        { ...incomeRow(ID_C, 'exp-3', 2, at('03')) },
      ],
    })
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: ID_A,
          name: 'sav-1',
          targetAmount: 1,
          currentBalance: 0,
          sortOrder: 0,
          createdAt: at('01'),
          updatedAt: at('01'),
        },
        {
          id: ID_C,
          name: 'sav-3',
          targetAmount: 1,
          currentBalance: 0,
          sortOrder: 2,
          createdAt: at('03'),
          updatedAt: at('03'),
        },
      ],
    })
    useBalanceStore.setState({
      entries: [
        {
          id: ID_A,
          type: 'investment',
          name: 'bal-1',
          currentBalance: 0,
          monthlyContribution: 0,
          frequency: 'monthly',
          sortOrder: 0,
          createdAt: at('01'),
          updatedAt: at('01'),
        },
        {
          id: ID_C,
          type: 'investment',
          name: 'bal-3',
          currentBalance: 0,
          monthlyContribution: 0,
          frequency: 'monthly',
          sortOrder: 2,
          createdAt: at('03'),
          updatedAt: at('03'),
        },
      ],
    })

    applyServerChangesToStores(
      [
        change({
          entityType: 'incomeSource',
          entityId: ID_B,
          data: { ...incomeRow(ID_B, 'inc-2', 1, at('02')) },
        }),
        change({
          entityType: 'expense',
          entityId: ID_B,
          // NOT NULL column, so a real pulled expense always carries it.
          data: { ...incomeRow(ID_B, 'exp-2', 1, at('02')), endsBeforeRetirement: false },
        }),
        change({
          entityType: 'savingsGoal',
          entityId: ID_B,
          data: {
            id: ID_B,
            userId: SERVER_USER_ID,
            name: 'sav-2',
            targetAmount: 1,
            currentBalance: 0,
            // NOT NULL column; a pulled row always carries it.
            allocationMode: 'automatic',
            sortOrder: 1,
            createdAt: at('02'),
            updatedAt: at('02'),
          },
        }),
        change({
          entityType: 'balanceTracking',
          entityId: ID_B,
          data: {
            id: ID_B,
            userId: SERVER_USER_ID,
            type: 'investment',
            name: 'bal-2',
            currentBalance: 0,
            monthlyContribution: 0,
            frequency: 'monthly',
            // NOT NULL column; a pulled row always carries it.
            contributionRecordedAsExpense: false,
            sortOrder: 1,
            createdAt: at('02'),
            updatedAt: at('02'),
          },
        }),
      ],
      SERVER_USER_ID
    )

    expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual([
      'inc-1',
      'inc-2',
      'inc-3',
    ])
    expect(useExpenseStore.getState().expenses.map((r) => r.name)).toEqual([
      'exp-1',
      'exp-2',
      'exp-3',
    ])
    expect(useSavingsStore.getState().savingsGoals.map((r) => r.name)).toEqual([
      'sav-1',
      'sav-2',
      'sav-3',
    ])
    expect(useBalanceStore.getState().entries.map((r) => r.name)).toEqual([
      'bal-1',
      'bal-2',
      'bal-3',
    ])
  })

  /** Pre-migration server rows have no sortOrder; without stamping, the next local row lands at the top. */
  it('stamps pulled rows that arrive WITHOUT a sortOrder (pre-migration server)', () => {
    applyServerChangesToStores(
      [
        change({
          entityId: ID_A,
          data: {
            id: ID_A,
            userId: SERVER_USER_ID,
            name: 'no-order-B',
            amount: 1000,
            frequency: 'monthly',
            createdAt: at('02'),
          },
        }),
        change({
          entityId: ID_B,
          data: {
            id: ID_B,
            userId: SERVER_USER_ID,
            name: 'no-order-A',
            amount: 1000,
            frequency: 'monthly',
            createdAt: at('01'),
          },
        }),
      ],
      SERVER_USER_ID
    )

    const rows = useIncomeStore.getState().incomeSources
    expect(rows.map((r) => r.name)).toEqual(['no-order-A', 'no-order-B'])
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1])
  })

  it('AC-3 survives a pull: a row added AFTER unstamped rows arrive goes to the BOTTOM', () => {
    applyServerChangesToStores(
      [
        change({
          entityId: ID_A,
          data: {
            id: ID_A,
            userId: SERVER_USER_ID,
            name: 'pulled-1',
            amount: 1000,
            frequency: 'monthly',
            createdAt: at('01'),
          },
        }),
        change({
          entityId: ID_B,
          data: {
            id: ID_B,
            userId: SERVER_USER_ID,
            name: 'pulled-2',
            amount: 1000,
            frequency: 'monthly',
            createdAt: at('02'),
          },
        }),
      ],
      SERVER_USER_ID
    )

    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'LOCAL-NEW', amount: 100, frequency: 'monthly' })

    expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual([
      'pulled-1',
      'pulled-2',
      'LOCAL-NEW',
    ])
  })

  it('does not renumber positions the server DID supply', () => {
    useIncomeStore.setState({ incomeSources: [incomeRow(ID_A, 'kept', 9, at('01'))] })
    applyServerChangesToStores(
      [
        change({
          entityId: ID_B,
          data: {
            id: ID_B,
            userId: SERVER_USER_ID,
            name: 'orphan',
            amount: 1000,
            frequency: 'monthly',
            createdAt: at('02'),
          },
        }),
      ],
      SERVER_USER_ID
    )
    expect(useIncomeStore.getState().incomeSources.map((r) => [r.name, r.sortOrder])).toEqual([
      ['kept', 9],
      ['orphan', 10],
    ])
  })

  /** Needs an unsorted collection to show that a skipped change triggers no re-sort. */
  it('a batch of only-skipped changes does not re-sort anything', () => {
    // Deliberately unsorted, so any re-sort would be visible.
    useIncomeStore.setState({
      incomeSources: [incomeRow(ID_C, 'third', 2, at('03')), incomeRow(ID_A, 'first', 0, at('01'))],
    })

    applyServerChangesToStores(
      [
        // No entityId: applyOne skips it and applies nothing.
        change({ entityType: 'incomeSource', entityId: '', data: { name: 'ignored' } }),
      ],
      SERVER_USER_ID
    )

    expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual(['third', 'first'])
  })

  it('leaves collections the batch did not touch alone', () => {
    const untouched = [incomeRow(ID_C, 'third', 2, at('03')), incomeRow(ID_A, 'first', 0, at('01'))]
    useExpenseStore.setState({ expenses: untouched.map((r) => ({ ...r })) })
    useIncomeStore.setState({ incomeSources: [incomeRow(ID_A, 'inc', 0, at('01'))] })

    applyServerChangesToStores(
      [
        change({
          entityType: 'incomeSource',
          entityId: ID_B,
          data: { ...incomeRow(ID_B, 'inc-2', 1, at('02')) },
        }),
      ],
      SERVER_USER_ID
    )

    expect(useExpenseStore.getState().expenses.map((r) => r.name)).toEqual(['third', 'first'])
  })
})
