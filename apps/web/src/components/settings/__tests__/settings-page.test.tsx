/**
 * SettingsPage tests (story 11-6).
 *
 * The consolidated home for the display preferences that used to be scattered
 * across page headers (currency) and the footer (theme). These assert the surface
 * actually hosts BOTH controls in one place, that the currency control's global
 * scope is spelled out (AC-2), and that exactly one theme toggle instance is
 * mounted (story 7-3 DECISION 2).
 *
 * Dark mode is free for every user (story 25-3), so the default tier here is a
 * free/unauthenticated visitor and the ThemeToggle still renders its live
 * `role="switch"`. The `usePremiumAccess` mock is retained only to keep any
 * incidental consumer deterministic; the currency control uses the real store.
 */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../auth/premium-prompt', () => ({
  PremiumPrompt: () => <div data-testid="premium-prompt" />,
}))

// AccountSection is a separate unit (10-5) with its own session fetch + router
// deps and its own test. Stub it here so this suite stays focused on the page's
// composition and does not warn about `useRouter` outside a RouterProvider.
vi.mock('../account-section', () => ({
  AccountSection: () => <div data-testid="account-section" />,
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

// Both AccountSection (10-5) and LocalDataSection (17-2) resolve the session via
// `fetch('/api/auth/me')` on mount. Stub it to a no-session response so the mounted
// SettingsPage neither hits the MSW "unhandled request" path nor makes a real call.
const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes('/api/auth/me')) {
      return Promise.resolve(new Response(JSON.stringify({ user: null }), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof global.fetch
  mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
})
afterEach(() => {
  global.fetch = originalFetch
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

  it('hosts exactly one theme toggle instance (7-3 DECISION 2), live for a free user (25-3)', () => {
    render(<SettingsPage />)
    const switches = screen.getAllByRole('switch')
    // Two switches total: the currency-symbols switch and the dark-mode switch.
    // Dark mode is free (25-3), so the switch is live for this free/unauthenticated
    // user; exactly ONE dark-mode switch must be mounted.
    const darkModeSwitches = switches.filter((el) =>
      /dark mode/i.test(el.getAttribute('aria-label') ?? el.textContent ?? '')
    )
    expect(darkModeSwitches).toHaveLength(1)
  })

  // Story 17-2: the "Clear local data" control is for EVERY user, unlike the
  // auth-gated Premium "Delete account" control.
  it('surfaces the all-users "Clear local data" control, even for a free/unauthenticated user (17-2 AC-1)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
    render(<SettingsPage />)
    expect(screen.getByRole('button', { name: /clear local data/i })).toBeInTheDocument()
  })

  // Story 30-3: the financial summary report is reached from here. Unlike
  // "Clear local data" it is Premium, so it is surfaced-but-locked for a free
  // visitor rather than hidden — the gate's own suite covers every tier state;
  // these two assert only that the section is composed into this page.
  it('hosts the Premium financial summary section, locked for a free user (30-3)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
    render(<SettingsPage />)

    expect(
      screen.getByRole('heading', { level: 2, name: /^financial summary$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Financial Summary Report — premium, locked' })
    ).toBeInTheDocument()
  })

  it('links an active Premium user from Settings to the report (30-3)', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<SettingsPage />)
    expect(screen.getByRole('link', { name: /financial summary report/i })).toHaveAttribute(
      'href',
      '/report'
    )
  })

  // Story 30.4b: category management is reached from here too. Same shape as the
  // report section above — the gate's own suite covers every tier state; these
  // two assert only that the section is composed into this page.
  it('hosts the Premium categories section, locked for a free user (30.4b)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
    render(<SettingsPage />)

    expect(screen.getByRole('heading', { level: 2, name: /^categories$/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Custom Categories — premium, locked' })
    ).toBeInTheDocument()
  })

  it('links an active Premium user from Settings to category management (30.4b)', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<SettingsPage />)
    expect(screen.getByRole('link', { name: /custom categories/i })).toHaveAttribute(
      'href',
      '/categories'
    )
  })
})
