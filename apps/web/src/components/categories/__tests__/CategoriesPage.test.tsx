/**
 * CategoriesPage tests (story 30.4b, AC-4).
 *
 * The route-level gate, following `ReportPage.test.tsx` exactly. This is the
 * boundary that matters: the `/settings` entry point is presentation, but a user
 * can navigate straight to `/categories`, and this must refuse them
 * independently — the `/profiles` precedent (story 13-3).
 *
 * The manager body is stubbed so these assertions are about GATING only; its own
 * suite covers the behaviour.
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../auth/premium-prompt', () => ({
  PremiumPrompt: ({ featureName }: { featureName: string }) => (
    <div data-testid="premium-prompt">{featureName}</div>
  ),
}))

vi.mock('../CategoryManager', () => ({
  CategoryManager: () => <div data-testid="category-manager" />,
}))

// ⚠️ Stubbed for the SAME reason as the manager, and it matters more here: the
// real breakdown mounts Recharts plus four unstubbed zustand stores, and this
// suite renders with bare RTL `render` (no providers) on purpose. Without the
// stub this file would quietly stop being a gate test.
vi.mock('../CategoryBreakdown', () => ({
  CategoryBreakdown: () => <div data-testid="category-breakdown" />,
}))

import { CategoriesPage } from '../CategoriesPage'

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

describe('CategoriesPage', () => {
  it('renders the manager for an active subscriber', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<CategoriesPage />)
    expect(screen.getByTestId('category-manager')).toBeInTheDocument()
    expect(screen.getByTestId('category-breakdown')).toBeInTheDocument()
    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
  })

  it('renders the manager for a lifetime licence holder', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'lifetime', isAuthenticated: true })
    render(<CategoriesPage />)
    expect(screen.getByTestId('category-manager')).toBeInTheDocument()
    expect(screen.getByTestId('category-breakdown')).toBeInTheDocument()
  })

  it.each([
    ['free' as const, false],
    ['past_due' as const, true],
    ['canceled' as const, true],
    [null, false],
  ])('shows the upgrade surface instead of the manager for %s', (subscriptionStatus, isAuth) => {
    mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated: isAuth })
    render(<CategoriesPage />)

    expect(screen.getByTestId('premium-prompt')).toHaveTextContent('Custom Categories')
    expect(screen.queryByTestId('category-manager')).not.toBeInTheDocument()
    // ⚠️ Inheriting a gate is not evidence the gate covers you. The breakdown
    // is a NEW sibling of the manager, so it needs its own absence assertion in
    // every non-entitled branch (story 30.5, AC-5).
    expect(screen.queryByTestId('category-breakdown')).not.toBeInTheDocument()
  })

  it('treats an ERRORED tier check as not premium (fail-closed)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'check failed' })
    render(<CategoriesPage />)
    expect(screen.getByTestId('premium-prompt')).toBeInTheDocument()
    expect(screen.queryByTestId('category-manager')).not.toBeInTheDocument()
    expect(screen.queryByTestId('category-breakdown')).not.toBeInTheDocument()
  })

  it('never renders the manager while the tier is still unknown', () => {
    // SSR + first client paint. A spinner here rather than content is what stops
    // a not-yet-verified visitor from seeing paid output for a frame.
    mockStatus({ isLoading: true })
    render(<CategoriesPage />)

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByTestId('category-manager')).not.toBeInTheDocument()
    // Fail-closed: a not-yet-verified tier must not leak paid output either.
    expect(screen.queryByTestId('category-breakdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
  })
})
