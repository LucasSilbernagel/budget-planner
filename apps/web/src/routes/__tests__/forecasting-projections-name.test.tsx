import { renderWithRouter, screen } from '@/test/utils'
import { fireEvent, waitFor } from '@testing-library/react'
import type React from 'react'
import { type ReactElement, cloneElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useProfileStore } from '../../stores/profileStore'
import { Route } from '../forecasting'

/**
 * The Projections chart names the user's scenario (story 97.2, FR158), on the
 * two paths a user reaches it by: (a) loading a saved forecast, (b) renaming
 * the scenario in the builder without saving. The name rides in the result the
 * builder hands the page (`result.scenario.name`), so no prop carries it.
 *
 * Real page, real builder, real engine, real Recharts; only the network
 * (profiles/forecasts) and `ResponsiveContainer` (0×0 in jsdom, so no SVG) are
 * replaced. A new file on purpose: story 97.1 edits the other forecasting
 * route tests concurrently.
 */

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 600, height: 400 } as never),
  }
})

const usePremiumAccess = vi.fn()
vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

const fetchProfiles = vi.fn()
const fetchForecasts = vi.fn()
vi.mock('../../lib/forecasting/forecast-api', () => ({
  fetchProfiles: (...args: unknown[]) => fetchProfiles(...args),
  fetchForecasts: (...args: unknown[]) => fetchForecasts(...args),
  saveForecast: vi.fn(),
  deleteForecast: vi.fn(async () => ({ success: true })),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement
const ISO = '2026-09-28T00:00:00.000Z'
const PROFILE = 'profile-test'

function savedRow(name: string): Record<string, unknown> {
  const scenario = { name, incomeGrowthRate: 0.03, expenseGrowthRate: 0.02 }
  return {
    id: 7,
    profileId: PROFILE,
    name,
    description: null,
    version: 1,
    createdAt: ISO,
    updatedAt: ISO,
    scenarioData: JSON.stringify({
      scenario,
      result: {
        scenario,
        baseline: [],
        projection: [],
        summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
      },
      inputs: { savings: 150_000_000, investments: 50_000_000, years: 10 },
    }),
  }
}

function legendNames(): string[] {
  return [...document.querySelectorAll('.recharts-legend-item-text')].map(
    (t) => t.textContent ?? ''
  )
}

async function openProjections() {
  fireEvent.click(screen.getByRole('tab', { name: /projections/i }))
  await waitFor(() => expect(legendNames().length).toBe(2))
}

beforeEach(() => {
  const status: PremiumAccessStatus = {
    hasAccess: true,
    subscriptionStatus: 'active',
    isLoading: false,
    error: null,
    isAuthenticated: true,
  }
  usePremiumAccess.mockReturnValue({ status })
  useProfileStore.setState({ activeProfileId: PROFILE })
  fetchProfiles.mockResolvedValue({
    success: true,
    data: [{ id: PROFILE, name: 'Household', isDefault: true }],
  })
  fetchForecasts.mockResolvedValue({ success: true, data: [savedRow('Buy a house')] })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('the Projections legend names the scenario', () => {
  it('(a) after loading a saved forecast from My Forecasts', async () => {
    renderWithRouter(<ForecastingPage />)
    fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Buy a house' }))
    await waitFor(() => expect(screen.getByDisplayValue('Buy a house')).toBeInTheDocument())

    await openProjections()
    await waitFor(() => expect(legendNames()).toEqual(['Baseline', 'Buy a house']))
  })

  it('(b) after renaming the scenario in the builder, unsaved', async () => {
    renderWithRouter(<ForecastingPage />)
    const nameField = await screen.findByLabelText('Scenario Name')
    // Control: the unsaved default name, once the first recompute lands.
    await openProjections()
    await waitFor(() => expect(legendNames()).toEqual(['Baseline', 'My Financial Forecast']))

    fireEvent.click(screen.getByRole('tab', { name: /scenario builder/i }))
    fireEvent.change(nameField, { target: { value: 'Buy a house' } })
    // Wait out the builder's 500 ms debounced recompute (it stays mounted).
    await new Promise((resolve) => setTimeout(resolve, 700))
    await openProjections()
    await waitFor(() => expect(legendNames()).toEqual(['Baseline', 'Buy a house']))
  })

  it('a blank name falls back to "Scenario"', async () => {
    renderWithRouter(<ForecastingPage />)
    const nameField = await screen.findByLabelText('Scenario Name')
    fireEvent.change(nameField, { target: { value: '   ' } })
    await new Promise((resolve) => setTimeout(resolve, 700))
    await openProjections()
    await waitFor(() => expect(legendNames()).toEqual(['Baseline', 'Scenario']))
  })
})
