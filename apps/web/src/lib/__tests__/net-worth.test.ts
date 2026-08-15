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
 *   investments 2,000,000c + savings 300,000c − debts 15,000,000c = −12,700,000c
 *
 *   old (savings dropped) → −13,000,000c
 *   savings subtracted    → −13,300,000c
 *   debts added           → +17,300,000c
 */

const FIXTURE = {
  investmentsCents: 2_000_000,
  savingsCents: 300_000,
  debtsCents: 15_000_000,
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
    const savingsOnly = { investmentsCents: 0, savingsCents: 300_000, debtsCents: 0 }
    expect(netWorthFromTotals(savingsOnly)).toBe(300_000)
  })

  it('returns the negated debt total for a debt-only user', () => {
    const debtOnly = { investmentsCents: 0, savingsCents: 0, debtsCents: 15_000_000 }
    expect(netWorthFromTotals(debtOnly)).toBe(-15_000_000)
  })

  it('isolates savings when investments and debts cancel exactly', () => {
    // Investments and debts are equal, so the ONLY thing left is savings. A sign
    // error on savings is unmissable here: −300,000 instead of +300,000.
    expect(
      netWorthFromTotals({
        investmentsCents: 2_000_000,
        savingsCents: 300_000,
        debtsCents: 2_000_000,
      })
    ).toBe(300_000)
  })

  it('returns zero when every total is zero', () => {
    expect(netWorthFromTotals({ investmentsCents: 0, savingsCents: 0, debtsCents: 0 })).toBe(0)
  })
})
