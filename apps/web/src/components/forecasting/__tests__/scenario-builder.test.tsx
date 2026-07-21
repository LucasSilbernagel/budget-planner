import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { ScenarioBuilder } from '../scenario-builder'

/**
 * ScenarioBuilder tests (story bug-3).
 *
 * These lock the input-defect fixes (AC-1 currency-mode-aware amount prefix,
 * AC-2 savings/investments cents round-trip) and the reload hydration (AC-4).
 * The component was previously untested.
 */

// Control the currency mode/currency/locale without touching the real zustand
// persist store (whose createJSONStorage binds localStorage at import time).
const mockCurrency = vi.hoisted(() => ({
  mode: 'none' as 'none' | 'symbol',
  currency: 'NONE',
  locale: 'en-US',
}))

vi.mock('../../../stores/currencyStore', () => ({
  // Symbol-less, grouped-less formatter so the only currency symbols on screen
  // come from the amount-prefix under test (not from formatCurrency).
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
  useCurrencyPreferences: () => ({ ...mockCurrency }),
  useCurrencyMode: () => mockCurrency.mode,
  useCurrencyCode: () => mockCurrency.currency,
}))

beforeEach(() => {
  mockCurrency.mode = 'none'
  mockCurrency.currency = 'NONE'
  mockCurrency.locale = 'en-US'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ScenarioBuilder amount prefix (bug-3 AC-1)', () => {
  it('shows no currency symbol on amount inputs in currency-less mode', () => {
    mockCurrency.mode = 'none'
    render(<ScenarioBuilder onSave={vi.fn()} />)
    // The old hard-coded `$` is gone, and neutral mode shows no symbol at all.
    expect(screen.queryByText('$')).toBeNull()
    expect(screen.queryByText('€')).toBeNull()
  })

  it('uses the selected currency symbol (not a literal $) in symbol mode', () => {
    mockCurrency.mode = 'symbol'
    mockCurrency.currency = 'EUR'
    render(<ScenarioBuilder onSave={vi.fn()} />)
    // Income + expense rows each render the EUR symbol as the amount prefix.
    expect(screen.getAllByText('€').length).toBeGreaterThan(0)
    expect(screen.queryByText('$')).toBeNull()
  })
})

describe('ScenarioBuilder savings/investments parsing (bug-3 AC-2)', () => {
  it('stores a typed savings amount as exact cents, without the double-×100 bug', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)

    // Default savings renders as 5000.00; change it to 7500.
    fireEvent.change(screen.getByDisplayValue('5000.00'), { target: { value: '7500' } })

    // The Save button appears only once the debounced forecast has computed.
    const saveButton = await screen.findByRole(
      'button',
      { name: /save forecast/i },
      { timeout: 2000 }
    )
    fireEvent.click(saveButton)

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    // 7500 → 750000 cents. The old parseFloat + ×100-in-handler bug produced
    // 75000000 ($500,000).
    expect(onSave.mock.calls[0][0].inputs.savings).toBe(750000)
  })

  // Helper: type `typed` into Current Savings, save, and return the persisted cents.
  async function savingsCentsAfterTyping(typed: string): Promise<number> {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    fireEvent.change(screen.getByDisplayValue('5000.00'), { target: { value: typed } })
    const saveButton = await screen.findByRole(
      'button',
      { name: /save forecast/i },
      { timeout: 2000 }
    )
    fireEvent.click(saveButton)
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    return onSave.mock.calls[0][0].inputs.savings
  }

  it('parses a GROUPED value without the parseFloat truncation bug', async () => {
    // The exact case AC-2 calls out: parseFloat('12,345.67') === 12 (truncates at
    // the comma). parseFromInput must strip grouping → 1234567 cents.
    expect(await savingsCentsAfterTyping('12,345.67')).toBe(1234567)
  })

  it('parses a symbol- and group-formatted value in symbol mode', async () => {
    // In symbol mode the field can display/edit a symbol+grouping string; the
    // core parser strips both. €7,500.50 → 750050 cents (not NaN, not truncated).
    mockCurrency.mode = 'symbol'
    mockCurrency.currency = 'EUR'
    expect(await savingsCentsAfterTyping('€7,500.50')).toBe(750050)
  })
})

describe('ScenarioBuilder reload hydration (bug-3 AC-4)', () => {
  const savedForecast: SavedForecast = {
    id: 'saved-1',
    name: 'My Saved Plan',
    description: 'A loaded scenario',
    scenario: {
      name: 'My Saved Plan',
      description: 'A loaded scenario',
      incomeGrowthRate: 0.05,
      expenseGrowthRate: 0.03,
      newIncome: [{ name: 'Consulting', amount: 800000, frequency: 'monthly' }],
      newExpenses: [{ name: 'Rent', amount: 250000, frequency: 'monthly' }],
      oneTimeEvents: [{ year: 3, amount: 1000000, name: 'Bonus' }],
    },
    result: {
      scenario: { name: 'My Saved Plan', incomeGrowthRate: 0.05, expenseGrowthRate: 0.03 },
      baseline: [],
      projection: [],
      summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
    },
    inputs: { savings: 1234500, investments: 6789000, years: 15 },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }

  it('seeds every field from a loaded forecast, including savings/investments/years', () => {
    render(<ScenarioBuilder onSave={vi.fn()} initialForecast={savedForecast} />)

    expect(screen.getByDisplayValue('My Saved Plan')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bonus')).toBeInTheDocument()
    // savings 1234500 → 12345.00, investments 6789000 → 67890.00 (mock formatter)
    expect(screen.getByDisplayValue('12345.00')).toBeInTheDocument()
    expect(screen.getByDisplayValue('67890.00')).toBeInTheDocument()
    // years seeded from inputs
    expect(screen.getByDisplayValue('15')).toBeInTheDocument()
  })

  it('defaults savings/investments/years for an older saved row with no persisted inputs', () => {
    const olderRow: SavedForecast = { ...savedForecast, inputs: undefined }
    render(<ScenarioBuilder onSave={vi.fn()} initialForecast={olderRow} />)

    // Name still seeds from the scenario, but the missing inputs fall back to the
    // builder defaults (savings 500000 → 5000.00, investments 1000000 → 10000.00,
    // years 10) instead of throwing.
    expect(screen.getByDisplayValue('My Saved Plan')).toBeInTheDocument()
    expect(screen.getByDisplayValue('5000.00')).toBeInTheDocument()
    expect(screen.getByDisplayValue('10000.00')).toBeInTheDocument()
    expect(screen.getByDisplayValue('10')).toBeInTheDocument()
  })
})
