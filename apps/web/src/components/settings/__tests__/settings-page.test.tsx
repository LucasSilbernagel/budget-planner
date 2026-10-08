import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SessionSeed, SessionSeedProvider } from '../../../context/session-seed'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { expectLockedRowsNamedByVisibleText, lockedName } from '../../../test/locked-name'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../auth/premium-prompt', () => ({
  PremiumPrompt: () => <div data-testid="premium-prompt" />,
}))

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

  it('names both locked premium rows by their visible title and description (story 116.2)', () => {
    const { container } = render(<SettingsPage />)
    expect(expectLockedRowsNamedByVisibleText(container)).toHaveLength(2)
  })

  it('is exactly one <main> landmark (story 116.1, FR184)', () => {
    render(<SettingsPage />)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('consolidates the currency control here, with its global scope made explicit (AC-2)', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('group', { name: /currency display/i })).toBeInTheDocument()
    expect(screen.getByText(/applies everywhere amounts are shown/i)).toBeInTheDocument()
  })

  it('describes the Retirement switch as covering the expense-form question too (71.1, FR113)', () => {
    render(<SettingsPage />)
    const toggle = screen.getByRole('switch', { name: /show retirement planner/i })
    const description = document.getElementById(toggle.getAttribute('aria-describedby') ?? '')
    const text = (description?.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(text).toContain('along with the retirement question on the expense form')
    expect(text).toContain('any expenses you marked are kept')
    expect(text).not.toMatch(/from your navigation\./)
  })

  it('hosts NO dark-mode toggle — the theme follows the device (61.1, FR93)', () => {
    render(<SettingsPage />)

    // Does not catch a dark-mode control renamed to "Theme" or "Appearance".
    const switches = screen.getAllByRole('switch')

    const darkModeSwitches = switches.filter((el) =>
      /dark mode/i.test(el.getAttribute('aria-label') ?? el.textContent ?? '')
    )
    expect(darkModeSwitches).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /dark mode/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /dark mode/i })).toBeNull()
  })

  it('surfaces the all-users "Clear local data" control, even for a free/unauthenticated user (17-2 AC-1)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
    render(<SettingsPage />)
    expect(screen.getByRole('button', { name: /clear local data/i })).toBeInTheDocument()
  })

  it('hosts the Premium financial summary section, locked for a free user (30-3)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
    render(<SettingsPage />)

    expect(
      screen.getByRole('heading', { level: 2, name: /^financial summary$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: lockedName('Financial summary report') })
    ).toBeInTheDocument()
  })

  it('links an active Premium user from Settings to the report (30-3)', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<SettingsPage />)
    expect(screen.getByRole('link', { name: /financial summary report/i })).toHaveAttribute(
      'href',
      '/financial-summary'
    )
  })

  it('hosts the Premium categories section, locked for a free user (30.4b)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
    render(<SettingsPage />)

    expect(screen.getByRole('heading', { level: 2, name: /^categories$/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: lockedName('Custom categories') })
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /custom categories/i })).toBeNull()
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

// Tier here is the session seed, not the usePremiumAccess mock.
describe('58.2: the premium Settings sections are tier-conditional (D2)', () => {
  function paidSeed(overrides: Partial<SessionSeed> = {}): SessionSeed {
    return {
      isAuthenticated: true,
      userId: 'u1',
      email: 'u1@example.test',
      subscriptionStatus: 'active',
      ...overrides,
    }
  }

  function renderWithSeed(seed: SessionSeed | null) {
    return render(
      <SessionSeedProvider seed={seed}>
        <SettingsPage />
      </SessionSeedProvider>
    )
  }

  function expectPageRendered(): void {
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /^display$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear local data/i })).toBeInTheDocument()
    expect(screen.getByTestId('account-section')).toBeInTheDocument()
  }

  it.each(['active', 'lifetime'] as const)(
    'renders neither premium section for a %s session',
    (subscriptionStatus) => {
      mockStatus({ hasAccess: true, subscriptionStatus, isAuthenticated: true })
      renderWithSeed(paidSeed({ subscriptionStatus }))

      expectPageRendered()

      expect(screen.queryByRole('heading', { level: 2, name: /^financial summary$/i })).toBeNull()
      expect(screen.queryByRole('heading', { level: 2, name: /^categories$/i })).toBeNull()
      expect(screen.queryByRole('link', { name: /financial summary report/i })).toBeNull()
      expect(screen.queryByRole('link', { name: /custom categories/i })).toBeNull()
      expect(screen.queryByText(/a printable summary of your budget/i)).toBeNull()
      expect(screen.queryByText(/your own income and expense groupings/i)).toBeNull()
    }
  )

  it('takes the report privacy sentence with it — NOT re-homed to /financial-summary (AC-5)', () => {
    // Don't move the privacy sentence onto /financial-summary: the report omits it
    // deliberately and a test pins its absence.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    renderWithSeed(paidSeed())

    expectPageRendered()
    expect(screen.queryByText(/nothing is sent anywhere to produce it/i)).toBeNull()
  })

  it.each([
    ['a null seed (resolver could not verify)', null, { isAuthenticated: false }],
    [
      'an unauthenticated seed',
      { isAuthenticated: false, userId: null, email: null, subscriptionStatus: null },
      { isAuthenticated: false },
    ],
    ['a free session', { subscriptionStatus: 'free' as const }, { isAuthenticated: true }],
    ['a past_due session', { subscriptionStatus: 'past_due' as const }, { isAuthenticated: true }],
    ['a canceled session', { subscriptionStatus: 'canceled' as const }, { isAuthenticated: true }],
  ])('renders both premium sections, unchanged, for %s (AC-6)', (_label, overrides, tier) => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', ...tier })
    renderWithSeed(overrides === null ? null : paidSeed(overrides as Partial<SessionSeed>))

    expectPageRendered()
    expect(
      screen.getByRole('heading', { level: 2, name: /^financial summary$/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /^categories$/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: lockedName('Financial summary report') })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: lockedName('Custom categories') })
    ).toBeInTheDocument()
    expect(screen.getByText(/nothing is sent anywhere to produce it/i)).toBeInTheDocument()
  })

  it('⚠️ FAILS OPEN on a null seed — the OPPOSITE of the nav, deliberately', () => {
    // Fails open: failing closed on an unverified seed could strand a paid user with
    // no route to these pages.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    renderWithSeed(null)

    expectPageRendered()
    expect(
      screen.getByRole('heading', { level: 2, name: /^financial summary$/i }),
      'a null seed must FAIL OPEN and still show the section'
    ).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /financial summary report/i })).toHaveAttribute(
      'href',
      '/financial-summary'
    )
    expect(screen.getByRole('link', { name: /custom categories/i })).toHaveAttribute(
      'href',
      '/categories'
    )
  })
})
