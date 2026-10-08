import { describe, expect, it } from 'vitest'
import { type CssRule, cssRules, selectorsOf } from '../css-rules'

const rule = (selector: string): CssRule => ({ selector, body: '', atRules: [] })

describe('cssRules', () => {
	it('reads rules with their enclosing at-rules, outermost first', () => {
		const rules = cssRules('@layer base { @media print { a, b { color: red; } } } c { x: y; }')
		expect(rules).toEqual([
			{ selector: 'a, b', body: ' color: red; ', atRules: ['@layer base', '@media print'] },
			{ selector: 'c', body: ' x: y; ', atRules: [] },
		])
	})

	it('throws on an unterminated rule instead of looping forever', () => {
		expect(() => cssRules('a { color: red;')).toThrow(/unterminated rule/)
	})

	it('throws on an unbalanced closing brace and on an unterminated at-rule', () => {
		expect(() => cssRules('a { x: y; } }')).toThrow(/unbalanced/)
		expect(() => cssRules('@media print { a { x: y; }')).toThrow(/unterminated at-rule/)
	})

	it('throws on a nested rule and on a brace inside a string rather than misreading them', () => {
		expect(() => cssRules('.a { color: red; .b { color: blue; } }')).toThrow(/nested rule/)
		expect(() => cssRules('a::after { content: "}"; }')).toThrow(/quoted string/)
	})
})

describe('selectorsOf', () => {
	it('splits on top-level commas only', () => {
		expect(selectorsOf(rule('#r :is(h1, h2), [title="a,b"], p'))).toEqual([
			'#r :is(h1, h2)',
			'[title="a,b"]',
			'p',
		])
	})
})
