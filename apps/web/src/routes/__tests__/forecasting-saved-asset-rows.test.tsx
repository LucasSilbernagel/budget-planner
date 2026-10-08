import { renderWithRouter, screen } from '@/test/utils'
import { fireEvent, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useProfileStore } from '../../stores/profileStore'
import { Route } from '../forecasting'

type ForecastArgs = Parameters<typeof import('@budget-planner/core').calculateFinancialForecast>
const engineCalls = vi.hoisted(() => [] as ForecastArgs[])

vi.mock('@budget-planner/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@budget-planner/core')>()
  return {
    ...real,
    calculateFinancialForecast: (...args: Parameters<typeof real.calculateFinancialForecast>) => {
      engineCalls.push(args)
      return real.calculateFinancialForecast(...args)
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
const ISO = '2026-10-06T00:00:00.000Z'
const PROFILE = 'profile-test'
const SCENARIO = { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 }
const INCOME = [{ name: 'Salary', amount: 500_000, frequency: 'monthly' as const }]

function savedRow(inputs: unknown, version: number): Record<string, unknown> {
  return {
    id: 9,
    profileId: PROFILE,
    name: 'Plan',
    description: null,
    version,
    createdAt: ISO,
    updatedAt: ISO,
    scenarioData: JSON.stringify({
      scenario: { ...SCENARIO, newIncome: INCOME },
      result: {
        scenario: SCENARIO,
        baseline: [],
        projection: [],
        summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
      },
      ...(inputs === undefined ? {} : { inputs }),
    }),
  }
}

async function loadPlan(inputs: unknown, version: number) {
  fetchForecasts.mockResolvedValue({ success: true, data: [savedRow(inputs, version)] })
  renderWithRouter(<ForecastingPage />)
  fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
  const load = await screen.findByRole('button', { name: 'Edit Plan' })
  const before = engineCalls.length
  fireEvent.click(load)
  await waitFor(() => expect(screen.getByLabelText('Scenario Name')).toHaveValue('Plan'))
  await waitFor(() => expect(engineCalls.length).toBeGreaterThan(before), { timeout: 3000 })
  const last = engineCalls.at(-1)
  if (!last) throw new Error('no engine call after the load')
  return last
}

function assetRows(): [string, string][] {
  const section = screen.getByRole('region', { name: 'Assets' })
  return within(section)
    .queryAllByLabelText(/^Asset Name, row \d+$/)
    .map((name) => {
      const value = (name as HTMLInputElement).value
      const label = value.trim() === '' ? 'unnamed asset' : value.trim()
      const field = within(section).getAllByLabelText(`Value for ${label}`)
      return [value, (field[0] as HTMLInputElement).value]
    })
}

beforeEach(() => {
  engineCalls.length = 0
  const status: PremiumAccessStatus = {
    hasAccess: true,
    subscriptionStatus: 'active',
    isLoading: false,
    error: null,
    isAuthenticated: true,
  }
  usePremiumAccess.mockReturnValue({ status })
  useProfileStore.setState({ activeProfileId: PROFILE })
  // The live store holds a DIFFERENT asset; a loaded forecast must never show it.
  useBalanceStore.setState({
    entries: [
      {
        id: 'live-1',
        profileId: PROFILE,
        type: 'asset',
        name: 'Live store house',
        currentBalance: 777_700,
        monthlyContribution: 0,
        frequency: 'monthly',
        sortOrder: 0,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ] as never,
  })
  fetchProfiles.mockResolvedValue({
    success: true,
    data: [{ id: PROFILE, name: 'Household', isDefault: true }],
  })
})

afterEach(() => {
  useBalanceStore.setState({ entries: [] })
  vi.clearAllMocks()
})

describe('a v6 forecast reloads its asset rows exactly (AC-10)', () => {
  it('names, values and order, and the engine gets their total', async () => {
    const [data] = await loadPlan(
      {
        savings: 0,
        investments: 0,
        years: 10,
        assetAccounts: [
          { name: 'House', balance: 30_000_001 },
          { name: 'Car', balance: 1_250_099 },
        ],
      },
      6
    )
    expect(assetRows()).toEqual([
      ['House', '300,000.01'],
      ['Car', '12,500.99'],
    ])
    expect(data.assets).toBe(31_250_100)
  })
})

describe('a forecast saved before version 6 (AC-10)', () => {
  it('reloads with NO asset rows, and the engine gets an asset total of 0', async () => {
    const [data] = await loadPlan({ savings: 0, investments: 0, years: 10 }, 5)
    expect(assetRows()).toEqual([])
    expect(data.assets).toBe(0)
  })
})

describe('a bad assetAccounts never discards inputs (AC-10)', () => {
  it('a non-array is ignored (no rows), and years survive', async () => {
    await loadPlan({ savings: 0, investments: 0, years: 7, assetAccounts: 'oops' }, 6)
    expect(assetRows()).toEqual([])
    expect(screen.getByLabelText('Projection Period (years)')).toHaveValue(7)
  })

  it('coerces each entry: non-object → blank and 0, non-string name → blank, non-finite or negative value → 0', async () => {
    const [data] = await loadPlan(
      {
        savings: 0,
        investments: 0,
        years: 7,
        assetAccounts: [
          null,
          { name: 5, balance: -1 },
          { name: 'Inf', balance: 'lots' },
          { name: 'Ok', balance: 1_000 },
        ],
      },
      6
    )
    expect(assetRows()).toEqual([
      ['', '0.00'],
      ['', '0.00'],
      ['Inf', '0.00'],
      ['Ok', '10.00'],
    ])
    expect(screen.getByLabelText('Projection Period (years)')).toHaveValue(7)
    expect(data.assets).toBe(1_000)
  })
})
