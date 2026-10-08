import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cssRules, GLOBAL_CSS } from '../test/css-rules'

// Pins SOURCE, not paint: jsdom applies no stylesheet.

const SRC = resolve(__dirname, '..')

function appTsx(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) {
			return name === '__tests__' || name === 'test' ? [] : appTsx(path)
		}
		return name.endsWith('.tsx') && !/\.test\.tsx$/.test(name) ? [path] : []
	})
}

describe('helper text and row buttons (story 115.2)', () => {
	it('`.text-faint` is gray-500 in light, the value `.text-muted` has', () => {
		// gray-400 measured 2.54:1 on white at all 15 of its sites; gray-500 is 4.83.
		const body = (selector: string) => {
			const rules = cssRules(GLOBAL_CSS).filter((rule) => rule.selector === selector)
			expect(rules, selector).toHaveLength(1)
			return (rules[0] as { body: string }).body.trim()
		}
		expect(body('.text-faint')).toBe('@apply text-gray-500 dark:text-gray-400;')
		expect(body('.text-faint')).toBe(body('.text-muted'))
	})

	it('no red-tint button keeps red-600 text (3.95:1 on red-100)', () => {
		const hits = appTsx(SRC).flatMap((path) =>
			readFileSync(path, 'utf-8')
				.split('\n')
				.flatMap((line, i) =>
					/(^|[\s"'`])bg-red-100\b/.test(line) && /(^|[\s"'`])text-red-600\b/.test(line)
						? [`${relative(SRC, path)}:${i + 1}`]
						: []
				)
		)
		expect(hits).toEqual([])
	})

	it('the six red-tint row buttons carry the AA pair at rest and on hover', () => {
		// An EXACT count, so a seventh with the old colours, or one that lost its hover, is visible.
		const pairs = appTsx(SRC).flatMap((path) =>
			readFileSync(path, 'utf-8')
				.split('\n')
				.filter(
					(line) =>
						/\bbg-red-100\b/.test(line) &&
						/\btext-red-700\b/.test(line) &&
						/\bhover:text-red-800\b/.test(line)
				)
		)
		expect(pairs).toHaveLength(6)
	})

	it('a red-800 hover never reaches dark mode', () => {
		// `hover:text-red-800` outranks `dark:text-red-300` in the dark media query, so without a
		// `dark:hover:` colour a hovered button turns red-800 on dark red.
		const bare = appTsx(SRC).flatMap((path) =>
			readFileSync(path, 'utf-8')
				.split('\n')
				.flatMap((line, i) =>
					/(^|[\s"'`])hover:text-red-800\b/.test(line) && !/\bdark:hover:text-red-300\b/.test(line)
						? [`${relative(SRC, path)}:${i + 1}`]
						: []
				)
		)
		expect(bare).toEqual([])
	})
})
