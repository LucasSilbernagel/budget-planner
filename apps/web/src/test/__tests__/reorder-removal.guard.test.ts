import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Bans identifiers in code only: past-tense prose about the removed feature is wanted, and
// `'manual'` is still TableSortControl's option value.

const WEB_ROOT = join(__dirname, '..', '..', '..')

const SCANNED_ROOTS = ['src', 'e2e'] as const

const SOURCE_EXT = /\.(ts|tsx)$/

const BANNED = [
  'RowMoveControls',
  'planRowMove',
  'applyRowMove',
  'RowMoveDirection',
  'RowPositionChange',
  'RowMoveChange',
  'RowMoveResult',
  'moveIncomeSource',
  'moveExpense',
  'moveSavingsGoal',
  'moveBalanceEntry',
] as const

// These SURVIVE: they serve row creation, the read path or sync. Deleting any breaks insertion order.
const SURVIVING = [
  'sortByDisplayOrder',
  'backfillSortOrder',
  'nextSortOrder',
  'stampMissingSortOrder',
] as const

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') {
      continue
    }
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
    } else if (SOURCE_EXT.test(entry)) {
      out.push(full)
    }
  }
  return out
}

// Best-effort, NOT a parser: a `//` or `/*` inside a string blanks live code. Never use it on
// the falsifying side of an absence claim.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

// Absent only if absent from the raw source too, or present only on whole-comment lines.
function referencesInCode(source: string, symbol: string): string[] {
  const re = new RegExp(`\\b${symbol}\\b`)
  if (!re.test(source)) {
    return []
  }
  return source
    .split('\n')
    .filter((line) => re.test(line))
    .filter((line) => {
      const t = line.trim()
      // A line that is ONLY a comment is prose, and prose is allowed.
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
}

// Excludes itself (`BANNED` is real code), so the positive controls are what prove the walk
// reaches the module the banned symbols were deleted from.
const SELF = join(WEB_ROOT, 'src', 'test', '__tests__', 'reorder-removal.guard.test.ts')

const FILES = SCANNED_ROOTS.flatMap((root) => walk(join(WEB_ROOT, root))).filter((f) => f !== SELF)

describe('manual row reordering is removed (story 48.2, UX-DR54)', () => {
  it('⚠️ POSITIVE CONTROL: the sweep actually walks both trees', () => {
    for (const root of SCANNED_ROOTS) {
      const inRoot = FILES.filter((f) => f.startsWith(join(WEB_ROOT, root)))
      expect(inRoot.length, `${root}/ contributed no files — the walk is broken`).toBeGreaterThan(
        10
      )
    }
  })

  it('⚠️ POSITIVE CONTROL: the sweep can SEE a symbol of the kind it denies', () => {
    // Without this, every absence arm would also pass on an empty read or a wrong root.
    const corpus = FILES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n')
    for (const symbol of SURVIVING) {
      expect(
        corpus,
        `${symbol} is not visible to this sweep — it cannot prove any absence`
      ).toMatch(new RegExp(`\\b${symbol}\\b`))
    }
  })

  it.each(BANNED)('%s appears in no source or test file', (symbol) => {
    const offenders = FILES.filter(
      (f) => referencesInCode(readFileSync(f, 'utf8'), symbol).length > 0
    ).map((f) => f.slice(WEB_ROOT.length + 1))
    expect(offenders, `${symbol} is still referenced in code`).toEqual([])
  })

  it('⚠️ the stripper does not blank live code (the two reproduced cases)', () => {
    const inString = `const u = 'http://x'; planRowMove(rows, id, 'up')`
    const inRegex = 'const re = /a\\/*b/; const x = applyRowMove'
    expect(
      referencesInCode(inString, 'planRowMove'),
      'a // inside a string literal hides a live call from the sweep'
    ).toHaveLength(1)
    expect(
      referencesInCode(inRegex, 'applyRowMove'),
      'a /* inside a regex literal hides a live reference from the sweep'
    ).toHaveLength(1)
    expect(referencesInCode('  // story 48.2 removed planRowMove', 'planRowMove')).toEqual([])
    expect(referencesInCode('   * `applyRowMove` is deleted', 'applyRowMove')).toEqual([])
  })

  it('the RowMoveControls module and its test are deleted', () => {
    for (const relative of [
      'src/components/ui/RowMoveControls.tsx',
      'src/components/ui/__tests__/RowMoveControls.test.tsx',
    ]) {
      expect(existsSync(join(WEB_ROOT, relative)), `${relative} still exists`).toBe(false)
    }
    // Anti-vacuity: a sibling that MUST still exist, so a wrong WEB_ROOT (where
    // every path is trivially absent) fails here instead of passing above.
    expect(existsSync(join(WEB_ROOT, 'src/components/ui/TableSortControl.tsx'))).toBe(true)
  })

  it('lib/ordering.ts exports exactly the helpers that survived', () => {
    // EXACT SET: a re-added unused export is exactly the shape a partial revert takes.
    const source = readFileSync(join(WEB_ROOT, 'src/lib/ordering.ts'), 'utf8')
    const declared = [
      ...source.matchAll(
        /^export\s+(?:async\s+)?(?:function\*?|interface|type|const|let|var|class|enum|default)\s+(\w+)/gm
      ),
    ].map((m) => m[1])
    const reExported = [...source.matchAll(/^export\s*\{([^}]*)\}/gm)].flatMap((m) =>
      m[1]
        .split(',')
        .map(
          (part) =>
            part
              .trim()
              .split(/\s+as\s+/)
              .pop()
              ?.trim() ?? ''
        )
        .filter(Boolean)
    )
    const exported = [...declared, ...reExported].sort()
    expect(exported).toEqual(
      [
        'DisplayOrdered',
        'backfillSortOrder',
        'nextSortOrder',
        'sortByDisplayOrder',
        'stampMissingSortOrder',
      ].sort()
    )
  })

  it('the four stores still REFERENCE the surviving ordering helpers', () => {
    // A "not accidentally deleted" check, not a behavioural one: the add path's ordering is
    // pinned by the display-order tests.
    for (const store of ['incomeStore', 'expenseStore', 'savingsStore', 'balanceStore']) {
      const source = stripComments(readFileSync(join(WEB_ROOT, `src/stores/${store}.ts`), 'utf8'))
      expect(source, `${store} no longer calls nextSortOrder`).toMatch(/\bnextSortOrder\b/)
      expect(source, `${store} no longer calls sortByDisplayOrder`).toMatch(
        /\bsortByDisplayOrder\b/
      )
    }
  })
})
