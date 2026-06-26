import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../../stores/currencyStore'
import { CurrencyToggle } from '../currency-toggle'

/**
 * CurrencyToggle component tests (story 4-6, Task 4).
 *
 * Covers AC-1 (currency-less default), AC-2 (switching to explicit symbols and
 * choosing a currency). AC-3 persistence is provided by the store middleware
 * and covered at the store/integration level.
 */
describe('CurrencyToggle', () => {
  beforeEach(() => {
    // Reset the shared (singleton) store to its currency-less defaults.
    useCurrencyStore.setState({
      mode: 'none',
      currency: 'NONE',
      locale: 'en-US',
      localeUserSet: false,
    })
  })

  it('defaults to symbols off (currency-less) with no currency picker', () => {
    renderWithProviders(<CurrencyToggle />)

    const toggle = screen.getByRole('switch', { name: /currency symbols/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('combobox', { name: /currency/i })).not.toBeInTheDocument()
  })

  it('turns on symbol mode and defaults the currency to USD when toggled on', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CurrencyToggle />)

    await user.click(screen.getByRole('switch', { name: /currency symbols/i }))

    expect(screen.getByRole('switch', { name: /currency symbols/i })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(useCurrencyStore.getState().mode).toBe('symbol')
    expect(useCurrencyStore.getState().currency).toBe('USD')

    const picker = screen.getByRole('combobox', { name: /currency/i })
    expect(picker).toBeInTheDocument()
    expect(picker).toHaveValue('USD')
  })

  it('does not offer NONE as a selectable symbol currency', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CurrencyToggle />)
    await user.click(screen.getByRole('switch', { name: /currency symbols/i }))

    const options = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(options).toContain('USD')
    expect(options).toContain('EUR')
    expect(options).not.toContain('NONE')
  })

  it('updates the store currency when a different currency is picked', async () => {
    const user = userEvent.setup()
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
    renderWithProviders(<CurrencyToggle />)

    await user.selectOptions(screen.getByRole('combobox', { name: /currency/i }), 'EUR')

    expect(useCurrencyStore.getState().currency).toBe('EUR')
  })

  it('switches back to currency-less mode and hides the picker', async () => {
    const user = userEvent.setup()
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
    renderWithProviders(<CurrencyToggle />)

    await user.click(screen.getByRole('switch', { name: /currency symbols/i }))

    expect(useCurrencyStore.getState().mode).toBe('none')
    expect(screen.queryByRole('combobox', { name: /currency/i })).not.toBeInTheDocument()
  })

  // --- Locale selector (story 4-7) ---

  it('shows a locale picker only in symbol mode', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CurrencyToggle />)

    // currency-less default: no locale picker
    expect(screen.queryByRole('combobox', { name: /locale/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: /currency symbols/i }))
    expect(screen.getByRole('combobox', { name: /locale/i })).toBeInTheDocument()
  })

  it('reflects the current locale and updates the store on change', async () => {
    const user = userEvent.setup()
    useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR', locale: 'en-US' })
    renderWithProviders(<CurrencyToggle />)

    const localePicker = screen.getByRole('combobox', { name: /locale/i })
    expect(localePicker).toHaveValue('en-US')

    await user.selectOptions(localePicker, 'de-DE')

    expect(useCurrencyStore.getState().locale).toBe('de-DE')
    expect(useCurrencyStore.getState().localeUserSet).toBe(true)
  })
})
