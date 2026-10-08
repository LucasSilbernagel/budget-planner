import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../auth/premium-prompt', () => ({
  PremiumPrompt: ({ featureName }: { featureName: string }) => (
    <div data-testid="premium-prompt">{featureName}</div>
  ),
}))

vi.mock('../CategoryManager', () => ({
  CategoryManager: () => <div data-testid="category-manager" />,
}))

// Stubbed because the real breakdown needs Recharts and stores this provider-less render lacks.
vi.mock('../CategoryBreakdown', () => ({
  CategoryBreakdown: () => <div data-testid="category-breakdown" />,
}))

import { CategoriesPage } from '../CategoriesPage'

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
})

describe('CategoriesPage', () => {
  it('renders the manager for an active subscriber', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<CategoriesPage />)
    expect(screen.getByTestId('category-manager')).toBeInTheDocument()
    expect(screen.getByTestId('category-breakdown')).toBeInTheDocument()
    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
  })

  it('renders the manager for a lifetime licence holder', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'lifetime', isAuthenticated: true })
    render(<CategoriesPage />)
    expect(screen.getByTestId('category-manager')).toBeInTheDocument()
    expect(screen.getByTestId('category-breakdown')).toBeInTheDocument()
  })

  it.each([
    ['free' as const, false],
    ['past_due' as const, true],
    ['canceled' as const, true],
    [null, false],
  ])('shows the upgrade surface instead of the manager for %s', (subscriptionStatus, isAuth) => {
    mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated: isAuth })
    render(<CategoriesPage />)

    expect(screen.getByTestId('premium-prompt')).toHaveTextContent('Custom Categories')
    expect(screen.queryByTestId('category-manager')).not.toBeInTheDocument()
    // The breakdown is a separate sibling, so each locked branch asserts its absence too.
    expect(screen.queryByTestId('category-breakdown')).not.toBeInTheDocument()
  })

  it('treats an ERRORED tier check as not premium (fail-closed)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'check failed' })
    render(<CategoriesPage />)
    expect(screen.getByTestId('premium-prompt')).toBeInTheDocument()
    expect(screen.queryByTestId('category-manager')).not.toBeInTheDocument()
    expect(screen.queryByTestId('category-breakdown')).not.toBeInTheDocument()
  })

  it('never renders the manager while the tier is still unknown', () => {
    mockStatus({ isLoading: true })
    render(<CategoriesPage />)

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByTestId('category-manager')).not.toBeInTheDocument()
    expect(screen.queryByTestId('category-breakdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
  })
})

describe('CategoriesPage landmarks (story 116.1)', () => {
  it.each([
    ['loading', { isLoading: true }],
    ['locked', { hasAccess: false, subscriptionStatus: 'free' as const }],
  ])('the %s state is exactly one <main>', (_state, overrides) => {
    mockStatus(overrides)
    render(<CategoriesPage />)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})

describe('CategoriesPage loading → resolved (story 117.2)', () => {
  it.each([
    ['the locked prompt', { hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true }],
    ['the paid page', { hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true }],
  ] as const)('replaces the loading nodes with %s', (_resolved, status) => {
    mockStatus({ isLoading: true })
    const { container, rerender } = render(<CategoriesPage />)
    const spinner = screen.getByRole('status', { name: 'Loading' })
    const shell = container.firstElementChild
    expect(shell, 'anti-vacuity: the loading shell rendered').not.toBeNull()

    mockStatus(status)
    rerender(<CategoriesPage />)

    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
    expect(spinner.isConnected, 'the spinner node was reused').toBe(false)
    expect(shell?.isConnected, 'the loading shell was reused').toBe(false)
  })
})
