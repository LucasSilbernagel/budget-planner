/**
 * balanceStore persist-migration tests (Story 16-2, FR37).
 *
 * Pins the v1→v2 persist migration that backfills a default contribution
 * `frequency` of 'monthly' for legacy rows (pre-frequency entries were implicitly
 * monthly). This is required, not cosmetic: the normalization engine throws on an
 * undefined frequency, so an un-backfilled row would crash the timeline math.
 *
 * Runs in jsdom (`.dom.test.ts`) for a real `localStorage` + the zustand persist
 * middleware (the store uses `skipHydration`, so we drive `persist.rehydrate()`).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../balanceStore'

const STORAGE_KEY = 'budget-planner:balance-tracking'

beforeEach(() => {
  localStorage.clear()
  useBalanceStore.setState({ entries: [] })
})

describe('balanceStore — v1→v2 frequency backfill (Story 16-2)', () => {
  it('backfills frequency=monthly for a legacy v1 row lacking one', async () => {
    // A v1-shaped persisted payload: uuid ids already, but no `frequency`.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          entries: [
            {
              id: 'legacy-uuid-1',
              type: 'investment',
              name: 'Old Brokerage',
              currentBalance: 10000,
              monthlyContribution: 500,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      })
    )

    await useBalanceStore.persist.rehydrate()

    const [entry] = useBalanceStore.getState().entries
    expect(entry.frequency).toBe('monthly')
    // Existing values are preserved unchanged.
    expect(entry.name).toBe('Old Brokerage')
    expect(entry.monthlyContribution).toBe(500)
    expect(entry.id).toBe('legacy-uuid-1')
  })

  it('preserves an already-present frequency on migration', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          entries: [
            {
              id: 'legacy-uuid-2',
              type: 'debt',
              name: 'Loan',
              currentBalance: -5000,
              monthlyContribution: 100,
              frequency: 'weekly',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      })
    )

    await useBalanceStore.persist.rehydrate()

    expect(useBalanceStore.getState().entries[0].frequency).toBe('weekly')
  })
})

describe('balanceStore — partial update validation (Story 16-2 review E2)', () => {
  it('accepts a partial update that omits frequency and preserves the stored cadence', () => {
    const created = useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Brokerage',
      currentBalance: 10000,
      monthlyContribution: 500,
      frequency: 'weekly',
    })
    expect(created).not.toBeNull()
    if (!created) return

    // A partial update changing only the name (no frequency) must succeed —
    // validation runs against the merged entry, not the raw partial.
    const updated = useBalanceStore.getState().updateBalanceEntry(created.id, { name: 'Renamed' })
    expect(updated).not.toBeNull()
    expect(updated?.name).toBe('Renamed')
    expect(updated?.frequency).toBe('weekly')
  })
})

describe('balanceStore — the asset type persists and leaves existing rows alone (Story 43.4, AC-5)', () => {
  const row = (id: string, type: string, name: string, sortOrder: number) => ({
    id,
    type,
    name,
    currentBalance: 100_000,
    maxContributionLimit: null,
    monthlyContribution: 0,
    frequency: 'monthly',
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  it('rehydrates an asset row unchanged, alongside investment and debt rows', async () => {
    // ⚠️ The whole AC-5 argument is that `migrate` is TYPE-BLIND: it touches only
    // `id`, `frequency` and `sortOrder`, and never reads or writes `type`. That is
    // a claim about code, so it is pinned here rather than asserted in prose.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        state: {
          entries: [
            row('inv-1', 'investment', 'ISA', 0),
            row('debt-1', 'debt', 'Mortgage', 1),
            row('asset-1', 'asset', 'Condo', 2),
          ],
        },
      })
    )

    await useBalanceStore.persist.rehydrate()
    const entries = useBalanceStore.getState().entries

    expect(entries).toHaveLength(3)
    // Every type survives EXACTLY as stored — nothing re-typed, nothing dropped.
    expect(entries.map((e) => e.type)).toEqual(['investment', 'debt', 'asset'])
    expect(entries.map((e) => e.id)).toEqual(['inv-1', 'debt-1', 'asset-1'])
    // ⚠️ And `sortOrder` is untouched: a careless version bump would re-run
    // `backfillSortOrder`, which re-densifies to 0..n-1 and destroys the gaps
    // deletes leave on purpose.
    expect(entries.map((e) => e.sortOrder)).toEqual([0, 1, 2])
  })

  it('does not re-type a row whose type this build does not recognise', async () => {
    // The same type-blindness protects FORWARD compatibility: a row written by a
    // newer build must not be silently coerced into an existing arm on rehydrate.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        state: { entries: [row('future-1', 'crypto', 'Some Coin', 0)] },
      })
    )

    await useBalanceStore.persist.rehydrate()
    expect(useBalanceStore.getState().entries[0]?.type).toBe('crypto')
  })

  it('totals an asset row separately from investments and debts', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        state: {
          entries: [
            { ...row('inv-1', 'investment', 'ISA', 0), currentBalance: 5_000_000 },
            { ...row('asset-1', 'asset', 'Condo', 1), currentBalance: 40_000_000 },
            { ...row('debt-1', 'debt', 'Mortgage', 2), currentBalance: 30_000_000 },
          ],
        },
      })
    )

    await useBalanceStore.persist.rehydrate()
    const { entries } = useBalanceStore.getState()
    const totalFor = (type: string) =>
      entries.filter((e) => e.type === type).reduce((sum, e) => sum + e.currentBalance, 0)

    // ⚠️ Asserted as COMPONENTS, not via net worth: net worth is invariant under
    // classifying an asset as an investment, so a net-only check cannot tell a
    // correct implementation from that exact mistake.
    expect(totalFor('investment')).toBe(5_000_000)
    expect(totalFor('asset')).toBe(40_000_000)
    expect(totalFor('debt')).toBe(30_000_000)
  })
})
