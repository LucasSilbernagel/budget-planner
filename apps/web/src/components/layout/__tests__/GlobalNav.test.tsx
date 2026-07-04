import { renderWithRouter, screen, within } from '@/test/utils'
import { describe, expect, it, vi } from 'vitest'

/**
 * GlobalNav component tests (story 11-1).
 *
 * Covers the persistent primary navigation: it is a real `<nav>` landmark with
 * an accessible name, exposes every top-level section with the correct route,
 * marks the current route with `aria-current="page"` (with the Overview link
 * matching `/` exactly so it is not active everywhere), and keeps the full link
 * set in the mobile (fixed bottom bar) layout.
 *
 * The active-route assertions rely on `renderWithRouter`'s `path` seed: TanStack
 * Router `<Link>` derives active state from the current location, which the
 * throwaway in-memory router exposes. (The one-click cross-section navigation
 * and the hydrated active state on the real route tree are additionally proven
 * in e2e/global-nav.spec.ts.)
 *
 * Nodes render asynchronously through RouterProvider, so every assertion awaits
 * `findBy*` first (mirrors the Footer suite). The desktop layout renders by
 * default because jsdom has no `matchMedia`, so `useIsNarrowViewport` returns
 * false; the mobile layout is exercised by mocking that hook.
 */

const SECTIONS: readonly [label: RegExp, href: string][] = [
  [/^overview$/i, '/'],
  [/^income$/i, '/income'],
  [/^expenses$/i, '/expenses'],
  [/^savings$/i, '/savings'],
  [/^balance$/i, '/balance'],
  [/^projections$/i, '/net-worth-projection'],
]

describe('GlobalNav', () => {
  it('renders a nav landmark with an accessible name', async () => {
    const { GlobalNav } = await import('../GlobalNav')
    renderWithRouter(<GlobalNav />)
    expect(await screen.findByRole('navigation', { name: /primary/i })).toBeInTheDocument()
  })

  it.each(SECTIONS)('exposes the %s section link to %s', async (name, href) => {
    const { GlobalNav } = await import('../GlobalNav')
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const link = within(nav).getByRole('link', { name })
    expect(link).toHaveAttribute('href', href)
  })

  it('exposes exactly the six top-level sections (no premium entry in the nav)', async () => {
    const { GlobalNav } = await import('../GlobalNav')
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length)
    // Forecasting stays surfaced-but-locked on Home (story 7-2), not in the nav.
    expect(within(nav).queryByRole('link', { name: /forecast/i })).not.toBeInTheDocument()
  })

  it('marks the current section with aria-current="page"', async () => {
    const { GlobalNav } = await import('../GlobalNav')
    renderWithRouter(<GlobalNav />, { path: '/expenses' })
    const link = await screen.findByRole('link', { name: /^expenses$/i })
    expect(link).toHaveAttribute('aria-current', 'page')
  })

  it('does not mark Overview active on a sub-route (exact match on "/")', async () => {
    const { GlobalNav } = await import('../GlobalNav')
    renderWithRouter(<GlobalNav />, { path: '/expenses' })
    // Expenses resolving active is the signal the router has settled.
    await screen.findByRole('link', { name: /^expenses$/i })
    expect(screen.getByRole('link', { name: /^overview$/i })).not.toHaveAttribute('aria-current')
  })

  it('marks Overview active only on the root route', async () => {
    const { GlobalNav } = await import('../GlobalNav')
    renderWithRouter(<GlobalNav />, { path: '/' })
    const overview = await screen.findByRole('link', { name: /^overview$/i })
    expect(overview).toHaveAttribute('aria-current', 'page')
  })

  it('keeps the full section set in the mobile bottom-bar layout', async () => {
    vi.resetModules()
    vi.doMock('../../../hooks/useIsNarrowViewport', () => ({
      useIsNarrowViewport: () => true,
    }))
    const { GlobalNav } = await import('../GlobalNav')
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length)
    vi.doUnmock('../../../hooks/useIsNarrowViewport')
    vi.resetModules()
  })
})
