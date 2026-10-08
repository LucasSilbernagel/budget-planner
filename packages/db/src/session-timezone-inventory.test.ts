// Every pg Pool/Client in non-test source must pass `options: DB_SESSION_OPTIONS`; sites are
// pinned by exact count per file. Comments are stripped before matching.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DB_SESSION_OPTIONS } from './client'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const PINNED_SITES: Record<string, number> = {
	'packages/db/src/client.ts': 1,
	'packages/db/src/migrate-preflight-cli.ts': 1,
	'packages/db/src/migrate-lock-cli.ts': 1,
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

/** Naive: string contents that look like comments are not a concern here. */
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
