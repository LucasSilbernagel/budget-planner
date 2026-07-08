import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../../stores/currencyStore'
import { CurrencyToggle } from '../currency-toggle'

/**
 * CurrencyToggle component tests (story 4-6, Task 4; updated by story 8-1).
 *
 * Covers AC-1 (currency-less default), AC-2 (switching to explicit symbols and
 * choosing a currency). Since story 8-1 the currency selection alone drives
 * formatting — there is no separate locale control. AC-3 persistence is provided
 * by the store middleware and covered at the store/integration level.
 */
describe('CurrencyToggle', () => {
  beforeEach(() => {
    // Reset the shared (singleton) store to its currency-less defaults.
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
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

  it('does not offer the consolidated dollar variants CAD/AUD/MXN (story 8-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CurrencyToggle />)
    await user.click(screen.getByRole('switch', { name: /currency symbols/i }))

    const options = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(options).not.toContain('CAD')
    expect(options).not.toContain('AUD')
    expect(options).not.toContain('MXN')
    // The canonical dollar representative remains selectable.
    expect(options).toContain('USD')
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

  // --- Symbol presentation (story 14-1, UX-DR16) ---

  it('presents currencies by symbol, not by bare ISO code', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CurrencyToggle />)
    await user.click(screen.getByRole('switch', { name: /currency symbols/i }))

    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    const byValue = new Map(options.map((o) => [o.value, o.textContent?.trim() ?? '']))

    // The USD option shows the dollar symbol; no option is labelled by its bare code.
    expect(byValue.get('USD')).toBe('$')
    expect(byValue.get('EUR')).toBe('€')
    expect(byValue.get('GBP')).toBe('£')
    for (const [value, label] of byValue) {
      // CHF is the one currency whose symbol IS its code, so "CHF" is its correct
      // symbol label (not a leftover ISO code). Every other option must differ.
      if (value === 'CHF') continue
      expect(label).not.toBe(value)
    }
  })

  it('keeps JPY and CNY distinguishable despite the shared ¥ glyph', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CurrencyToggle />)
    await user.click(screen.getByRole('switch', { name: /currency symbols/i }))

    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    const jpy = options.find((o) => o.value === 'JPY')?.textContent?.trim()
    const cny = options.find((o) => o.value === 'CNY')?.textContent?.trim()

    expect(jpy).toBeTruthy()
    expect(cny).toBeTruthy()
    expect(jpy).not.toBe(cny)
    expect(jpy).toContain('JPY')
    expect(cny).toContain('CNY')
  })

  it('still writes the ISO code (not the symbol) to the store when a symbol is picked', async () => {
    const user = userEvent.setup()
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
    renderWithProviders(<CurrencyToggle />)

    // Select by value — the underlying option value must remain the ISO code.
    await user.selectOptions(screen.getByRole('combobox', { name: /currency/i }), 'EUR')

    expect(useCurrencyStore.getState().currency).toBe('EUR')
  })

  // --- No separate locale control (story 8-1) ---

  it('never renders a locale selector, even in symbol mode', async () => {
    const user = userEvent.setup()
    useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
    renderWithProviders(<CurrencyToggle />)

    // The currency select is present, but the retired Locale control is not.
    expect(screen.getByRole('combobox', { name: /currency/i })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /locale/i })).not.toBeInTheDocument()

    // Toggling mode off and on must not resurrect it either.
    await user.click(screen.getByRole('switch', { name: /currency symbols/i }))
    await user.click(screen.getByRole('switch', { name: /currency symbols/i }))
    expect(screen.queryByRole('combobox', { name: /locale/i })).not.toBeInTheDocument()
  })
})
