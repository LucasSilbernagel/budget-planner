import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Story 48.2 (UX-DR54) — manual row reordering is gone, and stays gone.
 *
 * ## Why a source guard exists at all
 *
 * The DOM half of this claim lives in the four page suites, which assert the
 * EXACT array of buttons in a row's actions cell. That covers the rendered
 * surface. It cannot cover the module graph: a re-added `planRowMove`, an
 * orphaned `applyRowMove`, or a resurrected `RowMoveControls` imported by
 * nothing would all leave the DOM untouched and every page test green.
 *
 * ## ⚠️⚠️ THE FAILURE MODE THIS FILE WAS WRITTEN AGAINST
 *
 * Story 48.1's code review found a HIGH in its own guard: an absence sweep that
 * scanned `src/` while two of its five claims had been lifted from `e2e/`. Both
 * arms were UNFALSIFIABLE — they asserted the absence of strings that could not
 * appear anywhere the sweep read — and a red arm on a different file said
 * nothing about them.
 *
 * Every absence claim below is therefore paired with a positive control that
 * proves the sweep can SEE the thing it denies:
 *
 *   - `SCANNED_ROOTS` covers `src` AND `e2e`, and a test asserts both trees are
 *     non-empty and were actually walked.
 *   - Each banned identifier is asserted to be findable in this file's own
 *     `BANNED` list (trivially true) *and* the walk is proven to reach a file
 *     that still contains a NEIGHBOURING, surviving symbol from the same module
 *     (`sortByDisplayOrder`). If `ordering.ts` were renamed or the walk broke,
 *     that positive control fails rather than the absence arms passing quietly.
 *
 * ## What is deliberately NOT banned
 *
 * The word "move", the string `'manual'` (still `TableSortControl`'s option
 * VALUE — story 48.2 renamed the LABEL only), and past-tense PROSE about the
 * removed feature. Comments that explain what was removed and why are wanted;
 * banning the identifier outright would fail on them, which is the mistake
 * 48.1's guard made twice before it settled on stripping comments.
 */

/** `apps/web`. */
const WEB_ROOT = join(__dirname, '..', '..', '..')

/** Both trees. `src` alone is how 48.1's guard came to hold two dead arms. */
const SCANNED_ROOTS = ['src', 'e2e'] as const

const SOURCE_EXT = /\.(ts|tsx)$/

/**
 * Identifiers that existed only to serve manual reordering. Every one was
 * verified to have no surviving caller before deletion; see the story's §7
 * table.
 */
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

/** The helpers that SURVIVE, because they serve row creation, the read path or
 *  sync — not reordering. Deleting any of these breaks insertion order. */
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

/**
 * Strip comments: prose ABOUT the removed feature is wanted; code is not.
 *
 * ⚠️⚠️ THIS IS NOT A PARSER, AND ITS FAILURE MODE IS SILENT OVER-STRIPPING (48.2
 * review, found independently by two layers and reproduced by execution). It has no
 * string or regex awareness, so a `//` inside a string literal — `'https://x'`, very
 * common in the `e2e` tree this sweep reads — blanks the rest of that line, and a
 * `/*` inside a string or regex swallows everything to the next close. A banned
 * symbol sitting in a stripped region would pass the absence arm VACUOUSLY.
 *
 * Mitigated rather than replaced, because a real parser is not worth the dependency:
 * the absence arms no longer use this function at all. They go through
 * `referencesInCode` below, which reads the RAW source and discards only lines that
 * are WHOLLY comments — so over-stripping can now only ever cost a false FAIL (a
 * prose line mistaken for code), never a false PASS. `it('the stripper does not
 * blank live code')` pins the two reproduced cases directly.
 *
 * What still uses `stripComments`: the two positive controls and the store-reference
 * check, where over-stripping would make the assertion HARDER to satisfy, not easier.
 * Do not treat this function as sound; treat it as best-effort, and never put it on
 * the falsifying side of an absence claim.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * The backstop: a banned symbol counts as ABSENT only if it is absent from the raw
 * source too, OR present exclusively on lines that are wholly comments. This is what
 * makes an over-stripped region unable to hide a live reference.
 */
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

/**
 * ⚠️ THIS FILE EXCLUDES ITSELF, and that exclusion is why the two positive
 * controls above are load-bearing rather than decorative. `BANNED` is real code,
 * not a comment, so the sweep matched every one of its own entries on the first
 * run — 11 arms red against the guard itself while the codebase was already
 * clean. Excluding the guard removes the false positives; it also removes the
 * only place those strings are guaranteed to exist, which is precisely the
 * "unfalsifiable absence" shape that produced story 48.1's HIGH. The positive
 * controls close that gap by proving the walk reaches real code carrying the
 * SURVIVING siblings of every banned symbol.
 */
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
    // Without this, every absence arm below would also pass against an empty
    // read, a wrong root, or a stripper that blanked the whole file. The
    // surviving helpers live in the SAME module the banned ones were deleted
    // from, so finding them proves the sweep reaches the right code.
    const corpus = FILES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n')
    for (const symbol of SURVIVING) {
      expect(
        corpus,
        `${symbol} is not visible to this sweep — it cannot prove any absence`
      ).toMatch(new RegExp(`\\b${symbol}\\b`))
    }
  })

  it.each(BANNED)('%s appears in no source or test file', (symbol) => {
    // ⚠️ RAW source, line-filtered — NOT `stripComments`. See its docblock: the
    // stripper can silently blank live code, and this arm is the reason that can
    // only ever cost a false FAIL (a comment line caught) rather than a false PASS.
    const offenders = FILES.filter(
      (f) => referencesInCode(readFileSync(f, 'utf8'), symbol).length > 0
    ).map((f) => f.slice(WEB_ROOT.length + 1))
    expect(offenders, `${symbol} is still referenced in code`).toEqual([])
  })

  it('⚠️ the stripper does not blank live code (the two reproduced cases)', () => {
    // Both executed during the 48.2 review; pinned so a "simplification" of
    // `stripComments` cannot silently reopen the hole.
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
    // And the backstop must still let genuine PROSE through, or every past-tense
    // comment about the removed feature would redden the arms above.
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
    // ⚠️ EXACT SET. A re-added `export function planRowMove` fails here even if
    // nothing imports it (mutation arm M10) — an unused export is exactly the
    // shape a partial revert takes.
    const source = readFileSync(join(WEB_ROOT, 'src/lib/ordering.ts'), 'utf8')
    // ⚠️ BROADENED IN 48.2's REVIEW. The first version matched only
    // `export function|interface|type|const`, so `export async function`,
    // `export class`, `export enum`, `export let/var`, `export default` and
    // `export { name }` lists all evaded an assertion whose docblock says EXACT SET —
    // and a move planner reintroduced under a fresh name in any of those forms would
    // have slipped both this arm and the `BANNED` sweep.
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
    // The other half of the `sortOrder` KEEP decision (AC-5/AC-6): removing the
    // MUTATION path must not take the CREATE path with it.
    //
    // ⚠️⚠️ THIS IS A "NOT ACCIDENTALLY DELETED" CHECK, NOT A BEHAVIOURAL ONE, and
    // the distinction was MEASURED rather than assumed. Mutation arm M6b removed
    // `sortByDisplayOrder` from `incomeStore`'s ADD path and this test stayed
    // GREEN — the import and the update-path call still satisfied the regex. Two
    // conclusions, both recorded rather than patched over:
    //
    //   1. Do not read this as proof that the add path sorts. The BEHAVIOUR
    //      ("a new row lands at the bottom") is pinned properly, by
    //      `display-order.dom.test.ts`'s "new rows land at the BOTTOM (AC-3)".
    //   2. M6b left that behavioural block green too, and correctly so:
    //      `nextSortOrder` assigns max+1 and the reducer appends, so the array is
    //      already in order and the re-sort is defensive rather than load-bearing.
    //      A test that pins behaviour cannot fail on a redundant implementation
    //      detail, and should not be contorted until it does.
    for (const store of ['incomeStore', 'expenseStore', 'savingsStore', 'balanceStore']) {
      const source = stripComments(readFileSync(join(WEB_ROOT, `src/stores/${store}.ts`), 'utf8'))
      expect(source, `${store} no longer calls nextSortOrder`).toMatch(/\bnextSortOrder\b/)
      expect(source, `${store} no longer calls sortByDisplayOrder`).toMatch(
        /\bsortByDisplayOrder\b/
      )
    }
  })
})
