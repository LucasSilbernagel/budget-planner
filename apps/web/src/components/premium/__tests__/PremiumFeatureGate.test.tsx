/**
 * PremiumFeatureGate tests (story 7-2, FR24).
 *
 * The gate's tier decision is the heart of the story:
 *   - loading (SSR + first client paint) → neutral skeleton, never children.
 *   - paid (hasAccess) → the unlocked children, no lock badge.
 *   - free / lapsed / unauthenticated / errored → locked button + badge, and
 *     activating it opens the upgrade prompt (CTA → /pricing).
 *
 * `usePremiumAccess` is mocked to drive each tier; `PremiumPrompt` is stubbed to
 * a marker so this test stays focused on the gating logic (and needs no router
 * context for the prompt's <Link>). Mirrors the style of AdPlacement.test.tsx.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

const premiumPromptProps = vi.fn()

vi.mock('../../auth/premium-prompt', () => ({
  PremiumPrompt: (props: Record<string, unknown>) => {
    premiumPromptProps(props)
    return <div data-testid="premium-prompt" />
  },
}))

import { PremiumFeatureGate } from '../PremiumFeatureGate'

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

function renderGate(props?: { upgradeHref?: string }) {
  return render(
    <PremiumFeatureGate
      featureName="Advanced Forecasting"
      locked={<span>Advanced Forecasting</span>}
      upgradeHref={props?.upgradeHref}
    >
      <a href="/forecasting" data-testid="unlocked-link">
        Advanced Forecasting
      </a>
    </PremiumFeatureGate>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PremiumFeatureGate', () => {
  it('renders a neutral skeleton while the tier is loading (no children, no lock)', () => {
    mockStatus({ isLoading: true })
    renderGate()

    expect(screen.getByTestId('premium-gate-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('unlocked-link')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
  })

  it('AC-3: renders the unlocked children with no lock badge for a paid user', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    renderGate()

    expect(screen.getByTestId('unlocked-link')).toBeInTheDocument()
    expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
    expect(screen.queryByText('Premium')).not.toBeInTheDocument()
  })

  it('AC-1: renders the locked presentation with a badge for a free user', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderGate()

    const locked = screen.getByRole('button', { name: /advanced forecasting — premium, locked/i })
    expect(locked).toBeInTheDocument()
    expect(screen.getByText('Premium')).toBeInTheDocument()
    expect(screen.queryByTestId('unlocked-link')).not.toBeInTheDocument()
  })

  it('AC-1: fails closed — renders locked when the tier check errored', () => {
    mockStatus({ hasAccess: false, error: 'check failed', subscriptionStatus: null })
    renderGate()

    expect(screen.getByTestId('premium-gate-locked')).toBeInTheDocument()
    expect(screen.queryByTestId('unlocked-link')).not.toBeInTheDocument()
  })

  it('renders locked for an unauthenticated user', () => {
    mockStatus({ hasAccess: false, isAuthenticated: false, subscriptionStatus: null })
    renderGate()
    expect(screen.getByTestId('premium-gate-locked')).toBeInTheDocument()
  })

  it('AC-2: activating the locked feature opens the upgrade prompt (CTA → /pricing)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderGate()

    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /premium, locked/i }))

    expect(screen.getByTestId('premium-prompt')).toBeInTheDocument()
    expect(premiumPromptProps).toHaveBeenCalledWith(
      expect.objectContaining({
        asDialog: true,
        featureName: 'Advanced Forecasting',
        upgradeHref: '/pricing',
      })
    )
  })

  it('forwards a custom upgradeHref to the prompt', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderGate({ upgradeHref: '/login' })

    fireEvent.click(screen.getByRole('button', { name: /premium, locked/i }))
    expect(premiumPromptProps).toHaveBeenCalledWith(
      expect.objectContaining({ upgradeHref: '/login' })
    )
  })
})
