import type { Frequency } from '@budget-planner/core/finance'
import { isKnownFrequency } from '../readable-rows'

/**
 * One investment contribution as the leftover-allocation solver reads it
 * (`solveAutomaticAllocations`' `investmentContributions`), plus the `id`/`name`
 * the /savings breakdown lists it under.
 */
export interface InvestmentContributionItem {
  id: string
  name: string
  amount: number
  frequency: Frequency
  recordedAsExpense: boolean
}

/**
 * Maps the active profile's investment entries to the solver's contribution
 * items. ONE mapping for every caller (story 100.1): /savings feeds it to the
 * solver and its breakdown (story 45.1, FR72), and the forecast builder seeds its
 * automatic savings rows from the same solver, so a row's seeded contribution can
 * only equal the figure /savings shows for it if both build these items alike.
 */
export function investmentContributionItems(
  entries: readonly {
    id: string
    name: string
    monthlyContribution: number
    frequency: unknown
    contributionRecordedAsExpense?: boolean
  }[]
): InvestmentContributionItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    amount: entry.monthlyContribution,
    // Degrade a corrupt persisted cadence to 'monthly' rather than letting the
    // solver's validating normalizer throw during render. localStorage is
    // user-editable and the balance-store migrate only backfills a NULLISH
    // frequency, so a non-null legacy string can reach here.
    frequency: isKnownFrequency(entry.frequency) ? entry.frequency : 'monthly',
    // ⚠️ `=== true` mirrors the core rule exactly. A truthy check here would
    // let a persisted `"false"` string silently cancel a real deduction.
    recordedAsExpense: entry.contributionRecordedAsExpense === true,
  }))
}
