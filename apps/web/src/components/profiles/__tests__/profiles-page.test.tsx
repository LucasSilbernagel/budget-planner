/**
 * `ProfilesPage` gating tests — the component `/profiles` renders (Story 13-3,
 * AC-1/AC-2/AC-3). The route's own wiring is guarded by
 * `e2e/profiles-premium.spec.ts`; this suite covers the three tiers.
 *
 * Custom profiles is a Premium feature. The page must:
 *   - loading (SSR + first client paint) → neither the management UI nor the
 *     prompt (fail-closed);
 *   - non-active (free / lapsed / unauthenticated / errored) → a discoverable
 *     LOCKED upgrade surface (`PremiumPrompt` for "Custom Profiles"), and NONE of
 *     the create/switch management controls;
 *   - active → the full management UI, unchanged.
 *
 * `usePremiumAccess` is mocked to drive each tier; `PremiumPrompt` and the three
 * profile child components are stubbed to markers so the test stays focused on
 * the gating decision (mirrors PremiumFeatureGate.test.tsx).
 */

import type { PremiumAccessStatus } from '@/hooks/usePremiumAccess'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Every specifier below uses the `@/` alias — the SAME form `ProfilesPage`
// itself imports with. Two of them were relative while this suite lived in
// `routes/__tests__/`; a `vi.mock` only intercepts when its specifier resolves
// to the same module id the component under test imports, and from here the old
// relative paths resolve to nonexistent `components/hooks/...` files.
//
// ⚠️ Measured (story 39-1, Finding 2), because the failure mode is not the
// obvious one: vitest raises NO module error for a mock path that does not
// resolve. It simply fails to intercept. The real `usePremiumAccess` then runs,
// returns `isLoading: true`, and the suite goes 2 red / 1 GREEN — and the green
// one is the fail-closed test below, which passes for entirely the wrong reason
// (a permanently-loading gate satisfies it trivially). The danger is that
// vacuous pass, not the two loud failures.
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
vi.mock('@/components/profiles/switch-profile', () => ({
  SwitchProfileDropdown: () => <div data-testid="switch-profile" />,
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
