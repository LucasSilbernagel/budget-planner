/**
 * HomePage premium-discovery tests (story 7-2, FR24).
 *
 * FR24 requires premium features be discoverable-but-locked, not hidden. Before
 * this story `/forecasting` was linked from nowhere. These tests assert the
 * homepage now surfaces Advanced Forecasting:
 *   - free user → a locked control with a "Premium" badge (no working link).
 *   - paid user → a working link to /forecasting with no badge.
 *
 * `usePremiumAccess` is mocked to drive the tier. We assert the HYDRATED client
 * DOM (the resolved tier), not the SSR/loading skeleton — the unlock transition
 * is exactly what SSR-only smoke misses (project memory, 4-11).
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { HomePage } from '../HomePage'

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
  const status: PremiumAccessStatus = {
    hasAccess: false,
    subscriptionStatus: null,
    isLoading: false,
    error: null,
    isAuthenticated: false,
    ...overrides,
  }
  usePremiumAccess.mockReturnValue({ status })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HomePage premium discovery', () => {
  it('AC-1: shows Advanced Forecasting locked with a Premium badge for a free user', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    expect(
      screen.getByRole('button', { name: /advanced forecasting — premium, locked/i })
    ).toBeInTheDocument()
    expect(screen.getByText('Premium')).toBeInTheDocument()
    // Not a usable link for free users.
    expect(screen.queryByRole('link', { name: /advanced forecasting/i })).not.toBeInTheDocument()
  })

  it('AC-3: shows a working /forecasting link with no badge for a paid user', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    const link = screen.getByRole('link', { name: /advanced forecasting/i })
    expect(link).toHaveAttribute('href', '/forecasting')
    expect(screen.queryByText('Premium')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /premium, locked/i })).not.toBeInTheDocument()
  })
})

/**
 * Section-navigation tiles (story 11-3, WCAG 1.4.1 "Use of Color").
 *
 * The "Manage Your Finances" grid used to render each destination as a solid
 * `bg-*-600` fill — with Expenses in danger-red, which reads as a destructive
 * action. These tests assert destinations are distinguished by a non-color cue
 * (an accessible label plus a decorative category icon) and that no tile relies
 * on a saturated full-color fill, so the information survives a grayscale view.
 */
describe('HomePage section navigation (story 11-3)', () => {
  const SECTIONS = [
    { label: 'Income', href: '/income' },
    { label: 'Expenses', href: '/expenses' },
    { label: 'Savings', href: '/savings' },
    { label: 'Balance', href: '/balance' },
    { label: 'Projections', href: '/net-worth-projection' },
  ] as const

  beforeEach(() => {
    // These tiles are tier-independent, but HomePage reads usePremiumAccess.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
  })

  it('AC-1/AC-4: every section is a labelled link pointing at its route', () => {
    render(<HomePage />)
    for (const { label, href } of SECTIONS) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
  })

  it('AC-1/AC-4: every tile carries a decorative icon so color is not the sole cue', () => {
    render(<HomePage />)
    for (const { label } of SECTIONS) {
      const tile = screen.getByRole('link', { name: label })
      // The label alone names the link; a decorative (aria-hidden) icon adds a
      // second, non-color differentiator.
      expect(tile.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('AC-1/AC-2: no tile uses a saturated full-color fill, and Expenses is not danger-red', () => {
    render(<HomePage />)
    for (const { label } of SECTIONS) {
      const tile = screen.getByRole('link', { name: label })
      expect(tile.className).not.toMatch(/bg-(red|green|purple|blue|indigo)-(600|700)/)
    }
    // Danger-red stays reserved for destructive controls (delete), never navigation.
    const expenses = screen.getByRole('link', { name: 'Expenses' })
    expect(expenses.className).not.toMatch(/red/)
  })

  it('AC-2/AC-3: the accent is carried by the icon; Expenses is amber and no tile icon is danger-red', () => {
    render(<HomePage />)
    // The neutral wrapper never carries an accent, so assert on the icon node
    // that actually does — otherwise an icon-accent regression to red would
    // slip past the wrapper-only checks above.
    for (const { label } of SECTIONS) {
      const icon = screen.getByRole('link', { name: label }).querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon?.getAttribute('class')).not.toMatch(/text-red-/)
    }
    // Expenses specifically swapped danger-red → amber (AC-2), applied as an icon accent (AC-3).
    const expensesIcon = screen.getByRole('link', { name: 'Expenses' }).querySelector('svg')
    expect(expensesIcon?.getAttribute('class')).toMatch(/text-amber-/)
  })
})
