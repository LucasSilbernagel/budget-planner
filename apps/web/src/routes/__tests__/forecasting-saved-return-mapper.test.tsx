import { renderWithRouter, screen } from '@/test/utils'
import { fireEvent, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useProfileStore } from '../../stores/profileStore'
import { Route, type SavedForecast } from '../forecasting'

/**
 * The MAPPER's half of the saved-rate rules (story 100.3, AC-12), read at the
 * mapper itself: `ScenarioBuilder` is replaced by a stub that records the
 * `initialForecast` the page hands it, i.e. exactly what `mapToSavedForecast`
 * produced.
 *
 * Why a separate file (100.2 W11 lesson): the builder's `balanceFromSaved`
 * coerces the same rates on its own, so a test through the real builder cannot
 * see a mapper that, say, kept a string rate. Each rule is pinned here, on the
 * mapper's output, and again through the builder in
 * `forecasting-saved-balance-rows.test.tsx`.
 */

const received = vi.hoisted(() => [] as Array<SavedForecast | undefined>)
vi.mock('../../components/forecasting/scenario-builder', () => ({
  ScenarioBuilder: (props: { initialForecast?: SavedForecast }) => {
    received.push(props.initialForecast)
    return null
  },
}))

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

function savedRow(balanceAccounts: unknown[]): Record<string, unknown> {
  return {
    id: 9,
    profileId: PROFILE,
    name: 'Plan',
    description: null,
    version: 4,
    createdAt: ISO,
    updatedAt: ISO,
    scenarioData: JSON.stringify({
      scenario: SCENARIO,
      result: {
        scenario: SCENARIO,
        baseline: [],
        projection: [],
        summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
      },
      inputs: { savings: 0, investments: 0, years: 7, balanceAccounts },
    }),
  }
}

function row(name: string, extra: Record<string, unknown>, type = 'investment') {
  return {
    name,
    type,
    balance: 0,
    contribution: 0,
    frequency: 'monthly',
    contributionRecordedAsExpense: false,
    ...extra,
  }
}

/** Load "Plan" and return the balance rows the mapper handed the builder. */
async function mapped(balanceAccounts: unknown[]) {
  fetchForecasts.mockResolvedValue({ success: true, data: [savedRow(balanceAccounts)] })
  renderWithRouter(<ForecastingPage />)
  fireEvent.click(await screen.findByRole('button', { name: /my forecasts/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Plan' }))
  await waitFor(() => expect(received.at(-1)).toBeDefined())
  const rows = received.at(-1)?.inputs?.balanceAccounts
  if (!rows) throw new Error('the mapper produced no balance rows')
  return rows
}

beforeEach(() => {
  received.length = 0
  vi.clearAllMocks()
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

describe('mapToSavedForecast: annualReturn (story 100.3)', () => {
  it('keeps every FINITE investment rate as saved, in range or not (D9)', async () => {
    const rows = await mapped([
      row('Zero', { annualReturn: 0 }),
      row('Negative', { annualReturn: -0.25 }),
      row('Fraction', { annualReturn: 0.055 }),
      row('Wild', { annualReturn: 1.5 }),
    ])
    expect(rows.map((r) => r.annualReturn)).toEqual([0, -0.25, 0.055, 1.5])
  })

  it('omits a missing, null or non-number rate, so the builder default applies (D3)', async () => {
    const rows = await mapped([
      row('Missing', {}),
      row('Null', { annualReturn: null }),
      row('Text', { annualReturn: '0.09' }),
      row('Object', { annualReturn: {} }),
    ])
    expect(rows.map((r) => r.name)).toEqual(['Missing', 'Null', 'Text', 'Object'])
    for (const r of rows) expect(Object.keys(r)).not.toContain('annualReturn')
  })

  it("drops a debt row's rate (debts are saved without one, D8)", async () => {
    const rows = await mapped([row('Loan', { annualReturn: 0.2 }, 'debt')])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('debt')
    expect(Object.keys(rows[0] ?? {})).not.toContain('annualReturn')
  })
})
