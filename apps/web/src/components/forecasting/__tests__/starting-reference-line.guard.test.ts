import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Story `forecast-2` — the chart's "Starting" reference line, pinned in source.
 *
 * ⚠️ WHY A SOURCE GUARD. The rule is a NEGATIVE — the line must NOT be derived
 * from the first projection row — and Recharts renders nothing measurable in
 * jsdom (it needs real layout dimensions), so a behavioural assertion on the
 * rendered `<ReferenceLine y>` is not available at this layer.
 *
 * ⚠️⚠️ WHAT WENT WRONG, so the next reader does not undo it. The line used to
 * read `chartData[0]?.baselineNetWorth`. That was correct ONLY BY ACCIDENT:
 * while projection rows reported an OPENING balance, row 1 happened to equal
 * `summary.startingNetWorth`. Story `forecast-2` made rows report CLOSING
 * balances, and the dashed "Starting" line silently moved one year's flow up
 * the axis — contradicting the "Starting Net Worth" card rendered a few lines
 * below it, on the same screen. Nothing failed. The two expressions agree again
 * only if the row convention is reverted, so the binding must stay explicit.
 *
 * Comments are stripped before the ban is applied, so this file's own prose (and
 * the component's explanatory comment, which names the old expression on
 * purpose) cannot trip it.
 */
describe('ProjectionChart — "Starting" reference line (story forecast-2)', () => {
  const source = readFileSync(join(__dirname, '..', 'projection-chart.tsx'), 'utf8')

  /** The file's CODE lines, with `//` and `/* *\/` comment content removed. */
  const codeLines = (() => {
    const out: string[] = []
    let inBlock = false
    for (const raw of source.split('\n')) {
      let line = ''
      let i = 0
      while (i < raw.length) {
        if (inBlock) {
          const end = raw.indexOf('*/', i)
          if (end === -1) {
            i = raw.length
          } else {
            inBlock = false
            i = end + 2
          }
          continue
        }
        if (raw.startsWith('/*', i)) {
          inBlock = true
          i += 2
          continue
        }
        if (raw.startsWith('//', i)) break
        line += raw[i]
        i += 1
      }
      out.push(line)
    }
    return out
  })()

  const code = codeLines.join('\n')

  it('binds the reference line to summary.startingNetWorth', () => {
    // Positive control: the stripper left real code behind, so the ban below
    // cannot pass because everything was blanked.
    expect(code).toContain('ReferenceLine')
    expect(code).toMatch(/result\?\.summary\.startingNetWorth/)
  })

  it('never derives the starting figure from a projection row', () => {
    // The exact shape that regressed, plus the nearby variants a well-meaning
    // refactor would reach for.
    expect(code).not.toMatch(/chartData\[0\]/)
    expect(code).not.toMatch(/projection\[0\]/)
    expect(code).not.toMatch(/baseline\[0\]/)
  })
})
