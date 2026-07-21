import { describe, expect, it } from 'vitest'
import { LEGAL_PAGES, PRICING_PAGE, getLegalPage } from '../index'

/**
 * Legal/commercial content registry tests (story 5-13, updated in stories 10-3, 25-2).
 *
 * Confirms the registry exposes the four Paddle-required pages with well-formed
 * bodies loaded from the static `.md` files, that slug lookup behaves, that the
 * pricing page carries the Merchant-of-Record disclosure and the finalized EUR
 * pricing (€39/yr + €99 lifetime, no monthly — story 25-2), and that no unresolved
 * DRAFT/placeholder tokens remain (10-3 AC-1).
 */
describe('LEGAL_PAGES', () => {
  it('exposes the pricing, terms, privacy, and refund pages', () => {
    const slugs = LEGAL_PAGES.map((page) => page.slug)
    expect(slugs).toEqual(expect.arrayContaining(['pricing', 'terms', 'privacy', 'refund']))
  })

  it('gives every page a slug, title, description, and non-empty markdown body', () => {
    for (const page of LEGAL_PAGES) {
      expect(page.slug).toMatch(/^[a-z0-9-]+$/)
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.description.length).toBeGreaterThan(0)
      expect(page.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('uses unique slugs', () => {
    const slugs = LEGAL_PAGES.map((page) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('keeps the route header as the single h1: no body-level h1, at least one h2', () => {
    for (const page of LEGAL_PAGES) {
      // The route header owns the only `<h1>`; bodies must not introduce another.
      expect(page.content).not.toMatch(/^# .+/m)
      // …but each body still has structured h2 sections.
      expect(page.content).toMatch(/^## .+/m)
    }
  })

  it('never opens a body with a heading that just repeats the page title', () => {
    for (const page of LEGAL_PAGES) {
      const firstHeading = page.content.match(/^#{2,6} (.+)$/m)?.[1]?.trim()
      expect(firstHeading).not.toBe(page.title)
    }
  })

  it('contains no unresolved DRAFT banner or bracketed placeholder (10-3 AC-1)', () => {
    for (const page of LEGAL_PAGES) {
      expect(page.content).not.toMatch(/DRAFT — pending legal review/)
      expect(page.content).not.toMatch(/\[(?:DATE|PRICE|CONFIRM)\b[^\]]*\]/)
    }
  })
})

describe('getLegalPage', () => {
  it('returns the matching page for a known slug', () => {
    expect(getLegalPage('privacy')?.title).toBe('Privacy Policy')
  })

  it('returns undefined for an unknown slug', () => {
    expect(getLegalPage('does-not-exist')).toBeUndefined()
  })
})

describe('pricing page content (AC-4)', () => {
  it('discloses Paddle as the Merchant of Record', () => {
    expect(PRICING_PAGE.content).toMatch(/Paddle/)
    expect(PRICING_PAGE.content).toMatch(/Merchant of Record/i)
  })

  it('states the finalized EUR pricing (annual + lifetime, no monthly) — story 25-2', () => {
    expect(PRICING_PAGE.content).toMatch(/€39 per year/)
    expect(PRICING_PAGE.content).toMatch(/€99/)
    expect(PRICING_PAGE.content).toMatch(/lifetime/i)
    // Monthly plan dropped (25-2 AC-1): no per-month pricing remains anywhere.
    expect(PRICING_PAGE.content).not.toMatch(/per month/)
    expect(PRICING_PAGE.content).not.toMatch(/€10\b/)
  })

  it('describes both the free and premium tiers', () => {
    expect(PRICING_PAGE.content).toMatch(/### Free/)
    expect(PRICING_PAGE.content).toMatch(/### Premium/)
  })

  it('describes Premium forecasting honestly — no reload/side-by-side overpromise (story 20-1)', () => {
    // Story 20-1: the pricing forecasting bullet must match what ships. Saved
    // forecasts are a searchable list, not reloadable into the builder, and the
    // Projections tab does not reflect the user's scenario — so no "reloadable"
    // or "side by side" claims. Pin the honest phrasing so drift breaks a test.
    expect(PRICING_PAGE.content).toMatch(/what-if scenarios/i)
    expect(PRICING_PAGE.content).toMatch(/searchable\s+list/i)
    expect(PRICING_PAGE.content).not.toMatch(/reloadable/i)
    expect(PRICING_PAGE.content).not.toMatch(/side by side/i)
  })
})
