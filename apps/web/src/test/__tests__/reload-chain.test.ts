import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as balance from '../../stores/balanceStore'
import * as category from '../../stores/categoryStore'
import * as currency from '../../stores/currencyStore'
import * as expense from '../../stores/expenseStore'
import * as income from '../../stores/incomeStore'
import * as overviewDuration from '../../stores/overviewDurationStore'
import * as plannerVisibility from '../../stores/plannerVisibilityStore'
import * as profile from '../../stores/profileStore'
import * as retirementPlanner from '../../stores/retirementPlannerStore'
import * as savings from '../../stores/savingsStore'
import * as tableSort from '../../stores/tableSortStore'
import { PERSISTED_STORES } from '../reload-chain'

/**
 * Parity: the reload chain resets EVERY store `StoreHydration` rehydrates (84.5
 * code review). A registered store missing from `PERSISTED_STORES` keeps its
 * in-memory value across `reloadChain()`, so a test would see it "survive" a
 * reload without it ever reaching storage, the vacuity the chain exists to
 * remove.
 */
const HYDRATION_SOURCE = readFileSync(
  resolve(__dirname, '..', '..', 'lib', 'store-hydration.tsx'),
  'utf-8'
)

describe('reload chain parity with StoreHydration', () => {
  it('resets every store StoreHydration registers', () => {
    const list = /const stores = \[([\s\S]*?)\]/.exec(HYDRATION_SOURCE)?.[1] ?? ''
    const names = [...list.matchAll(/\b(use\w+Store)\b/g)].map((m) => m[1] as string)
    // Positive control: the source parse found the registration list.
    expect(names.length).toBeGreaterThanOrEqual(10)
    const byName = Object.assign(
      {},
      ...[
        balance,
        category,
        currency,
        expense,
        income,
        overviewDuration,
        plannerVisibility,
        profile,
        retirementPlanner,
        savings,
        tableSort,
      ]
    ) as Record<string, unknown>
    for (const name of names) {
      expect(byName[name], `${name} is not exported by any stores/*Store module`).toBeDefined()
      expect(
        PERSISTED_STORES as readonly unknown[],
        `${name} is not reset by reloadChain()`
      ).toContain(byName[name])
    }
  })
})
