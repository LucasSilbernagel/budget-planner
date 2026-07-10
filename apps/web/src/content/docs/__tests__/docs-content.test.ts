import { describe, expect, it } from 'vitest'
import { DOC_PAGES, getDocPage } from '../index'

/**
 * Documentation content registry tests (story 4-10, AC-2).
 *
 * Confirms the registry exposes well-formed pages whose bodies are loaded from
 * the static `.md` files, and that slug lookup behaves correctly.
 */
describe('DOC_PAGES', () => {
  it('exposes at least the getting-started, features, and faq pages', () => {
    const slugs = DOC_PAGES.map((page) => page.slug)
    expect(slugs).toEqual(expect.arrayContaining(['getting-started', 'features', 'faq']))
  })

  it('gives every page a slug, title, description, and non-empty markdown body', () => {
    for (const page of DOC_PAGES) {
      expect(page.slug).toMatch(/^[a-z0-9-]+$/)
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.description.length).toBeGreaterThan(0)
      expect(page.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('uses unique slugs', () => {
    const slugs = DOC_PAGES.map((page) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe('getDocPage', () => {
  it('returns the matching page for a known slug', () => {
    expect(getDocPage('faq')?.title).toBe('FAQ')
  })

  it('returns undefined for an unknown slug', () => {
    expect(getDocPage('does-not-exist')).toBeUndefined()
  })
})

/**
 * Content-accuracy guards (story 10-4).
 *
 * These lock in the corrections made when the docs were reconciled against the
 * shipped app so a future edit can't silently reintroduce a stale claim. They
 * assert facts, not prose, so wording can still evolve freely.
 */
describe('documentation content accuracy (story 10-4)', () => {
  const contentFor = (slug: string): string => {
    const page = getDocPage(slug)
    if (!page) throw new Error(`missing expected doc page: ${slug}`)
    return page.content
  }

  it('no page references the "Financial Health" score removed in story 11-5', () => {
    for (const page of DOC_PAGES) {
      expect(page.content.toLowerCase()).not.toContain('financial health')
    }
  })

  it('the FAQ locates the currency control on /settings, not an old page header', () => {
    const faq = contentFor('faq')
    expect(faq).toContain('/settings')
    expect(faq).not.toContain('in the page header')
  })

  it('the FAQ documents the in-app "Clear local data" control (story 17-2)', () => {
    // The reset/clear answer must lead with the in-app control, not only point at
    // the browser's own privacy settings.
    expect(contentFor('faq')).toContain('Clear local data')
  })

  it('the FAQ discloses the cookieless (counter.dev) analytics posture', () => {
    expect(contentFor('faq').toLowerCase()).toContain('counter.dev')
  })

  it('the FAQ routes support requests to the in-app contact form and links the Privacy Policy', () => {
    const faq = contentFor('faq')
    expect(faq).toContain('/contact')
    expect(faq).toContain('/privacy')
  })

  // The Features page splits into a Free section and a Premium section; the two
  // guards below assert *which* section a claim lives in, not just that a
  // substring appears somewhere on the page.
  const featureSections = () => {
    const content = getDocPage('features')?.content ?? ''
    const premiumIndex = content.indexOf('### Premium tier')
    if (premiumIndex === -1) throw new Error('Features page is missing the Premium tier section')
    return {
      free: content.slice(0, premiumIndex).toLowerCase(),
      premium: content.slice(premiumIndex).toLowerCase(),
    }
  }

  it('the Features page states ad removal under Premium (mirrors the Privacy Policy, story 13-1)', () => {
    // AC-2: the Premium section must explicitly say ads are removed for Premium
    // users, consistent with privacy.md ("Signed-in Premium users are not shown ads").
    expect(featureSections().premium).toContain('no ads')
  })

  it('the Features page keeps Retirement modeling under the Free tier (story 13-1, AC-4)', () => {
    // AC-4 do-not-regress guard: retirement stays Free (decided 2026-07-06) — it
    // must appear in the Free section and NOT be advertised under Premium.
    const { free, premium } = featureSections()
    expect(free).toContain('retirement modeling')
    expect(premium).not.toContain('retirement modeling')
  })

  it('every internal doc link targets a real app route', () => {
    // The routes referenced by the docs; each exists under apps/web/src/routes.
    const knownRoutes = new Set([
      '/docs/getting-started',
      '/docs/features',
      '/docs/faq',
      '/privacy',
      '/settings',
      '/contact',
      '/net-worth-projection',
      '/retirement',
    ])
    const internalLink = /\]\((\/[^)]*)\)/g
    for (const page of DOC_PAGES) {
      for (const match of page.content.matchAll(internalLink)) {
        expect(knownRoutes.has(match[1])).toBe(true)
      }
    }
  })
})
