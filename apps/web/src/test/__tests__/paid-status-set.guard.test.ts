import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Story 78.3 (FR127) guard: which statuses grant access is defined ONCE, in
 * `lib/premium/access-statuses.ts`. This walks the web source and fails if a
 * new hand-written copy of a status set appears anywhere else.
 *
 * Why a guard and not a comment: the paid-access set was hand-copied six times
 * and the premium-features rule written inline fifteen times. `lifetime` went
 * missing from copies twice (30.4a, 34.1a), and Story 73.2's inventory of the
 * copies counted five of six — its grep's PATTERN was too narrow. So this guard
 * matches SHAPES, not one spelling. A "status" is any value of the
 * `subscriptionStatus` enum; a shape naming TWO DIFFERENT statuses is a set:
 *
 *  (a) an array / `Set` literal (any order or quote, `as const` or not, multi-line);
 *  (b) comparisons against two different statuses in ONE expression joined by
 *      `||` / `&&` — whatever sits between them (`|| s === 'trialing' ||`,
 *      `|| isLegacy ||`) and whatever the operand looks like (`u['status']`,
 *      `(x as U).status`); `.includes('<status>')` counts as a comparison, and
 *      the complement (`!== 'free' && !== 'canceled'`) is a set too;
 *  (c) two statuses as fall-through `case` labels;
 *  (d) a keyed table — an object literal with two statuses as keys
 *      (`{ active: true, lifetime: true }`, the pre-78.3 `STATUS_CLASS` shape).
 *
 * A single-status test (`=== 'lifetime'` for the no-downgrade rule, message
 * branching, a display `switch` with one label and a body per branch) is NOT a
 * set and is not flagged — pinned by the negative cases below.
 *
 * SCOPE — TEST FILES ARE NOT WALKED (decision, Lucas 2026-09-29, 78.3 review).
 * Tests legitimately restate these sets as value pins. The one test-side copy
 * that did drift (the sync route tests' `vi.mock` `['active','past_due']`) was
 * removed by 78.3, and those tests now exercise the real `hasPaidAccess`. The
 * matcher RECOGNISES that shape (fixture below); the walk does not look there.
 *
 * Known limitation (as the no-browser-confirm guard): aliasing, computed
 * strings, regex literals, ternary chains and spreads can evade a text scan. It
 * is defence in depth against the copy-paste that actually happened, not an AST
 * proof.
 */

const SRC_ROOT = resolve(__dirname, '../..')

/** The one definition. It is exempt: it IS the keyed table. */
const DEFINITION = 'lib/premium/access-statuses.ts'

/**
 * Files allowed to contain a matching shape, with the EXACT number of matches.
 * A count, not a presence flag: a second copy added to an allowed file must
 * still fail (allow-list masking — see memory "allow-list needs exact counts").
 */
const ALLOWED: Readonly<Record<string, number>> = {
  // Paddle's OWN subscription statuses (`trialing`, `paused` are not ours), the
  // set of subscriptions to cancel on account deletion — not an access rule.
  'server/paddle/subscription-api.ts': 1,
  // `STATUS_CLASS` names every status as a key so a new enum value is a tsc
  // error there too; every value is DERIVED (`classOf(...)`) from the definition.
  'server/retention/status-classes.ts': 1,
}

const STATUS_WORDS = ['free', 'active', 'past_due', 'canceled', 'lifetime'] as const
const STATUS = `(${STATUS_WORDS.join('|')})`
const Q = '[\'"`]'

/**
 * Blank comments while keeping strings, template literals and regex literals
 * intact, so a `/*` or `//` INSIDE a string (a CSP source, a glob, a URL) can
 * never hide the code after it. Comment characters become spaces; newlines are
 * kept.
 */
export function stripComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  // The last significant (non-space, non-comment) character emitted — decides
  // whether a `/` starts a regex literal or is a division.
  let prev = ''
  while (i < n) {
    const ch = source[i] as string
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < n && source[j] !== ch) {
        if (source[j] === '\\') j++
        else if (ch !== '`' && source[j] === '\n') break
        j++
      }
      out += source.slice(i, j + 1)
      i = j + 1
      prev = ch
      continue
    }
    if (ch === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev))) {
      // Regex literal: copy through its closing `/`, honouring escapes and classes.
      let j = i + 1
      let inClass = false
      while (j < n && source[j] !== '\n') {
        const c = source[j]
        if (c === '\\') j++
        else if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) break
        j++
      }
      out += source.slice(i, j + 1)
      i = j + 1
      prev = '/'
      continue
    }
    out += ch
    if (!/\s/.test(ch)) prev = ch
    i++
  }
  return out
}

function distinctStatuses(text: string): Set<string> {
  const found = new Set<string>()
  for (const m of text.matchAll(new RegExp(`(${Q})${STATUS}\\1`, 'g'))) {
    found.add(m[2] as string)
  }
  return found
}

/** Whether the text between two positions stays inside ONE expression. */
function sameExpression(between: string): boolean {
  return !/[;{}]/.test(between) && /\|\||&&/.test(between)
}

/** Whether the text between two keys stays inside ONE object literal (balanced, no `;`). */
function sameObject(between: string): boolean {
  if (between.includes(';')) return false
  let depth = 0
  for (const ch of between) {
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
    if (depth < 0) return false
  }
  return depth === 0
}

/**
 * Every status-set shape in `source` (comments are stripped here). Returns the
 * offending snippets, whitespace-collapsed.
 */
export function findStatusSetCopies(source: string): string[] {
  const code = stripComments(source)
  const hits: string[] = []
  const show = (s: string) => s.replace(/\s+/g, ' ').trim()

  // (a) bracketed literal (no nested brackets) naming 2+ statuses.
  for (const m of code.matchAll(/\[[^[\]]*\]/g)) {
    if (distinctStatuses(m[0]).size >= 2) hits.push(show(m[0]))
  }

  // (b) comparison atoms, matched by operator + literal only (any operand).
  const cmp = '(?:===|!==|==|!=)'
  const atom = new RegExp(
    `${cmp}\\s*(${Q})${STATUS}\\1|(${Q})${STATUS}\\3\\s*${cmp}|\\.includes\\(\\s*(${Q})${STATUS}\\5\\s*\\)`,
    'g'
  )
  const atoms = [...code.matchAll(atom)].map((m) => ({
    status: (m[2] ?? m[4] ?? m[6]) as string,
    start: m.index as number,
    end: (m.index as number) + m[0].length,
  }))
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]
    if (!a) continue
    // The nearest later atom with a DIFFERENT status, still in the same expression.
    for (let k = i + 1; k < atoms.length; k++) {
      const b = atoms[k]
      if (!b) break
      const between = code.slice(a.end, b.start)
      if (/[;{}]/.test(between)) break
      if (b.status === a.status) continue
      if (sameExpression(between)) {
        hits.push(show(code.slice(a.start, b.end)))
        i = k
      }
      break
    }
  }

  // (c) fall-through case labels: `case 'active': case 'lifetime':` with no body between.
  for (const m of code.matchAll(new RegExp(`(?:case\\s*(${Q})${STATUS}\\1\\s*:\\s*){2,}`, 'g'))) {
    if (distinctStatuses(m[0]).size >= 2) hits.push(show(m[0]))
  }

  // (d) keyed table: two different status keys in one object literal.
  const key = new RegExp(`[{,]\\s*(?:(${Q})${STATUS}\\1|\\b${STATUS}\\b)\\s*:`, 'g')
  const keys = [...code.matchAll(key)].map((m) => ({
    status: (m[2] ?? m[3]) as string,
    start: m.index as number,
    end: (m.index as number) + m[0].length,
  }))
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (!a || !b || a.status === b.status) continue
    if (sameObject(code.slice(a.end, b.start))) {
      hits.push(show(code.slice(a.start, b.end)))
      // One hit per table: skip the rest of this object's status keys.
      while (i + 1 < keys.length) {
        const c = keys[i + 1]
        const d = keys[i]
        if (!c || !d || !sameObject(code.slice(d.end, c.start))) break
        i++
      }
    }
  }

  return hits
}

/** Recursively collect non-test source files (.ts/.tsx/.js/.mjs/.cjs). */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      collectSourceFiles(full, acc)
      continue
    }
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) continue
    if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(entry)) continue
    if (entry.endsWith('.gen.ts') || entry.endsWith('.d.ts')) continue
    acc.push(full)
  }
  return acc
}

describe('stripComments — strings are not comments', () => {
  it('keeps code after a `/*` inside a string (CSP / glob)', () => {
    const src =
      "const csp = 'https://*.paddle.com /*.x'\nconst X = ['active', 'lifetime']\n/* real */"
    expect(stripComments(src)).toContain("['active', 'lifetime']")
    expect(stripComments(src)).not.toContain('real')
  })

  it('keeps the rest of a line after a `//` inside a string', () => {
    const src = "const u = 'a//b'; const X = ['active', 'lifetime']"
    expect(stripComments(src)).toContain("['active', 'lifetime']")
  })

  it('keeps code after a regex literal containing a quote or `/*`', () => {
    const src = "const r = /['\"]/g\nconst g = /\\/\\*/\nconst X = ['active', 'lifetime']"
    expect(stripComments(src)).toContain("['active', 'lifetime']")
  })

  it('still blanks real line and block comments', () => {
    expect(stripComments("x // ['active', 'lifetime']").trim()).toBe('x')
    expect(stripComments("x /* ['active', 'lifetime'] */").trim()).toBe('x')
  })
})

describe('findStatusSetCopies — catches every historical spelling', () => {
  it.each([
    // The six copies Story 78.3 removed, verbatim.
    ["const ENTITLED_STATUSES: readonly string[] = ['active', 'past_due', 'lifetime']"],
    ["const PAID_ACCESS_STATUSES: readonly string[] = ['active', 'past_due', 'lifetime']"],
    ["export const PAID_SYNC_STATUSES = ['active', 'past_due', 'lifetime'] as const"],
    ["export const PAID_SYNC_STATUSES = ['active', 'past_due', 'lifetime']"],
    ["const ALREADY_PREMIUM_STATUSES = ['active', 'past_due', 'lifetime'] as const"],
    // The stale two-status shape the sync route TESTS carried (the matcher knows
    // it; test files are outside the walk — see SCOPE above).
    ["PAID_SYNC_STATUSES: ['active', 'past_due'],"],
    // Reordered, double-quoted, backticks, Set, multi-line, the lapsed complement.
    ["const X = ['lifetime', 'active']"],
    ['const X = ["past_due", "lifetime"]'],
    ['const X = [`active`, `lifetime`]'],
    ["const X = new Set(['active', 'lifetime'])"],
    ["const X = [\n  'lifetime',\n  'past_due',\n  'active',\n] as const"],
    ["const LAPSED = ['free', 'canceled']"],
    // Inline comparisons — the fifteen premium-features sites' shapes.
    ["return subscriptionStatus === 'active' || subscriptionStatus === 'lifetime'"],
    ["(seed.subscriptionStatus === 'active' || seed.subscriptionStatus === 'lifetime')"],
    ["if (user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'lifetime') {"],
    [
      "if (\n      sessionResult.data.subscriptionStatus !== 'active' &&\n      sessionResult.data.subscriptionStatus !== 'lifetime'\n    ) {",
    ],
    ['if (s === "past_due" || s === "active") {'],
    ["if ('active' === s || 'lifetime' === s) {"],
    ["if (s === 'active' || (s === 'lifetime')) {"],
    // Review 2026-09-29: a middle term, odd operands, backticks, includes, complement.
    ["if (s === 'active' || s === 'trialing' || s === 'lifetime') {"],
    ["if (s === 'active' || isLegacy || s === 'lifetime') {"],
    ["if (u['status'] === 'active' || u['status'] === 'lifetime') {"],
    ["if ((x as U).status === 'active' || (x as U).status === 'lifetime') {"],
    ['if (s === `active` || s === `lifetime`) {'],
    ["if (s.includes('active') || s.includes('lifetime')) {"],
    ["if (s !== 'free' && s !== 'canceled') {"],
    // Switch-shaped set.
    ["switch (s) {\n  case 'active':\n  case 'lifetime':\n    return true\n}"],
    // Keyed tables — the STATUS_ACCESS / pre-78.3 STATUS_CLASS shapes.
    ['const X = { active: true, lifetime: true }'],
    [
      "const STATUS_CLASS = {\n  free: 'lapsed',\n  active: 'entitled',\n  past_due: 'entitled',\n} as const",
    ],
    ['const T = { \'active\': 1, "past_due": 1 }'],
    [
      'const T = {\n  active: { paidAccess: true, premiumFeatures: true },\n  lifetime: { paidAccess: true, premiumFeatures: true },\n}',
    ],
  ])('flags %j', (snippet) => {
    expect(findStatusSetCopies(snippet)).toHaveLength(1)
  })

  it.each([
    // Single-status rules — legitimate, and present in the source today.
    ["if (existing[0]?.status === 'lifetime') {"],
    ["sql`${users.subscriptionStatus} <> 'lifetime'`"],
    ["if (status === 'lifetime') {\n  return 1\n}\nif (status === 'past_due') {\n  return 2\n}"],
    // One label per branch (plan-label.ts) and a mapping with one of ours per group.
    [
      "switch (status) {\n  case 'lifetime':\n    return 'Lifetime Plan'\n  case 'active':\n    return 'Active'\n}",
    ],
    ["switch (s) {\n  case 'active':\n  case 'trialing':\n    return 'active'\n}"],
    // Type unions are not sets that grant anything.
    ["subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime' | null"],
    // A single status in a literal, and the same status twice.
    ["const X = ['lifetime']"],
    ["if (a === 'active' || b === 'active') {"],
    // Two statuses in DIFFERENT statements / objects.
    ["const a = s === 'active'; const b = s === 'lifetime'"],
    ["const P = { monthly: '€5.99', lifetime: '€99' }\nconst Q = { active: 1 }"],
    // An object type with `;` separators, and one status key per object.
    ['type T = { active: boolean; lifetime: boolean }'],
    // Prose.
    ["// was ['active', 'past_due', 'lifetime'] before 78.3"],
    ["/* s === 'active' || s === 'lifetime' */"],
  ])('does not flag %j', (snippet) => {
    expect(findStatusSetCopies(snippet)).toEqual([])
  })
})

describe('guard: the status sets are defined once (Story 78.3)', () => {
  it('finds no hand-written status set outside lib/premium/access-statuses.ts', () => {
    const offenders: string[] = []
    const allowedSeen: Record<string, number> = {}
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file)
      if (rel === DEFINITION) continue
      const hits = findStatusSetCopies(readFileSync(file, 'utf8'))
      if (hits.length === 0) continue
      if (rel in ALLOWED) {
        allowedSeen[rel] = hits.length
        continue
      }
      for (const hit of hits) offenders.push(`src/${rel}: ${hit}`)
    }
    expect(offenders).toEqual([])
    // Every allow-listed file still matches, EXACTLY as often as pinned — a stale
    // entry or a second copy in an allowed file both fail here.
    expect(allowedSeen).toEqual(ALLOWED)
  })

  it('the definition file exists where the guard expects it', () => {
    // A rename would otherwise turn the `continue` above into a silent no-op.
    expect(statSync(join(SRC_ROOT, DEFINITION)).isFile()).toBe(true)
  })

  it('the walk actually covers the source tree, .mjs included', () => {
    // A guard that scans nothing passes. Pin a floor, one file known to import
    // the definition, and one server `.mjs` (the walk once skipped them).
    const files = collectSourceFiles(SRC_ROOT).map((f) => relative(SRC_ROOT, f))
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain('server/api/sync.ts')
    expect(files).toContain('server/node-adapter.mjs')
  })
})
