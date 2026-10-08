import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Start awaits every statically imported route chunk before hydration, so Recharts must stay
// off that graph. Dynamic imports are invisible here by design: deferring behind one is the fix.

const SRC_ROOT = resolve(__dirname, '..')

const ENTRIES = [
	{
		name: 'Overview route',
		entry: join(SRC_ROOT, 'routes', 'index.tsx'),
		mustReach: 'components/HomePage.tsx',
		banned: ['recharts'],
	},
	{
		name: 'root route',
		entry: join(SRC_ROOT, 'routes', '__root.tsx'),
		mustReach: 'components/sync/SyncProvider.tsx',
		// `@/lib/sync/syncBridge` is deliberately NOT banned: every store imports it to publish
		// mutations, and its only import is type-only.
		banned: ['@/hooks/useSync', '@/lib/sync/seedLocalData'],
	},
] as const

/**
 * A `/` opens a REGEX LITERAL when the previous significant character cannot end a
 * value. After an identifier, a number, `)`, `]` or a quote, `/` is division.
 */
const REGEX_MAY_FOLLOW = /[(,=:[!&|?{};+\-*%~^<>]|^$/

// A character scanner, not a regex: a string containing `/*` would open a phantom comment
// and hide real imports.
function stripComments(source: string): string {
	const out = source.split('')
	const blank = (from: number, to: number) => {
		for (let k = from; k < to && k < out.length; k++) {
			if (out[k] !== '\n') out[k] = ' '
		}
	}
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
				// Skip the regex literal without blanking it; character classes may hold an unescaped `/`.
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

// A scanner, not a regex, because braced imports span lines. Type-only imports ship no bytes,
// and a dynamic `import()` is never matched.
function staticSpecifiers(source: string): string[] {
	const code = stripComments(source)
	const lines = code.split('\n')
	const specs: string[] = []

	for (let n = 0; n < lines.length; n++) {
		const line = lines[n] as string
		// `(?=\s)` rejects `import('./x')`: a dynamic import is the fix, not the defect.
		if (!/^[ \t]*(?:import|export)(?=\s)/.test(line)) continue
		if (/^[ \t]*(?:import|export)\s+type\b/.test(line)) continue

		// A statement that never yields a specifier is abandoned once another starts, so it
		// can't swallow a later import's specifier.
		for (let k = n; k < lines.length && k <= n + 40; k++) {
			const cur = lines[k] as string
			if (k > n && /^[ \t]*(?:import|export)(?=\s)/.test(cur)) break
			const quoted = [...cur.matchAll(/['"]([^'"]+)['"]/g)]
			if (quoted.length > 0) {
				const last = quoted.at(-1)?.[1]
				if (last !== undefined) specs.push(last)
				n = k
				break
			}
			if (k > n && /^[ \t]*\}?[ \t]*;?[ \t]*$/.test(cur) && !cur.includes('from')) break
		}
	}
	return specs
}

// Follows the `@/` alias too: a ban that fires on only one spelling of a module is not a ban.
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
		} catch {}
	}
	return null
}

// Module identity, not string equality: deep paths, relative spellings of an alias, barrels.
function matchesBanned(fromFile: string, spec: string, banned: string): boolean {
	if (banned.startsWith('@/')) {
		const bannedFile = resolveLocal(SRC_ROOT, banned)
		const specFile = resolveLocal(fromFile, spec)
		return bannedFile !== null && specFile !== null && bannedFile === specFile
	}
	return spec === banned || spec.startsWith(`${banned}/`)
}

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
		// Load-bearing: a walk that resolved nothing would make every ban below pass forever.
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
			expect(existsSync(join(SRC_ROOT, lazyModule))).toBe(true)
			expect(files).not.toContain(lazyModule)
		}
	)
})
