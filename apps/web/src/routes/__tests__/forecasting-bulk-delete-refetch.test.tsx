import { renderWithRouter, screen } from '@/test/utils'
import { act, fireEvent, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useProfileStore } from '../../stores/profileStore'
import { Route } from '../forecasting'

/**
 * A bulk delete's list reloads can't bring deleted forecasts back (story 119.1,
 * code review).
 *
 * Bulk delete calls the page's delete handler once per id, and each call reloads
 * the list after its own DELETE. Those reloads overlap, and nothing orders their
 * responses. Before the fix, every response replaced the list, so a slow early
 * reload (taken while later DELETEs were still pending) landing last put
 * already-deleted forecasts back on screen. Deleting them again answers
 * not-found, which reloads nothing, so they stayed until a page reload.
 *
 * The transport is mocked with a fake server: each GET answers the server's rows
 * at the moment it was CALLED, after a delay the test controls.
 */

const usePremiumAccess = vi.fn()
vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

const fetchProfiles = vi.fn()
const fetchForecasts = vi.fn()
const deleteForecast = vi.fn()
vi.mock('../../lib/forecasting/forecast-api', () => ({
  fetchProfiles: (...args: unknown[]) => fetchProfiles(...args),
  fetchForecasts: (...args: unknown[]) => fetchForecasts(...args),
  saveForecast: vi.fn(),
  deleteForecast: (...args: unknown[]) => deleteForecast(...args),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement
const ISO = '2026-10-07T00:00:00.000Z'
const PROFILE = 'profile-test'

function savedRow(id: number, name: string): Record<string, unknown> {
  const scenario = { name, incomeGrowthRate: 0, expenseGrowthRate: 0 }
  return {
    id,
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
      inputs: { savings: 0, investments: 0, years: 5 },
    }),
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('bulk delete list reloads', () => {
  it('keeps the newest reload when an older one answers last', async () => {
    let server = [savedRow(1, 'One'), savedRow(2, 'Two'), savedRow(3, 'Three')]
    let gets = 0
    fetchForecasts.mockImplementation(async () => {
      const call = gets++
      const rows = [...server]
      // GET 0 is the page's first load. GET 1 is the first delete's reload,
      // taken while Two and Three still exist: it answers last.
      await sleep(call === 1 ? 300 : 5)
      return { success: true, data: rows }
    })
    deleteForecast.mockImplementation(async (id: string) => {
      await sleep(10 * Number(id))
      server = server.filter((row) => String(row.id) !== String(id))
      return { success: true }
    })
    const rowBoxes = () => screen.queryAllByRole('checkbox', { name: /^Select (One|Two|Three)$/ })

    renderWithRouter(<ForecastingPage />)
    fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all' }))
    expect(rowBoxes()).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    // All three DELETEs and the two later reloads are done; the slow one isn't.
    await act(() => sleep(150))
    expect(gets).toBe(4)
    expect(rowBoxes()).toHaveLength(0)

    // The slow reload (One already gone, Two and Three not yet) answers now.
    await act(() => sleep(300))
    expect(server).toEqual([])
    expect(rowBoxes()).toHaveLength(0)
  })
})
