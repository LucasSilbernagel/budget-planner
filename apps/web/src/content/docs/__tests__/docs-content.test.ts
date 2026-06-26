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
