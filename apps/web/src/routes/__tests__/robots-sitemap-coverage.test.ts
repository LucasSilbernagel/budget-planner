import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOC_PAGES } from '../../content/docs'
import { globbedPagePaths } from './route-discovery'

const PUBLIC_DIR = resolve(__dirname, '../../../public')
const ORIGIN = 'https://www.longhandbudget.com'

// Written by hand: a decision, not a derivation. Keep in step with robots.txt's "Indexable" comment.
const INDEXABLE_ROUTES = [
	'/',
	'/contact',
	'/docs',
	'/docs/$docId',
	'/pricing',
	'/privacy',
	'/refund',
	'/terms',
] as const

const NON_PAGE_DISALLOWS = new Set(['/api/'])

interface Robots {
	disallows: string[]
	allows: string[]
	sitemaps: string[]
	unmodelled: string[]
}

// Models only the `User-agent: *` group. Other groups, stray rules or extra Allow lines land in
// `unmodelled`, because a real crawler would read them differently.
function parseRobots(text: string): Robots {
	const robots: Robots = { disallows: [], allows: [], sitemaps: [], unmodelled: [] }
	let groups = 0
	let agents: string[] | null = null
	let inRules = false
	for (const [index, raw] of text.split(/\r?\n/).entries()) {
		const line = raw.replace(/#.*$/, '').trim()
		if (line === '') continue
		const at = `line ${index + 1} "${line}"`
		const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
		if (!match) {
			robots.unmodelled.push(`${at}: not a field`)
			continue
		}
		const field = match[1]?.toLowerCase()
		const value = match[2]?.trim() ?? ''
		if (field === 'user-agent') {
			// Consecutive User-agent lines share one group; one after rules starts a new one.
			if (agents === null || inRules) {
				agents = []
				inRules = false
				groups += 1
				if (groups > 1) robots.unmodelled.push(`${at}: a second User-agent group`)
			}
			agents.push(value)
		} else if (field === 'sitemap') {
			robots.sitemaps.push(value)
		} else if (field === 'allow' || field === 'disallow') {
			inRules = true
			if (agents === null) {
				robots.unmodelled.push(`${at}: a rule outside any User-agent group`)
			} else if (agents.join() !== '*') {
				robots.unmodelled.push(`${at}: a rule for User-agent ${agents.join(', ')}, not *`)
			} else if (field === 'allow') {
				robots.allows.push(value)
			} else if (value !== '') {
				robots.disallows.push(value)
			}
		} else {
			robots.unmodelled.push(`${at}: field "${field}" is not modelled`)
		}
	}
	return robots
}

// Matched over the whole document so a stray tag or unclosed `<url>` fails. `[^<&]` refuses
// entities: the `<loc>` scan does not decode them.
const SITEMAP_SHAPE =
	/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">(?:\s*<url>\s*<loc>[^<&]+<\/loc>\s*<\/url>)+\s*<\/urlset>\s*$/

function withoutXmlComments(xml: string): string {
	return xml.replace(/<!--[\s\S]*?-->/g, '')
}

// XML comments removed first so header prose about `<loc>` cannot be read as a URL.
function parseSitemapLocs(xml: string): string[] {
	return [...withoutXmlComments(xml).matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((m) => m[1] ?? '')
}

function disallowedBy(path: string, disallows: readonly string[]): string[] {
	return disallows.filter((rule) => path.startsWith(rule))
}

function expandRoute(routePath: string): string[] {
	if (routePath === '/docs/$docId') return DOC_PAGES.map((doc) => `/docs/${doc.slug}`)
	if (routePath.includes('$')) {
		throw new Error(`no sitemap expansion for dynamic route ${routePath} — add one here`)
	}
	return [routePath]
}

const robotsText = readFileSync(resolve(PUBLIC_DIR, 'robots.txt'), 'utf8')
const sitemapXml = readFileSync(resolve(PUBLIC_DIR, 'sitemap.xml'), 'utf8')
const robots = parseRobots(robotsText)
const locs = parseSitemapLocs(sitemapXml)

describe('the parsers read what the files actually say (story seo-1)', () => {
	// Without these, an empty parse would make every loop below vacuous.
	it('robots.txt uses only the grammar this test models', () => {
		expect(robots.unmodelled).toEqual([])
		expect(robots.allows).toEqual(['/'])
	})

	it('finds the Disallow lines, the sitemap entries and the routes', () => {
		expect(robots.disallows.length).toBeGreaterThan(0)
		expect(locs.length).toBeGreaterThan(0)
		expect(globbedPagePaths.length).toBeGreaterThan(0)
		expect(DOC_PAGES.length).toBeGreaterThan(0)
	})
})

describe('every page route is classified in robots.txt (story seo-1, AC-1/AC-4)', () => {
	for (const routePath of globbedPagePaths) {
		it(`${routePath} is either indexable or disallowed — and not both`, () => {
			const indexable = (INDEXABLE_ROUTES as readonly string[]).includes(routePath)
			if (indexable) {
				const rules = expandRoute(routePath).flatMap((p) => disallowedBy(p, robots.disallows))
				expect(rules, `${routePath} is listed as indexable but robots.txt disallows it`).toEqual([])
			} else {
				// A disallowed dynamic route is matched on its static prefix: `$x` stands
				// in for any param value, and no Disallow rule contains a `$`.
				const rules = disallowedBy(routePath, robots.disallows)
				expect(
					rules.length,
					`${routePath} is UNCLASSIFIED: add a \`Disallow:\` line to public/robots.txt, or add it to INDEXABLE_ROUTES and sitemap.xml`
				).toBeGreaterThan(0)
			}
		})
	}

	it('every indexable route is a route that exists', () => {
		const missing = INDEXABLE_ROUTES.filter((r) => !globbedPagePaths.includes(r))
		expect(missing, 'INDEXABLE_ROUTES names routes that no longer exist').toEqual([])
	})

	it('every Disallow line names a page route (except non-page paths)', () => {
		// A rule must be a route or a parent segment, not a string prefix: `/setting` would match `/settings`.
		const stale = robots.disallows.filter(
			(rule) =>
				!NON_PAGE_DISALLOWS.has(rule) &&
				!globbedPagePaths.some((r) => r === rule || r.startsWith(`${rule}/`))
		)
		expect(stale, 'robots.txt disallows paths no route serves').toEqual([])
	})
})

describe('sitemap.xml lists exactly the indexable pages (story seo-1, AC-2/AC-3/AC-4)', () => {
	it('is a sitemaps.org 0.9 urlset, whole document', () => {
		expect(withoutXmlComments(sitemapXml)).toMatch(SITEMAP_SHAPE)
	})

	it('every <loc> is an absolute URL on the production www origin', () => {
		const offOrigin = locs.filter((loc) => {
			const url = new URL(loc)
			return url.origin !== ORIGIN || `${url.origin}${url.pathname}` !== loc
		})
		// Not the apex (it only 301s), not http, no query or fragment.
		expect(offOrigin).toEqual([])
	})

	it('the <loc> set equals the indexable routes, expanded', () => {
		const expected = INDEXABLE_ROUTES.flatMap(expandRoute).sort()
		const actual = locs.map((loc) => new URL(loc).pathname).sort()
		expect(actual).toEqual(expected)
	})

	it('lists no page twice', () => {
		expect(new Set(locs).size).toBe(locs.length)
	})

	it('lists nothing robots.txt disallows', () => {
		const blocked = locs.filter(
			(loc) => disallowedBy(new URL(loc).pathname, robots.disallows).length > 0
		)
		expect(blocked).toEqual([])
	})

	it('robots.txt names it once, absolutely, on the same origin as every <loc>', () => {
		expect(robots.sitemaps).toEqual([`${ORIGIN}/sitemap.xml`])
	})
})
