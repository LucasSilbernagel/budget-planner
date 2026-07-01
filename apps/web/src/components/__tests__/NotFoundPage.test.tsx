import { renderWithRouter, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { NotFoundPage } from '../NotFoundPage'

/**
 * NotFoundPage component tests (story 6-4, UX-DR12).
 *
 * Covers the acceptance criteria that can be asserted in isolation: the page
 * exposes a single <h1> subject heading, keeps the "404" eyebrow out of the
 * heading tree, and offers an accessible recovery link back to the dashboard.
 * Rendered inside a router because the recovery control is a TanStack `Link`.
 */
describe('NotFoundPage', () => {
  it('renders exactly one h1, reading "Page not found" (AC-3)', async () => {
    renderWithRouter(<NotFoundPage />)
    const headings = await screen.findAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(/page not found/i)
  })

  it('keeps the decorative "404" out of the heading tree (AC-3)', async () => {
    renderWithRouter(<NotFoundPage />)
    // "404" is present as text but must not be a heading.
    expect(await screen.findByText('404')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '404' })).not.toBeInTheDocument()
  })

  it('shows the "Budget Planner" brand wordmark (AC-1)', async () => {
    renderWithRouter(<NotFoundPage />)
    expect(await screen.findByText('Budget Planner')).toBeInTheDocument()
  })

  it('offers an accessible recovery link to the home/dashboard (AC-3)', async () => {
    renderWithRouter(<NotFoundPage />)
    const link = await screen.findByRole('link', { name: /go home/i })
    expect(link).toHaveAttribute('href', '/')
  })

  it('renders inside a single main landmark (AC-1)', async () => {
    renderWithRouter(<NotFoundPage />)
    expect(await screen.findByRole('main')).toBeInTheDocument()
  })
})
