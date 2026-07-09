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
