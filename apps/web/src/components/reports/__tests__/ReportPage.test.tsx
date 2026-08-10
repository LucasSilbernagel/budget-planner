/**
 * ReportPage tests (story 30-3, FR53).
 *
 * The route-level gate. This is the boundary that matters: the `/settings`
 * entry point is presentation, but a user can navigate straight to `/report`,
 * and this must refuse them independently — following the `/profiles` precedent
 * (story 13-3).
 *
 * The report body is stubbed so these assertions are about GATING only; its own
 * suite covers the content.
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

vi.mock('../FinancialSummaryReport', () => ({
  FinancialSummaryReport: () => <div data-testid="financial-summary-report" />,
}))

import { ReportPage } from '../ReportPage'

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

describe('ReportPage', () => {
  it('renders the report for an active subscriber', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<ReportPage />)
    expect(screen.getByTestId('financial-summary-report')).toBeInTheDocument()
    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
  })

  it('renders the report for a lifetime licence holder', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'lifetime', isAuthenticated: true })
    render(<ReportPage />)
    expect(screen.getByTestId('financial-summary-report')).toBeInTheDocument()
  })

  it.each([
    ['free' as const, false],
    ['past_due' as const, true],
    ['canceled' as const, true],
    [null, false],
  ])('shows the upgrade surface instead of the report for %s', (subscriptionStatus, isAuth) => {
    mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated: isAuth })
    render(<ReportPage />)

    expect(screen.getByTestId('premium-prompt')).toHaveTextContent('Financial Summary Report')
    expect(screen.queryByTestId('financial-summary-report')).not.toBeInTheDocument()
  })

  it('treats an ERRORED tier check as not premium (fail-closed)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'check failed' })
    render(<ReportPage />)
    expect(screen.getByTestId('premium-prompt')).toBeInTheDocument()
    expect(screen.queryByTestId('financial-summary-report')).not.toBeInTheDocument()
  })

  it('never renders the report while the tier is still unknown', () => {
    // SSR + first client paint. A skeleton here rather than content is what stops
    // a not-yet-verified visitor from seeing paid output for a frame.
    mockStatus({ isLoading: true })
    render(<ReportPage />)

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByTestId('financial-summary-report')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
  })
})
