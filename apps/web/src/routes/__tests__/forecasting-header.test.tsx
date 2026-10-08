import { renderWithRouter, screen } from '@/test/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { Route } from '../forecasting'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../lib/forecasting/forecast-api', () => ({
  fetchProfiles: vi.fn(async () => ({ success: true, data: [] })),
  fetchForecasts: vi.fn(async () => ({ success: true, data: [] })),
  saveForecast: vi.fn(async () => ({ success: true, data: null })),
  deleteForecast: vi.fn(async () => ({ success: true })),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement

beforeEach(() => {
  vi.clearAllMocks()
  const status: PremiumAccessStatus = {
    hasAccess: true,
    subscriptionStatus: 'active',
    isLoading: false,
    error: null,
    isAuthenticated: true,
  }
  usePremiumAccess.mockReturnValue({ status })
})

describe('the /forecasting header (108.1, AC-1)', () => {
  it('shows the page title and no Premium badge', async () => {
    renderWithRouter(<ForecastingPage />)

    const heading = await screen.findByRole('heading', { level: 1, name: 'Financial Forecasting' })
    const header = heading.closest('header')
    expect(header, 'the title sits in the page header').not.toBeNull()

    expect(header?.textContent).not.toMatch(/premium/i)
    expect(screen.queryByText('Premium Feature')).toBeNull()
  })
})
