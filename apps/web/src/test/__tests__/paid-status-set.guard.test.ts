import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Matches SHAPES, not one spelling: anything naming two different statuses is a set. Test
// files are not walked: they legitimately restate sets as value pins.

const SRC_ROOT = resolve(__dirname, '../..')

const DEFINITION = 'lib/premium/access-statuses.ts'

// A count, not a presence flag: a second copy added to an allowed file must still fail.
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

// Blank comments but keep strings, templates and regex literals, so a `/*` inside a string
// can't hide the code after it.
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

function sameExpression(between: string): boolean {
	return !/[;{}]/.test(between) && /\|\||&&/.test(between)
}

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

export function findStatusSetCopies(source: string): string[] {
	const code = stripComments(source)
	const hits: string[] = []
	const show = (s: string) => s.replace(/\s+/g, ' ').trim()

	for (const m of code.matchAll(/\[[^[\]]*\]/g)) {
		if (distinctStatuses(m[0]).size >= 2) hits.push(show(m[0]))
	}

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

	for (const m of code.matchAll(new RegExp(`(?:case\\s*(${Q})${STATUS}\\1\\s*:\\s*){2,}`, 'g'))) {
		if (distinctStatuses(m[0]).size >= 2) hits.push(show(m[0]))
	}

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
		["const ENTITLED_STATUSES: readonly string[] = ['active', 'past_due', 'lifetime']"],
		["const PAID_ACCESS_STATUSES: readonly string[] = ['active', 'past_due', 'lifetime']"],
		["export const PAID_SYNC_STATUSES = ['active', 'past_due', 'lifetime'] as const"],
		["export const PAID_SYNC_STATUSES = ['active', 'past_due', 'lifetime']"],
		["const ALREADY_PREMIUM_STATUSES = ['active', 'past_due', 'lifetime'] as const"],
		["PAID_SYNC_STATUSES: ['active', 'past_due'],"],
		["const X = ['lifetime', 'active']"],
		['const X = ["past_due", "lifetime"]'],
		['const X = [`active`, `lifetime`]'],
		["const X = new Set(['active', 'lifetime'])"],
		["const X = [\n  'lifetime',\n  'past_due',\n  'active',\n] as const"],
		["const LAPSED = ['free', 'canceled']"],
		["return subscriptionStatus === 'active' || subscriptionStatus === 'lifetime'"],
		["(seed.subscriptionStatus === 'active' || seed.subscriptionStatus === 'lifetime')"],
		["if (user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'lifetime') {"],
		[
			"if (\n      sessionResult.data.subscriptionStatus !== 'active' &&\n      sessionResult.data.subscriptionStatus !== 'lifetime'\n    ) {",
		],
		['if (s === "past_due" || s === "active") {'],
		["if ('active' === s || 'lifetime' === s) {"],
		["if (s === 'active' || (s === 'lifetime')) {"],
		["if (s === 'active' || s === 'trialing' || s === 'lifetime') {"],
		["if (s === 'active' || isLegacy || s === 'lifetime') {"],
		["if (u['status'] === 'active' || u['status'] === 'lifetime') {"],
		["if ((x as U).status === 'active' || (x as U).status === 'lifetime') {"],
		['if (s === `active` || s === `lifetime`) {'],
		["if (s.includes('active') || s.includes('lifetime')) {"],
		["if (s !== 'free' && s !== 'canceled') {"],
		["switch (s) {\n  case 'active':\n  case 'lifetime':\n    return true\n}"],
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
		["if (existing[0]?.status === 'lifetime') {"],
		["sql`${users.subscriptionStatus} <> 'lifetime'`"],
		["if (status === 'lifetime') {\n  return 1\n}\nif (status === 'past_due') {\n  return 2\n}"],
		[
			"switch (status) {\n  case 'lifetime':\n    return 'Lifetime Plan'\n  case 'active':\n    return 'Active'\n}",
		],
		["switch (s) {\n  case 'active':\n  case 'trialing':\n    return 'active'\n}"],
		["subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime' | null"],
		["const X = ['lifetime']"],
		["if (a === 'active' || b === 'active') {"],
		["const a = s === 'active'; const b = s === 'lifetime'"],
		["const P = { monthly: '€5.99', lifetime: '€99' }\nconst Q = { active: 1 }"],
		['type T = { active: boolean; lifetime: boolean }'],
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
		// A guard that scans nothing passes. Pin a floor, one importer, and one server `.mjs`.
		const files = collectSourceFiles(SRC_ROOT).map((f) => relative(SRC_ROOT, f))
		expect(files.length).toBeGreaterThan(200)
		expect(files).toContain('server/api/sync.ts')
		expect(files).toContain('server/node-adapter.mjs')
	})
})
