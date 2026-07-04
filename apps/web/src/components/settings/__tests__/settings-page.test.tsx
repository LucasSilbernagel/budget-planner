/**
 * SettingsPage tests (story 11-6).
 *
 * The consolidated home for the display preferences that used to be scattered
 * across page headers (currency) and the footer (theme). These assert the surface
 * actually hosts BOTH controls in one place, that the currency control's global
 * scope is spelled out (AC-2), and that exactly one theme toggle instance is
 * mounted (story 7-3 DECISION 2).
 *
 * `usePremiumAccess` is mocked to a paid tier so the ThemeToggle renders its live
 * `role="switch"`; the currency control uses the real store. Mirrors
 * settings/__tests__/theme-toggle.test.tsx.
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../auth/premium-prompt', () => ({
  PremiumPrompt: () => <div data-testid="premium-prompt" />,
}))

import { SettingsPage } from '../settings-page'

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
  mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
})

describe('SettingsPage', () => {
  it('renders a Settings heading and a Display section', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /^display$/i })).toBeInTheDocument()
  })

  it('consolidates the currency control here, with its global scope made explicit (AC-2)', () => {
    render(<SettingsPage />)
    // The relocated currency toggle (its accessible group name).
    expect(screen.getByRole('group', { name: /currency display/i })).toBeInTheDocument()
    // Scope is no longer ambiguous: copy states it applies app-wide.
    expect(screen.getByText(/applies everywhere amounts are shown/i)).toBeInTheDocument()
  })

  it('hosts exactly one theme toggle instance (7-3 DECISION 2), working for a paid user', () => {
    render(<SettingsPage />)
    const switches = screen.getAllByRole('switch')
    // Two switches total: the currency-symbols switch and the dark-mode switch.
    // Crucially only ONE dark-mode switch (a second would remount the gate Modal).
    const darkModeSwitches = switches.filter((el) =>
      /dark mode/i.test(el.getAttribute('aria-label') ?? el.textContent ?? '')
    )
    expect(darkModeSwitches).toHaveLength(1)
  })
})
