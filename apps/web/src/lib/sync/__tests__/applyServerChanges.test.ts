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

/**
 * ⚠️ The uuid the SERVER sends (story 66.2).
 *
 * The `ServerChange.data` fixtures below used to carry a `userId` that could
 * never have been on the wire: `0` on the income fixture, the string `'u-1'` on
 * `profileChange` and both Story-54.2 fixtures. (The story's header first said
 * "every fixture carried `userId: 0`"; its code review corrected that — two
 * different wrong shapes, not one.) `0` is the CLIENT STORE's type for the free
 * tier — `incomeSources.userId` is
 * `uuid(...).notNull()` and `getSyncChanges` emits `data: row` verbatim, so a
 * number was never on the wire. The fixtures were wrong about production, and
 * `tsconfig.app.json` excludes test files from the type-check, so no compiler
 * could ever have said so. Story 66.2's pull-path guard is what surfaced it.
 *
 * ⚠️ The `useXStore.setState(...)` fixtures further down still use `userId: 0`
 * ON PURPOSE: those are LOCAL rows the applier never validates, and 0 is the
 * correct client-store shape for them.
 */
const SERVER_USER_ID = '11111111-1111-4111-8111-111111111111'

function incomeChange(overrides: Partial<ServerChange> = {}): ServerChange {
  return {
    entityType: 'incomeSource',
    entityId: UUID_A,
    data: {
      id: UUID_A,
      userId: SERVER_USER_ID,
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
          userId: SERVER_USER_ID,
          name: 'Emergency fund',
          targetAmount: 1000000,
          currentBalance: 250000,
          // NOT NULL column; a pulled row always carries it (code review 66.2).
          allocationMode: 'automatic',
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
      userId: SERVER_USER_ID,
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

  /**
   * Story 63.2 (AC-9): the SECOND device, after a default was deleted elsewhere.
   *
   * ⚠️ This is the consumer that story 63.2 could break without any local test
   * noticing. `reconcileActiveProfile` resolves with
   * `active ?? find(p => p.isDefault) ?? realProfiles[0]` — a fallback that
   * yields the WRONG profile rather than an error, so an account left with zero
   * defaults lands the user on whichever profile happens to be first. That is
   * silent, and it is why the deleting device must queue the promotion rather
   * than write the flag locally.
   *
   * The device here has a stale active id, so it falls through to the `isDefault`
   * arm — which is the only way to observe the promotion at all, since a device
   * sitting on a valid profile keeps its own selection by design.
   */
  it('lands on the PROMOTED default after the old default was deleted elsewhere', () => {
    applyServerChangesToStores([
      // Array order puts the promoted profile SECOND on purpose: resolving by
      // position rather than by the flag would pass with it first.
      profileChange(SERVER_PROFILE_OTHER, false, 'Side'),
      profileChange(SERVER_PROFILE_DEFAULT, true, 'Promoted'),
    ])

    expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_DEFAULT)
    const profiles = useProfileStore.getState().profiles
    expect(profiles.filter((p) => p.isDefault)).toHaveLength(1)
    expect(profiles.find((p) => p.isDefault)?.name).toBe('Promoted')
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
          userId: SERVER_USER_ID,
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
          userId: SERVER_USER_ID,
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

/**
 * A pulled profile tombstone destroys that profile's local rows (story 66.3,
 * AC-8).
 *
 * ⚠️⚠️ THIS IS THE SECOND-DEVICE ARM, and it is the layer the epic did not name.
 * `getSyncChanges` filters every child table by the client's ACTIVE profileId, so
 * a device on another profile pulls the profile tombstone and NONE of the child
 * tombstones — and once the profile row is gone it can never make that profile
 * active to ask for them. Pinned server-side by
 * `server/api/__tests__/sync-profile-cascade.db.test.ts`.
 */
describe('a pulled userProfile tombstone cascades locally (story 66.3)', () => {
  const DOOMED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

  beforeEach(() => {
    useProfileStore.setState({
      profiles: [
        { id: DOOMED, userId: SERVER_USER_ID, name: 'Business', isDefault: false, currency: 'EUR' },
        { id: UUID_A, userId: SERVER_USER_ID, name: 'Main', isDefault: true, currency: 'EUR' },
      ],
      activeProfileId: UUID_A,
    } as never)
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'i-doomed',
          userId: 0,
          profileId: DOOMED,
          name: 'Consulting',
          amount: 1,
          frequency: 'monthly',
        },
        {
          id: 'i-keeper',
          userId: 0,
          profileId: UUID_A,
          name: 'Salary',
          amount: 2,
          frequency: 'monthly',
        },
        {
          id: 'i-legacy',
          userId: 0,
          profileId: null,
          name: 'Legacy',
          amount: 3,
          frequency: 'monthly',
        },
      ],
    } as never)
    useCategoryStore.setState({
      categories: [
        {
          id: 'c-doomed',
          userId: 0,
          profileId: DOOMED,
          name: 'Software',
          kind: 'expense',
          isDeleted: false,
        },
      ],
    } as never)
  })

  it('removes the profile AND its rows, keeping the survivor and the unscoped row', () => {
    applyServerChangesToStores([
      {
        entityType: 'userProfile',
        entityId: DOOMED,
        data: {},
        isDeleted: true,
        updatedAt: Date.now(),
      } as ServerChange,
    ])

    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([UUID_A])
    expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toEqual([
      'i-keeper',
      'i-legacy',
    ])
    expect(useCategoryStore.getState().categories).toEqual([])
  })

  /**
   * ⚠️ NEGATIVE CONTROL for the arm above — mislabelled a POSITIVE control in the
   * first version (code review). A tombstone for a DIFFERENT entity type must not
   * cascade; without this, a cascade that fired on EVERY tombstone would still
   * pass the test above.
   *
   * ⚠⚠ It also asserts the income tombstone was genuinely APPLIED. Without that
   * line the test proves nothing about the `entityType === 'userProfile'`
   * condition it exists to guard: if `applyOne` returned early for any unrelated
   * reason, nothing would cascade, nothing would be removed, and every remaining
   * assertion here would still pass. A control that cannot fail is not a control.
   */
  it('does NOT cascade on a tombstone for any other entity type', () => {
    applyServerChangesToStores([
      {
        entityType: 'incomeSource',
        entityId: 'i-keeper',
        data: {},
        isDeleted: true,
        updatedAt: Date.now(),
      } as ServerChange,
    ])

    // The tombstone under test really was applied — this is what makes the two
    // assertions below meaningful rather than vacuous.
    expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).not.toContain('i-keeper')
    expect(useCategoryStore.getState().categories.map((r) => r.id)).toEqual(['c-doomed'])
    expect(useProfileStore.getState().profiles).toHaveLength(2)
  })
})
