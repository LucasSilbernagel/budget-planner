/**
 * Story ops-2, AC-3: the inventory of database connections is closed and stays
 * closed. Every `new Pool(` / `new Client(` / `new pg.Pool(` / `new pg.Client(`
 * in non-test source must carry `options: DB_SESSION_OPTIONS` (TimeZone=UTC).
 *
 * Scanned: `packages/db/src/**` + `packages/db/*.ts`, `apps/web/src/**` +
 * `apps/web/*.mjs`, test files (`*.test.*`, `*.spec.*`, `__tests__/`) excluded.
 * Comments are stripped before matching, so this header's own prose cannot
 * satisfy or trip it.
 *
 * The expected sites are pinned by EXACT count per file (memory
 * allowlist-exact-count): a second construction in a pinned file, or a new one
 * anywhere else, turns this RED.
 *
 * Exempt, and why (not scanned, or not a pg connection):
 *   X1 (gone) `test-db-simple.mjs` (repo root), a manual connection check from
 *      6c17abb, was deleted by story 92.1.
 *   X2 `migrations-uuid.test.ts` `new Client`: a test, `TEST_DB_URL`-gated.
 *   X3 the PGlite Vitest harnesses (`new PGlite()`, `src/test/pglite-migrated.ts`):
 *      in-process, no pg connection. Pinned to UTC by the Vitest runs themselves
 *      (story 92.1): `TZ: 'UTC'` in `apps/web/vitest.config.ts` `test.env`, and
 *      `process.env.TZ = 'UTC'` at the top of `packages/db/vitest.config.ts`
 *      (Vitest 1.6 threads: `test.env` reached `process.env` but not the zone).
 * drizzle-kit's own pool (C4) is pinned through PGOPTIONS by `stepEnv`
 * (`migrate-lock.ts`), covered by `session-timezone.test.ts` AC-2(b)/(c); the
 * wiring (`runStep` passes `stepEnv`) and the manual `db:migrate` script are
 * pinned below.
 * The e2e PGlite server (C5) pins with `SET TimeZone` (AC-4).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DB_SESSION_OPTIONS } from './client'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** Repo-relative file -> number of pinned connection constructions. */
const PINNED_SITES: Record<string, number> = {
  'packages/db/src/client.ts': 1, // C1 app pool
  'packages/db/src/migrate-preflight-cli.ts': 1, // C2 preflight
  'packages/db/src/migrate-lock-cli.ts': 1, // C3 lock client
}

const CONSTRUCTION = /\bnew\s+(?:pg\s*\.\s*)?(?:Pool|Client)\s*\(/g
const PIN = /\boptions\s*:\s*DB_SESSION_OPTIONS\b/g

function isTestFile(rel: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.split('/').includes('__tests__')
}

function walk(dir: string, exts: RegExp, recursive: boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = path.join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (recursive) out.push(...walk(full, exts, true))
    } else if (exts.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** Strip block and line comments (string contents that look like comments are not a concern here). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
}

function scannedFiles(): string[] {
  const sources = /\.(ts|tsx|mjs|js|cjs)$/
  const files = [
    ...walk(path.join(REPO_ROOT, 'packages/db/src'), sources, true),
    ...walk(path.join(REPO_ROOT, 'packages/db'), /\.ts$/, false),
    ...walk(path.join(REPO_ROOT, 'apps/web/src'), sources, true),
    ...walk(path.join(REPO_ROOT, 'apps/web'), /\.mjs$/, false),
  ]
  return files.map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'))
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length
}

describe('AC-3: every pg connection construction pins TimeZone=UTC', () => {
  const files = scannedFiles().filter((rel) => !isTestFile(rel))

  it('scans a non-trivial file set (non-vacuity)', () => {
    expect(files).toContain('packages/db/src/client.ts')
    expect(files).toContain('packages/db/drizzle.config.ts')
    expect(files.some((f) => f.startsWith('apps/web/src/'))).toBe(true)
    expect(files.length).toBeGreaterThan(100)
  })

  it('finds EXACTLY the pinned construction sites, by file and count', () => {
    const found: Record<string, number> = {}
    for (const rel of files) {
      const n = count(stripComments(readFileSync(path.join(REPO_ROOT, rel), 'utf8')), CONSTRUCTION)
      if (n > 0) found[rel] = n
    }
    expect(found).toEqual(PINNED_SITES)
  })

  it('each site file passes `options: DB_SESSION_OPTIONS` once per construction', () => {
    for (const [rel, sites] of Object.entries(PINNED_SITES)) {
      const code = stripComments(readFileSync(path.join(REPO_ROOT, rel), 'utf8'))
      expect(count(code, PIN), rel).toBe(sites)
    }
  })

  it('drizzle.config.ts carries no `options` key (drizzle-kit strips it; PGOPTIONS via stepEnv is the pin)', () => {
    const code = stripComments(
      readFileSync(path.join(REPO_ROOT, 'packages/db/drizzle.config.ts'), 'utf8')
    )
    expect(code).not.toMatch(/\boptions\s*:/)
  })

  it('runStep spawns every migrate step with stepEnv (C4 wiring)', () => {
    const code = stripComments(
      readFileSync(path.join(REPO_ROOT, 'packages/db/src/migrate-lock-cli.ts'), 'utf8')
    )
    expect(count(code, /\benv\s*:\s*stepEnv\(process\.env\)/g)).toBe(1)
    expect(code).not.toMatch(/\benv\s*:\s*process\.env\b/)
  })

  it('the manual `db:migrate` script pins drizzle-kit through PGOPTIONS', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'packages/db/package.json'), 'utf8'))
    expect(pkg.scripts['db:migrate']).toBe(`PGOPTIONS='${DB_SESSION_OPTIONS}' drizzle-kit migrate`)
  })
})
