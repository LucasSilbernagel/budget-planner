import { describe, expect, it } from 'vitest'
import {
	type ClientMetadata,
	isMetadataEmpty,
	parseMetadataFromUrl,
	sanitizeMetadataValue,
	TRACKED_PARAMS,
} from '../metadata'

describe('sanitizeMetadataValue', () => {
	it('trims surrounding whitespace', () => {
		expect(sanitizeMetadataValue('  google  ')).toBe('google')
	})

	it('strips control characters', () => {
		expect(sanitizeMetadataValue('goo\u0000gle\u001F')).toBe('google')
	})

	it('caps length at 256 characters', () => {
		const long = 'a'.repeat(500)
		expect(sanitizeMetadataValue(long)).toHaveLength(256)
	})

	it('returns undefined for empty or whitespace-only input', () => {
		expect(sanitizeMetadataValue('')).toBeUndefined()
		expect(sanitizeMetadataValue('   ')).toBeUndefined()
		expect(sanitizeMetadataValue('\u0000')).toBeUndefined()
	})

	it('strips zero-width, BOM and bidi-override characters', () => {
		expect(sanitizeMetadataValue('a\u200Bb\u202Ec\uFEFF')).toBe('abc')
	})

	it('caps by code points without splitting a surrogate pair', () => {
		// 256 ASCII chars + an astral emoji (2 UTF-16 units): the emoji must be
		// dropped whole, never split into a lone surrogate.
		const result = sanitizeMetadataValue(`${'a'.repeat(256)}\u{1F600}`)
		expect(result).toBe('a'.repeat(256))
		expect([...(result ?? '')]).toHaveLength(256)
	})
})

describe('parseMetadataFromUrl', () => {
	it('captures standard UTM parameters', () => {
		const meta = parseMetadataFromUrl(
			'?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_term=budget&utm_content=cta'
		)
		expect(meta).toEqual<ClientMetadata>({
			source: 'newsletter',
			medium: 'email',
			campaign: 'launch',
			term: 'budget',
			content: 'cta',
		})
	})

	it('accepts a leading "?" or a bare query string', () => {
		expect(parseMetadataFromUrl('utm_source=x')).toEqual({ source: 'x' })
		expect(parseMetadataFromUrl('?utm_source=x')).toEqual({ source: 'x' })
	})

	it('accepts a URLSearchParams instance', () => {
		const params = new URLSearchParams({ utm_campaign: 'spring' })
		expect(parseMetadataFromUrl(params)).toEqual({ campaign: 'spring' })
	})

	it.each([
		[
			'extracts the query from a full URL (with fragment)',
			{
				input: 'https://app.example.com/path?utm_source=newsletter#section',
				expected: { source: 'newsletter' },
			},
		],
		[
			'maps the "ref" shorthand to source',
			{
				input: '?ref=twitter',
				expected: { source: 'twitter' },
			},
		],
		[
			'prefers utm_source over the ref shorthand when both are present',
			{
				input: '?ref=twitter&utm_source=newsletter',
				expected: { source: 'newsletter' },
			},
		],
		[
			'captures an explicit referrer parameter',
			{
				input: '?referrer=example.com',
				expected: { referrer: 'example.com' },
			},
		],
		[
			'ignores unknown / arbitrary parameters (no PII passthrough)',
			{
				input: '?email=user@example.com&name=Jane&utm_source=ok',
				expected: { source: 'ok' },
			},
		],
		[
			'sanitizes captured values',
			{
				input: '?utm_source=  goo\u0000gle  ',
				expected: { source: 'google' },
			},
		],
		[
			'drops parameters that sanitize to empty',
			{
				input: '?utm_source=%20%20&utm_medium=email',
				expected: { medium: 'email' },
			},
		],
	])('%s', (_title, { input, expected }) => {
		expect(parseMetadataFromUrl(input)).toEqual(expected)
	})

	it('returns an empty object for no query / no tracked params', () => {
		expect(parseMetadataFromUrl('')).toEqual({})
		expect(parseMetadataFromUrl('?')).toEqual({})
		expect(parseMetadataFromUrl('?foo=bar')).toEqual({})
	})

	it('exposes the set of tracked parameter names', () => {
		expect(TRACKED_PARAMS).toContain('utm_source')
		expect(TRACKED_PARAMS).toContain('ref')
		expect(TRACKED_PARAMS).not.toContain('email')
	})
})

describe('isMetadataEmpty', () => {
	it('is true for an empty object', () => {
		expect(isMetadataEmpty({})).toBe(true)
	})

	it('is false when any field is set', () => {
		expect(isMetadataEmpty({ source: 'x' })).toBe(false)
	})
})
