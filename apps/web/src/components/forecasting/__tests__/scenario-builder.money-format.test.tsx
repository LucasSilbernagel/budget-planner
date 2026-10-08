import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { ScenarioBuilder } from '../scenario-builder'

const mockCurrency = vi.hoisted(() => ({
  mode: 'symbol' as 'none' | 'symbol',
  currency: 'USD',
  locale: 'en-US',
}))

vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
  useCurrencyPreferences: () => ({ ...mockCurrency }),
  useCurrencyMode: () => mockCurrency.mode,
  useCurrencyCode: () => mockCurrency.currency,
}))

const ISO = '2026-10-06T00:00:00.000Z'
const PROFILE = 'profile-test'
const SALARY_CENTS = 4_200_000

beforeEach(() => {
  mockCurrency.mode = 'symbol'
  mockCurrency.currency = 'USD'
  mockCurrency.locale = 'en-US'
  useProfileStore.setState({ activeProfileId: PROFILE })
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        profileId: PROFILE,
        userId: 0,
        name: 'Salary',
        amount: SALARY_CENTS,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
  useExpenseStore.setState({ expenses: [] })
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  vi.clearAllMocks()
})

function incomeSection(): HTMLElement {
  return screen.getByRole('heading', { name: 'Income Sources' }).closest('section') as HTMLElement
}

function salaryAmount(): HTMLInputElement {
  return within(incomeSection()).getByLabelText('Amount') as HTMLInputElement
}

function addEvent(): { amount: HTMLInputElement; direction: HTMLSelectElement } {
  fireEvent.click(screen.getByRole('button', { name: '+ Add Event' }))
  return {
    amount: document.querySelector('input[id^="event-amount-"]') as HTMLInputElement,
    direction: document.querySelector('select[id^="event-direction-"]') as HTMLSelectElement,
  }
}

async function save(onSave: ReturnType<typeof vi.fn>) {
  fireEvent.click(await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 }))
  await waitFor(() => expect(onSave).toHaveBeenCalled())
  return onSave.mock.calls.at(-1)?.[0]
}

function renderBuilder() {
  const onSave = vi.fn().mockResolvedValue({ success: true })
  render(<ScenarioBuilder onSave={onSave} />)
  return onSave
}

describe('a money field opens formatted (AC 2)', () => {
  it('en-US: the seeded amount shows grouped with two decimals', () => {
    renderBuilder()
    expect(salaryAmount()).toHaveValue('42,000.00')
  })

  it('de-DE (EUR): the seeded amount shows in the user’s own grouping', () => {
    mockCurrency.currency = 'EUR'
    mockCurrency.locale = 'de-DE'
    renderBuilder()
    expect(salaryAmount()).toHaveValue('42.000,00')
  })

  it('every kind of builder money field is a decimal text field (AC 1)', () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
    const { amount: event } = addEvent()
    const fields = [
      salaryAmount(),
      event,
      screen.getByLabelText('Balance for New Account'),
      screen.getByLabelText('Monthly Contribution for New Account'),
      screen.getByLabelText('Balance for New Investment'),
      screen.getByLabelText('Contribution for New Investment'),
    ]
    for (const field of fields) {
      expect(field).toHaveAttribute('type', 'text')
      expect(field).toHaveAttribute('inputmode', 'decimal')
      expect(field).not.toHaveAttribute('min')
      expect(field).not.toHaveAttribute('step')
      expect(within(field.parentElement as HTMLElement).getByText('$')).toBeInTheDocument()
    }
    for (const field of fields.slice(1)) expect(field).toHaveValue('0.00')
  })
})

describe('typing and blur, as on /income (AC 3)', () => {
  it('shows the typed text until blur, then re-echoes it grouped', async () => {
    const onSave = renderBuilder()
    const amount = salaryAmount()
    fireEvent.change(amount, { target: { value: '42001' } })
    expect(amount).toHaveValue('42001')
    fireEvent.blur(amount)
    expect(amount).toHaveValue('42,001.00')
    expect((await save(onSave)).scenario.newIncome[0].amount).toBe(4_200_100)
  })

  it('re-echoes a savings and an investment row field on blur too', () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
    for (const label of ['Balance for New Account', 'Contribution for New Investment']) {
      const field = screen.getByLabelText(label)
      fireEvent.change(field, { target: { value: '1234.5' } })
      fireEvent.blur(field)
      expect(field).toHaveValue('1,234.50')
    }
  })

  it('drops a letter as it is typed', () => {
    renderBuilder()
    const amount = salaryAmount()
    fireEvent.change(amount, { target: { value: '12a3' } })
    expect(amount).toHaveValue('123')
  })

  it('keeps an emptied field empty on blur, and counts it as 0', async () => {
    const onSave = renderBuilder()
    const amount = salaryAmount()
    fireEvent.change(amount, { target: { value: '' } })
    fireEvent.blur(amount)
    expect(amount).toHaveValue('')
    expect(amount).not.toHaveAttribute('aria-invalid')
    expect((await save(onSave)).scenario.newIncome[0].amount).toBe(0)
  })

  it('keeps a digit-free partial ("-", ".") visible on blur', () => {
    renderBuilder()
    const amount = salaryAmount()
    for (const partial of ['-', '.']) {
      fireEvent.change(amount, { target: { value: partial } })
      fireEvent.blur(amount)
      expect(amount).toHaveValue(partial)
    }
  })

  it('de-DE: reads the user’s grouping and re-echoes in it', async () => {
    mockCurrency.currency = 'EUR'
    mockCurrency.locale = 'de-DE'
    const onSave = renderBuilder()
    const amount = salaryAmount()
    fireEvent.change(amount, { target: { value: '42.000,50' } })
    fireEvent.blur(amount)
    expect(amount).toHaveValue('42.000,50')
    expect((await save(onSave)).scenario.newIncome[0].amount).toBe(4_200_050)
  })

  it('truncates past two decimals, as the other pages do (Q3)', async () => {
    const onSave = renderBuilder()
    fireEvent.change(salaryAmount(), { target: { value: '1.239' } })
    expect((await save(onSave)).scenario.newIncome[0].amount).toBe(123)
  })
})

describe('a refused entry (AC 4)', () => {
  it('"Enter a number." holds Save, and blur keeps what was typed', async () => {
    renderBuilder()
    await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
    const amount = salaryAmount()
    fireEvent.change(amount, { target: { value: '1.2.3' } })
    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(within(incomeSection()).getByText('Enter a number.')).toBeInTheDocument()
    expect(screen.getByTestId('save-blocked-reason')).toHaveTextContent(
      'Fix the highlighted fields to save'
    )
    expect(screen.getByRole('button', { name: /save forecast/i })).toBeDisabled()
    fireEvent.blur(amount)
    expect(amount).toHaveValue('1.2.3')
  })

  it('one cent over the money limit is refused with the limit message (Q1)', () => {
    renderBuilder()
    const amount = salaryAmount()
    fireEvent.change(amount, { target: { value: '21474836.48' } })
    expect(within(incomeSection()).getByText('Enter an amount up to $21,474,836.47')).toBeTruthy()
    fireEvent.change(amount, { target: { value: '21474836.47' } })
    expect(amount).not.toHaveAttribute('aria-invalid')
  })
})

describe('the one-time event keeps its sign rules (AC 5)', () => {
  it('-500 selects Money out, stores −50000, and blur shows the magnitude', async () => {
    const onSave = renderBuilder()
    const { amount, direction } = addEvent()
    fireEvent.change(amount, { target: { value: '-500' } })
    expect(direction).toHaveValue('out')
    expect(amount).toHaveValue('500')
    fireEvent.blur(amount)
    expect(amount).toHaveValue('500.00')
    expect((await save(onSave)).scenario.oneTimeEvents[0].amount).toBe(-50_000)
  })

  it('a lone "-" selects Money out on its first keystroke and stays visible', () => {
    renderBuilder()
    const { amount, direction } = addEvent()
    fireEvent.change(amount, { target: { value: '-' } })
    expect(direction).toHaveValue('out')
    expect(amount).toHaveValue('-')
    expect(amount).not.toHaveAttribute('aria-invalid')
  })
})
