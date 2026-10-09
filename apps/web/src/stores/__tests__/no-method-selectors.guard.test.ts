/**
 * A source sweep because render() is not hydration. A tripwire, not a proof: it misses a named
 * selector defined elsewhere and a method reached through a nested object.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(__dirname, '..', '..')

/** The `\1` back-reference distinguishes `(s) => s.getX()` from `(s) => helperFrom(s.field)`. */
const METHOD_SELECTOR =
	/use\w*Store\(\s*(?:useShallow\(\s*)?\(?\s*(\w+)(?:\s*:[^)=]+)?\)?\s*=>[^)]{0,120}?\b\1\s*\??\.\w+\s*\(/g

/**
 * Strips comments and strings so the sweep cannot flag its own docs. A character scanner: a regex
 * stripper can open a phantom comment from a string and delete real code.
 */
function stripCommentsAndStrings(source: string): string {
	const out = source.split('')
	let i = 0
	const blank = (from: number, to: number) => {
		for (let k = from; k < to && k < out.length; k++) {
			if (out[k] !== '\n') out[k] = ' '
		}
	}
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
			const ch = source[i]
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
				blank(i + 1, j)
				i = j + 1
			} else {
				i++
			}
		}
	}
	return out.join('')
}

function sourceFiles(dir: string): string[] {
	const out: string[] = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		let isDir = false
		try {
			isDir = statSync(full).isDirectory()
		} catch {
			// A broken symlink must not take the whole guard down.
			continue
		}
		if (isDir) {
			if (entry === '__tests__' || entry === 'node_modules') continue
			out.push(...sourceFiles(full))
		} else if (/\.tsx?$/.test(entry)) {
			out.push(full)
		}
	}
	return out
}

describe('zustand selectors', () => {
	it('never call a state method (it escapes React’s hydration snapshot)', () => {
		const offenders: string[] = []

		for (const file of sourceFiles(SRC_ROOT)) {
			const source = stripCommentsAndStrings(readFileSync(file, 'utf-8'))
			for (const match of source.matchAll(METHOD_SELECTOR)) {
				const line = source.slice(0, match.index).split('\n').length
				offenders.push(`${file.slice(SRC_ROOT.length + 1)}:${line}  ${match[0]}…)`)
			}
		}

		expect(
			offenders,
			offenders.length === 0
				? ''
				: [
						'A selector that calls a state method reads LIVE state during hydration and makes React discard the tree.',
						"Read the row's array from the selector argument instead, via the store's pure `*From()` helper:",
						'',
						offenders.join('\n'),
					].join('\n')
		).toEqual([])
	})

	/** Control: without it a green sweep could mean the regex matches nothing. */
	it('the detector matches every banned spelling and spares the allowed ones (control)', () => {
		const banned = [
			'useSavingsStore((state) => state.getTotalSavings())',
			'useSavingsStore((s) => s.getTotalSavings())',
			'useSavingsStore(s => s.getTotalSavings())',
			'useSavingsStore((state: SavingsState) => state.getTotalSavings())',
			'useSavingsStore((s) => { return s.getTotalSavings() })',
			'useSavingsStore((s) => s?.getTotalSavings())',
			'useSavingsStore((s) => 100 - s.getTotalSavings())',
			'useSavingsStore((s) => format(s.getTotalSavings()))',
			'useSavingsStore(useShallow((s) => s.getTotalSavings()))',
		]
		for (const source of banned) {
			expect(source.match(METHOD_SELECTOR), `should be flagged: ${source}`).toHaveLength(1)
		}

		const allowed = [
			'useSavingsStore((state) => state.getSavingsGoalById)',
			'useSavingsStore((state) => totalSavingsFrom(state.savingsGoals))',
			'useSavingsStore((state) => state.savingsGoals)',
			'useSavingsStore((state) => state.savingsGoals.map(withProgress))',
			'useSavingsStore((state) => state.savingsGoals.filter((g) => g.targetAmount != null))',
		]
		for (const source of allowed) {
			expect(source.match(METHOD_SELECTOR), `should NOT be flagged: ${source}`).toBeNull()
		}
	})

	it('strips comments without deleting real code', () => {
		const documented = '/** never write useSavingsStore((s) => s.getTotalSavings()) */\nconst x = 1'
		expect(stripCommentsAndStrings(documented).match(METHOD_SELECTOR)).toBeNull()
		expect(documented.match(METHOD_SELECTOR)).toHaveLength(1)

		// A string opening a phantom block comment must not swallow what follows.
		const phantomBlock = [
			"const pattern = 'src/*.ts'",
			'useSavingsStore((s) => s.getTotalSavings())',
			'/* a real comment */',
		].join('\n')
		expect(stripCommentsAndStrings(phantomBlock).match(METHOD_SELECTOR)).toHaveLength(1)

		// An escaped `//` inside a string must not truncate its line.
		const escapedSlashes = [
			"const s = 'a\\/\\/b'",
			'useSavingsStore((s) => s.getTotalSavings())',
		].join('\n')
		expect(stripCommentsAndStrings(escapedSlashes).match(METHOD_SELECTOR)).toHaveLength(1)

		// Line numbers must survive stripping (spans are blanked, not removed).
		expect(stripCommentsAndStrings('/* a */\nconst x = 1').split('\n')).toHaveLength(2)
	})
})
