import { describe, expect, it } from 'vitest'
import { type BalancesBarColors, buildBalancesBarData } from '../balances-bar-data'

/**
 * Overview "Balances" series tests (story 43.4).
 *
 * ⚠️ These exist because the Assets bar was, briefly, guarded by NOTHING. Every
 * test that looked like it covered the Overview's balance chart actually read the
 * Net Worth TILE — which is fed by the shared `useNetWorth()` hook, not by this
 * series. Deleting the Assets bar outright left the entire suite green, on the
 * site story 43.4 itself calls the highest-risk in the codebase.
 *
 * Every amount below is HAND-COMPUTED and mutually DISTINCT, so no assertion can
 * pass by coincidence or by a bucket being read from the wrong total.
 */

const COLORS: BalancesBarColors = {
  savings: '#SAV',
  investment: '#INV',
  asset: '#AST',
  debt: '#DBT',
}

const TOTALS = {
  savingsCents: 300_000,
  investmentsCents: 5_000_000,
  assetsCents: 40_000_000,
  debtsCents: 30_000_000,
}

describe('buildBalancesBarData', () => {
  it('emits all four buckets, in order, when every total is non-zero', () => {
    expect(buildBalancesBarData(TOTALS, COLORS).map((d) => d.category)).toEqual([
      'Savings',
      'Investments',
      'Assets',
      'Debts',
    ])
  })

  it('carries the asset total on its OWN bar, not folded into investments', () => {
    const data = buildBalancesBarData(TOTALS, COLORS)
    const byCategory = Object.fromEntries(data.map((d) => [d.category, d.amount]))

    // ⚠️ Both halves matter. Folding assets into the Investments bar would give
    // Investments 45,000,000 and no Assets bar — and any assertion that only
    // checked a total would not tell the two apart.
    expect(byCategory['Assets']).toBe(40_000_000)
    expect(byCategory['Investments']).toBe(5_000_000)
  })

  it('plots debts NEGATIVE and everything else positive', () => {
    const data = buildBalancesBarData(TOTALS, COLORS)
    const byCategory = Object.fromEntries(data.map((d) => [d.category, d.amount]))

    expect(byCategory['Debts']).toBe(-30_000_000)
    expect(byCategory['Savings']).toBe(300_000)
    // The four bars sum to the net-worth definition: 300,000 + 5,000,000
    // + 40,000,000 − 30,000,000 = 15,300,000.
    expect(data.reduce((sum, d) => sum + d.amount, 0)).toBe(15_300_000)
  })

  it('gives the Assets bar its own colour, distinct from every other bar', () => {
    const data = buildBalancesBarData(TOTALS, COLORS)
    const fills = data.map((d) => d.fill)

    expect(data.find((d) => d.category === 'Assets')?.fill).toBe('#AST')
    expect(new Set(fills).size).toBe(fills.length)
  })

  it('drops a bucket the user has nothing in, including assets', () => {
    const noAssets = buildBalancesBarData({ ...TOTALS, assetsCents: 0 }, COLORS)
    expect(noAssets.map((d) => d.category)).toEqual(['Savings', 'Investments', 'Debts'])
  })

  it('emits an Assets bar for an asset-only user', () => {
    // The zero-drop makes "no Assets bar" ambiguous between "no assets" and
    // "assets were never wired in". This is the case that disambiguates it.
    const assetOnly = buildBalancesBarData(
      { savingsCents: 0, investmentsCents: 0, assetsCents: 40_000_000, debtsCents: 0 },
      COLORS
    )
    expect(assetOnly).toHaveLength(1)
    expect(assetOnly[0]?.category).toBe('Assets')
    expect(assetOnly[0]?.amount).toBe(40_000_000)
  })

  it('returns an empty series when the user tracks no balances at all', () => {
    expect(
      buildBalancesBarData(
        { savingsCents: 0, investmentsCents: 0, assetsCents: 0, debtsCents: 0 },
        COLORS
      )
    ).toEqual([])
  })
})
