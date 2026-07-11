import { renderWithRouter, screen, within } from '@/test/utils'
import { describe, expect, it, vi } from 'vitest'
import { APP_VERSION } from '../../../utils/version'

// The footer now mounts the premium-gated dark-mode toggle (story 7-3), which
// calls usePremiumAccess on mount. Mock it to a resolved free tier so these
// footer tests stay hermetic (no server-function import / network) and the
// toggle deterministically renders its locked state.
vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => ({
    status: {
      hasAccess: false,
      subscriptionStatus: 'free',
      isLoading: false,
      error: null,
      isAuthenticated: false,
    },
  }),
}))

import { Footer } from '../Footer'

/**
 * Footer component tests (story 4-8, AC-1; story 9-1, AC-1; story 7-3 toggle).
 *
 * Covers: the footer renders as an accessible landmark, displays the
 * application version sourced from package.json, and exposes the global in-app
 * "Contact" link on every page (story 9-1, which replaced the old GitHub
 * feedback link). Rendered within a router since footer links resolve routes.
 */
describe('Footer', () => {
  it('renders a contentinfo landmark', async () => {
    renderWithRouter(<Footer />)
    expect(await screen.findByRole('contentinfo')).toBeInTheDocument()
  })

  it('displays the application version', async () => {
    renderWithRouter(<Footer />)
    expect(await screen.findByText(`v${APP_VERSION}`)).toBeInTheDocument()
  })

  it('exposes the version to assistive tech with a label', async () => {
    renderWithRouter(<Footer />)
    expect(
      await screen.findByLabelText(new RegExp(`version ${APP_VERSION.replace(/\./g, '\\.')}`, 'i'))
    ).toBeInTheDocument()
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

  it('displays a copyright notice for the current year (story 6-9)', async () => {
    renderWithRouter(<Footer />)
    // Compute the year the same way the component does so this never goes stale.
    const year = new Date().getFullYear()
    expect(await screen.findByText(new RegExp(`Copyright ${year}`))).toBeInTheDocument()
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
