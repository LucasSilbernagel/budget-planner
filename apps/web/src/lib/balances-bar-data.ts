/**
 * The Overview's "Balances" bar-chart series (story 43.4).
 *
 * ## Why this is a module and not an inline array
 *
 * It used to be an inline `const balancesBarData = [...]` inside `HomePage`,
 * built from totals `HomePage` ALSO re-derived inline rather than reading the
 * balance store's selectors. Story 43.4 called that "the single highest-risk site
 * in the codebase" for the change that added the `asset` type — because the Net
 * Worth tile eight lines below reads the shared `useNetWorth()` hook, so an asset
 * missing from THIS series produces two figures contradicting each other on one
 * screen.
 *
 * ⚠️ It was also, at that point, guarded by nothing. Every test that appeared to
 * cover it actually read the Net Worth TILE, so deleting the Assets bar outright
 * left the whole suite green. A pure function can be asserted directly, which is
 * the same reasoning that produced `lib/savings-chart-data.ts` in story 37.1.
 *
 * Debts are plotted NEGATIVE, matching the net-worth definition: this chart shows
 * what each bucket contributes to net worth, not its absolute magnitude.
 */

export interface BalancesBarDatum {
  category: string
  amount: number
  fill: string
}

export interface BalancesBarTotals {
  /** In cents. */
  savingsCents: number
  /** In cents. */
  investmentsCents: number
  /** In cents — things owned outright (property, vehicle, cash). FR70. */
  assetsCents: number
  /** In cents, POSITIVE magnitude; this function negates it for the chart. */
  debtsCents: number
}

export interface BalancesBarColors {
  savings: string
  investment: string
  asset: string
  debt: string
}

/**
 * Build the Balances series, dropping any bucket the user has nothing in.
 *
 * The zero-drop is why an asset-less user sees no Assets bar and needs no empty
 * state — but it also means "the bar is absent" is ambiguous between "no assets"
 * and "assets were never wired in", which is precisely what the tests must
 * distinguish by asserting a NON-ZERO asset total produces a bar.
 */
export function buildBalancesBarData(
  totals: BalancesBarTotals,
  colors: BalancesBarColors
): BalancesBarDatum[] {
  return [
    { category: 'Savings', amount: totals.savingsCents, fill: colors.savings },
    { category: 'Investments', amount: totals.investmentsCents, fill: colors.investment },
    { category: 'Assets', amount: totals.assetsCents, fill: colors.asset },
    { category: 'Debts', amount: -totals.debtsCents, fill: colors.debt },
  ].filter((item) => item.amount !== 0)
}
