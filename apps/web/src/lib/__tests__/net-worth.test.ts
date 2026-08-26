import { describe, expect, it } from 'vitest'
import { netWorthFromTotals } from '../net-worth'

/**
 * FR59 net-worth definition tests (story 32.2).
 *
 * ⚠️ Every expectation below is HAND-COMPUTED. A test that calls
 * `netWorthFromTotals` to build its own expectation passes even when the
 * operator is wrong — the rule stated verbatim in `build-financial-summary.test.ts:1-12`.
 *
 * The shared fixture (story §3) is chosen so that every sign slip lands on a
 * distinct, wrong value:
 *
 *   investments 2,000,000c + savings 300,000c + assets 0c − debts 15,000,000c
 *     = −12,700,000c
 *
 *   old (savings dropped) → −13,000,000c
 *   savings subtracted    → −13,300,000c
 *   debts added           → +17,300,000c
 *   assets dropped        → see ASSET_FIXTURE below (story 43.4)
 */

const FIXTURE = {
  investmentsCents: 2_000_000,
  savingsCents: 300_000,
  assetsCents: 0,
  debtsCents: 15_000_000,
}

/**
 * Story 43.4 (FR70) fixture. Every component is non-zero and MUTUALLY DISTINCT
 * so a term swapped for another is visible in the result:
 *
 *   investments 5,000,000c + savings 300,000c + assets 40,000,000c
 *     − debts 30,000,000c = +15,300,000c
 *
 *   assets dropped entirely → −24,700,000c
 *   assets subtracted       → −64,700,000c
 *   assets swapped w/ debts → −4,700,000c
 */
const ASSET_FIXTURE = {
  investmentsCents: 5_000_000,
  savingsCents: 300_000,
  assetsCents: 40_000_000,
  debtsCents: 30_000_000,
}

describe('netWorthFromTotals', () => {
  it('adds investments and savings, subtracts debts (the shared story fixture)', () => {
    // 2,000,000 + 300,000 − 15,000,000
    expect(netWorthFromTotals(FIXTURE)).toBe(-12_700_000)
  })

  it('does not silently drop savings (the pre-32.2 definition)', () => {
    // The value the OLD `investments − debts` formula produced for this fixture.
    expect(netWorthFromTotals(FIXTURE)).not.toBe(-13_000_000)
  })

  it('returns the savings total for a savings-only user', () => {
    const savingsOnly = {
      investmentsCents: 0,
      savingsCents: 300_000,
      assetsCents: 0,
      debtsCents: 0,
    }
    expect(netWorthFromTotals(savingsOnly)).toBe(300_000)
  })

  it('returns the negated debt total for a debt-only user', () => {
    const debtOnly = {
      investmentsCents: 0,
      savingsCents: 0,
      assetsCents: 0,
      debtsCents: 15_000_000,
    }
    expect(netWorthFromTotals(debtOnly)).toBe(-15_000_000)
  })

  it('isolates savings when investments and debts cancel exactly', () => {
    // Investments and debts are equal, so the ONLY thing left is savings. A sign
    // error on savings is unmissable here: −300,000 instead of +300,000.
    expect(
      netWorthFromTotals({
        investmentsCents: 2_000_000,
        savingsCents: 300_000,
        assetsCents: 0,
        debtsCents: 2_000_000,
      })
    ).toBe(300_000)
  })

  it('returns zero when every total is zero', () => {
    expect(
      netWorthFromTotals({
        investmentsCents: 0,
        savingsCents: 0,
        assetsCents: 0,
        debtsCents: 0,
      })
    ).toBe(0)
  })

  // --- Story 43.4 / FR70: the asset term -----------------------------------

  it('returns the asset total for an asset-only user', () => {
    expect(
      netWorthFromTotals({
        investmentsCents: 0,
        savingsCents: 0,
        assetsCents: 40_000_000,
        debtsCents: 0,
      })
    ).toBe(40_000_000)
  })

  it('is POSITIVE for a condo worth more than the mortgage against it (FR70)', () => {
    // The requirement's own scenario: a $400,000 condo and a $300,000 mortgage.
    // Before FR70 the property could not be recorded at all, so this user saw
    // −$300,000. Hand-computed: 40,000,000 − 30,000,000.
    expect(
      netWorthFromTotals({
        investmentsCents: 0,
        savingsCents: 0,
        assetsCents: 40_000_000,
        debtsCents: 30_000_000,
      })
    ).toBe(10_000_000)
  })

  it('adds assets alongside investments and savings, and subtracts debts', () => {
    // 5,000,000 + 300,000 + 40,000,000 − 30,000,000
    expect(netWorthFromTotals(ASSET_FIXTURE)).toBe(15_300_000)
  })

  it('does not drop the asset term', () => {
    // The value this fixture would produce if `assetsCents` were ignored.
    expect(netWorthFromTotals(ASSET_FIXTURE)).not.toBe(-24_700_000)
  })

  it('adds assets rather than subtracting them', () => {
    // The value a sign slip on the asset term would produce.
    expect(netWorthFromTotals(ASSET_FIXTURE)).not.toBe(-64_700_000)
  })

  it('isolates assets when investments, savings and debts cancel exactly', () => {
    // Everything else nets to zero, so a sign error on assets is unmissable.
    expect(
      netWorthFromTotals({
        investmentsCents: 1_000_000,
        savingsCents: 0,
        assetsCents: 40_000_000,
        debtsCents: 1_000_000,
      })
    ).toBe(40_000_000)
  })
})
