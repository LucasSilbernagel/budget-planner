import { renderWithRouter, screen } from '@/test/utils'
import { fireEvent, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { Route } from '../forecasting'

/**
 * Reopening a saved forecast whose `years` is out of range (story 77.1, FR124).
 *
 * ⚠️⚠️ THE DEFECT: `mapToSavedForecast` accepted any finite `years >= 1`, with no
 * upper bound and no integer check. A saved `years` of 1e9 seeded the builder,
 * whose mount-time debounced recompute then ran the engine for a billion years and
 * froze the tab ON OPEN. A field guard cannot see this path: nobody typed anything.
 *
 * ⚠️ THE ENGINE IS MOCKED, and it has to be. On a build without the fix, the real
 * engine called with 1e9 would hang THIS test run, not fail it (a sync loop blocks
 * vitest's own timeout). The fake below records every `years` it receives and only
 * runs the real engine for a value it can finish; the assertion is on the RECORD.
 * The in-range test is written with a plain integer check rather than core's
 * `isValidForecastYears`, so it states the rule independently of the code under test.
 */

const engineYears = vi.hoisted(() => [] as unknown[])
const engineSavings = vi.hoisted(() => [] as unknown[])

vi.mock('@budget-planner/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@budget-planner/core')>()
  return {
    ...real,
    calculateFinancialForecast: (
      data: Parameters<typeof real.calculateFinancialForecast>[0],
      scenario: Parameters<typeof real.calculateFinancialForecast>[1],
      years: number
    ) => {
      engineYears.push(years)
      engineSavings.push(data.savings)
      const finishable = Number.isInteger(years) && years >= 1 && years <= 30
      return real.calculateFinancialForecast(data, scenario, finishable ? years : 1)
    },
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

function savedRow(years: unknown): Record<string, unknown> {
  return {
    id: 7,
    profileId: PROFILE,
    name: 'Long plan',
    description: null,
    version: 1,
    createdAt: ISO,
    updatedAt: ISO,
    scenarioData: JSON.stringify({
      scenario: { name: 'Long plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
      result: {
        scenario: { name: 'Long plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
        baseline: [],
        projection: [],
        summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
      },
      inputs: { savings: 123_400, investments: 0, years },
    }),
  }
}

beforeEach(() => {
  engineYears.length = 0
  engineSavings.length = 0
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
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  vi.clearAllMocks()
})

describe('a saved forecast with an out-of-range years reopens at the default period', () => {
  for (const years of [1e9, 31, 2.5]) {
    it(`years = ${years}`, async () => {
      fetchForecasts.mockResolvedValue({ success: true, data: [savedRow(years)] })
      renderWithRouter(<ForecastingPage />)

      fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
      const loadButton = await screen.findByRole('button', { name: 'Edit Long plan' })
      // Only calls made AFTER the load count (review P4): the builder mounted on
      // first render may already have computed its own default period.
      const callsBeforeLoad = engineYears.length
      fireEvent.click(loadButton)

      // The mechanism first (review P4): the reopened field must show the
      // default, so a filter regression reads "expected 1000000000 to be 10".
      // Re-queried inside waitFor so a pre-load element cannot answer.
      await waitFor(() =>
        expect(screen.getByLabelText('Projection Period (years)')).toHaveValue(10)
      )
      expect(screen.getByDisplayValue('Long plan')).toBeInTheDocument()
      // The loaded builder's mount-time debounced recompute (500 ms) must have
      // run, or the record below proves nothing.
      await waitFor(() => expect(engineYears.length).toBeGreaterThan(callsBeforeLoad), {
        timeout: 3000,
      })

      const afterLoad = engineYears.slice(callsBeforeLoad)
      expect(
        afterLoad.filter(
          (y) => !(Number.isInteger(y) && (y as number) >= 1 && (y as number) <= 30)
        ),
        'every years the engine was called with must be a whole number 1-30'
      ).toEqual([])
      // Review P1: only `years` is replaced. The row's own savings must survive,
      // or the reopened forecast silently re-baselines to 0.
      expect(engineSavings.slice(callsBeforeLoad).at(-1), 'saved savings kept').toBe(123_400)
      const field = screen.getByLabelText('Projection Period (years)')
      expect(
        within(field.parentElement as HTMLElement).queryByText(/whole number of years/)
      ).toBeNull()
    })
  }

  it('an in-range saved years is kept (control)', async () => {
    fetchForecasts.mockResolvedValue({ success: true, data: [savedRow(25)] })
    renderWithRouter(<ForecastingPage />)

    fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Long plan' }))

    expect(await screen.findByLabelText('Projection Period (years)')).toHaveValue(25)
    // Story 120.2 (AC 3): Edit switches back to the builder, and the tab selection
    // and roving tabIndex follow the programmatic switch.
    const builderTab = screen.getByRole('tab', { name: /scenario builder/i })
    expect(builderTab).toHaveAttribute('aria-selected', 'true')
    expect(builderTab.tabIndex).toBe(0)
    expect(screen.getByRole('tab', { name: /my forecasts/i })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    await waitFor(() => expect(engineYears).toContain(25), { timeout: 3000 })
  })
})
