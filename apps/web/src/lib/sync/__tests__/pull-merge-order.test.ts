/**
 * Pull-merge ordering — the unnamed fourth sync gate (Story 34.1a, AC-5).
 *
 * ⚠️ THIS FIXES A LIVE BUG THAT EXISTED BEFORE THIS STORY, not a hypothetical.
 * `applyOne` merges a pulled change by REMOVE-THEN-APPEND:
 *
 *     const without = current.filter((item) => item.id !== id)
 *     store.setState({ [collection]: [...without, entity] })
 *
 * and `applyServerChangesToStores` had NO re-sort anywhere. For income and
 * expenses — whose array order simply IS their display order, since nothing
 * sorted them — that meant a pulled UPDATE to any row silently moved that row to
 * the BOTTOM of the user's list on every single pull. The epic called sync
 * "triple-gated" and never named this file at all.
 *
 * It is also the gate that would have made the rest of this story pointless:
 * `sortOrder` persisted correctly, then ignored on the very next pull.
 *
 * Runs in the default `node` environment — the stores are plain zustand and need
 * no DOM here (rehydration is not involved).
 */

import type { ServerChange } from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { applyServerChangesToStores } from '../applyServerChanges'

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const at = (day: string) => `2026-01-${day}T00:00:00.000Z`

function incomeRow(id: string, name: string, sortOrder: number, createdAt: string) {
  return {
    id,
    userId: 0,
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
  /**
   * MUTATION KILLED (M4): remove the re-sort from applyServerChangesToStores.
   *
   * This is the exact regression from the story's §2, reproduced: the middle row
   * of a three-row list receives a pulled UPDATE, and must NOT end up last.
   */
  it('a pulled UPDATE to a middle row does NOT move it to the bottom', () => {
    useIncomeStore.setState({
      incomeSources: [
        incomeRow(ID_A, 'first', 0, at('01')),
        incomeRow(ID_B, 'second', 1, at('02')),
        incomeRow(ID_C, 'third', 2, at('03')),
      ],
    })

    applyServerChangesToStores([
      change({
        entityId: ID_B,
        data: { ...incomeRow(ID_B, 'second (edited)', 1, at('02')) },
      }),
    ])

    const rows = useIncomeStore.getState().incomeSources
    // Position preserved, and it really is the updated row.
    expect(rows.map((r) => r.name)).toEqual(['first', 'second (edited)', 'third'])
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  it('a pulled CREATE lands at the position its sortOrder dictates, not merely last', () => {
    useIncomeStore.setState({
      incomeSources: [incomeRow(ID_A, 'first', 0, at('01')), incomeRow(ID_C, 'third', 2, at('03'))],
    })

    applyServerChangesToStores([
      change({ entityId: ID_B, data: { ...incomeRow(ID_B, 'second', 1, at('02')) } }),
    ])

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

    applyServerChangesToStores([change({ entityId: ID_A, isDeleted: true, data: { id: ID_A } })])

    const rows = useIncomeStore.getState().incomeSources
    expect(rows.map((r) => r.name)).toEqual(['second', 'third'])
    // No reindex on delete — the gap is deliberate (AC-6).
    expect(rows.map((r) => r.sortOrder)).toEqual([1, 2])
  })

  /**
   * AC-5's convergence clause. Two devices reordered the same list offline and
   * both produced `sortOrder: 1` — legitimate under last-write-wins, which is
   * exactly why no unique constraint exists. Both devices must still show the
   * same order, resolved by createdAt then id.
   *
   * MUTATION KILLED (M7): drop the createdAt tiebreaker.
   */
  it('duplicate sortOrder values from two devices converge deterministically', () => {
    useIncomeStore.setState({
      incomeSources: [
        incomeRow(ID_A, 'local-dupe', 1, at('05')),
        incomeRow(ID_C, 'anchor', 0, at('01')),
      ],
    })

    applyServerChangesToStores([
      change({ entityId: ID_B, data: { ...incomeRow(ID_B, 'server-dupe', 1, at('03')) } }),
    ])

    // Both rows sit at position 1; createdAt ASC decides, so the earlier one wins.
    expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual([
      'anchor',
      'server-dupe',
      'local-dupe',
    ])
  })

  /**
   * The re-sort must run ONCE after the whole loop, and it must cover every
   * collection the batch touched — not just the first, and not just the last.
   */
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

    applyServerChangesToStores([
      change({
        entityType: 'incomeSource',
        entityId: ID_B,
        data: { ...incomeRow(ID_B, 'inc-2', 1, at('02')) },
      }),
      change({
        entityType: 'expense',
        entityId: ID_B,
        data: { ...incomeRow(ID_B, 'exp-2', 1, at('02')) },
      }),
      change({
        entityType: 'savingsGoal',
        entityId: ID_B,
        data: {
          id: ID_B,
          name: 'sav-2',
          targetAmount: 1,
          currentBalance: 0,
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
          type: 'investment',
          name: 'bal-2',
          currentBalance: 0,
          monthlyContribution: 0,
          frequency: 'monthly',
          sortOrder: 1,
          createdAt: at('02'),
          updatedAt: at('02'),
        },
      }),
    ])

    // Each of the four lands in the middle of its own list, not at the end.
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

  /**
   * ⚠️ ADDED BY CODE REVIEW 34.1a — the fixtures above ALL stamp `sortOrder`, so
   * the suite was blind by construction to the state the pull actually produces
   * today: migration 0013 is unapplied, so server rows have NO `sortOrder` column
   * and `applyOne` spreads them in verbatim. On such a list `nextSortOrder`
   * returns 0, and 0 beats the LAST sentinel, so the next locally-added row landed
   * at the TOP — a confirmed AC-3 violation. The pull now stamps on arrival.
   */
  it('stamps pulled rows that arrive WITHOUT a sortOrder (pre-migration server)', () => {
    applyServerChangesToStores([
      change({
        entityId: ID_A,
        data: { id: ID_A, userId: 0, name: 'no-order-B', createdAt: at('02') },
      }),
      change({
        entityId: ID_B,
        data: { id: ID_B, userId: 0, name: 'no-order-A', createdAt: at('01') },
      }),
    ])

    const rows = useIncomeStore.getState().incomeSources
    // Ordered by createdAt (their only usable key) and given real positions.
    expect(rows.map((r) => r.name)).toEqual(['no-order-A', 'no-order-B'])
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1])
  })

  it('AC-3 survives a pull: a row added AFTER unstamped rows arrive goes to the BOTTOM', () => {
    applyServerChangesToStores([
      change({
        entityId: ID_A,
        data: { id: ID_A, userId: 0, name: 'pulled-1', createdAt: at('01') },
      }),
      change({
        entityId: ID_B,
        data: { id: ID_B, userId: 0, name: 'pulled-2', createdAt: at('02') },
      }),
    ])

    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'LOCAL-NEW', amount: 100, frequency: 'monthly' })

    // Before the stamping fix this was ['LOCAL-NEW', 'pulled-1', 'pulled-2'].
    expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual([
      'pulled-1',
      'pulled-2',
      'LOCAL-NEW',
    ])
  })

  it('does not renumber positions the server DID supply', () => {
    useIncomeStore.setState({ incomeSources: [incomeRow(ID_A, 'kept', 9, at('01'))] })
    applyServerChangesToStores([
      change({
        entityId: ID_B,
        data: { id: ID_B, userId: 0, name: 'orphan', createdAt: at('02') },
      }),
    ])
    expect(useIncomeStore.getState().incomeSources.map((r) => [r.name, r.sortOrder])).toEqual([
      ['kept', 9],
      ['orphan', 10],
    ])
  })

  /**
   * ⚠️ ADDED BECAUSE THE REVIEW PATCH'S OWN MUTATION CAME BACK GREEN.
   *
   * `applyOne` early-returns on a change with no id, and `touchedOrdered` used to
   * be populated unconditionally afterwards — so a batch that applied NOTHING still
   * triggered a re-sort, making the "which collections were genuinely touched"
   * comment false. Reverting the guard passed 18/18, so the fix had shipped
   * untested. Observing it requires a collection in a deliberately UNSORTED state:
   * with the guard nothing re-sorts it, without the guard it silently gets sorted.
   */
  it('a batch of only-skipped changes does not re-sort anything', () => {
    // Deliberately out of order, and deliberately NOT what a re-sort would produce.
    useIncomeStore.setState({
      incomeSources: [incomeRow(ID_C, 'third', 2, at('03')), incomeRow(ID_A, 'first', 0, at('01'))],
    })

    applyServerChangesToStores([
      // No entityId — applyOne skips it defensively and applies nothing.
      change({ entityType: 'incomeSource', entityId: '', data: { name: 'ignored' } }),
    ])

    // Untouched. If the collection came back ['first','third'] a re-sort ran for a
    // batch that changed nothing.
    expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual(['third', 'first'])
  })

  it('leaves collections the batch did not touch alone', () => {
    const untouched = [incomeRow(ID_C, 'third', 2, at('03')), incomeRow(ID_A, 'first', 0, at('01'))]
    useExpenseStore.setState({ expenses: untouched.map((r) => ({ ...r })) })
    useIncomeStore.setState({ incomeSources: [incomeRow(ID_A, 'inc', 0, at('01'))] })

    applyServerChangesToStores([
      change({
        entityType: 'incomeSource',
        entityId: ID_B,
        data: { ...incomeRow(ID_B, 'inc-2', 1, at('02')) },
      }),
    ])

    // Deliberately still in its original (unsorted) order: nothing pulled for it.
    expect(useExpenseStore.getState().expenses.map((r) => r.name)).toEqual(['third', 'first'])
  })
})
