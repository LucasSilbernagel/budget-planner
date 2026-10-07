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
 * context for the prompt's <Link>).
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { ANY_LOCKED_NAME, lockedName } from '../../../test/locked-name'

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

const DESCRIPTION = 'See how your finances change over the years ahead'

function renderGate(props?: { upgradeHref?: string; featureName?: string }) {
  return render(
    <PremiumFeatureGate
      featureName={props?.featureName ?? 'Advanced Forecasting'}
      locked={
        <span className="flex flex-col">
          <span>Advanced Forecasting</span>
          <span>{DESCRIPTION}</span>
        </span>
      }
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
  it('while loading shows the tier-agnostic label but no children, lock, or prompt', () => {
    mockStatus({ isLoading: true })
    renderGate()

    const skeleton = screen.getByTestId('premium-gate-skeleton')
    expect(skeleton).toBeInTheDocument()
    // The shared label is shown (settling content, not a blank box)...
    expect(skeleton).toHaveTextContent('Advanced Forecasting')
    // ...but fail-closed: no unlocked children, no lock button, no upgrade prompt.
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

    const locked = screen.getByRole('button', { name: lockedName('Advanced Forecasting') })
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
    fireEvent.click(screen.getByRole('button', { name: ANY_LOCKED_NAME }))

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

    fireEvent.click(screen.getByRole('button', { name: ANY_LOCKED_NAME }))
    expect(premiumPromptProps).toHaveBeenCalledWith(
      expect.objectContaining({ upgradeHref: '/login' })
    )
  })
})

/**
 * Story 116.2 (FR184, A3): the locked control is named by what it SHOWS. It used
 * to carry `aria-label="<featureName> — premium, locked"`, which replaced its
 * content in the accessible name, so the visible description was never
 * announced and a voice-control user saying the visible title matched nothing
 * (axe `label-content-name-mismatch`).
 */
describe('PremiumFeatureGate locked accessible name (story 116.2)', () => {
  /** The name testing-library computes for `el` (handed to a `name` matcher). */
  function nameOf(el: HTMLElement): string {
    let name = ''
    screen.queryAllByRole('button', {
      name: (computed, node) => {
        if (node === el) name = computed
        return false
      },
    })
    return name
  }

  it('carries no aria-label or aria-labelledby that would replace its content (AC-2)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderGate()
    const locked = screen.getByTestId('premium-gate-locked')
    expect(locked).not.toHaveAttribute('aria-label')
    expect(locked).not.toHaveAttribute('aria-labelledby')
  })

  it('is named title first, then the description, then "Premium, locked" (AC-1)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderGate()
    const name = nameOf(screen.getByTestId('premium-gate-locked'))
    expect(name).toMatch(/^Advanced Forecasting\b/)
    expect(name).toContain(DESCRIPTION)
    expect(name).toMatch(/\bPremium\s*,\s*locked$/)
  })

  it('takes its name from the visible content, not from `featureName` (AC-1, AC-5)', () => {
    // A `featureName` that appears nowhere on screen: it must reach the dialog
    // and NOT the button's name.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderGate({ featureName: 'Dialog-only Name' })
    const locked = screen.getByTestId('premium-gate-locked')
    expect(nameOf(locked)).toMatch(/^Advanced Forecasting\b/)
    expect(nameOf(locked)).not.toContain('Dialog-only Name')

    fireEvent.click(locked)
    expect(premiumPromptProps).toHaveBeenCalledWith(
      expect.objectContaining({ featureName: 'Dialog-only Name' })
    )
  })

  it('the entitled and loading states carry no lock text (AC-3)', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    const { unmount } = renderGate()
    // Positive control first: the entitled branch rendered.
    expect(screen.getByTestId('unlocked-link')).toBeInTheDocument()
    expect(screen.queryByText(/locked/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/locked/i)
    unmount()

    mockStatus({ isLoading: true })
    renderGate()
    const skeleton = screen.getByTestId('premium-gate-skeleton')
    expect(skeleton).toHaveAttribute('aria-hidden', 'true')
    expect(skeleton.textContent).not.toMatch(/locked/i)
  })
})
