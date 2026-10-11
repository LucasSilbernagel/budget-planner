import { describe, expect, it } from 'vitest'
import { breadcrumbList, jsonLdScript, longhandSoftwareApplication } from '../json-ld'

describe('jsonLdScript', () => {
	it('serialises as an ld+json data block', () => {
		const script = jsonLdScript({ '@type': 'Thing', name: 'x' })
		expect(script.type).toBe('application/ld+json')
		expect(JSON.parse(script.children)).toEqual({ '@type': 'Thing', name: 'x' })
	})

	it('escapes < so a value cannot close the script element', () => {
		const script = jsonLdScript({ name: '</script><script>alert(1)</script>' })
		expect(script.children).not.toContain('</script>')
		expect(JSON.parse(script.children)).toEqual({ name: '</script><script>alert(1)</script>' })
	})
})

describe('breadcrumbList', () => {
	it('numbers positions from 1 with absolute item URLs', () => {
		const list = breadcrumbList([
			{ name: 'Home', path: '/' },
			{ name: 'Compare', path: '/compare' },
		]) as { itemListElement: { position: number; item: string; name: string }[] }
		expect(list.itemListElement.map((i) => i.position)).toEqual([1, 2])
		expect(list.itemListElement[1]).toMatchObject({
			name: 'Compare',
			item: 'https://www.longhandbudget.com/compare',
		})
	})
})

describe('longhandSoftwareApplication', () => {
	it('is a FinanceApplication with three EUR offers and no invented rating', () => {
		const app = longhandSoftwareApplication() as Record<string, unknown>
		expect(app['@type']).toBe('SoftwareApplication')
		expect(app['applicationCategory']).toBe('FinanceApplication')
		const offers = app['offers'] as { price: string; priceCurrency: string }[]
		expect(offers.map((o) => o.price)).toEqual(['0', '39', '99'])
		expect(new Set(offers.map((o) => o.priceCurrency))).toEqual(new Set(['EUR']))
		expect(app).not.toHaveProperty('aggregateRating')
		expect(app).not.toHaveProperty('review')
	})
})
