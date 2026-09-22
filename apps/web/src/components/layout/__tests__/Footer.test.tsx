import { renderWithRouter, screen, within } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { Footer } from '../Footer'

/**
 * Footer component tests (story 9-1, AC-1; story 5-13 compliance links; story
 * 21-1 version-drop + active-page state).
 *
 * Covers: the footer renders as an accessible landmark, exposes the global
 * in-app "Contact"/"Documentation"/compliance links on every page, no longer
 * shows the build version (story 21-1), marks the current footer page with
 * `aria-current="page"` via TanStack Router active state, and keeps the copyright
 * a visually distinct group. Rendered within a router since footer links resolve
 * routes; the active-route assertions rely on `renderWithRouter`'s `path` seed
 * (mirrors the GlobalNav suite).
 */
describe('Footer', () => {
  it('renders a contentinfo landmark', async () => {
    renderWithRouter(<Footer />)
    expect(await screen.findByRole('contentinfo')).toBeInTheDocument()
  })

  it('no longer displays the build version (story 21-1)', async () => {
    renderWithRouter(<Footer />)
    // Wait for the async footer content, then assert no "v0.0.1"-style build
    // version string is anywhere in the footer (story 21-1 dropped it).
    const footer = await screen.findByRole('contentinfo')
    expect(footer).not.toHaveTextContent(/\bv\d+\.\d+\.\d+/)
    expect(screen.queryByLabelText(/version/i)).not.toBeInTheDocument()
  })

  it('keeps the Longhand Budget brand text', async () => {
    renderWithRouter(<Footer />)
    // Exact text, not /longhand/i — the footer wordmark is the formal form
    // "Longhand Budget" (brand-1 AC-1: the footer sits in the legal cluster).
    expect(await screen.findByText('Longhand Budget')).toBeInTheDocument()
    // Guard: the retired SoluBudget wordmark must not return (story brand-1).
    expect(screen.queryByText(/solubudget/i)).toBeNull()
  })

  it('renders the global in-app contact link (story 9-1)', async () => {
    renderWithRouter(<Footer />)
    const link = await screen.findByRole('link', { name: /^contact$/i })
    expect(link).toHaveAttribute('href', '/contact')
  })

  it('no longer exposes the old GitHub feedback link (story 9-1)', async () => {
    renderWithRouter(<Footer />)
    // Wait for the async footer content, then assert the removed affordance is gone.
    await screen.findByRole('contentinfo')
    expect(
      screen.queryByRole('link', { name: /report an issue or share feedback/i })
    ).not.toBeInTheDocument()
  })

  it('renders the global documentation link (story 4-10)', async () => {
    renderWithRouter(<Footer />)
    const link = await screen.findByRole('link', { name: /documentation/i })
    expect(link).toHaveAttribute('href', '/docs')
  })

  it.each([
    [/^pricing$/i, '/pricing'],
    [/terms of service/i, '/terms'],
    [/privacy policy/i, '/privacy'],
    [/refund policy/i, '/refund'],
  ])('links to the %s compliance page (story 5-13)', async (name, href) => {
    renderWithRouter(<Footer />)
    const link = await screen.findByRole('link', { name })
    expect(link).toHaveAttribute('href', href)
  })

  // Story 21-1 (UX-DR28): the current footer page is distinguished with
  // `aria-current="page"` via TanStack Router active state (mirrors GlobalNav).
  it('marks the current footer page with aria-current="page" (story 21-1)', async () => {
    renderWithRouter(<Footer />, { path: '/pricing' })
    const pricing = await screen.findByRole('link', { name: /^pricing$/i })
    expect(pricing).toHaveAttribute('aria-current', 'page')
    // A different footer link is not marked current.
    expect(screen.getByRole('link', { name: /terms of service/i })).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('marks the Documentation link current on /docs (story 21-1)', async () => {
    renderWithRouter(<Footer />, { path: '/docs' })
    const docs = await screen.findByRole('link', { name: /documentation/i })
    expect(docs).toHaveAttribute('aria-current', 'page')
  })

  // Story 60.2 (FR92) INVERTED this test. It previously asserted the opposite —
  // that Documentation was NOT marked on a sub-page — which is what story 21-1's
  // `activeOptions={{ exact: true }}` produced. The flag is gone; the footer link
  // now reports the SECTION the reader is in, so a reader inside an article sees
  // Documentation marked current. Inverted rather than deleted: the direction it
  // guards flipped, and deleting it would have left the old behaviour free to
  // return unnoticed. The count test below overlaps it deliberately — this one
  // names the behaviour, that one bounds it.
  it('marks Documentation current on a /docs sub-page (story 60.2)', async () => {
    renderWithRouter(<Footer />, { path: '/docs/getting-started' })
    // Wait on the assertion's own subject, not a bystander. A `<Link>` renders
    // its `<a href>` on first paint whether or not the active state has been
    // computed, so awaiting any other link proves nothing about location
    // resolution — it only looked sufficient here because the previous version
    // of this test asserted an ABSENCE, which passes before resolution too.
    expect(
      await screen.findByRole('link', { name: /documentation/i, current: 'page' })
    ).toBeInTheDocument()
  })

  // Story 60.2: pins the SEGMENT boundary that the Footer docblock warns about.
  // `/docsomething` starts with the same characters as `/docs` but is a
  // different first segment, so the router must NOT mark Documentation there.
  // Without this, both other /docs tests would pass equally under a naive
  // `pathname.startsWith('/docs')`, and the docblock's capitalised warning
  // against hand-rolling one would rest on nothing.
  it('does not mark Documentation current on a path that merely starts with the same characters (story 60.2)', async () => {
    renderWithRouter(<Footer />, { path: '/docsomething' })
    const footer = await screen.findByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: /documentation/i })).not.toHaveAttribute(
      'aria-current'
    )
  })

  // Story 60.2: the five sibling entries (/pricing, /terms, /privacy, /refund,
  // /contact) have no child routes — verified against the real route tree in
  // `routeTree.gen.ts`, not assumed — and must not gain an active state from the
  // switch to prefix matching. Asserting the COUNT of marked links covers all
  // five in one assertion, and unlike five separate `.not.toHaveAttribute`
  // absence probes it cannot silently pass if a link label is later renamed.
  //
  // The total is pinned first, and that order matters: a count of marked links
  // alone would still read "exactly one" on a Footer that had stopped rendering
  // its siblings entirely, which is the failure the comment above claims to
  // cover. Seven = the six router links plus the external author link, which is
  // a plain <a> and can never carry `aria-current`.
  it('marks exactly one of the seven footer links current on a /docs sub-page (story 60.2)', async () => {
    renderWithRouter(<Footer />, { path: '/docs/getting-started' })
    const footer = await screen.findByRole('contentinfo')
    const links = within(footer).getAllByRole('link')
    expect(links).toHaveLength(7)
    const marked = links.filter((link) => link.getAttribute('aria-current') === 'page')
    expect(marked).toHaveLength(1)
    expect(marked[0]).toHaveAccessibleName(/documentation/i)
  })

  it('displays a copyright notice for the current year (story 6-9)', async () => {
    renderWithRouter(<Footer />)
    // Compute the year the same way the component does so this never goes stale.
    const year = new Date().getFullYear()
    expect(await screen.findByText(new RegExp(`Copyright ${year}`))).toBeInTheDocument()
  })

  // Story 21-1 (UX-DR27/UX-DR33): the copyright reads as a distinct group, with
  // more separation than the uniform inter-group gap on both mobile (extra
  // top margin in the stacked column) and desktop (extra left margin in the row).
  it('separates the copyright group from the legal-link cluster (story 21-1)', async () => {
    renderWithRouter(<Footer />)
    const copyright = await screen.findByText(/Copyright \d{4}/)
    // Class-token membership, not substring (18-1/18-3 lesson).
    const tokens = copyright.className.split(/\s+/)
    expect(tokens).toContain('mt-2')
    expect(tokens).toContain('sm:ml-3')
    // The mobile top margin is reset at >=640px so it doesn't nudge the
    // copyright below its siblings' centre in the desktop `items-center` row.
    expect(tokens).toContain('sm:mt-0')
  })

  it('links the author name to their website in a new tab (story 6-9)', async () => {
    renderWithRouter(<Footer />)
    const link = await screen.findByRole('link', {
      name: /lucas silbernagel.*opens in a new tab/i,
    })
    expect(link).toHaveAttribute('href', 'https://lucassilbernagel.com/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // Assert the visible attribution text too — the accessible name above is
    // driven by aria-label, so this guards against the link text being emptied.
    expect(link).toHaveTextContent('Lucas Silbernagel')
  })

  // Story 18-2: at 320px the footer stacks vertically; the six legal links are
  // grouped in a wrapper so they read as a spaced cluster (comfortable tap
  // rhythm) rather than a cramped run-together stack. The wrapper carries
  // `sm:contents` so at >=640px it dissolves and the links rejoin the single
  // wrapping row exactly as before — the desktop layout is unchanged.
  it('groups the legal links in a cluster that dissolves at >=640px (story 18-2)', async () => {
    renderWithRouter(<Footer />)
    const contact = await screen.findByRole('link', { name: /^contact$/i })
    const group = contact.parentElement
    // Class-token membership, not substring (18-1/18-3 lesson).
    const tokens = (group?.className ?? '').split(/\s+/)
    expect(tokens).toContain('sm:contents')
    // All six legal links live in that grouping wrapper.
    const hrefs = within(group as HTMLElement)
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'))
    expect(hrefs).toEqual(
      expect.arrayContaining(['/pricing', '/docs', '/terms', '/privacy', '/refund', '/contact'])
    )
  })
})
