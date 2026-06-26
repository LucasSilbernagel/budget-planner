/**
 * AdPlacement gating tests (story 4-11, AC-1 + AC-2 / FR20).
 *
 * The visibility decision is the heart of the story:
 *   - AC-1: unauthenticated / free users SEE ads.
 *   - AC-2: authenticated paid (active) users do NOT see ads.
 *   - Lapsed (past_due/canceled) users see ads; in-flight checks show nothing.
 *
 * `usePremiumAccess` is mocked to drive each tier; the EthicalAds child is
 * stubbed to a marker so this test stays focused on the gating logic.
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../EthicalAds', () => ({
  EthicalAds: () => <div data-testid="ethical-ads" />,
}))

import { AdPlacement } from '../AdPlacement'

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

describe('AdPlacement', () => {
  it('AC-1: shows ads to an unauthenticated user', () => {
    mockStatus({ isAuthenticated: false, hasAccess: false, subscriptionStatus: null })
    render(<AdPlacement />)
    // The landmark itself is owned by EthicalAds (so it never renders empty);
    // here we only assert the gate renders the ad surface for this tier.
    expect(screen.getByTestId('ethical-ads')).toBeInTheDocument()
  })

  it('AC-1: shows ads to an authenticated free-tier user', () => {
    mockStatus({ isAuthenticated: true, hasAccess: false, subscriptionStatus: 'free' })
    render(<AdPlacement />)
    expect(screen.getByTestId('ethical-ads')).toBeInTheDocument()
  })

  it('AC-2: hides ads from an authenticated paid (active) user', () => {
    mockStatus({ isAuthenticated: true, hasAccess: true, subscriptionStatus: 'active' })
    const { container } = render(<AdPlacement />)

    expect(screen.queryByTestId('ethical-ads')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows ads to a lapsed (past_due) subscriber', () => {
    mockStatus({ isAuthenticated: true, hasAccess: false, subscriptionStatus: 'past_due' })
    render(<AdPlacement />)
    expect(screen.getByTestId('ethical-ads')).toBeInTheDocument()
  })

  it('renders nothing while the access check is in flight (no ad flash)', () => {
    mockStatus({ isLoading: true })
    const { container } = render(<AdPlacement />)
    expect(screen.queryByTestId('ethical-ads')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('AC-2: fails closed — shows nothing when the premium check errored', () => {
    // A verification failure must NOT leak ads to a (possibly paying) user.
    mockStatus({ hasAccess: false, error: 'check failed', subscriptionStatus: null })
    const { container } = render(<AdPlacement />)
    expect(screen.queryByTestId('ethical-ads')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })
})
