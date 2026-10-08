import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Brand and copy sweeps use SEPARATE allow-lists: the brand list exempts all tests, which
// would blind the copy sweep in the very files that carry the retired copy.

const WEB_ROOT = resolve(__dirname, '..')
const PUBLIC_ROOT = resolve(__dirname, '../../public')
const PWA_CONFIG = resolve(__dirname, '../../pwa.config.mjs')
const REPO_ROOT = resolve(__dirname, '../../../..')
// Copy only, never brands: `packages/` keeps internal `budget-planner` identifiers, but its
// strings do reach the UI.
const PACKAGES_ROOT = resolve(REPO_ROOT, 'packages')

// The repo root is walked one level deep: `_bmad-output/` quotes retired brands on purpose.
const REPO_DOC_ROOT = REPO_ROOT
const DOCS_ROOT = resolve(REPO_ROOT, 'docs')

const RETIRED_BRANDS = ['SoluBudget', 'Budget Planner'] as const

// Distinguishing fragments, matched after normalize() so hard-wrapped comments still match.
const RETIRED_COPY = ['minds its own business', 'never sees your money'] as const

const normalize = (content: string) => content.replace(/[\s*/#]+/g, ' ').toLowerCase()

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.mjs', '.svg', '.html', '.webmanifest'])

const ALLOWED = [
  // Guards asserting the retired brands are gone necessarily name them.
  /__tests__\//,
  /\.test\.tsx?$/,
  // Internal identifiers and prose about the original project name are out of scope.
  /src\/stores\/profileStore\.ts$/,
  /src\/hooks\//,
  /src\/server\/api\//,
  /src\/server\/functions\//,
  /src\/components\/settings\/local-data-section\.tsx$/,
] as const

const COPY_ALLOWED = [
  // This file names the retired copy in order to assert its absence.
  /src\/__tests__\/retired-brand\.test\.ts$/,
  // Carries the rendered homepage subtitle absence guard.
  /src\/components\/__tests__\/HomePage\.test\.tsx$/,
  // Carries the <title> and meta description absence guards.
  /src\/routes\/__tests__\/root-head\.test\.ts$/,
] as const

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (SCANNED_EXTENSIONS.has(extname(entry))) {
      out.push(full)
    }
  }
  return out
}

// `withFileTypes`, not `statSync`: stat follows symlinks, so a dangling one would throw at
// collection and drop the whole file.
function walkTopLevel(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name)))
    .map((entry) => join(dir, entry.name))
}

const REPO_DOC_FILES = [...walkTopLevel(REPO_DOC_ROOT), ...walk(DOCS_ROOT)]

const ALL_FILES = [...walk(WEB_ROOT), ...walk(PUBLIC_ROOT), PWA_CONFIG, ...REPO_DOC_FILES]
const ALL_COPY_FILES = [...ALL_FILES, ...walk(PACKAGES_ROOT)]

const label = (file: string) => file.replace(`${REPO_ROOT}/`, '')

describe('no retired brand survives on a shipped surface (brand-1 AC-2)', () => {
  const files = ALL_FILES.filter((f) => !ALLOWED.some((pattern) => pattern.test(f)))

  it('walks a non-trivial set of files (guards against a vacuous pass)', () => {
    // Without this, a broken walk or an over-broad ALLOWED entry would make the
    // sweep below pass by scanning nothing at all.
    expect(files.length).toBeGreaterThan(100)
  })

  it('reaches the contributor docs outside apps/web (story 40-3, AC-5)', () => {
    // The count can't protect these (apps/web alone clears it), so pin the named files.
    const swept = new Set(files.map(label))

    expect(swept).toContain('README.md')
    expect(swept).toContain('product-document.md')
    expect(swept).toContain('docs/development.md')
  })

  for (const brand of RETIRED_BRANDS) {
    it(`no shipped file contains "${brand}"`, () => {
      const offenders = files
        .filter((file) => readFileSync(file, 'utf-8').includes(brand))
        .map(label)

      expect(offenders, `retired brand "${brand}" found in: ${offenders.join(', ')}`).toEqual([])
    })
  }
})

describe('no retired copy survives on a shipped surface (story 36-1 AC-4)', () => {
  const copyFiles = ALL_COPY_FILES.filter((f) => !COPY_ALLOWED.some((pattern) => pattern.test(f)))

  it('walks a non-trivial set of files (guards against a vacuous pass)', () => {
    // The brand sweep's own guard says nothing about this list — COPY_ALLOWED is
    // a different filter and could over-match independently.
    expect(copyFiles.length).toBeGreaterThan(100)
  })

  it('walks EVERY root, so a single dropped root cannot hide behind the total', () => {
    // Per root: a total-only floor is satisfied by WEB_ROOT alone. Checked on the swept list,
    // not a re-walk, so dropping a root from ALL_COPY_FILES fails.
    const underRoot = (root: string) => copyFiles.filter((f) => f.startsWith(`${root}/`)).length
    expect(underRoot(WEB_ROOT)).toBeGreaterThan(100)
    expect(underRoot(PUBLIC_ROOT)).toBeGreaterThan(0)
    expect(underRoot(PACKAGES_ROOT)).toBeGreaterThan(10)

    // Names, not a count: REPO_DOC_ROOT is REPO_ROOT, so a `startsWith` floor proves nothing.
    const sweptCopy = new Set(copyFiles.map(label))
    expect(sweptCopy).toContain('README.md')
    expect(sweptCopy).toContain('docs/development.md')
  })

  for (const copy of RETIRED_COPY) {
    it(`no shipped file contains "${copy}"`, () => {
      // Word-bounded so "reminds its own business" does not trip a guard whose
      // failure message asserts retired copy was found.
      const needle = new RegExp(`\\b${copy}\\b`)
      const offenders = copyFiles
        .filter((file) => needle.test(normalize(readFileSync(file, 'utf-8'))))
        .map(label)

      expect(offenders, `retired copy "${copy}" found in: ${offenders.join(', ')}`).toEqual([])
    })
  }
})
