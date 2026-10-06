/**
 * The `/forecasting` header carries no "Premium Feature" badge (story 108.1,
 * FR176, D5: removed at every width).
 *
 * The page is only reachable by a user who already has premium, so a badge
 * telling them so was noise in a sticky header that costs height on a phone.
 * The Overview's own premium labels are a different surface and are untouched.
 *
 * Harness: the same as `forecasting-intro.test.tsx` (the route component through
 * `Route.options.component`, premium access and the forecast API stubbed).
 */

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

    // Positive control: the header IS rendered, so the absence below is the badge
    // genuinely gone and not the page failing to mount.
    const heading = await screen.findByRole('heading', { level: 1, name: 'Financial Forecasting' })
    const header = heading.closest('header')
    expect(header, 'the title sits in the page header').not.toBeNull()

    expect(header?.textContent).not.toMatch(/premium/i)
    expect(screen.queryByText('Premium Feature')).toBeNull()
  })
})
