/**
 * `ProfilesPage` gating tests — the component `/profiles` renders (Story 13-3,
 * AC-1/AC-2/AC-3). The route's own wiring, with the REAL hook, is guarded by
 * `profiles-page.locked-route.test.tsx` (moved from e2e by story 82.3); this
 * suite covers the three tiers.
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
// ⚠️ No `switch-profile` mock since story 63.1 (FR96): that component is deleted
// and the profile CARDS are the switcher. A `vi.mock` of a module that no longer
// exists is not reliably loud, so it is removed rather than left sitting.

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

/**
 * The header carries no switcher dropdown (was
 * `e2e/profiles-card-switcher.paid.spec.ts:141`, story 63.1 FR96; moved by story
 * 84.5). The profile CARDS are the switcher; the deleted dropdown's trigger had
 * `aria-haspopup` and its menu read "Switch Profile".
 *
 * ⚠️ Scoped to the header, located by its content and positively controlled, as
 * the e2e original was: a page-wide `[aria-haspopup]` count would pin an
 * unrelated global invariant, and a locator matching nothing would pass for the
 * wrong reason.
 */
describe('ProfilesPage header (story 63.1)', () => {
  it('carries no switcher dropdown beside "+ New Profile"', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<ProfilesPage />)

    const newProfile = screen.getByRole('button', { name: '+ New Profile' })
    const heading = screen.getByRole('heading', { level: 1, name: 'Profiles' })
    // The header row is the nearest element holding BOTH.
    let header: HTMLElement | null = newProfile.parentElement
    while (header && !header.contains(heading)) header = header.parentElement
    expect(header, 'the header row holding the heading and the action').not.toBeNull()
    // …and it IS the header, not a page-wide ancestor (84.5 code review): it
    // must not reach the profile list below it.
    expect(header).not.toContainElement(screen.getByTestId('profile-list'))

    expect(header?.querySelectorAll('[aria-haspopup]')).toHaveLength(0)
    expect(screen.queryByText('Switch Profile', { exact: true })).toBeNull()
  })
})

// Story 116.1 (FR184, A4): every state of `/profiles` is ONE `<main>` landmark.
// Lighthouse saw only the paid one; loading and locked were never audited.
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
