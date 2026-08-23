import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Recharts must stay OFF the Overview's synchronous critical path (story 38.3).
 *
 * ## What this guards, and why a source sweep is the right shape
 *
 * `@tanstack/react-start`'s `hydrateStart.js:28` AWAITS `router.loadRouteChunk`
 * for every match before hydration begins. So every module reachable from
 * `routes/index.tsx` by a STATIC import is fetched and evaluated before the user's
 * figures can appear. Story 38.3 measured the cost of one such import: moving
 * `recharts` out of `HomePage.tsx` took the Overview's critical path from
 * **288.3 KB gzipped across 17 assets to 171.1 KB across 16** — all of it in front of
 * a number the user is waiting to read. (The earlier "177.9 KB" here was arithmetic on
 * a rounded delta rather than a figure the script printed; both numbers above are now
 * script output, and `scripts/measure-critical-path.mjs` reproduces them.)
 *
 * A runtime test cannot see this. jsdom gives `ResponsiveContainer` a 0x0 box so
 * no chart SVG ever renders, and the unit suite does not hydrate at all
 * (`hydrateRoot` has zero hits repo-wide). A build-output test cannot see it
 * either: CI never runs `pnpm build`, so an assertion over `dist/` would be
 * permanently skipped. The import graph is the one artifact that is both the
 * cause and always present.
 *
 * ## ⚠️ What this does NOT catch
 *
 * 1. **A transitive import through a package**, e.g. if `@budget-planner/core`
 *    ever imported `recharts`. The walk stops at the `apps/web/src` boundary
 *    because nothing outside it renders React today.
 * 2. **A re-export chain that launders the name** — `export * from './x'` IS
 *    followed, but a dynamically-computed specifier is not (and cannot be).
 * 3. **Any other heavy dependency.** The `banned` lists are lists, not a policy.
 *    Add to one when a MEASUREMENT says something belongs there — not on a hunch.
 * 4. **A `@/`-aliased module's own imports.** {@link resolveLocal} follows only
 *    relative specifiers, so an aliased import is recorded as a leaf: banning
 *    `@/hooks/useSync` catches a direct import of it, but not a third module that
 *    imports it and is itself pulled in under an alias. Both current call sites are
 *    direct, and `scripts/measure-critical-path.mjs` is the backstop that would
 *    show the bytes returning.
 *
 * So this is a tripwire, not a proof. The number that proves it is
 * `scripts/measure-critical-path.mjs`, run against a fresh build.
 *
 * ## ⚠️ The walk follows STATIC imports only, and that is the entire point
 *
 * `import('./HomeChartCanvases')` is invisible here by design: putting Recharts
 * behind a dynamic import is the fix. If this file ever starts following dynamic
 * imports it will flag the fix as the defect.
 */

const SRC_ROOT = resolve(__dirname, '..')

/**
 * The two synchronous entry points, and what each may not pull in.
 *
 * `routes/index.tsx` is the Overview route chunk. `routes/__root.tsx` is the root
 * chunk EVERY visitor downloads before hydration on every route, so a heavy static
 * import there costs more than one on any single page.
 *
 * Each banned specifier is here because a MEASUREMENT put it here, and the
 * measurement is in the story's Dev Agent Record. This is not a place for hunches:
 * `scripts/measure-critical-path.mjs` is what says whether something belongs.
 */
const ENTRIES = [
  {
    name: 'Overview route',
    entry: join(SRC_ROOT, 'routes', 'index.tsx'),
    mustReach: 'components/HomePage.tsx',
    // 104.0 KB gzipped, 36.1% of the measured critical path (story 38.3).
    banned: ['recharts'],
  },
  {
    name: 'root route',
    entry: join(SRC_ROOT, 'routes', '__root.tsx'),
    mustReach: 'components/sync/SyncProvider.tsx',
    // The sync ENGINE: dead code for every free and signed-out visitor, yet it
    // shipped in the root chunk until story 38.3 split `ActiveSync` out.
    //
    // ⚠️ `@/lib/sync/syncBridge` is deliberately NOT banned, and the reason is a
    // correction. It was on this list until code review pointed the guard at module
    // identity instead of specifier strings — at which point the ban failed, because
    // `lib/sync/syncBridge.ts` has been in the root closure all along: all six stores
    // import it relatively (`stores/balanceStore.ts:36` and five siblings) to publish
    // their mutations. That is correct and byte-cheap — the module's only import is
    // `import type { SyncEntityType }`, which is erased. Banning it asserted a
    // property that was already false, and the string-matching check hid that.
    banned: ['@/hooks/useSync', '@/lib/sync/seedLocalData'],
  },
] as const

/**
 * A `/` opens a REGEX LITERAL when the previous significant character cannot end a
 * value. After an identifier, a number, `)`, `]` or a quote, `/` is division.
 */
const REGEX_MAY_FOLLOW = /[(,=:[!&|?{};+\-*%~^<>]|^$/

/**
 * Blank out comments, leaving strings intact.
 *
 * ⚠️ A character scanner, not a regex, for the reason code review 38.1 recorded:
 * a regex stripper can DELETE REAL CODE, because a string containing `/*` opens a
 * phantom block comment that runs to the next real terminator. Here that would
 * swallow an offending import and report the file clean — a guard whose failure
 * mode is silence.
 *
 * Strings are deliberately KEPT: unlike 38.1's selector sweep, the thing being
 * matched here IS a string literal (the module specifier).
 */
function stripComments(source: string): string {
  const out = source.split('')
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }
  // The last significant character seen, used to decide whether a `/` opens a
  // REGEX LITERAL or is a division operator. Division can only follow a value, so
  // anything else means regex. This is the standard lexer heuristic and it is here
  // because code review measured the cost of omitting it: a single `/^\\/*/` in a
  // scanned file opened a phantom block comment that blanked every import after it,
  // and a regex containing a quote desynced the string scanner the same way.
  let prev = ''
  let i = 0
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
      const ch = source[i] as string
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
        i = j + 1
        prev = ch
      } else if (ch === '/' && REGEX_MAY_FOLLOW.test(prev)) {
        // Skip the regex literal WITHOUT blanking it: it is not a comment, and its
        // contents must not be mistaken for one. Character classes may contain an
        // unescaped `/`, so track them.
        let j = i + 1
        let inClass = false
        while (j < source.length) {
          const c = source[j]
          if (c === '\\') {
            j += 2
            continue
          }
          if (c === '\n') break
          if (c === '[') inClass = true
          else if (c === ']') inClass = false
          else if (c === '/' && !inClass) break
          j++
        }
        i = j + 1
        prev = '/'
      } else {
        if (ch.trim() !== '') prev = ch
        i++
      }
    }
  }
  return out.join('')
}

/**
 * Every STATIC module specifier in a file — `import … from 'x'`, `export … from 'x'`,
 * and the side-effect form `import 'x'`.
 *
 * ⚠️ **THIS IS A SCANNER, NOT A REGEX, AND THAT IS THE WHOLE POINT.** The regex this
 * replaced excluded `\n` from the clause between `import` and `from`, so it could not
 * see a braced import spanning multiple lines — which is the form Biome produces for
 * anything past the line width, and precisely the form of the ten-symbol
 * `import { Bar, BarChart, … } from 'recharts'` that story 38.3 removed from
 * `HomePage.tsx`. **Measured during code review: restoring that exact block left this
 * guard passing 10/10.** The recorded mutation had used a SINGLE-LINE import, so the
 * spelling of the mutation — not the code — is what made the detector fire.
 *
 * The same blindness silently shrank the closure: 24 multi-line RELATIVE imports were
 * dropped as edges, so any file reachable only through one was never scanned at all,
 * while `mustReach` and the file-count floor both still passed.
 *
 * `import type` / `export type` are excluded: type-only imports are erased by the
 * compiler and ship no bytes. A dynamic `import('…')` is never matched — it is a call
 * expression, not a statement, and deferring a module behind one is the FIX this guard
 * exists to protect, not a violation of it.
 */
function staticSpecifiers(source: string): string[] {
  const code = stripComments(source)
  const lines = code.split('\n')
  const specs: string[] = []

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] as string
    // ⚠️ `(?=\s)` is load-bearing: it rejects `import('./x')`. A dynamic import is a
    // call expression, and deferring a module behind one is the FIX this guard
    // protects — matching it would flag `HomePage.tsx`'s own lazy boundaries as the
    // defect they prevent.
    if (!/^[ \t]*(?:import|export)(?=\s)/.test(line)) continue
    if (/^[ \t]*(?:import|export)\s+type\b/.test(line)) continue

    // Walk forward until the statement yields a quoted specifier. A statement that
    // never does (e.g. `export function foo() {`) is abandoned as soon as another
    // statement starts, so it cannot swallow a later import's specifier.
    for (let k = n; k < lines.length && k <= n + 40; k++) {
      const cur = lines[k] as string
      if (k > n && /^[ \t]*(?:import|export)(?=\s)/.test(cur)) break
      const quoted = [...cur.matchAll(/['"]([^'"]+)['"]/g)]
      if (quoted.length > 0) {
        const last = quoted[quoted.length - 1]?.[1]
        if (last !== undefined) specs.push(last)
        n = k
        break
      }
      // A `;` or a closing brace with nothing after it ends a specifier-less statement.
      if (k > n && /^[ \t]*\}?[ \t]*;?[ \t]*$/.test(cur) && !cur.includes('from')) break
    }
  }
  return specs
}

/**
 * Resolve a specifier to a real file under `src/`, or `null` if it is external.
 *
 * ⚠️ Handles BOTH relative (`./x`, `../x`) and `@/`-aliased specifiers. The alias is
 * `apps/web/src` (`vite.config.ts`), and following it is not optional: code review
 * measured that the root-route ban on `@/lib/sync/syncBridge` matched nothing while
 * `lib/sync/syncBridge.ts` was in the closure the whole time, because all six stores
 * import it RELATIVELY. A ban that fires on only one spelling of a module is not a ban.
 *
 * `.js`/`.jsx` suffixes resolve to their TypeScript source, so an ESM-style
 * `./foo.js` is followed instead of being dropped as an external leaf.
 */
function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec)
  } else if (spec.startsWith('@/')) {
    base = join(SRC_ROOT, spec.slice(2))
  } else {
    return null
  }

  const withoutJs = base.replace(/\.(js|jsx)$/, '')
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // unreadable — fall through to the next candidate
    }
  }
  return null
}

/**
 * Does `spec`, as written in `fromFile`, refer to the banned module?
 *
 * ⚠️ **Module identity, not string equality.** `specs.includes(banned)` was the
 * original check, and code review found three ways past it in one line each: a deep
 * path (`recharts/es6/cartesian/Bar`), a relative spelling of an alias-banned module
 * (`../hooks/useSync`), and a barrel re-export (`hooks/index.ts`'s
 * `export * from './useSync'`).
 */
function matchesBanned(fromFile: string, spec: string, banned: string): boolean {
  if (banned.startsWith('@/')) {
    const bannedFile = resolveLocal(SRC_ROOT, banned)
    const specFile = resolveLocal(fromFile, spec)
    return bannedFile !== null && specFile !== null && bannedFile === specFile
  }
  // A bare package: the package itself, or any deep path inside it.
  return spec === banned || spec.startsWith(`${banned}/`)
}

/** Every `apps/web/src` module reachable from `ENTRY` by static imports. */
function staticClosure(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    const source = readFileSync(file, 'utf8')
    const specs = staticSpecifiers(source)
    seen.set(file, specs)
    for (const spec of specs) {
      const local = resolveLocal(file, spec)
      if (local !== null && !seen.has(local)) queue.push(local)
    }
  }
  return seen
}

/**
 * The scanner's own regression suite.
 *
 * ⚠️ Every case below is a bypass code review FOUND IN THE SHIPPED GUARD, not a
 * hypothetical. The original regex-based matcher passed all three while the guard it
 * powered reported 10/10 green with the real `recharts` import restored. A detector
 * needs its own detector.
 */
describe('staticSpecifiers — the bypasses code review found', () => {
  const q = "'"

  it('sees a MULTI-LINE braced import (the form Biome emits, and the one that beat it)', () => {
    const src = `import {\n  Bar,\n  BarChart,\n  Pie,\n} from ${q}recharts${q}`
    expect(staticSpecifiers(src)).toContain('recharts')
  })

  it('sees a single-line import', () => {
    expect(staticSpecifiers(`import { Bar } from ${q}recharts${q}`)).toContain('recharts')
  })

  it('sees a side-effect import', () => {
    expect(staticSpecifiers(`import ${q}recharts${q}`)).toContain('recharts')
  })

  it('sees a multi-line RELATIVE import (these were dropped as closure edges)', () => {
    const src = `import {\n  useOverviewDuration,\n} from ${q}../stores/overviewDurationStore${q}`
    expect(staticSpecifiers(src)).toContain('../stores/overviewDurationStore')
  })

  it('is not derailed by a regex literal containing a block-comment opener', () => {
    const src = `const CLEANUP = /^\\/*/\nimport { Bar } from ${q}recharts${q}`
    expect(staticSpecifiers(src)).toContain('recharts')
  })

  it('is not derailed by a regex literal containing a line-comment opener', () => {
    const src = `const p = /a\\/\\/b/\nimport { Bar } from ${q}recharts${q}`
    expect(staticSpecifiers(src)).toContain('recharts')
  })

  it('is not derailed by a regex literal containing a quote', () => {
    const src = `const re = /${q}/\nimport { Bar } from ${q}recharts${q}`
    expect(staticSpecifiers(src)).toContain('recharts')
  })

  it('still ignores real comments', () => {
    const src = `// import { Bar } from ${q}recharts${q}\n/* import { Pie } from ${q}recharts${q} */\nconst x = 1`
    expect(staticSpecifiers(src)).not.toContain('recharts')
  })

  it('still ignores type-only imports and DYNAMIC imports', () => {
    expect(staticSpecifiers(`import type { X } from ${q}recharts${q}`)).not.toContain('recharts')
    expect(staticSpecifiers(`  import(${q}./HomeChartCanvases${q}).then(m => m)`)).toHaveLength(0)
  })
})

describe('matchesBanned — module identity, not string equality', () => {
  const HOME = join(SRC_ROOT, 'components', 'HomePage.tsx')

  it('catches a deep path into a banned package', () => {
    expect(matchesBanned(HOME, 'recharts/es6/cartesian/Bar', 'recharts')).toBe(true)
  })

  it('does not catch a package that merely starts with the banned name', () => {
    expect(matchesBanned(HOME, 'recharts-extra', 'recharts')).toBe(false)
  })

  it('catches a RELATIVE spelling of an alias-banned module', () => {
    const fromRoot = join(SRC_ROOT, 'components', 'sync', 'SyncProvider.tsx')
    expect(matchesBanned(fromRoot, '../../hooks/useSync', '@/hooks/useSync')).toBe(true)
  })
})

describe.each(ENTRIES)('$name synchronous import graph (story 38.3)', (subject) => {
  const closure = staticClosure(subject.entry)
  const files = [...closure.keys()].map((f) => relative(SRC_ROOT, f))

  it(`reaches ${subject.mustReach} — otherwise every assertion here is vacuous`, () => {
    // ⚠️ THE LOAD-BEARING CHECK. If the walk silently resolved nothing (a rename,
    // a changed extension, an alias replacing the relative import), the bans below
    // would sweep an empty graph and pass forever. Story 38.2's M12 is the
    // precedent: a fence that could not fire read as coverage for a story.
    expect(files).toContain(subject.mustReach)
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(subject.banned)('no module on the path statically imports %s', (banned) => {
    const offenders = [...closure.entries()]
      .filter(([file, specs]) => specs.some((spec) => matchesBanned(file, spec, banned)))
      .map(([file]) => relative(SRC_ROOT, file))

    const why = `statically import "${banned}", which puts it on the critical path before hydration. Pull it through React.lazy instead — see components/HomeChartCanvases.tsx and components/sync/ActiveSync.tsx.`
    expect(offenders, `${offenders.join(', ')} ${why}`).toEqual([])
  })

  it.each(['components/HomeChartCanvases.tsx', 'components/sync/ActiveSync.tsx'])(
    '%s is NOT on this synchronous path (it is a lazy boundary)',
    (lazyModule) => {
      // The complement of the bans: proving each module still EXISTS and is still
      // reached only dynamically. If a future edit imports one statically the bans
      // above fire, but this states the intent directly, so the failure names the
      // design rather than only the symptom.
      expect(existsSync(join(SRC_ROOT, lazyModule))).toBe(true)
      expect(files).not.toContain(lazyModule)
    }
  )
})
