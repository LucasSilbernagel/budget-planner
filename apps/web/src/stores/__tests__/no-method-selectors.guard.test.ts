/**
 * No zustand selector may CALL a state method (Story 38.1, AC-3, BUG-F).
 *
 * ## Why this is a source sweep and not a runtime test
 *
 * The defect only appears during React hydration, and `render()` is not
 * hydration — every one of the ~96 Overview-area unit tests was structurally
 * blind to it. `store-selector-hydration.dom.test.tsx` proves the *mechanism*
 * on two representative hooks; this file is what stops the shape coming back
 * anywhere else, including on a hook that has no consumer yet and therefore no
 * test of its own.
 *
 * ## The shape, and why it breaks
 *
 * zustand passes `api.getInitialState` to React as `getServerSnapshot`, so during
 * hydration a selector is handed the PRISTINE default state — the same object the
 * server rendered from. But that object's methods still close over `get()`, which
 * returns LIVE state. So:
 *
 *   useSavingsStore((s) => s.getTotalSavings())      ← reads live state    ❌ banned
 *   useSavingsStore((s) => totalSavingsFrom(s.savingsGoals))              ✅ correct
 *   useSavingsStore((s) => s.addSavingsGoal)         ← a reference, not a call ✅
 *
 * Only a CALL is banned. Passing a method reference (the `use*Actions` hooks) is
 * fine: the reference is stable and is invoked from an event handler, long after
 * hydration.
 *
 * ## ⚠️ WHAT THIS GUARD DOES **NOT** CATCH — read before relying on it
 *
 * Code review found the first version pinned exactly one spelling. It now covers
 * paren-less and type-annotated params, braced bodies, optional chaining, and
 * calls nested inside a larger expression. It still CANNOT see:
 *
 *   1. **A named selector defined elsewhere** — `const sel = (s) => s.getX();
 *      useStore(sel)`. Invisible to any regex that keys on the call site.
 *   2. **A method reached through a nested object** — `s.selectors.getX()`.
 *      Deliberately not matched: the pattern that would catch it also flags the
 *      legitimate `s.savingsGoals.map(...)`, and no store in this repo nests
 *      state methods.
 *   3. **Anything outside `apps/web/src`.** No other package renders React.
 *
 * So this is a high-value tripwire, NOT a proof. Do not write "the guard makes
 * this unrepresentable" in a docblock — it makes the common spellings loud.
 *
 * ## ⚠️ Comments and strings are stripped before scanning, and that is load-bearing
 *
 * The banned shape is quoted verbatim in the warning comments in `savingsStore.ts`,
 * `incomeStore.ts` and `expenseStore.ts` — the docs that exist to prevent it. A
 * naive sweep flags its own warning and the obvious "fix" is to water down the
 * documentation. Measured: without stripping, this sweep reports 3 false hits, all
 * inside those comments.
 *
 * ⚠️ The stripper is a character scanner, not a regex. A regex stripper was
 * written first and code review showed it could DELETE REAL CODE: a string
 * containing `/*` opens a phantom block comment that runs to the next real `*​/`,
 * and a regex literal containing an escaped `//` truncates its line — in both
 * cases silently swallowing an offender and reporting the file clean. A guard
 * whose failure mode is silence has to be exact.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(__dirname, '..', '..')

/**
 * A selector whose body calls a method on its own state parameter.
 *
 * Anatomy:
 *   `use\w*Store\(`        the hook call
 *   `(?:useShallow\(\s*)?` an optional equality wrapper
 *   `\(?\s*(\w+)`          the param, with or without parentheses
 *   `(?:\s*:[^)=]+)?\)?`   an optional type annotation
 *   `\s*=>`                the arrow
 *   `[^)]{0,120}?`         an optional prefix (a `return`, a wrapping call, an
 *                          operator) — bounded, and stops at the first `)` so it
 *                          cannot run past the end of the selector
 *   `\b\1\s*\??\.\w+\s*\(` the param, then `.method(` — optional chaining allowed
 *
 * The back-reference `\1` is what distinguishes `(s) => s.getX()` from
 * `(s) => helperFrom(s.field)` — only the former reaches through the snapshot.
 */
const METHOD_SELECTOR =
  /use\w*Store\(\s*(?:useShallow\(\s*)?\(?\s*(\w+)(?:\s*:[^)=]+)?\)?\s*=>[^)]{0,120}?\b\1\s*\??\.\w+\s*\(/g

/**
 * Removes comments, string literals and template literals so the sweep cannot
 * flag its own documentation — and, unlike a regex, cannot delete real code.
 *
 * Replaces stripped spans with spaces so byte offsets (and therefore reported
 * line numbers) stay accurate.
 */
function stripCommentsAndStrings(source: string): string {
  const out = source.split('')
  let i = 0
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '//') {
      let end = source.indexOf('\n', i)
      if (end === -1) end = source.length
      blank(i, end)
      i = end
    } else if (two === '/*') {
      let end = source.indexOf('*/', i + 2)
      end = end === -1 ? source.length : end + 2
      blank(i, end)
      i = end
    } else {
      const ch = source[i]
      if (ch === '"' || ch === "'" || ch === '`') {
        let j = i + 1
        while (j < source.length) {
          if (source[j] === '\\') {
            j += 2
            continue
          }
          if (source[j] === ch) break
          j++
        }
        blank(i + 1, j)
        i = j + 1
      } else {
        i++
      }
    }
  }
  return out.join('')
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      // A broken symlink must not take the whole guard down.
      continue
    }
    if (isDir) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('zustand selectors', () => {
  it('never call a state method (it escapes React’s hydration snapshot)', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(SRC_ROOT)) {
      const source = stripCommentsAndStrings(readFileSync(file, 'utf-8'))
      for (const match of source.matchAll(METHOD_SELECTOR)) {
        const line = source.slice(0, match.index).split('\n').length
        offenders.push(`${file.slice(SRC_ROOT.length + 1)}:${line}  ${match[0]}…)`)
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            'A selector that calls a state method reads LIVE state during hydration and makes React discard the tree (story 38.1).',
            "Read the row's array from the selector argument instead, via the store's pure `*From()` helper:",
            '',
            offenders.join('\n'),
          ].join('\n')
    ).toEqual([])
  })

  /**
   * ⚠️ DESIGNED control — publish as a control, never count it as a pass.
   *
   * Proves the pattern matches the banned shape in every spelling review found it
   * could take, and spares the legitimate ones. Without this, a green sweep above
   * could mean "the regex matches nothing" rather than "no offenders".
   */
  it('the detector matches every banned spelling and spares the allowed ones (control)', () => {
    const banned = [
      'useSavingsStore((state) => state.getTotalSavings())',
      'useSavingsStore((s) => s.getTotalSavings())',
      'useSavingsStore(s => s.getTotalSavings())',
      'useSavingsStore((state: SavingsState) => state.getTotalSavings())',
      'useSavingsStore((s) => { return s.getTotalSavings() })',
      'useSavingsStore((s) => s?.getTotalSavings())',
      'useSavingsStore((s) => 100 - s.getTotalSavings())',
      'useSavingsStore((s) => format(s.getTotalSavings()))',
      'useSavingsStore(useShallow((s) => s.getTotalSavings()))',
    ]
    for (const source of banned) {
      expect(source.match(METHOD_SELECTOR), `should be flagged: ${source}`).toHaveLength(1)
    }

    const allowed = [
      'useSavingsStore((state) => state.getSavingsGoalById)',
      'useSavingsStore((state) => totalSavingsFrom(state.savingsGoals))',
      'useSavingsStore((state) => state.savingsGoals)',
      'useSavingsStore((state) => state.savingsGoals.map(withProgress))',
      'useSavingsStore((state) => state.savingsGoals.filter((g) => g.targetAmount != null))',
    ]
    for (const source of allowed) {
      expect(source.match(METHOD_SELECTOR), `should NOT be flagged: ${source}`).toBeNull()
    }
  })

  /**
   * ⚠️ Guards the guard. Two separate hazards, both found in code review:
   *   - without stripping, the sweep flags the three warning comments (3 hits);
   *   - a REGEX stripper deletes real code when a string or regex literal
   *     contains `/*` or an escaped `//`, silently hiding an offender.
   */
  it('strips comments without deleting real code', () => {
    const documented = '/** never write useSavingsStore((s) => s.getTotalSavings()) */\nconst x = 1'
    expect(stripCommentsAndStrings(documented).match(METHOD_SELECTOR)).toBeNull()
    expect(documented.match(METHOD_SELECTOR)).toHaveLength(1)

    // A string opening a phantom block comment must not swallow what follows.
    const phantomBlock = [
      "const pattern = 'src/*.ts'",
      'useSavingsStore((s) => s.getTotalSavings())',
      '/* a real comment */',
    ].join('\n')
    expect(stripCommentsAndStrings(phantomBlock).match(METHOD_SELECTOR)).toHaveLength(1)

    // An escaped `//` inside a string must not truncate its line.
    const escapedSlashes = [
      "const s = 'a\\/\\/b'",
      'useSavingsStore((s) => s.getTotalSavings())',
    ].join('\n')
    expect(stripCommentsAndStrings(escapedSlashes).match(METHOD_SELECTOR)).toHaveLength(1)

    // Line numbers must survive stripping (spans are blanked, not removed).
    expect(stripCommentsAndStrings('/* a */\nconst x = 1').split('\n')).toHaveLength(2)
  })
})
