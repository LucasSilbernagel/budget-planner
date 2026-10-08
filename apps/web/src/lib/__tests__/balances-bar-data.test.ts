import { describe, expect, it } from 'vitest'
import { type BalancesBarColors, buildBalancesBarData } from '../balances-bar-data'

/** Amounts are hand-computed and mutually distinct so no assertion passes by coincidence. */

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

    expect(byCategory['Assets']).toBe(40_000_000)
    expect(byCategory['Investments']).toBe(5_000_000)
  })

  it('plots debts NEGATIVE and everything else positive', () => {
    const data = buildBalancesBarData(TOTALS, COLORS)
    const byCategory = Object.fromEntries(data.map((d) => [d.category, d.amount]))

    expect(byCategory['Debts']).toBe(-30_000_000)
    expect(byCategory['Savings']).toBe(300_000)
    // 300,000 + 5,000,000 + 40,000,000 − 30,000,000 = 15,300,000.
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
