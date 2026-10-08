import { renderWithRouter, screen, within } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { Footer } from '../Footer'

describe('Footer', () => {
  it('renders a contentinfo landmark', async () => {
    renderWithRouter(<Footer />)
    expect(await screen.findByRole('contentinfo')).toBeInTheDocument()
  })

  it('no longer displays the build version (story 21-1)', async () => {
    renderWithRouter(<Footer />)
    const footer = await screen.findByRole('contentinfo')
    expect(footer).not.toHaveTextContent(/\bv\d+\.\d+\.\d+/)
    expect(screen.queryByLabelText(/version/i)).not.toBeInTheDocument()
  })

  it('keeps the Longhand Budget brand text', async () => {
    renderWithRouter(<Footer />)
    expect(await screen.findByText('Longhand Budget')).toBeInTheDocument()
    expect(screen.queryByText(/solubudget/i)).toBeNull()
  })

  it('renders the global in-app contact link (story 9-1)', async () => {
    renderWithRouter(<Footer />)
    const link = await screen.findByRole('link', { name: /^contact$/i })
    expect(link).toHaveAttribute('href', '/contact')
  })

  it('no longer exposes the old GitHub feedback link (story 9-1)', async () => {
    renderWithRouter(<Footer />)
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

  it('marks the current footer page with aria-current="page" (story 21-1)', async () => {
    renderWithRouter(<Footer />, { path: '/pricing' })
    const pricing = await screen.findByRole('link', { name: /^pricing$/i })
    expect(pricing).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /terms of service/i })).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('marks the Documentation link current on /docs (story 21-1)', async () => {
    renderWithRouter(<Footer />, { path: '/docs' })
    const docs = await screen.findByRole('link', { name: /documentation/i })
    expect(docs).toHaveAttribute('aria-current', 'page')
  })

  it('marks Documentation current on a /docs sub-page (story 60.2)', async () => {
    renderWithRouter(<Footer />, { path: '/docs/getting-started' })
    // Await the assertion's own subject: a <Link> renders its href before active state resolves.
    expect(
      await screen.findByRole('link', { name: /documentation/i, current: 'page' })
    ).toBeInTheDocument()
  })

  it('does not mark Documentation current on a path that merely starts with the same characters (story 60.2)', async () => {
    renderWithRouter(<Footer />, { path: '/docsomething' })
    const footer = await screen.findByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: /documentation/i })).not.toHaveAttribute(
      'aria-current'
    )
  })

  // Pin the total first: one marked link would also pass if the siblings stopped rendering.
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
    const year = new Date().getFullYear()
    expect(await screen.findByText(new RegExp(`Copyright ${year}`))).toBeInTheDocument()
  })

  it('separates the copyright group from the legal-link cluster (story 21-1)', async () => {
    renderWithRouter(<Footer />)
    const copyright = await screen.findByText(/Copyright \d{4}/)
    const tokens = copyright.className.split(/\s+/)
    expect(tokens).toContain('mt-2')
    expect(tokens).toContain('sm:ml-3')
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
    expect(link).toHaveTextContent('Lucas Silbernagel')
  })

  it('groups the legal links in a cluster that dissolves at >=640px (story 18-2)', async () => {
    renderWithRouter(<Footer />)
    const contact = await screen.findByRole('link', { name: /^contact$/i })
    const group = contact.parentElement
    const tokens = (group?.className ?? '').split(/\s+/)
    expect(tokens).toContain('sm:contents')
    const hrefs = within(group as HTMLElement)
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'))
    expect(hrefs).toEqual(
      expect.arrayContaining(['/pricing', '/docs', '/terms', '/privacy', '/refund', '/contact'])
    )
  })

  // Class tokens: jsdom applies no Tailwind.
  it('lays the legal links out as a two-column grid of 44px phone targets (story 96.1)', async () => {
    renderWithRouter(<Footer />)
    const contact = await screen.findByRole('link', { name: /^contact$/i })
    const group = contact.parentElement as HTMLElement
    const groupTokens = [...group.classList]
    expect(groupTokens).toEqual(expect.arrayContaining(['grid', 'grid-cols-2', 'w-full']))
    expect(groupTokens).toContain('sm:contents')
    const links = within(group).getAllByRole('link')
    expect(links).toHaveLength(6)
    for (const link of links) {
      const tokens = [...link.classList]
      expect(tokens, `${link.textContent} is not a 44px phone cell`).toEqual(
        expect.arrayContaining([
          'max-sm:flex',
          'max-sm:min-h-[44px]',
          'max-sm:items-center',
          'max-sm:justify-center',
        ])
      )
      expect(tokens).not.toContain('min-h-[44px]')
      expect(tokens).toContain('underline')
    }
    const author = screen.getByRole('link', { name: /lucas silbernagel.*opens in a new tab/i })
    expect([...author.classList]).toEqual(
      expect.arrayContaining(['max-sm:inline-flex', 'max-sm:min-h-[44px]', 'max-sm:items-center'])
    )
    expect([...author.classList]).not.toContain('min-h-[44px]')
  })
})
