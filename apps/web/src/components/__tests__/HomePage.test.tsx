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

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useIncomeStore } from '../../stores'

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

/**
 * Financial Overview copy (story 11-4, "Match between the system and the real
 * world"). The stat cards used to surface internal normalization vocabulary
 * ("(Monthly Normalized)", a bare "Raw: …" sub-line). These tests assert the
 * plain-language labels and that the monthly-conversion explanation is available
 * progressively via an info affordance rather than a jargon-y sub-line.
 */
describe('HomePage financial overview copy (story 11-4)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  it('AC-1: stat cards read "(per month)" in plain language with no "Normalized"/"Raw" jargon', () => {
    render(<HomePage />)
    expect(screen.getByText('Total Income (per month)')).toBeInTheDocument()
    expect(screen.getByText('Total Expenses (per month)')).toBeInTheDocument()
    expect(screen.queryByText(/Normalized/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Raw:/)).not.toBeInTheDocument()
  })

  it('AC-2: a normalized non-monthly amount drops the "Raw:" line and reveals the conversion (with the raw total) progressively on focus', async () => {
    // A weekly amount normalizes to ~4.33× its entry, so the monthly figure
    // differs from what was entered and the info affordance renders.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'test-weekly',
          userId: 0,
          name: 'Weekly gig',
          amount: 10000,
          frequency: 'weekly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
    render(<HomePage />)

    // No bare engineering sub-line.
    expect(screen.queryByText(/^Raw:/)).not.toBeInTheDocument()

    // Progressive disclosure: the explanation is not present until the trigger is
    // focused/hovered — no tooltip and no association at rest.
    const trigger = screen.getByRole('button', {
      name: /more information about the monthly income figure/i,
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(trigger).not.toHaveAttribute('aria-describedby')

    // On focus, the tooltip appears, is associated for assistive tech, explains the
    // conversion, and surfaces the raw entered total.
    fireEvent.focus(trigger)
    const tooltip = await screen.findByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-describedby')
    expect(tooltip).toHaveTextContent(
      /convert weekly and annual amounts to a monthly figure so totals are comparable/i
    )
    expect(tooltip).toHaveTextContent(/entered total before conversion/i)
  })
})
