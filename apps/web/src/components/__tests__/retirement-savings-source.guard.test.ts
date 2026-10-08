// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The retirement figure must NOT adopt the savings pool's `contributionRecordedAsExpense` skip.
// Scans raw source: blanking template `${}` interpolations would hide code.
describe('RetirementAccumulationPlanner — monthly-savings source (story 47.2)', () => {
  const source = readFileSync(join(__dirname, '..', 'RetirementAccumulationPlanner.tsx'), 'utf8')
  const lines = source.split('\n')

  /** Code lines only, tracking block-comment state; string contents are deliberately not parsed. */
  const codeOnly: string[] = []
  let inBlockComment = false
  for (const raw of lines) {
    let line = raw
    if (inBlockComment) {
      const close = line.indexOf('*/')
      if (close === -1) {
        codeOnly.push('')
        continue
      }
      line = line.slice(close + 2)
      inBlockComment = false
    }
    for (;;) {
      const open = line.indexOf('/*')
      if (open === -1) break
      const close = line.indexOf('*/', open + 2)
      if (close === -1) {
        line = line.slice(0, open)
        inBlockComment = true
        break
      }
      line = line.slice(0, open) + line.slice(close + 2)
    }
    const lineComment = line.indexOf('//')
    codeOnly.push(lineComment === -1 ? line : line.slice(0, lineComment))
  }

  it('routes through the single normalizer', () => {
    expect(source).toContain(
      "import { calculateNetIncomeResult, monthlyContributionCents } from '@budget-planner/core'"
    )
  })

  it('never imports the pool reducer that DOES skip flagged rows (AC-2, AC-12)', () => {
    const codeUses = codeOnly.filter((line) => line.includes('sumMonthlyInvestmentContributions'))
    expect(codeUses).toEqual([])
    const poolUses = codeOnly.filter((line) => line.includes('calculateDistributablePool'))
    expect(poolUses).toEqual([])
  })

  it('reads the contribution flag in no code path', () => {
    // Filtering on this flag would under-report payroll-deducted savers: the pool excludes that money
    // because it already left the leftover arithmetic, not because it stopped being invested.
    const codeUses = codeOnly.filter(
      (line) => line.includes('contributionRecordedAsExpense') || line.includes('recordedAsExpense')
    )
    expect(codeUses).toEqual([])
  })

  it('no longer derives the monthly figure from income minus expenses (AC-1)', () => {
    const codeUses = codeOnly.filter((line) => line.includes('calculateNetIncomeResult'))
    // Two code lines: the import and the desired-income prefill, which is seeded from GROSS income.
    expect(codeUses).toHaveLength(2)
    expect(codeUses[0]).toContain("from '@budget-planner/core'")
    expect(codeUses[1]).toContain('const { grossIncome } = calculateNetIncomeResult(')
  })
})
