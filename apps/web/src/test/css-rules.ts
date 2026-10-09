import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** These pins assert rules, never computed style: jsdom applies no stylesheet. */

export type CssRule = {
	selector: string
	body: string
	/** The at-rule preludes enclosing the rule, outermost first (e.g. `@layer base`). */
	atRules: string[]
}

export const GLOBAL_CSS = readFileSync(resolve(__dirname, '..', 'styles', 'global.css'), 'utf-8')

/**
 * Brace-aware so an enclosing @media is visible to the pins. Throws on input it cannot read
 * (unterminated or nested rules, braces in strings) rather than misreading it.
 */
export function cssRules(css: string): CssRule[] {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
	const rules: CssRule[] = []
	const stack: string[] = []
	let prelude = ''
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === '{') {
			const head = prelude.trim()
			prelude = ''
			if (head.startsWith('@')) {
				stack.push(head)
				continue
			}
			const close = text.indexOf('}', i)
			if (close === -1) throw new Error(`cssRules: unterminated rule "${head}"`)
			const body = text.slice(i + 1, close)
			if (body.includes('{'))
				throw new Error(`cssRules: nested rule inside "${head}" is not supported`)
			if ((body.match(/"/g) ?? []).length % 2 || (body.match(/'/g) ?? []).length % 2) {
				throw new Error(`cssRules: a brace inside a quoted string in "${head}" is not supported`)
			}
			rules.push({ selector: head, body, atRules: [...stack] })
			i = close
		} else if (ch === '}') {
			if (stack.length === 0) throw new Error('cssRules: unbalanced "}"')
			stack.pop()
			prelude = ''
		} else if (ch === ';' && prelude.trim().startsWith('@')) {
			prelude = '' // a statement at-rule such as `@tailwind base;`
		} else {
			prelude += ch
		}
	}
	if (stack.length > 0) throw new Error(`cssRules: unterminated at-rule "${stack.at(-1)}"`)
	return rules
}

/**
 * The selectors of a rule, split on TOP-LEVEL commas only and trimmed: the
 * comma inside `:is(a, b)` or `[title="a,b"]` does not split.
 */
export function selectorsOf(rule: CssRule): string[] {
	const parts: string[] = []
	let depth = 0
	let quote: string | null = null
	let current = ''
	for (const ch of rule.selector) {
		if (quote) {
			if (ch === quote) quote = null
		} else if (ch === '"' || ch === "'") {
			quote = ch
		} else if (ch === '(' || ch === '[') {
			depth++
		} else if (ch === ')' || ch === ']') {
			depth--
		} else if (ch === ',' && depth === 0) {
			parts.push(current.trim())
			current = ''
			continue
		}
		current += ch
	}
	parts.push(current.trim())
	return parts
}
