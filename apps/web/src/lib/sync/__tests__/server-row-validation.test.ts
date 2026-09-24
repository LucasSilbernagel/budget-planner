/**
 * A pulled server row is validated before it enters a client store (Story 66.2, FR103).
 *
 * ## The defect this closes
 *
 * `applyOne` used to write the server payload in verbatim:
 *
 *     const entity = { ...change.data, id }
 *     store.setState({ [collection]: [...without, entity] })
 *
 * with no validation of any kind — the authoritative server row was trusted
 * completely. Every one of the six sync gates sits on the PUSH path or at rest;
 * not one ran on the server→client direction.
 *
 * ⚠️⚠️ The failure mode that matters is NOT a crash. A persisted STRING amount
 * makes `+` a CONCATENATION, so the totals come out large, finite and entirely
 * plausible, with no `NaN` anywhere to flag them. MEASURED, not illustrated —
 * this is the literal red output of the test below against `e3202df`:
 *
 *     AssertionError: expected '0300000800000' to be 800000
 *
 * The investment total came back as the STRING `'0300000800000'`. (The digits are
 * in that order because `resortCollection` re-sorts the collection after the
 * apply, and the two fixtures tie on `sortOrder` so the id tiebreaker puts the
 * poisoned row first — the shape of the bug, not the exact digits, is the point.)
 *
 * (`deferred-work.md:1031`; still live at `stores/savingsStore.ts` and
 * `stores/balanceStore.ts`, both of which sum raw persisted rows, and consumed
 * by `hooks/useNetWorth.ts` → `lib/net-worth.ts`.) A finiteness check alone does
 * not catch it — `Number.isFinite("300000")` is false, but the string never
 * reaches a finiteness check; it reaches an addition. The guard must test
 * `typeof === 'number'`, which is what zod's `z.number()` does.
 *
 * ## Fixture discipline
 *
 * ⚠️ Every fixture here carries a uuid STRING `userId`, because that is what the
 * server actually sends: `getSyncChanges` emits `data: row` — the whole drizzle
 * row — and `incomeSources.userId` is `uuid(...).notNull()`. The older fixtures
 * in this directory used `userId: 0`, a number, which is the CLIENT STORE's type
 * for the free tier and was never on the wire. They are corrected in the same
 * pass; a fixture that is not production-shaped proves nothing about production.
 */

import type { ServerChange } from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { netWorthFromTotals } from '../../net-worth'
import { applyServerChangesToStores } from '../applyServerChanges'

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

beforeEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
  useProfileStore.setState({ profiles: [], activeProfileId: null })
})

describe('AC-1/AC-3: a malformed server row is refused, not written', () => {
  it('a STRING currentBalance never reaches the store', () => {
    applyServerChangesToStores([balanceChange({ currentBalance: '300000' })])
    expect(useBalanceStore.getState().entries).toHaveLength(0)
  })

  it('⚠️ the consequence: the concatenated total can no longer be produced', () => {
    // ⚠️ This asserts through `getTotalSavings()` — the store's OWN selector,
    // production code — NOT a copy of its arithmetic written here. An earlier
    // draft of this test summed the rows with a local `reduce` annotated "the
    // same arithmetic the selectors perform"; its code review called that what it
    // was, a copy asserted against itself. `getTotalSavings` is the real
    // `totalSavingsFrom` reduce that `useNetWorth` ultimately feeds.
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
        // biome-ignore lint/suspicious/noExplicitAny: deliberately shaped as the store type
      ] as any,
    })

    applyServerChangesToStores([savingsChange({ currentBalance: '300000' })])

    const savingsCents = useSavingsStore.getState().getTotalSavings()
    const net = netWorthFromTotals({
      investmentsCents: 0,
      savingsCents,
      assetsCents: 0,
      debtsCents: 15_000_000,
    })

    // Against `e3202df` the equivalent assertion read:
    //   AssertionError: expected '0300000800000' to be 800000
    // The total was a STRING, and every figure derived from it was nonsense that
    // looked like money.
    expect(savingsCents).toBe(800_000)
    expect(net).toBe(-14_200_000)
    // ⚠️ The type assertion is the load-bearing one: a future change that let the
    // row through would make this a string again long before it made it NaN.
    expect(typeof savingsCents).toBe('number')
    expect(typeof net).toBe('number')
  })

  it('a STRING amount on a cashflow row never reaches the store', () => {
    applyServerChangesToStores([incomeChange({ amount: '500000' })])
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })

  it('a non-finite amount never reaches the store', () => {
    applyServerChangesToStores([incomeChange({ amount: Number.POSITIVE_INFINITY })])
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })

  it('an unknown frequency never reaches the store', () => {
    applyServerChangesToStores([incomeChange({ frequency: 'fortnightly' })])
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })

  it('a row missing its required fields never reaches the store', () => {
    applyServerChangesToStores([
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
  it('writes the whole server payload, not a reshaped copy', () => {
    applyServerChangesToStores([incomeChange({})])

    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(1)
    const row = rows[0] as unknown as Record<string, unknown>

    // ⚠️⚠️ The regression fence on `safeParse`-for-the-verdict-only. `z.object`
    // STRIPS undeclared keys, and the entity schemas declare none of these. If a
    // future edit writes the PARSE OUTPUT instead of `change.data`, every synced
    // row silently loses its profile scope and its ordering.
    expect(row['profileId']).toBe(PROFILE_ID)
    expect(row['sortOrder']).toBe(0)
    expect(row['categoryId']).toBeNull()
    expect(row['createdAt']).toBe(ISO)
    expect(row['updatedAt']).toBe(ISO)
    expect(row['name']).toBe('Salary')
    expect(row['amount']).toBe(500_000)
  })

  it('a savings ACCOUNT (targetAmount null) is written, not refused', () => {
    // ⚠️ The false-rejection fence. `savingsGoals.targetAmount` is nullable —
    // null means "savings account, no target" (story 16-1) — and core's schema
    // required a number until this story. Getting this wrong would have deleted
    // every savings account from every synced device.
    applyServerChangesToStores([
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

  it('a profile with a null description and null currency is written, not refused', () => {
    applyServerChangesToStores([
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
  it('a tombstone carrying NO payload at all still deletes the row', () => {
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
        // biome-ignore lint/suspicious/noExplicitAny: deliberately shaped as the store type
      ] as any,
    })

    // A tombstone is reconstructed from a soft-deleted ROW and is not required to
    // carry a well-formed payload. Validating it would stop deletes propagating
    // across devices — a silent, permanent data-resurrection bug.
    applyServerChangesToStores([
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

  it('a tombstone whose payload is MALFORMED still deletes the row', () => {
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
        // biome-ignore lint/suspicious/noExplicitAny: deliberately shaped as the store type
      ] as any,
    })

    applyServerChangesToStores([
      balanceChange({ currentBalance: '300000' }, { isDeleted: true, updatedAt: 3000 }),
    ])

    expect(useBalanceStore.getState().entries).toHaveLength(0)
  })
})

describe('AC-7: a rejected row does not perturb ordering or the active profile', () => {
  it('does not re-sort a collection whose only change was rejected', () => {
    // `resortCollection` runs `stampMissingSortOrder`, which ASSIGNS a position to
    // any row that lacks one. A batch whose every change was refused must not
    // trigger it, or a rejected pull silently rewrites the user's ordering.
    useIncomeStore.setState({
      // biome-ignore lint/suspicious/noExplicitAny: deliberately shaped as the store type
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

    applyServerChangesToStores([incomeChange({ amount: '500000' })])

    // Same array identity: nothing wrote to this collection at all.
    expect(useIncomeStore.getState().incomeSources).toBe(before)
  })

  it('does not reconcile the active profile when the only profile change was rejected', () => {
    // A rejected `userProfile` must not set `appliedProfile`. Otherwise
    // `reconcileActiveProfile` runs against a list that is MISSING the row it was
    // meant to add, and can repoint the active profile or drop placeholders.
    useProfileStore.setState({
      // biome-ignore lint/suspicious/noExplicitAny: deliberately shaped as the store type
      profiles: [{ id: 'local-default', name: 'Main Profile', userId: '', isDefault: true }] as any,
      activeProfileId: 'local-default',
    })
    const profilesBefore = useProfileStore.getState().profiles

    applyServerChangesToStores([
      {
        entityType: 'userProfile',
        entityId: PROFILE_ID,
        // `name` is required and absent → refused.
        data: { id: PROFILE_ID, userId: USER_ID, isDefault: true, currency: 'USD' },
        updatedAt: 2000,
        isDeleted: false,
      },
    ])

    expect(useProfileStore.getState().activeProfileId).toBe('local-default')
    // ⚠️ Array IDENTITY, not just length: `reconcileActiveProfile` calls
    // `setProfiles`/`setActiveProfileId`, so any run at all replaces this array.
    // Asserting only that an unchanged value is unchanged could not tell "did not
    // run" from "ran harmlessly" (code review 66.2).
    expect(useProfileStore.getState().profiles).toBe(profilesBefore)
  })

  it('one rejected row does not block the valid rows in the same batch', () => {
    applyServerChangesToStores([
      incomeChange({ amount: '500000' }),
      incomeChange({ id: ROW_B }, { entityId: ROW_B }),
    ])

    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(ROW_B)
  })
})

describe('AC-5: a refusal is reported, not swallowed', () => {
  it('warns once per rejected row, without leaking the financial value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      applyServerChangesToStores([balanceChange({ currentBalance: '300000' })])

      expect(warn).toHaveBeenCalledTimes(1)
      const [message, context] = warn.mock.calls[0] ?? []
      expect(String(message)).toContain('[applyServerChanges]')
      // ⚠️ The entity type and id are diagnosable; the row's MONEY is not logged.
      // `lib/logger.ts` redacts financial keys by name on the server paths, and a
      // client-side warning has no redaction pass at all — so the value must
      // never be put into the message in the first place.
      expect(JSON.stringify(context)).toContain('balanceTracking')
      expect(JSON.stringify(context)).not.toContain('300000')
      // ⚠️ The `fields` array is the diagnosable half and is asserted, not assumed:
      // without this the claim "the failing field paths are reported" rested on
      // nothing (code review 66.2).
      const { fields } = context as { fields: string[] }
      expect(fields).toEqual(['currentBalance:invalid_type'])
    } finally {
      warn.mockRestore()
    }
  })

  it('says nothing for a batch in which every row is valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      applyServerChangesToStores([incomeChange({})])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('AC-5: the empty-id refusal is reported too', () => {
  it('warns when a change carries no entityId, instead of dropping it silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      applyServerChangesToStores([incomeChange({}, { entityId: '' })])
      expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
      // Before the code review this path returned silently, so a row dropped for a
      // missing id was invisible while a row dropped for a bad amount was not.
      expect(warn).toHaveBeenCalledTimes(1)
      const [, context] = warn.mock.calls[0] ?? []
      expect((context as { fields: string[] }).fields).toEqual(['entityId:too_small'])
    } finally {
      warn.mockRestore()
    }
  })
})

describe('an unknown entity type is still ignored defensively, not warned about', () => {
  it('a future server-side entity type does not crash an older client', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      applyServerChangesToStores([
        {
          // biome-ignore lint/suspicious/noExplicitAny: simulating a NEWER server
          entityType: 'somethingNew' as any,
          entityId: ROW_A,
          data: { id: ROW_A },
          updatedAt: 2000,
          isDeleted: false,
        },
      ])
      // Pre-existing behaviour at the `!binding` guard in `applyOne`, deliberately
      // left alone: an older client seeing a newer entity type is not a corrupt row.
      // (No line number on purpose — this diff moved that guard once already.)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
