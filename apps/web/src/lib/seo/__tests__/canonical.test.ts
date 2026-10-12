import { describe, expect, it } from 'vitest'
import { canonicalLink } from '../canonical'

describe('canonicalLink', () => {
	it('keeps the root slash and strips a trailing slash elsewhere', () => {
		expect(canonicalLink('/')).toEqual({
			rel: 'canonical',
			href: 'https://www.longhandbudget.com/',
		})
		expect(canonicalLink('/compare/').href).toBe('https://www.longhandbudget.com/compare')
		expect(canonicalLink('/compare/longhand-vs-spreadsheet').href).toBe(
			'https://www.longhandbudget.com/compare/longhand-vs-spreadsheet'
		)
	})

	it.each(['compare', '/x?y=1', '/x#top', '', '//evil', '/a//b', '/With Space', '/Upper'])(
		'rejects "%s"',
		(path) => {
			expect(() => canonicalLink(path)).toThrow(/absolute path/)
		}
	)
})
