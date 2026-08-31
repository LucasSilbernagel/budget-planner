import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Story 47.2 (FR74) — the planner's monthly-savings source, pinned in source.
 *
 * ⚠️ Why a source guard rather than a behavioural one. The rule this file
 * protects is a NEGATIVE: the retirement figure must NOT adopt the savings
 * pool's `contributionRecordedAsExpense` skip. A behavioural test proves the
 * figure is right today; it does not stop the next reader "fixing" an apparent
 * inconsistency between two functions that read the same rows and disagree on
 * purpose. The rationale has to travel with the code, and something has to fail
 * when it is deleted.
 *
 * ⚠️⚠️ THIS SCANS RAW SOURCE ON PURPOSE. Story 47.1's AC-8 guard copied
 * `no-method-selectors.guard.test.ts`'s character-scanner "string stripper" and
 * measured it BLANKING TEMPLATE-LITERAL `${…}` INTERPOLATIONS — which are
 * executable code — so a write path hidden inside one scanned green. Over-
 * blanking makes a ban pass vacuously, the one failure mode a guard must not
 * have. The opposite failure (a comment tripping a ban) is safe and visible, so
 * the flag check below is scoped by LINE KIND instead: any real use lands on a
 * code line, and the file's own explanatory comments are allowed to name it.
 */
describe('RetirementAccumulationPlanner — monthly-savings source (story 47.2)', () => {
  const source = readFileSync(join(__dirname, '..', 'RetirementAccumulationPlanner.tsx'), 'utf8')
  const lines = source.split('\n')

  /**
   * The file's lines with COMMENTS removed, so an identifier ban applies to code
   * and only code.
   *
   * ⚠️ Rewritten in review. The first version classified a whole line as "a
   * comment" when its trimmed form began with `*`, which exempts a wrapped
   * continuation line of a real expression (`* ({ weekly: 52 / 12, … })`) from
   * every ban below — an exemption that errs in the UNSAFE direction. It also
   * classified a brace-wrapped JSX comment as code, which errs in the safe-but-
   * annoying one. Tracking block-comment state fixes both.
   *
   * ⚠️ String and template-literal contents are deliberately NOT parsed. Story
   * 47.1's guard copied a character-scanner "string stripper" and measured it
   * BLANKING `${…}` interpolations — executable code — so a banned write path
   * scanned green. Over-blanking is the one failure mode a guard must not have.
   * The residual here is the opposite and is safe: a banned identifier sitting
   * inside a string literal would be a data reference, not a filter, and the
   * prose pins below would still see it.
   */
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
  /**
   * The file's prose with each line's comment marker removed, so a clause that
   * WRAPS across two comment lines is still one run of text.
   *
   * ⚠️ Without this, `\s+` cannot bridge `…SAVINGS\n  // POOL…` — the `// ` is
   * not whitespace — and a copy pin silently becomes unmatchable the moment
   * Biome reflows the comment. That is the same class of failure as story 47.1's
   * M3, where a reflow disarmed a mutation arm and it reported a false green.
   * Normalizing the MARKER is not the same as blanking content: nothing is
   * removed but the prefix itself.
   */
  const isCommentLine = (line: string): boolean => {
    const trimmed = line.trim()
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
  }
  const prose = lines
    .filter(isCommentLine)
    .map((line) => line.trim().replace(/^\/\*+|^\/\/+|^\*+\/?/, ''))
    .join('\n')

  it('records WHY a payroll-deducted contribution still counts here (AC-12)', () => {
    // One ordered clause joined with `\s+`, never loose fragments: three separate
    // `toContain`s stay green against a reordering that reverses the meaning.
    expect(prose).toMatch(
      /contributionRecordedAsExpense`\)\s+COUNTS\s+IN\s+FULL\s+here[\s\S]{0,600}?never\s+reuse/i
    )
    expect(prose).toMatch(/statement\s+about\s+the\s+SAVINGS\s+POOL\s+only/i)
  })

  it('names the single normalizer it is required to route through (AC-12)', () => {
    expect(prose).toMatch(
      /`monthlyContributionCents`\s+is\s+the\s+repo's\s+SINGLE\s+normalizer\s+for\s+this\s+field/i
    )
    expect(source).toContain(
      "import { calculateNetIncomeResult, monthlyContributionCents } from '@budget-planner/core'"
    )
  })

  it('never imports the pool reducer that DOES skip flagged rows (AC-2, AC-12)', () => {
    // `sumMonthlyInvestmentContributions` is module-private to
    // `savingsAllocation.ts` today, so this is a tripwire against a future
    // export-and-reuse, not a claim that one exists. It is allowed in prose.
    const codeUses = codeOnly.filter((line) => line.includes('sumMonthlyInvestmentContributions'))
    expect(codeUses).toEqual([])
    const poolUses = codeOnly.filter((line) => line.includes('calculateDistributablePool'))
    expect(poolUses).toEqual([])
  })

  it('reads the contribution flag in NO code path, only in prose (AC-2)', () => {
    // ⚠️ The whole point. Filtering on this flag here would under-report every
    // payroll-deducted saver's actual saving — the pool excludes the money
    // because it was already removed from the leftover arithmetic, not because
    // it stopped being invested.
    const codeUses = codeOnly.filter(
      (line) => line.includes('contributionRecordedAsExpense') || line.includes('recordedAsExpense')
    )
    expect(codeUses).toEqual([])
    // Positive anchor: the rule really is written down somewhere in the file, so
    // this test cannot pass by the identifier being absent altogether.
    expect(source).toContain('contributionRecordedAsExpense')
  })

  it('no longer derives the monthly figure from income minus expenses (AC-1)', () => {
    const codeUses = codeOnly.filter((line) => line.includes('calculateNetIncomeResult'))
    // Exactly TWO code lines: the import, and the ONE surviving call — the
    // desired-income prefill, which is seeded from GROSS income and is
    // deliberately unchanged by story 47.2. A third would mean the old
    // income-minus-expenses derivation came back.
    expect(codeUses).toHaveLength(2)
    expect(codeUses[0]).toContain("from '@budget-planner/core'")
    expect(codeUses[1]).toContain('const { grossIncome } = calculateNetIncomeResult(')
  })
})
