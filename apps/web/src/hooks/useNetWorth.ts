/**
 * The single React entry point for net worth (story 32.2, FR59).
 *
 * Every REACT surface that shows the user "your net worth" reads this hook — the
 * Overview and the Balance page — so the two cannot drift apart. There were
 * three until story 43.3 (FR69) removed the free Net Worth projection page; the
 * rule is "every React surface", not "these two", so a new one reads this too.
 * The arithmetic itself lives in `lib/net-worth.ts`, which the
 * React-free report builder calls directly with its own corruption-filtered
 * totals (a deliberate divergence, pinned by a parity test). The forecasting
 * scenario's "Starting/Ending Net Worth" is NOT this figure at all: those inputs
 * are typed by the user, and the exclusion is recorded at that call site.
 *
 * ⚠️ There is deliberately no balance-store-only net selector any more. The old
 * `useNetBalance` computed `investments − debts` and could not see the savings
 * store, yet its only consumer imported it as `useNetBalance as useNetWorth` —
 * the wrong definition wearing the right name. It was deleted in 32.2 rather
 * than left beside this hook.
 */

import { netWorthFromTotals } from '../lib/net-worth'
import { useTotalDebtBalance, useTotalInvestmentBalance } from '../stores/balanceStore'
import { useTotalSavings } from '../stores/savingsStore'

/**
 * Net worth in cents: investments + savings − debts.
 *
 * Subscribes to both the balance and savings stores, so the figure updates live
 * when a row on `/balance` or `/savings` changes.
 */
export function useNetWorth(): number {
  const investmentsCents = useTotalInvestmentBalance()
  const savingsCents = useTotalSavings()
  const debtsCents = useTotalDebtBalance()

  return netWorthFromTotals({ investmentsCents, savingsCents, debtsCents })
}
