// Hydration keeps a typed DOM value but fires no onChange, so the next re-render writes the server value back.
// RTL's render() has no hydration pass; typing is simulated by setting `.value` on server markup with no event.

import { screen, within } from '@testing-library/react'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetStoresHydratedForTests } from '../../../hooks/useStoresHydrated'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
  useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
  useCurrencyMode: () => 'none',
  useCurrencyCode: () => 'NONE',
}))

const NOW = '2026-09-22T00:00:00.000Z'
const PROFILE_A = 'profile-a'

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
}

function fillStores(): void {
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        profileId: PROFILE_A,
        userId: 0,
        name: 'Consulting',
        amount: 720_000,
        frequency: 'monthly' as const,
        categoryId: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'goal-1',
        profileId: PROFILE_A,
        name: 'Emergency fund',
        targetAmount: 1_000_000,
        currentBalance: 345_600,
        allocationMode: 'manual' as const,
        monthlyAllocation: null,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
  useBalanceStore.setState({
    entries: [
      {
        id: 'entry-1',
        profileId: PROFILE_A,
        type: 'investment' as const,
        name: 'Index fund',
        currentBalance: 987_600,
        monthlyContribution: 0,
        frequency: 'monthly' as const,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
}

let container: HTMLDivElement
let root: ReturnType<typeof hydrateRoot> | undefined

beforeEach(() => {
  clearStores()
  useProfileStore.setState({ activeProfileId: PROFILE_A })
  __resetStoresHydratedForTests()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = undefined
  container?.remove()
  clearStores()
  vi.clearAllMocks()
})

async function hydrateAfterTyping(
  onSave: ReturnType<typeof vi.fn>,
  typeBeforeHydration: (server: ReturnType<typeof within>) => void
) {
  const element = <ScenarioBuilder onSave={onSave} />
  container = document.createElement('div')
  container.innerHTML = renderToString(element)
  document.body.appendChild(container)

  typeBeforeHydration(within(container))
  fillStores()

  await act(async () => {
    root = hydrateRoot(container, element)
  })
}

function typeRaw(input: HTMLElement, text: string): void {
  ;(input as HTMLInputElement).value = text
}

async function saveAndRead(onSave: ReturnType<typeof vi.fn>) {
  const saveButton = await screen.findByRole(
    'button',
    { name: /save forecast/i },
    { timeout: 2000 }
  )
  await act(async () => {
    saveButton.click()
  })
  await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
  return onSave.mock.calls[0][0]
}

describe('typing before hydration is kept', () => {
  it('keeps a Scenario Name typed before hydration, on screen and in the save', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    await hydrateAfterTyping(onSave, (server) => {
      typeRaw(server.getByLabelText('Scenario Name'), 'Holiday plan')
      typeRaw(server.getByLabelText('Description'), 'Two weeks away')
    })

    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByLabelText('Scenario Name')).toHaveValue('Holiday plan')
    expect(screen.getByLabelText('Description')).toHaveValue('Two weeks away')

    const saved = await saveAndRead(onSave)
    expect(saved.name).toBe('Holiday plan')
    expect(saved.description).toBe('Two weeks away')
  })

  it('does NOT adopt money typed before hydration: the server markup has no money field, the seed fills the rows', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    await hydrateAfterTyping(onSave, (server) => {
      expect(server.queryByLabelText(/^Balance for /)).toBeNull()
      expect(server.queryByLabelText(/^Contribution for /)).toBeNull()
      expect(server.queryByLabelText('Current Investments')).toBeNull()
      expect(server.getByLabelText('Scenario Name')).toBeInTheDocument()
    })

    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue('3,456.00')
    expect(screen.getByLabelText('Balance for Index fund')).toHaveValue('9,876.00')

    const saved = await saveAndRead(onSave)
    expect(saved.inputs.savings).toBe(345_600)
    expect(saved.inputs.investments).toBe(987_600)
  })

  it('turns browser autofill/form restore off on every money row field once seeded', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    await hydrateAfterTyping(onSave, () => {})

    const fields = screen.getAllByLabelText(/^(Balance|Contribution|Monthly Contribution) for /)
    expect(fields.length).toBe(4)
    for (const field of fields) expect(field).toHaveAttribute('autocomplete', 'off')
  })

  it('keeps the years and growth rates typed before hydration', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    await hydrateAfterTyping(onSave, (server) => {
      typeRaw(server.getByLabelText('Projection Period (years)'), '25')
      typeRaw(server.getByLabelText('Income Growth Rate'), '4')
      typeRaw(server.getByLabelText('Expense Growth Rate'), '2.5')
    })

    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByLabelText('Projection Period (years)')).toHaveValue(25)
    expect(screen.getByLabelText('Income Growth Rate')).toHaveValue('4')
    expect(screen.getByLabelText('Expense Growth Rate')).toHaveValue('2.5')

    const saved = await saveAndRead(onSave)
    expect(saved.inputs.years).toBe(25)
    expect(saved.scenario.incomeGrowthRate).toBeCloseTo(0.04)
    expect(saved.scenario.expenseGrowthRate).toBeCloseTo(0.025)
  })

  it('still seeds and keeps the defaults when nothing was typed (control)', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    await hydrateAfterTyping(onSave, () => {})

    expect(screen.getByLabelText('Scenario Name')).toHaveValue('My Financial Forecast')
    expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue('3,456.00')
    expect(screen.getByLabelText('Balance for Index fund')).toHaveValue('9,876.00')

    const saved = await saveAndRead(onSave)
    expect(saved.name).toBe('My Financial Forecast')
    expect(saved.inputs.savings).toBe(345_600)
    expect(saved.inputs.investments).toBe(987_600)
  })
})
