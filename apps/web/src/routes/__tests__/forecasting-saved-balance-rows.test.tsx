import { renderWithRouter, screen } from '@/test/utils'
import { calculateFinancialForecast as realForecast } from '@budget-planner/core'
import { fireEvent, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useProfileStore } from '../../stores/profileStore'
import { Route } from '../forecasting'

/**
 * Reopening saved forecasts with and without investment/debt rows (story 100.2,
 * AC-13, AC-14), through the page's real `mapToSavedForecast` → builder path.
 *
 * The engine is the REAL one, wrapped only to record what it was called with and
 * what it returned, so a v1/v2 forecast's figures can be compared with the call
 * the page made before this story (no balance rows, the same `investments`).
 */

const engineCalls = vi.hoisted(
  () =>
    [] as Array<{
      data: Parameters<typeof import('@budget-planner/core').calculateFinancialForecast>[0]
      result: ReturnType<typeof import('@budget-planner/core').calculateFinancialForecast>
    }>
)

vi.mock('@budget-planner/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@budget-planner/core')>()
  return {
    ...real,
    calculateFinancialForecast: (
      ...args: Parameters<typeof real.calculateFinancialForecast>
    ): ReturnType<typeof real.calculateFinancialForecast> => {
      const result = real.calculateFinancialForecast(...args)
      engineCalls.push({ data: args[0], result })
      return result
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
const ISO = '2026-10-05T00:00:00.000Z'
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

/** Open My Forecasts, Load "Plan", and wait for the loaded builder's first recompute. */
async function loadPlan(inputs: unknown, version: number) {
  fetchForecasts.mockResolvedValue({ success: true, data: [savedRow(inputs, version)] })
  renderWithRouter(<ForecastingPage />)
  fireEvent.click(await screen.findByRole('button', { name: /my forecasts/i }))
  const load = await screen.findByRole('button', { name: 'Load Plan' })
  const before = engineCalls.length
  fireEvent.click(load)
  await waitFor(() => expect(screen.getByLabelText('Scenario Name')).toHaveValue('Plan'))
  await waitFor(() => expect(engineCalls.length).toBeGreaterThan(before), { timeout: 3000 })
  const last = engineCalls.at(-1)
  if (!last) throw new Error('no engine call after the load')
  return last
}

/** Every investment/debt row as `[name, type, balance, contribution, frequency, flag]`. */
function rows(): [string, string, number, number, string, boolean | null][] {
  const section = screen.getByRole('region', { name: 'Investments & Debts' })
  const value = (el: HTMLElement) => (el as HTMLInputElement).value
  return within(section)
    .queryAllByLabelText(/^Balance Name, row \d+$/)
    .map((name) => {
      const label = value(name).trim() === '' ? 'unnamed balance' : value(name).trim()
      const flag = within(section).queryByLabelText(
        `Not taken from the money left over, for ${label}`
      ) as HTMLInputElement | null
      return [
        value(name),
        value(within(section).getByLabelText(`Type for ${label}`)),
        Number(value(within(section).getByLabelText(`Balance for ${label}`))),
        Number(value(within(section).getByLabelText(`Contribution for ${label}`))),
        value(within(section).getByLabelText(`Frequency for ${label}`)),
        flag ? flag.checked : null,
      ]
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
  // The live store holds a DIFFERENT row; a loaded forecast must never show it.
  useBalanceStore.setState({
    entries: [
      {
        id: 'live-1',
        profileId: PROFILE,
        type: 'investment',
        name: 'Live store row',
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

describe('a v3 forecast reloads its rows exactly (AC-13)', () => {
  it('names, types, balances, contributions, frequencies, flags and order', async () => {
    const call = await loadPlan(
      {
        savings: 0,
        investments: 1_200_001,
        years: 10,
        balanceAccounts: [
          {
            name: 'Pension',
            type: 'investment',
            balance: 1_000_001,
            contribution: 25_000,
            frequency: 'biweekly',
            contributionRecordedAsExpense: true,
          },
          {
            name: 'Car loan',
            type: 'debt',
            balance: 500_000,
            contribution: 30_000,
            frequency: 'monthly',
            contributionRecordedAsExpense: false,
          },
          {
            name: 'ISA',
            type: 'investment',
            balance: 200_000,
            contribution: 120_000,
            frequency: 'annually',
            contributionRecordedAsExpense: false,
          },
        ],
      },
      3
    )

    expect(rows()).toEqual([
      ['Pension', 'investment', 10000.01, 250, 'biweekly', true],
      ['Car loan', 'debt', 5000, 300, 'monthly', null],
      ['ISA', 'investment', 2000, 1200, 'annually', false],
    ])
    expect(call.data.investments).toBe(1_200_001)
    expect(call.data.balanceAccounts).toEqual([
      {
        type: 'investment',
        balance: 1_000_001,
        contribution: 25_000,
        frequency: 'biweekly',
        contributionRecordedAsExpense: true,
      },
      {
        type: 'debt',
        balance: 500_000,
        contribution: 30_000,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
      },
      {
        type: 'investment',
        balance: 200_000,
        contribution: 120_000,
        frequency: 'annually',
        contributionRecordedAsExpense: false,
      },
    ])
    // The debt counts against the start: 0 + 1200001 − 500000.
    expect(call.result.summary.startingNetWorth).toBe(700_001)
    expect(screen.queryByDisplayValue('Live store row')).toBeNull()
  })
})

describe('a v1/v2 forecast reopens with the figures it had (AC-13)', () => {
  for (const version of [1, 2]) {
    it(`v${version}: becomes ONE Investments row, and projects exactly as before the story`, async () => {
      const call = await loadPlan({ savings: 123_400, investments: 50_000, years: 7 }, version)

      expect(rows()).toEqual([['Investments', 'investment', 500, 0, 'monthly', false]])
      // What the page computed before story 100.2: the same inputs, no balance rows.
      const before = realForecast(
        { income: INCOME, expenses: [], savings: 123_400, investments: 50_000 },
        { ...SCENARIO, newIncome: INCOME, newExpenses: [], oneTimeEvents: [] },
        7
      )
      expect(call.result.summary).toEqual(before.summary)
      expect(call.result.projection.map((p) => p.netWorth)).toEqual(
        before.projection.map((p) => p.netWorth)
      )
    })
  }

  it('becomes an empty list when its investments were 0', async () => {
    const call = await loadPlan({ savings: 1_000, investments: 0, years: 7 }, 2)
    expect(rows()).toEqual([])
    expect(screen.getByText('No investments or debts in this scenario')).toBeInTheDocument()
    expect(call.data.investments).toBe(0)
    expect(call.data.balanceAccounts).toEqual([])
  })

  it('keeps a NEGATIVE saved total and flags it, rather than clamping it (100.1 decision)', async () => {
    fetchForecasts.mockResolvedValue({
      success: true,
      data: [savedRow({ savings: 0, investments: -500, years: 7 }, 2)],
    })
    renderWithRouter(<ForecastingPage />)
    fireEvent.click(await screen.findByRole('button', { name: /my forecasts/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Load Plan' }))
    const field = await screen.findByLabelText('Balance for Investments')
    expect(field).toHaveValue(-5)
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('save-blocked-reason').textContent).toBe(
      'Fix the highlighted fields to save'
    )
  })

  it('a pre-bug-3 row with no inputs still starts at 0', async () => {
    const call = await loadPlan(undefined, 1)
    expect(rows()).toEqual([])
    expect(call.data.investments).toBe(0)
  })
})

describe('corrupt saved rows (AC-14)', () => {
  it('ignores a balanceAccounts that is not an array and falls back to the v1/v2 total', async () => {
    const call = await loadPlan(
      { savings: 0, investments: 50_000, years: 7, balanceAccounts: { not: 'an array' } },
      3
    )
    expect(rows()).toEqual([['Investments', 'investment', 500, 0, 'monthly', false]])
    expect(call.data.investments).toBe(50_000)
  })

  it('coerces each bad entry, drops an unknown type, and never drops inputs', async () => {
    const call = await loadPlan(
      {
        savings: 0,
        investments: 1_000,
        years: 7,
        balanceAccounts: [
          {
            name: 5,
            type: 'investment',
            balance: -1,
            contribution: 'a',
            frequency: 'quarterly',
            contributionRecordedAsExpense: 'yes',
          },
          { name: 'House', type: 'asset', balance: 9_999_900, contribution: 0 },
          null,
          {
            name: 'Loan',
            type: 'debt',
            balance: 1_000,
            contribution: 100,
            frequency: 'weekly',
            contributionRecordedAsExpense: true,
          },
          { name: 'Ok', type: 'investment', balance: 1_000, contribution: 100 },
        ],
      },
      3
    )
    // The asset and the null entry (no type) are dropped; the debt's flag is cleared.
    expect(rows()).toEqual([
      ['', 'investment', 0, 0, 'monthly', false],
      ['Loan', 'debt', 10, 1, 'weekly', null],
      ['Ok', 'investment', 10, 1, 'monthly', false],
    ])
    // `inputs` survived: years is the saved one.
    expect(screen.getByLabelText('Projection Period (years)')).toHaveValue(7)
    expect(call.data.investments).toBe(1_000)
  })

  /**
   * The mapper's half of "rows win" (100.1 lesson: the builder derives the total
   * from the rows by itself, so a disagreeing finite total cannot tell whether
   * the MAPPER recomputed it). A non-finite total can: without the mapper's
   * recompute `inputs` is dropped whole and the forecast reopens at 0.
   */
  it('rescues a saved total that is not a number when the rows are valid (rows win, mapper level)', async () => {
    const call = await loadPlan(
      {
        savings: 0,
        investments: null,
        years: 7,
        balanceAccounts: [
          {
            name: 'Only',
            type: 'investment',
            balance: 1_000,
            contribution: 0,
            frequency: 'monthly',
            contributionRecordedAsExpense: false,
          },
        ],
      },
      3
    )
    expect(rows()).toEqual([['Only', 'investment', 10, 0, 'monthly', false]])
    expect(call.data.investments).toBe(1_000)
    expect(screen.getByLabelText('Projection Period (years)')).toHaveValue(7)
  })

  it('trusts the ROWS when they disagree with the saved total', async () => {
    const call = await loadPlan(
      {
        savings: 0,
        investments: 999,
        years: 7,
        balanceAccounts: [
          {
            name: 'Only',
            type: 'investment',
            balance: 1_000,
            contribution: 0,
            frequency: 'monthly',
            contributionRecordedAsExpense: false,
          },
        ],
      },
      3
    )
    expect(call.data.investments).toBe(1_000)
    expect(call.result.summary.startingNetWorth).toBe(1_000)
  })
})
