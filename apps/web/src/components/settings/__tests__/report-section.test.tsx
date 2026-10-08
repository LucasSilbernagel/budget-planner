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

import { ReportSection } from '../report-section'

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

describe('ReportSection', () => {
  it('names the section and explains that nothing is transmitted', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<ReportSection />)

    expect(
      screen.getByRole('heading', { level: 2, name: /^financial summary$/i })
    ).toHaveTextContent(/^Financial Summary$/)
    expect(screen.getByText(/nothing is sent anywhere to produce it/i)).toBeInTheDocument()
  })

  it('links an active Premium user straight to the report', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<ReportSection />)

    const link = screen.getByRole('link', { name: /financial summary report/i })
    expect(link).toHaveAttribute('href', '/financial-summary')
    expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
  })

  it('grants a lifetime licence holder the same access as an active subscriber', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'lifetime', isAuthenticated: true })
    render(<ReportSection />)
    expect(screen.getByRole('link', { name: /financial summary report/i })).toHaveAttribute(
      'href',
      '/financial-summary'
    )
  })

  it('shows a free visitor the feature as discoverable-but-locked, with no link', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    render(<ReportSection />)

    expect(
      screen.getByRole('button', { name: lockedName('Financial summary report') })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /financial summary report/i })
    ).not.toBeInTheDocument()
    expect(screen.getByText(/a printable summary of your budget/i)).toBeInTheDocument()
  })

  it.each([['past_due' as const], ['canceled' as const]])(
    'locks a lapsed %s subscription',
    (subscriptionStatus) => {
      mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated: true })
      render(<ReportSection />)
      expect(screen.getByTestId('premium-gate-locked')).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: /financial summary report/i })
      ).not.toBeInTheDocument()
    }
  )

  it('treats an ERRORED tier check as not premium (fail-closed)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'network down' })
    render(<ReportSection />)
    expect(screen.getByTestId('premium-gate-locked')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /financial summary report/i })
    ).not.toBeInTheDocument()
  })

  it('shows neither the link nor the lock while the tier is still unknown', () => {
    mockStatus({ isLoading: true })
    render(<ReportSection />)

    expect(screen.getByTestId('premium-gate-skeleton')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /financial summary report/i })
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
  })

  it('renders the gate inside its own wrapper so the locked dialog is not a spaced sibling', () => {
    // Modal has no portal, so without a wrapper the locked gate's overlay picks up the
    // parent stack's gap and leaves an undimmed strip.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free' })
    const { container } = render(<ReportSection />)

    const locked = screen.getByTestId('premium-gate-locked')
    const wrapper = locked.parentElement as HTMLElement
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.closest('section')).toBe(container.querySelector('section'))
  })
})
