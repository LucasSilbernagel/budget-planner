/**
 * ThemeToggle tests (story 7-3, FR23).
 *
 * The toggle is a thin consumer of story 7-2's PremiumFeatureGate (AC-4), so
 * these tests assert the gated behavior end to end:
 *   - loading → the gate's neutral skeleton, never a live switch (fail-closed).
 *   - paid → a working `role="switch"` that flips the theme store.
 *   - free → a locked, discoverable affordance + Premium badge whose activation
 *     opens the upgrade prompt with the `/pricing` CTA.
 *
 * `usePremiumAccess` is mocked to drive each tier and `PremiumPrompt` is stubbed
 * to a marker (no router needed), mirroring PremiumFeatureGate.test.tsx.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { useThemeStore } from '../../../stores/themeStore'

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

import { ThemeToggle } from '../theme-toggle'

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
  useThemeStore.setState({ theme: 'light' })
})

describe('ThemeToggle', () => {
  it('renders the gate skeleton while the tier is loading (no live switch)', () => {
    mockStatus({ isLoading: true })
    render(<ThemeToggle />)

    expect(screen.getByTestId('premium-gate-skeleton')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
  })

  it('paid: renders a working switch that toggles the theme store', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<ThemeToggle />)

    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Premium')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    expect(useThemeStore.getState().theme).toBe('light')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('free: renders a locked affordance with a Premium badge (no live switch)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: /dark mode — premium, locked/i })).toBeInTheDocument()
    expect(screen.getByText('Premium')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('free: activating the locked toggle opens the upgrade prompt (CTA → /pricing)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<ThemeToggle />)

    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /dark mode — premium, locked/i }))

    expect(screen.getByTestId('premium-prompt')).toBeInTheDocument()
    expect(premiumPromptProps).toHaveBeenCalledWith(
      expect.objectContaining({
        asDialog: true,
        featureName: 'Dark mode',
        upgradeHref: '/pricing',
      })
    )
    // A free user's locked toggle never mutates the theme.
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('fails closed: renders locked when the tier check errored', () => {
    mockStatus({ hasAccess: false, error: 'check failed', subscriptionStatus: null })
    render(<ThemeToggle />)

    expect(screen.getByTestId('premium-gate-locked')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
