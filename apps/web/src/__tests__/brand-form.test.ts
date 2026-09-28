import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The product is called "Longhand Budget" wherever a user can see the name
 * (story brand-2). This reverses brand-1 AC-1's two-form rule, where "Longhand"
 * alone was used in prose after the first mention.
 *
 * WHY THE COMPILER, NOT A LINE GREP. Source comments legitimately say
 * "Longhand" (they explain the naming rule itself), and stripping comments with
 * a regex breaks on the `//` inside every URL. So code is parsed with the
 * TypeScript compiler and every JSX text node, string literal and
 * template-literal chunk is checked. Comments are never visited, by
 * construction. This is deliberately OVER-inclusive: an import specifier or a
 * log line is not user-visible, but checking every string costs nothing today
 * (no such string names the product) and saves deciding, per literal, whether
 * it can reach a user.
 *
 * Markdown bodies (docs + legal) and text assets are checked against the raw
 * source, with a lookahead that tolerates whitespace and emphasis markers — a
 * hard-wrap between "Longhand" and "Budget", or `**Longhand** Budget`, is the
 * full name, not the bare one. HTML comments are blanked first (keeping their
 * newlines, so reported line numbers stay true).
 *
 * CASE-SENSITIVE ON PURPOSE. "longhand" is an ordinary English word ("written
 * in longhand"); only the capitalised product name is policed.
 *
 * THE ONLY EXCEPTIONS (Lucas, 2026-09-27): the PWA manifest `short_name` and the
 * install prompt that names the icon the user is about to get. They must agree
 * with each other (`pwa-manifest.test.ts`). Each is matched by FILE, EXACT TEXT
 * AND EXACT COUNT — never by whole file, and never "at least one": a text-only
 * match would also absorb `name: 'Longhand'` in the manifest, and "at least
 * one" would let the visible install heading drift while the aria-label kept
 * the entry alive (both found in brand-2's code review).
 */

const WEB_ROOT = resolve(__dirname, '..')
const APP_ROOT = resolve(__dirname, '../..')
const REPO_ROOT = resolve(APP_ROOT, '../..')
const PACKAGES_ROOT = resolve(REPO_ROOT, 'packages')
const PUBLIC_ROOT = resolve(APP_ROOT, 'public')
const CONTENT_ROOT = resolve(WEB_ROOT, 'content')
const README = resolve(REPO_ROOT, 'README.md')

/** "Longhand" not followed by whitespace + "Budget". Used on single code literals. */
const BARE = /\bLonghand\b(?!\s+Budget\b)/
/** Prose form: whitespace and Markdown emphasis may sit between the two words. */
const PROSE_BARE = /\bLonghand\b(?![\s*_]+Budget\b)/g

const EXCEPTIONS = [
  { file: 'pwa.config.mjs', text: 'Longhand', count: 1 },
  // aria-label + the visible heading: both must stay, and stay identical.
  { file: 'src/components/pwa/InstallPrompt.tsx', text: 'Install Longhand', count: 2 },
] as const

const CODE_EXT = /\.[cm]?[jt]sx?$/
const NOT_SHIPPED = /__tests__\/|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$|\.d\.ts$/
/** App-root files that configure the test harness, not the shipped app. */
const HARNESS = new Set(['playwright.config.ts', 'vitest.config.ts', 'vitest.setup.ts'])

interface Hit {
  readonly file: string
  readonly line: number
  readonly text: string
}

function walk(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, keep))
    else if (keep(full)) out.push(full)
  }
  return out
}

const label = (file: string) => relative(APP_ROOT, file)

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

const USER_VISIBLE_KINDS = new Set([
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
])

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/** Bare-form hits in the string and JSX text nodes of one source file. */
function codeHits(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
  const hits: Hit[] = []
  const visit = (node: ts.Node) => {
    if (USER_VISIBLE_KINDS.has(node.kind)) {
      const text = collapse((node as ts.LiteralLikeNode).text)
      if (BARE.test(text)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        hits.push({ file, line: line + 1, text })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** Bare-form hits in rendered prose (Markdown, or text assets minus comments). */
function proseHits(file: string, source: string): Hit[] {
  const text = source.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '))
  const lines = text.split('\n')
  return [...text.matchAll(PROSE_BARE)].map((m) => {
    const line = text.slice(0, m.index).split('\n').length
    return { file, line, text: lines[line - 1].trim() }
  })
}

const isException = (hit: Hit) =>
  EXCEPTIONS.some((e) => e.file === label(hit.file) && e.text === hit.text)

const CODE_FILES = [
  ...walk(WEB_ROOT, (f) => CODE_EXT.test(f) && !NOT_SHIPPED.test(f)),
  // App entry points and build config (pwa.config.mjs, server-entry.mjs, vite.config.ts…).
  ...readdirSync(APP_ROOT)
    .filter((f) => CODE_EXT.test(f) && !HARNESS.has(f))
    .map((f) => join(APP_ROOT, f)),
  // `packages/*` strings reach users too — e.g. EMAIL_FROM_NAME is the From
  // name on every email, and core's solver copy renders in the UI.
  ...readdirSync(PACKAGES_ROOT)
    .map((p) => join(PACKAGES_ROOT, p, 'src'))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory()
      } catch {
        return false
      }
    })
    .flatMap((dir) => walk(dir, (f) => CODE_EXT.test(f) && !NOT_SHIPPED.test(f))),
]
const MARKDOWN_FILES = walk(CONTENT_ROOT, (f) => extname(f) === '.md')
const PROSE_FILES = [
  ...MARKDOWN_FILES,
  ...walk(PUBLIC_ROOT, (f) =>
    ['.svg', '.html', '.webmanifest', '.txt', '.xml'].includes(extname(f))
  ),
  README,
]

const ALL_HITS: Hit[] = [
  ...CODE_FILES.flatMap((f) => codeHits(f, readFileSync(f, 'utf-8'))),
  ...PROSE_FILES.flatMap((f) => proseHits(f, readFileSync(f, 'utf-8'))),
]

describe('the product name is "Longhand Budget" on every user-visible surface (brand-2)', () => {
  it('sweeps a non-trivial set of files, including each named root (guards a vacuous pass)', () => {
    // A total-count floor is satisfied by src/ alone, so each root is pinned by NAME.
    expect(CODE_FILES.length).toBeGreaterThan(100)
    expect(MARKDOWN_FILES.length).toBeGreaterThanOrEqual(5)
    const swept = new Set([...CODE_FILES, ...PROSE_FILES].map(label))
    expect(swept).toContain('src/routes/login.tsx')
    expect(swept).toContain('src/content/docs/index.ts')
    expect(swept).toContain('pwa.config.mjs')
    expect(swept).toContain('server-entry.mjs')
    expect(swept).toContain('../../packages/config/src/schema.ts')
    expect(swept).toContain('../../packages/core/src/index.ts')
    expect(swept).toContain('src/content/docs/faq.md')
    expect(swept).toContain('src/content/legal/terms.md')
    expect(swept).toContain('public/favicon.svg')
    expect(swept).toContain('../../README.md')
    // The harness is not a shipped surface; this very file must not sweep itself.
    expect(swept).not.toContain('src/__tests__/brand-form.test.ts')
    expect(swept).not.toContain('vitest.config.ts')
  })

  it('no user-visible string uses the bare "Longhand" outside the two sanctioned exceptions', () => {
    const offenders = ALL_HITS.filter((hit) => !isException(hit)).map(
      (hit) => `${label(hit.file)}:${hit.line} "${hit.text}"`
    )
    expect(offenders, `bare "Longhand" found in:\n${offenders.join('\n')}`).toEqual([])
  })

  it('each sanctioned exception matches exactly as many sites as it is meant to', () => {
    for (const exception of EXCEPTIONS) {
      const matched = ALL_HITS.filter(
        (hit) => label(hit.file) === exception.file && hit.text === exception.text
      ).length
      expect(
        matched,
        `exception ${exception.file} "${exception.text}" should match ${exception.count} site(s)`
      ).toBe(exception.count)
    }
  })

  it('reads JSX text, attributes and template chunks, but never comments', () => {
    const hits = codeHits(
      'x.tsx',
      [
        '// Longhand in a line comment',
        '/* Longhand in a block comment */',
        'const a = <p aria-label="Open Longhand">Use Longhand',
        '  Budget today</p>',
        'const b = `Hi ${name}, welcome to Longhand`',
        'const c = `Longhand Budget ${name}`',
      ].join('\n')
    )
    expect(hits.map((h) => [h.line, h.text])).toEqual([
      [3, 'Open Longhand'],
      [5, ', welcome to Longhand'],
    ])
  })

  it('treats hard-wraps and emphasis as the full name, ignores HTML comments, and reports the line', () => {
    const hits = proseHits(
      'x.md',
      [
        'Use **Longhand** Budget today, or Longhand',
        'Budget tomorrow. <!-- Longhand',
        'in a comment --> Then',
        'Longhand alone.',
      ].join('\n')
    )
    expect(hits.map((h) => [h.line, h.text])).toEqual([[4, 'Longhand alone.']])
  })
})
