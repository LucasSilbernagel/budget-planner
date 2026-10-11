import { describe, expect, it } from 'vitest'
import { COMPARE_PAGES } from '../../content/compare'
import { Route as SlugRoute } from '../compare/$slug'
import { Route as HubRoute } from '../compare/index'

type Script = { type?: string; children?: string }
type Head = { meta?: unknown[]; links?: { rel?: string; href?: string }[]; scripts?: Script[] }

function jsonLd(head: Head): Record<string, unknown>[] {
	return (head.scripts ?? [])
		.filter((s) => s.type === 'application/ld+json')
		.map((s) => JSON.parse(s.children ?? 'null') as Record<string, unknown>)
}

const page = COMPARE_PAGES[0]
if (!page) throw new Error('no compare pages')

describe('/compare head()', () => {
	const head = (HubRoute.options.head as (a: unknown) => Head)({})

	it('emits a breadcrumb list and the SoftwareApplication block, nonce-free (HeadContent adds it)', () => {
		const blocks = jsonLd(head)
		expect(blocks.map((b) => b['@type'])).toEqual(['BreadcrumbList', 'SoftwareApplication'])
		for (const script of head.scripts ?? []) expect(script).not.toHaveProperty('nonce')
	})

	it('has one canonical on the www origin', () => {
		expect(head.links?.filter((l) => l.rel === 'canonical').map((l) => l.href)).toEqual([
			'https://www.longhandbudget.com/compare',
		])
	})
})

describe('/compare/$slug head()', () => {
	const head = (SlugRoute.options.head as (a: unknown) => Head)({
		params: { slug: page.slug },
		loaderData: { page },
	})

	it('emits exactly one breadcrumb list naming the spoke', () => {
		const blocks = jsonLd(head)
		expect(blocks.map((b) => b['@type'])).toEqual(['BreadcrumbList'])
		const items = blocks[0]?.['itemListElement'] as { name: string; item: string }[]
		expect(items.map((i) => i.name)).toEqual(['Home', 'Compare', page.title])
		expect(items[2]?.item).toBe(`https://www.longhandbudget.com/compare/${page.slug}`)
	})

	it('emits nothing but fallback meta while pending or after notFound()', () => {
		const pending = (SlugRoute.options.head as (a: unknown) => Head)({
			params: { slug: 'missing' },
			loaderData: undefined,
		})
		expect(pending.links ?? []).toEqual([])
		expect(pending.scripts ?? []).toEqual([])
		expect(pending.meta?.length).toBeGreaterThan(0)
	})
})
