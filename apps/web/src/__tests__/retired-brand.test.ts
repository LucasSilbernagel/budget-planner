import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Repo-wide retired-brand guard (story brand-1, AC-2).
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

/** Brands that must never appear as a CURRENT product name again. */
const RETIRED_BRANDS = ['SoluBudget', 'Budget Planner'] as const

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

describe('no retired brand survives on a shipped surface (brand-1 AC-2)', () => {
  const files = [...walk(WEB_ROOT), ...walk(PUBLIC_ROOT), PWA_CONFIG].filter(
    (f) => !ALLOWED.some((pattern) => pattern.test(f))
  )

  it('walks a non-trivial set of files (guards against a vacuous pass)', () => {
    // Without this, a broken walk or an over-broad ALLOWED entry would make the
    // sweep below pass by scanning nothing at all.
    expect(files.length).toBeGreaterThan(100)
  })

  for (const brand of RETIRED_BRANDS) {
    it(`no shipped file contains "${brand}"`, () => {
      const offenders = files
        .filter((file) => readFileSync(file, 'utf-8').includes(brand))
        .map((file) => file.replace(`${WEB_ROOT}/`, ''))

      expect(offenders, `retired brand "${brand}" found in: ${offenders.join(', ')}`).toEqual([])
    })
  }
})
