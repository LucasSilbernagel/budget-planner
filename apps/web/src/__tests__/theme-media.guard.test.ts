import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type CssRule, cssRules, GLOBAL_CSS, selectorsOf } from '../test/css-rules'

// A tripwire, not a proof: jsdom can't re-evaluate the media query or paint, and a `dark`
// class built at runtime from other strings would get past the source scan.

const SRC = resolve(__dirname, '..')
// Read as text: the config is untyped ESM, and only its one key is the claim.
const TAILWIND_CONFIG = readFileSync(resolve(SRC, '..', 'tailwind.config.js'), 'utf-8')

function appSources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) {
			return name === '__tests__' || name === 'test' ? [] : appSources(path)
		}
		return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
	})
}

describe('the theme follows prefers-color-scheme (was e2e theme-dark-mode:30)', () => {
	it("tailwind compiles `dark:` to the media query: darkMode is 'media'", () => {
		// Declarations only; a trailing `// comment` is allowed.
		const declarations = [
			...TAILWIND_CONFIG.matchAll(/^\s*darkMode\s*:\s*([^,\n/]+?)\s*,?\s*(?:\/\/.*)?$/gm),
		].map((m) => (m[1] as string).trim())
		expect(declarations).toEqual(["'media'"])
	})

	it('darkens the page canvas under @media (prefers-color-scheme: dark), never under .dark', () => {
		const bodyRules = cssRules(GLOBAL_CSS).filter((rule) => selectorsOf(rule).includes('body'))
		const dark = bodyRules.filter((rule: CssRule) =>
			rule.atRules.some((at) => /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/.test(at))
		)
		expect(dark, 'no dark-scheme body rule in global.css').toHaveLength(1)
		expect((dark[0] as CssRule).body).toMatch(/\bbg-gray-900\b/)

		const classKeyed = cssRules(GLOBAL_CSS).filter((rule) =>
			// ANY `.dark` class, compound or inside `:is()`/`:where()`, but not `.dark-mode`.
			selectorsOf(rule).some((selector) => /\.dark(?![\w-])/.test(selector))
		)
		expect(
			classKeyed.map((rule) => rule.selector),
			'a .dark selector never matches'
		).toEqual([])
	})

	it('no app source writes a `dark` class in the usual spellings', () => {
		const files = appSources(SRC)
		// Positive control: the walk reached the app.
		expect(files.length).toBeGreaterThan(50)
		const DARK = /['"`]dark['"`]|['"`]dark\s|\sdark['"`]/
		const WRITES = [
			/classList\.(add|toggle|replace)\(([^)]*)\)/g,
			/className\s*=\s*(\{[^}]*\}|['"`][^'"`]*['"`])/g,
			/setAttribute\(\s*['"]class['"]\s*,([^)]*)\)/g,
		]
		const writes = (source: string) =>
			WRITES.some((re) => [...source.matchAll(re)].some((m) => DARK.test(m[0])))
		for (const sample of [
			"document.documentElement.classList.add('dark')",
			"html.className = 'dark'",
			"<html className={isDark ? 'dark' : ''}>",
			"el.setAttribute('class', 'dark')",
		]) {
			expect(writes(sample), sample).toBe(true)
		}
		const writers = files.filter((file) => writes(readFileSync(file, 'utf-8')))
		expect(writers).toEqual([])
	})
})
