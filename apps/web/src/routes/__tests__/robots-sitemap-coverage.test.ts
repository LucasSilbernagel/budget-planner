import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOC_PAGES } from '../../content/docs'
import { globbedPagePaths } from './route-discovery'

/**
 * Every page route is classified for crawlers, and the sitemap lists exactly
 * the indexable ones (story seo-1).
 *
 * WHY THIS EXISTS. Story 40.1 wrote robots.txt against the routes of its day.
 * `/welcome` landed afterwards (story 5-3) and fell under the `Allow: /` default
 * without anyone deciding it should — nothing tied the route set to the file.
 * This test does: it is driven by the DISCOVERED route set (the same discovery
 * story 40.1's head-coverage test uses, not a third walker), so a route added
 * tomorrow is unclassified — and red — the day it lands.
 *
 * Both files are read from disk, not fetched: this is about what ships in
 * `public/`, and a fetch would also depend on a server this suite does not run.
 * (Whether production serves the sitemap AS XML is the adapter test's job —
 * `src/server/__tests__/node-adapter.test.ts`.)
 */

const PUBLIC_DIR = resolve(__dirname, '../../../public')
const ORIGIN = 'https://www.longhandbudget.com'

/**
 * The pages a stranger may land on from a search result, by ROUTE path.
 *
 * Written out by hand because it is a decision, not a derivation: the test's
 * job is to make sure every route has had that decision made, so a route
 * missing from here AND from robots.txt's `Disallow:` lines is the failure.
 * Keep it in step with robots.txt's "Indexable" comment.
 */
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

/** Server routes, not pages — disallowed without a page route behind them. */
const NON_PAGE_DISALLOWS = new Set(['/api/'])

interface Robots {
  disallows: string[]
  allows: string[]
  sitemaps: string[]
  /** Anything in the file this parser does not model. Must be empty. */
  unmodelled: string[]
}

/**
 * Just enough of the robots.txt grammar for this file: comments stripped,
 * field names case-insensitive and whitespace-tolerant (as crawlers accept),
 * so a `sitemap:` spelled differently cannot slip past the "exactly one" check.
 *
 * ⚠️ It models ONE group, `User-agent: *`, and nothing else — and it says so
 * loudly rather than guessing. A crawler obeys only the most specific group
 * that names it, so a `Disallow:` under `User-agent: Googlebot` (or outside any
 * group, which crawlers ignore) must not count as classifying a route for
 * everyone. Likewise `Allow:` wins over a shorter `Disallow:` (longest match),
 * so any `Allow:` beyond the `/` baseline would make "disallowed" here disagree
 * with a real crawler. All of those land in `unmodelled`, which a test pins
 * empty: extend this parser before extending the file.
 */
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
      // Sitemap is a file-level field, independent of any group.
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

/**
 * The shape THIS sitemap is written in: a prolog, one sitemaps.org 0.9
 * `urlset`, and nothing but `<url><loc>…</loc></url>` entries inside it —
 * matched over the WHOLE document (comments removed), so a missing
 * `</urlset>`, a stray tag or an unclosed `<url>` fails here instead of
 * slipping past a `<loc>` scan. `[^<&]` refuses entities outright: every URL
 * this site has is entity-free, and the `<loc>` scan below does not decode them.
 * This is deliberately narrower than "any valid sitemap" — widen it on purpose
 * (e.g. for `xhtml:link` alternates), not by accident.
 */
const SITEMAP_SHAPE =
  /^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">(?:\s*<url>\s*<loc>[^<&]+<\/loc>\s*<\/url>)+\s*<\/urlset>\s*$/

function withoutXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * `<loc>` values, with XML comments removed first: the sitemap's own header
 * comment talks about `<loc>` entries, and a regex over the raw text must not
 * be able to read prose as a URL.
 */
function parseSitemapLocs(xml: string): string[] {
  return [...withoutXmlComments(xml).matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((m) => m[1] ?? '')
}

/** robots.txt `Disallow:` is a PREFIX rule. */
function disallowedBy(path: string, disallows: readonly string[]): string[] {
  return disallows.filter((rule) => path.startsWith(rule))
}

/** Route paths -> URL paths, with `/docs/$docId` expanded from `DOC_PAGES`. */
function expandRoute(routePath: string): string[] {
  if (routePath === '/docs/$docId') return DOC_PAGES.map((doc) => `/docs/${doc.slug}`)
  if (routePath.includes('$')) {
    // A new dynamic route cannot be listed in a sitemap without knowing its
    // params. Fail by name rather than emitting a literal `$param` URL.
    throw new Error(`no sitemap expansion for dynamic route ${routePath} — add one here`)
  }
  return [routePath]
}

const robotsText = readFileSync(resolve(PUBLIC_DIR, 'robots.txt'), 'utf8')
const sitemapXml = readFileSync(resolve(PUBLIC_DIR, 'sitemap.xml'), 'utf8')
const robots = parseRobots(robotsText)
const locs = parseSitemapLocs(sitemapXml)

describe('the parsers read what the files actually say (story seo-1)', () => {
  // Without these, an empty parse would make every "for each" below vacuous.
  it('robots.txt uses only the grammar this test models', () => {
    // See `parseRobots`: other groups, stray rules or extra Allow lines would
    // make every "disallowed" verdict below disagree with a real crawler.
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
    // A rule must BE a route, or the parent segment of one — not merely a
    // string prefix of one. `Disallow: /setting` (a typo) is a prefix of
    // `/settings`, so a prefix check would call it live while it also blocks
    // any future `/setting…` page.
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
    // Not the apex (it only 301s, ADR-007), not http, no query or fragment.
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
    // Relative Sitemap URLs are invalid; a second line would be a second
    // decision that nothing keeps in step with the first.
    expect(robots.sitemaps).toEqual([`${ORIGIN}/sitemap.xml`])
  })
})
