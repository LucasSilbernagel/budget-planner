import { renderWithRouter, screen } from '@/test/utils'
import { calculateFinancialForecast as realForecast } from '@budget-planner/core'
import { fireEvent, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { Route } from '../forecasting'

/**
 * Reopening saved forecasts with and without savings rows (story 100.1, AC-11
 * to AC-13), through the page's real `mapToSavedForecast` → builder path.
 *
 * The engine is the REAL one, wrapped only to record what it was called with and
 * what it returned, so a v1 forecast's figures can be compared with the call the
 * page made before this story (no rows, the same `savings`).
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

function savedRow(inputs: unknown, version = 1): Record<string, unknown> {
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
async function loadPlan(inputs: unknown, version?: number) {
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

/** Every savings row as `[name, balance, contribution]`, zipped by position. */
function rows(): [string, number, number][] {
  const value = (el: HTMLElement) => (el as HTMLInputElement).value
  // Money fields show grouped text since story 109.1 (`1,234.00`).
  const amount = (el: HTMLElement) => Number(value(el).replaceAll(',', ''))
  const balances = screen.queryAllByLabelText(/^Balance for /)
  const contributions = screen.queryAllByLabelText(/^Monthly Contribution for /)
  return screen
    .queryAllByLabelText(/^Account Name, row \d+$/)
    .map((name, i) => [
      value(name),
      amount(balances[i] as HTMLElement),
      amount(contributions[i] as HTMLElement),
    ])
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
  // The live store holds a DIFFERENT savings row; a loaded forecast must never
  // show it (62.1 AC-7).
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'live-1',
        profileId: PROFILE,
        name: 'Live store row',
        targetAmount: null,
        currentBalance: 777_700,
        allocationMode: 'automatic',
        monthlyAllocation: null,
        sortOrder: 0,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
  fetchProfiles.mockResolvedValue({
    success: true,
    data: [{ id: PROFILE, name: 'Household', isDefault: true }],
  })
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  vi.clearAllMocks()
})

describe('a v2 forecast reloads its rows exactly (AC-11)', () => {
  it('names, balances, contributions and order', async () => {
    const call = await loadPlan(
      {
        savings: 350_001,
        investments: 10_000,
        years: 10,
        savingsAccounts: [
          { name: 'Emergency fund', balance: 100_000, monthlyContribution: 20_000 },
          { name: 'House fund', balance: 250_001, monthlyContribution: 5 },
        ],
      },
      2
    )

    expect(rows()).toEqual([
      ['Emergency fund', 1000, 200],
      ['House fund', 2500.01, 0.05],
    ])
    expect(call.data.savings).toBe(350_001)
    expect(call.data.savingsAccounts).toEqual([
      { balance: 100_000, monthlyContribution: 20_000 },
      { balance: 250_001, monthlyContribution: 5 },
    ])
    expect(screen.queryByDisplayValue('Live store row')).toBeNull()
  })
})

// Renamed by the 100.3 code review: under 100.3 D3 a v1 forecast no longer
// reopens with the figures it had (its investments drop from 7% to 6%). The claim
// kept here is 100.1's: the single Savings row changes no figure.
describe('a v1 forecast reopens as one Savings row that changes no figure (AC-12)', () => {
  it('becomes ONE row named Savings, and projects exactly as the same inputs without savings rows', async () => {
    const call = await loadPlan({ savings: 123_400, investments: 50_000, years: 7 })

    expect(rows()).toEqual([['Savings', 1234, 0]])
    // What the page computes without savings rows: the same inputs, no rows.
    // ⚠️ Story 100.3 (D3): the v1 forecast's investments now reload as one
    // Investments row at 6% (100.2 + 100.3), so the comparison call carries that
    // same row. The claim pinned here is still 100.1's: the one Savings row
    // changes no figure. (Before 100.3 this compared against a no-rows call at 7%.)
    const before = realForecast(
      {
        income: INCOME,
        expenses: [],
        savings: 123_400,
        investments: 50_000,
        balanceAccounts: [
          {
            type: 'investment',
            balance: 50_000,
            contribution: 0,
            frequency: 'monthly',
            annualReturn: 0.06,
          },
        ],
      },
      { ...SCENARIO, newIncome: INCOME, newExpenses: [], oneTimeEvents: [] },
      7
    )
    expect(call.result.summary).toEqual(before.summary)
    expect(call.result.projection.map((p) => p.netWorth)).toEqual(
      before.projection.map((p) => p.netWorth)
    )
  })

  it('becomes an empty list when its savings were 0', async () => {
    const call = await loadPlan({ savings: 0, investments: 50_000, years: 7 })
    expect(rows()).toEqual([])
    expect(screen.getByText('No savings accounts in this scenario')).toBeInTheDocument()
    expect(call.data.savings).toBe(0)
  })

  it('a pre-bug-3 row with no inputs still reloads at 0', async () => {
    const call = await loadPlan(undefined)
    expect(rows()).toEqual([])
    expect(call.data.savings).toBe(0)
    expect(call.data.investments).toBe(0)
  })
})

describe('corrupt saved rows (AC-13)', () => {
  it('ignores a savingsAccounts that is not an array and falls back to the v1 total', async () => {
    const call = await loadPlan(
      { savings: 123_400, investments: 50_000, years: 7, savingsAccounts: 'oops' },
      2
    )
    expect(rows()).toEqual([['Savings', 1234, 0]])
    expect(call.data.investments).toBe(50_000)
  })

  it('coerces each bad entry rather than dropping inputs', async () => {
    const call = await loadPlan(
      {
        savings: 1_000,
        investments: 50_000,
        years: 7,
        savingsAccounts: [
          { name: 5, balance: -1, monthlyContribution: 'a' },
          null,
          { name: 'Ok', balance: 1_000, monthlyContribution: 100 },
        ],
      },
      2
    )
    expect(rows()).toEqual([
      ['', 0, 0],
      ['', 0, 0],
      ['Ok', 10, 1],
    ])
    // `inputs` survived: investments and years are the saved ones.
    expect(call.data.investments).toBe(50_000)
    expect(screen.getByLabelText('Projection Period (years)')).toHaveValue(7)
  })

  /**
   * ⚠️ End-to-end only. MEASURED (mutation W5, removing the mapper's recompute):
   * this case stays GREEN, because the builder derives `savings` from the rows
   * on its own. The mapper's half of D7 is pinned by the NaN-total case below,
   * which W5 turns RED.
   */
  it('trusts the ROWS when they disagree with the saved total (D7)', async () => {
    const call = await loadPlan(
      {
        savings: 999,
        investments: 0,
        years: 7,
        savingsAccounts: [{ name: 'Only', balance: 1_000, monthlyContribution: 0 }],
      },
      2
    )
    expect(call.data.savings).toBe(1_000)
    expect(call.result.summary.startingNetWorth).toBe(1_000)
  })

  it('keeps inputs whose saved total is not a number when the rows are valid', async () => {
    // JSON has no NaN: a NaN total is saved as `null`.
    const call = await loadPlan(
      {
        savings: null,
        investments: 50_000,
        years: 7,
        savingsAccounts: [{ name: 'Only', balance: 1_000, monthlyContribution: 0 }],
      },
      2
    )
    expect(rows()).toEqual([['Only', 10, 0]])
    expect(call.data.savings).toBe(1_000)
    expect(call.data.investments).toBe(50_000)
  })
})
