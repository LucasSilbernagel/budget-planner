/**
 * ThemeProvider tests (story 7-3, FR23).
 *
 * ThemeProvider renders nothing; its whole job is side effects on the document
 * and the theme store. These tests cover its two responsibilities:
 *   1. reflecting the theme onto `<html class="dark">` (live, on store change);
 *   2. the fail-safe-to-light correction (DECISION 3 / AC-3): once the tier
 *      resolves to NOT premium it forces light and clears a stale persisted dark,
 *      while leaving a paid (or still-loading) user's dark preference intact.
 *
 * `usePremiumAccess` is mocked to drive the tier.
 */

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { useThemeStore } from '../../../stores/themeStore'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { ThemeProvider } from '../ThemeProvider'

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
  localStorage.clear()
  useThemeStore.setState({ theme: 'light' })
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('ThemeProvider', () => {
  it('reflects theme changes onto <html> while the tier is loading', () => {
    // isLoading → the DECISION 3 correction is inert, isolating the class sync.
    mockStatus({ isLoading: true })
    render(<ThemeProvider />)

    // Starts light: no dark class.
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => {
      useThemeStore.getState().setTheme('dark')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => {
      useThemeStore.getState().setTheme('light')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('keeps a paid user in dark mode (no correction)', () => {
    localStorage.setItem(
      'budget-planner-theme-prefs-v1',
      JSON.stringify({ state: { theme: 'dark' }, version: 0 })
    )
    useThemeStore.setState({ theme: 'dark' })
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })

    render(<ThemeProvider />)

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('forces light + clears the persisted dark once the tier resolves to not-premium (AC-3)', () => {
    localStorage.setItem(
      'budget-planner-theme-prefs-v1',
      JSON.stringify({ state: { theme: 'dark' }, version: 0 })
    )
    useThemeStore.setState({ theme: 'dark' })
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

    render(<ThemeProvider />)

    // Corrected to light and the class stripped.
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    // The persisted preference is now light (stale dark cleared).
    const parsed = JSON.parse(localStorage.getItem('budget-planner-theme-prefs-v1') as string)
    expect(parsed.state.theme).toBe('light')
  })

  it('preserves a persisted dark preference when the tier check fails (transient error, not authoritative)', () => {
    // A genuinely-paid user whose premium check fails (offline PWA / network /
    // 500) surfaces as hasAccess:false WITH an error. We must NOT persist light
    // over their stored dark — that would be a permanent silent downgrade.
    localStorage.setItem(
      'budget-planner-theme-prefs-v1',
      JSON.stringify({ state: { theme: 'dark' }, version: 0 })
    )
    useThemeStore.setState({ theme: 'dark' })
    mockStatus({ hasAccess: false, error: 'Failed to check premium access' })

    render(<ThemeProvider />)

    // No correction: the store and the persisted preference stay dark.
    expect(useThemeStore.getState().theme).toBe('dark')
    const parsed = JSON.parse(localStorage.getItem('budget-planner-theme-prefs-v1') as string)
    expect(parsed.state.theme).toBe('dark')
  })
})
