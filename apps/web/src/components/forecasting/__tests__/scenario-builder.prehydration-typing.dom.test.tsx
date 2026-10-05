/**
 * Text typed into the builder BEFORE hydration survives it.
 *
 * The server-rendered fields are live as soon as they paint, and on a cold load
 * that can be seconds before React takes over (observed during 97.2: a Scenario
 * Name typed in that window was overwritten). Hydration leaves the typed DOM
 * value in place but fires no onChange, so state still holds the server value,
 * and the next re-render writes it back. The store seed (62.1) is such a
 * re-render, and for Current Savings / Investments it also replaces the value.
 *
 * RTL's `render()` has no hydration pass, so this needs `renderToString` +
 * `hydrateRoot`, as in `scenario-builder.seeding.dom.test.tsx`. Typing before
 * hydration is simulated by setting `.value` on the server markup with no event,
 * which is exactly what the browser leaves behind when no listener is attached.
 */

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

// Same currency stub as the seeding suite: a displayed amount is `cents / 100`.
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

/** Income, $3,456 of savings and $9,876 of investments: the seed re-renders AND sets both. */
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

/**
 * Server-render, let `typeBeforeHydration` edit the live markup, fill the stores
 * (as localStorage does on a real load), then hydrate and let the seed land.
 */
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

    // The seed has landed (positive control), so the re-render has happened.
    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByLabelText('Scenario Name')).toHaveValue('Holiday plan')
    expect(screen.getByLabelText('Description')).toHaveValue('Two weeks away')

    const saved = await saveAndRead(onSave)
    expect(saved.name).toBe('Holiday plan')
    expect(saved.description).toBe('Two weeks away')
  })

  it('keeps a Current Savings typed before hydration instead of seeding over it', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    await hydrateAfterTyping(onSave, (server) => {
      typeRaw(server.getByLabelText('Current Savings'), '1234')
    })

    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    // The seeded $3,456 must NOT replace what the user typed.
    expect(screen.queryByDisplayValue('3456.00')).toBeNull()
    // And the field shows the typed amount, not a blank or 0.00 (code review).
    expect(screen.getByLabelText('Current Savings')).toHaveValue('1234.00')
    // Investments was not typed into, so it is still seeded.
    expect(screen.getByLabelText('Current Investments')).toHaveValue('9876.00')

    const saved = await saveAndRead(onSave)
    expect(saved.inputs.savings).toBe(123_400)
    expect(saved.inputs.investments).toBe(987_600)
  })

  it('keeps a Current Investments typed before hydration instead of seeding over it', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    await hydrateAfterTyping(onSave, (server) => {
      typeRaw(server.getByLabelText('Current Investments'), '5000')
    })

    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByLabelText('Current Investments')).toHaveValue('5000.00')
    expect(screen.getByLabelText('Current Savings')).toHaveValue('3456.00')

    const saved = await saveAndRead(onSave)
    expect(saved.inputs.investments).toBe(500_000)
    expect(saved.inputs.savings).toBe(345_600)
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

  it('still seeds when the only pre-hydration edit is one the money filter rejects', async () => {
    // `0.00a` sanitizes back to the server's `0.00`: nothing the field accepts
    // was typed, so it must not count as a touch and block the seed.
    const onSave = vi.fn().mockResolvedValue({ success: true })
    await hydrateAfterTyping(onSave, (server) => {
      typeRaw(server.getByLabelText('Current Savings'), '0.00a')
    })

    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByLabelText('Current Savings')).toHaveValue('3456.00')

    const saved = await saveAndRead(onSave)
    expect(saved.inputs.savings).toBe(345_600)
  })

  it('still seeds and keeps the defaults when nothing was typed (control)', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    await hydrateAfterTyping(onSave, () => {})

    expect(screen.getByLabelText('Scenario Name')).toHaveValue('My Financial Forecast')
    expect(screen.getByDisplayValue('3456.00')).toBeInTheDocument()
    expect(screen.getByDisplayValue('9876.00')).toBeInTheDocument()

    const saved = await saveAndRead(onSave)
    expect(saved.name).toBe('My Financial Forecast')
    expect(saved.inputs.savings).toBe(345_600)
    expect(saved.inputs.investments).toBe(987_600)
  })
})
