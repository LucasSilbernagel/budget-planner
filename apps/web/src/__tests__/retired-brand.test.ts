import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Repo-wide guards for retired BRANDS (story brand-1, AC-2) and retired COPY
 * (story 36-1, AC-4).
 *
 * Two sweeps, one walk, TWO SEPARATE ALLOW-LISTS. The lists differ because the
 * invariants differ: the brand sweep exempts all test files (they must name the
 * retired brands to assert their absence, and several source dirs keep the
 * original project name as an internal identifier per brand-1 AC-9), while the
 * copy sweep exempts only the three named guards. Reusing `ALLOWED` for the
 * copy sweep would blind it in the very files that carry the retired copy.
 *
 * WHY THIS EXISTS. Every previous rename protected itself with per-collection
 * assertions — `not.toContain('Budget Planner')` over `DOC_PAGES`, over
 * `LEGAL_PAGES`, over a handful of named components. That strategy has already
 * failed once, silently and for a whole epic: story 27-3 retired the "Budget
 * Planner" wordmark and shipped fully green, yet `public/favicon.svg` still
 * carried it when brand-1 started, because an SVG belongs to none of those
 * collections. brand-1 then repeated the same per-collection approach.
 *
 * AC-2's actual invariant is repo-wide — "no stale brand string survives on a
 * shipped surface" — so it is encoded repo-wide here, once, instead of as N
 * hand-written negatives that each cover only what their author remembered.
 * This subsumes those negatives and, unlike them, covers what nobody thought of:
 * the seven per-route `head()` titles (which had NO test asserting them at all),
 * SVG assets, the PWA config, and any file added in future.
 *
 * Scope note: only user-facing source and assets are walked. Internal
 * identifiers are explicitly out of scope per AC-9 — the `budget-planner`
 * workspace name, `@budget-planner/*` package names and imports, and JSDoc
 * prose referencing the original "Budget Planner" project name all remain
 * unchanged by design, so `packages/` manifests and comments are not swept.
 */

const WEB_ROOT = resolve(__dirname, '..')
const PUBLIC_ROOT = resolve(__dirname, '../../public')
const PWA_CONFIG = resolve(__dirname, '../../pwa.config.mjs')
const REPO_ROOT = resolve(__dirname, '../../../..')
/**
 * Swept for retired COPY only, never for retired BRANDS. brand-1 AC-9 fences
 * internal identifiers (`budget-planner`, `@budget-planner/*`) out of the
 * rename, so `packages/` must stay out of the brand sweep. That rationale does
 * not transfer to product copy: `packages/core` strings do reach the UI (35.3
 * routes them through `SOLVER_ERROR_COPY`), so a retired tagline reappearing
 * there would ship.
 */
const PACKAGES_ROOT = resolve(REPO_ROOT, 'packages')

/** Brands that must never appear as a CURRENT product name again. */
const RETIRED_BRANDS = ['SoluBudget', 'Budget Planner'] as const

/**
 * Retired product COPY that must never ship again (story 36-1 AC-4).
 *
 * Needles are DISTINGUISHING FRAGMENTS, not whole sentences, so a partial
 * reintroduction ("…minds its own business" without the leading "The budget
 * app that") is still caught.
 *
 * MATCHING IS NORMALIZED, and that is load-bearing. A naive
 * `readFileSync().includes('minds its own business')` returns FALSE for a
 * JSDoc that hard-wraps the phrase as "minds its own\n * business." — the
 * newline and comment prefix sit inside the needle. Story 36-1 first worked
 * around this by shortening the needle, which only moved the hole: a wrap at
 * "minds\nits own" would have evaded it just the same. `normalize()` collapses
 * whitespace and comment punctuation and lowercases, so the guard is
 * wrap-proof and case-proof rather than wrap-lucky. Word boundaries keep
 * "reminds its own business" from tripping it.
 *
 * The 25-4 tagline is listed alongside the 27-4 one deliberately: this file's
 * whole thesis is that per-surface negatives fail silently, and until now the
 * older line had only per-surface negatives. Note the brand sweep does NOT
 * cover it — `Budget Planner` is capitalised there, the tagline is not.
 */
const RETIRED_COPY = ['minds its own business', 'never sees your money'] as const

/**
 * Collapse whitespace and comment punctuation, then lowercase, so a needle
 * matches regardless of line wrapping, indentation, comment style or casing.
 */
const normalize = (content: string) => content.replace(/[\s*/#]+/g, ' ').toLowerCase()

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.mjs', '.svg', '.html', '.webmanifest'])

/**
 * Files allowed to mention a retired brand, and why. Kept deliberately short —
 * every entry is a place the string is REQUIRED, not merely tolerated.
 */
const ALLOWED = [
  // Guards asserting the retired brands are gone necessarily name them.
  /__tests__\//,
  /\.test\.tsx?$/,
  // AC-9 fences internal identifiers: JSDoc prose describing the original
  // "Budget Planner" project is explicitly out of scope for the rename.
  /src\/stores\/profileStore\.ts$/,
  /src\/hooks\//,
  /src\/server\/api\//,
  /src\/server\/functions\//,
  /src\/components\/settings\/local-data-section\.tsx$/,
] as const

/** Files allowed to mention the retired COPY, and why. See RETIRED_COPY. */
const COPY_ALLOWED = [
  // This file names the retired copy in order to assert its absence.
  /src\/__tests__\/retired-brand\.test\.ts$/,
  // Carries the `queryByText(/minds its own business/i)` absence guard on the
  // rendered homepage subtitle (story 36-1).
  /src\/components\/__tests__\/HomePage\.test\.tsx$/,
  // Carries the `not.toContain(RETIRED_TAGLINE)` guards on the <title> and the
  // meta description (story 36-1).
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

/**
 * The raw walk, shared by both sweeps. Deliberately UNFILTERED: each sweep
 * applies its own allow-list, because the two invariants exempt different files
 * for different reasons and fusing them would silently give one sweep the
 * other's blind spots.
 */
const ALL_FILES = [...walk(WEB_ROOT), ...walk(PUBLIC_ROOT), PWA_CONFIG]
/** The copy sweep reaches further than the brand sweep — see PACKAGES_ROOT. */
const ALL_COPY_FILES = [...ALL_FILES, ...walk(PACKAGES_ROOT)]

/** Repo-relative label so offenders outside WEB_ROOT are not printed absolute. */
const label = (file: string) => file.replace(`${REPO_ROOT}/`, '')

describe('no retired brand survives on a shipped surface (brand-1 AC-2)', () => {
  const files = ALL_FILES.filter((f) => !ALLOWED.some((pattern) => pattern.test(f)))

  it('walks a non-trivial set of files (guards against a vacuous pass)', () => {
    // Without this, a broken walk or an over-broad ALLOWED entry would make the
    // sweep below pass by scanning nothing at all.
    expect(files.length).toBeGreaterThan(100)
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

/**
 * Repo-wide retired-COPY guard (story 36-1, AC-4).
 *
 * Same argument as the brand sweep above: story 36-1 retires the 27-4 tagline
 * from three production strings, and the two test files that assert it are
 * self-enforcing (they go red the moment the source changes). What nothing else
 * covers is every OTHER file — a comment, a doc page, an asset, or a file that
 * does not exist yet. That is what this sweeps.
 *
 * It uses its own allow-list on purpose. `ALLOWED` above exempts `/__tests__/`
 * and `*.test.tsx` wholesale, which is right for brands but would make this
 * sweep blind in exactly the two files that carry the retired copy.
 */
describe('no retired copy survives on a shipped surface (story 36-1 AC-4)', () => {
  const copyFiles = ALL_COPY_FILES.filter((f) => !COPY_ALLOWED.some((pattern) => pattern.test(f)))

  it('walks a non-trivial set of files (guards against a vacuous pass)', () => {
    // The brand sweep's own guard says nothing about this list — COPY_ALLOWED is
    // a different filter and could over-match independently.
    expect(copyFiles.length).toBeGreaterThan(100)
  })

  it('walks EVERY root, so a single dropped root cannot hide behind the total', () => {
    // A total-only floor is satisfied by WEB_ROOT alone: if a root were dropped
    // from the composition, the count above would still clear 100 and the sweep
    // would pass while a whole root went unscanned.
    //
    // Asserted against `copyFiles` — the list actually swept — NOT by calling
    // walk() again. Re-walking would only prove walk() works, and would stay
    // green if someone deleted a root from ALL_COPY_FILES, which is precisely
    // the regression this test names.
    const underRoot = (root: string) => copyFiles.filter((f) => f.startsWith(`${root}/`)).length
    expect(underRoot(WEB_ROOT)).toBeGreaterThan(100)
    expect(underRoot(PUBLIC_ROOT)).toBeGreaterThan(0)
    expect(underRoot(PACKAGES_ROOT)).toBeGreaterThan(10)
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
