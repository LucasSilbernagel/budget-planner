/**
 * CategoriesSection tests (story 30.4b, AC-4).
 *
 * The `/settings` entry point to category management. Covers all THREE
 * `PremiumFeatureGate` states, because the gate is fail-closed and the loading
 * state is a distinct render, not a transient detail:
 *   - loading  → neither the link nor the lock
 *   - locked   → an inert button, no link
 *   - unlocked → the link to /categories, no lock
 *
 * Accessible names: since story 116.2 BOTH states are named by their content.
 * The locked <button> has no `aria-label` (it used to, "<featureName> —
 * premium, locked", which hid the visible label from the name): it reads the
 * visible title, the description, then "Premium, locked". The unlocked <a>
 * reads its content too.
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { lockedName } from '../../../test/locked-name'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../auth/premium-prompt', () => ({
  PremiumPrompt: () => <div data-testid="premium-prompt" />,
}))

import { CategoriesSection } from '../categories-section'

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
  usePremiumAccess.mockReturnValue({
    status: {
      hasAccess: false,
      subscriptionStatus: null,
      isLoading: false,
      error: null,
      isAuthenticated: false,
      ...overrides,
    } satisfies PremiumAccessStatus,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CategoriesSection', () => {
  it('names the section and explains what a rename does', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<CategoriesSection />)

    expect(screen.getByRole('heading', { level: 2, name: /^categories$/i })).toBeInTheDocument()
    expect(
      screen.getByText(/renaming a category updates every entry that uses it/i)
    ).toBeInTheDocument()
  })

  it('links an active Premium user straight to the management page', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<CategoriesSection />)

    // The unlocked <a> has NO aria-label, so its name comes from its content.
    const link = screen.getByRole('link', { name: /custom categories/i })
    expect(link).toHaveAttribute('href', '/categories')
    expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
  })

  it.each([
    ['free' as const, false],
    ['past_due' as const, true],
    ['canceled' as const, true],
    [null, false],
  ])('shows an inert locked control and no link for %s', (subscriptionStatus, isAuthenticated) => {
    mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated })
    render(<CategoriesSection />)

    // Named by what it shows: the visible title first, "Premium, locked" last.
    expect(
      screen.getByRole('button', { name: lockedName('Custom categories') })
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /custom categories/i })).not.toBeInTheDocument()
    // Discoverable, not hidden (FR24).
    expect(screen.getByText('Premium')).toBeInTheDocument()
  })

  it('treats an ERRORED tier check as not premium (fail-closed)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'check failed' })
    render(<CategoriesSection />)

    expect(screen.getByTestId('premium-gate-locked')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /custom categories/i })).not.toBeInTheDocument()
  })

  it('leaks neither the link nor the lock while the tier is unknown', () => {
    mockStatus({ isLoading: true })
    render(<CategoriesSection />)

    expect(screen.getByTestId('premium-gate-skeleton')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /custom categories/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
    expect(screen.queryByText('Premium')).not.toBeInTheDocument()
  })

  it('carries the product name nowhere — the retired brand must not creep back in', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    const { container } = render(<CategoriesSection />)
    // `local-data-section.tsx` says "Budget Planner" and is on retired-brand's
    // ALLOWED list; this file is not, so its markup was copied and its prose was not.
    expect(container.textContent).not.toMatch(/budget planner/i)
  })
})
