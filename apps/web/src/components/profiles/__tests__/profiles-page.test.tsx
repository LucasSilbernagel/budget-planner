import type { PremiumAccessStatus } from '@/hooks/usePremiumAccess'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock only intercepts when its specifier resolves to the same module id as the
// component's import; a non-resolving path fails silently.
const usePremiumAccess = vi.fn()
vi.mock('@/hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

const premiumPromptProps = vi.fn()
vi.mock('@/components/auth/premium-prompt', () => ({
  PremiumPrompt: (props: Record<string, unknown>) => {
    premiumPromptProps(props)
    return <div data-testid="premium-prompt" />
  },
}))
vi.mock('@/components/profiles/create-profile', () => ({
  CreateProfileDialog: () => <div data-testid="create-profile" />,
}))
vi.mock('@/components/profiles/profile-list', () => ({
  ProfileList: () => <div data-testid="profile-list" />,
}))

import { ProfilesPage } from '../profiles-page'

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

describe('ProfilesPage gating', () => {
  it('shows the locked upgrade surface (Custom Profiles) and NO management UI for a free user — AC-1/AC-2', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<ProfilesPage />)

    expect(screen.getByTestId('premium-prompt')).toBeInTheDocument()
    expect(premiumPromptProps).toHaveBeenCalledWith(
      expect.objectContaining({ featureName: 'Custom Profiles' })
    )
    expect(screen.queryByTestId('profile-list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new profile/i })).not.toBeInTheDocument()
  })

  it('renders the full management UI and NO prompt for an active premium user — AC-3', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<ProfilesPage />)

    expect(screen.getByTestId('profile-list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new profile/i })).toBeInTheDocument()
    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
  })

  it('shows neither the management UI nor the prompt while the tier is loading — AC-2 fail-closed', () => {
    mockStatus({ isLoading: true })
    render(<ProfilesPage />)

    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
    expect(screen.queryByTestId('profile-list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new profile/i })).not.toBeInTheDocument()
  })
})

describe('ProfilesPage header (story 63.1)', () => {
  it('carries no switcher dropdown beside "+ New Profile"', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<ProfilesPage />)

    const newProfile = screen.getByRole('button', { name: '+ New Profile' })
    const heading = screen.getByRole('heading', { level: 1, name: 'Profiles' })
    let header: HTMLElement | null = newProfile.parentElement
    while (header && !header.contains(heading)) header = header.parentElement
    expect(header, 'the header row holding the heading and the action').not.toBeNull()
    expect(header).not.toContainElement(screen.getByTestId('profile-list'))

    expect(header?.querySelectorAll('[aria-haspopup]')).toHaveLength(0)
    expect(screen.queryByText('Switch Profile', { exact: true })).toBeNull()
  })
})

describe('ProfilesPage landmarks (story 116.1)', () => {
  it.each([
    ['loading', { isLoading: true }],
    ['locked', { hasAccess: false, subscriptionStatus: 'free' as const }],
    ['active', { hasAccess: true, subscriptionStatus: 'active' as const, isAuthenticated: true }],
  ])('the %s state is exactly one <main>', (_state, overrides) => {
    mockStatus(overrides)
    render(<ProfilesPage />)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})

describe('ProfilesPage loading → resolved (story 117.2)', () => {
  it.each([
    ['the locked prompt', { hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true }],
    ['the paid page', { hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true }],
  ] as const)('replaces the loading nodes with %s', (_resolved, status) => {
    mockStatus({ isLoading: true })
    const { container, rerender } = render(<ProfilesPage />)
    const spinner = screen.getByRole('status', { name: 'Loading' })
    const shell = container.firstElementChild
    expect(shell, 'anti-vacuity: the loading shell rendered').not.toBeNull()

    mockStatus(status)
    rerender(<ProfilesPage />)

    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
    expect(spinner.isConnected, 'the spinner node was reused').toBe(false)
    expect(shell?.isConnected, 'the loading shell was reused').toBe(false)
  })
})
