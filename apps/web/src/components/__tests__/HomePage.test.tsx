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
