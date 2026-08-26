/**
 * The app's ONE definition of net worth (story 32.2, FR59).
 *
 * ## Why this module exists
 *
 * Before 32.2 net worth was re-derived independently in four places — the
 * Overview card (`HomePage.tsx`), the Balance page stat card (via the balance
 * store's `useNetBalance`), the "Current Net Worth" figure on the free Net Worth
 * projection page (since removed by story 43.3), and the printed Premium report
 * (`lib/report/build-financial-summary.ts`) — and every one of them said
 * `investments − debts`, omitting savings. Meanwhile the Overview's own balances
 * bar chart already plotted `savings + investments − debts` under a comment
 * claiming it was "consistent with the Net Worth definition". FR59 does not just
 * add savings to four formulas; it collapses them into this one, so a fifth
 * surface cannot be added wrong.
 *
 * Story 43.4 (FR70) added the `asset` term. That it was a one-line change HERE,
 * rather than a fourth independent edit, is the payoff 32.2 was written for.
 *
 * ## Why it is pure, and why it lives in `apps/web/src/lib`
 *
 * Pure, because `lib/report/build-financial-summary.ts` is React-free and must
 * import it — a hook cannot be. In `apps/web` rather than `packages/core`
 * because it composes totals derived from the *client* store row shapes, which
 * core would have to import upward to know, and because a core change drags in
 * the `dist` rebuild. This is the same reasoning recorded at
 * `build-financial-summary.ts:8-14`.
 *
 * React surfaces should read {@link useNetWorth} (`hooks/useNetWorth.ts`), which
 * wires the three store selectors into this function.
 *
 * ## Corruption safety is deliberately NOT handled here
 *
 * The store selectors that feed this sum raw persisted rows, so a single
 * non-finite `currentBalance` yields `NaN`. That is true before and after 32.2
 * and is left alone on purpose: for a headline total the established response is
 * PARTITION + DISCLOSE (`lib/readable-rows.ts`,
 * `lib/report/build-financial-summary.ts:25-32`), never a silent drop — filtering
 * a balance away without saying so removes money from the user's net worth with
 * nothing on screen to explain it. The report already partitions and discloses,
 * and passes this function its readable totals.
 */

export interface NetWorthTotals {
  /** In cents. */
  investmentsCents: number
  /** In cents. */
  savingsCents: number
  /**
   * Balance rows of type `asset` — something owned outright (a property, a
   * vehicle, a cash holding). In cents. Story 43.4 / FR70.
   *
   * ⚠️ This is a SEPARATE term from `investmentsCents` on purpose, and folding
   * the two together would be undetectable by any net-worth assertion: net worth
   * is INVARIANT under misclassifying an asset as an investment, because
   * `(I + A) + S − D` and `I + S + A − D` are equal for every input. The two are
   * distinguished only by the component totals, which is why the surfaces assert
   * those separately (story 43.4, AC-2).
   */
  assetsCents: number
  /** In cents, held as a positive magnitude — this function subtracts it. */
  debtsCents: number
}

/**
 * Net worth = what you own (investments + savings + assets) minus what you owe
 * (debts).
 *
 * @param totals - The four component totals, in integer cents
 * @returns Net worth in cents; may be negative
 */
export function netWorthFromTotals(totals: NetWorthTotals): number {
  return totals.investmentsCents + totals.savingsCents + totals.assetsCents - totals.debtsCents
}
