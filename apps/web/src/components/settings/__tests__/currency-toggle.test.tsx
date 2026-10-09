import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { useCurrencyStore } from '../../../stores/currencyStore'
import { CurrencyToggle } from '../currency-toggle'

describe('CurrencyToggle', () => {
	beforeEach(() => {
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

	it('does not offer the consolidated dollar variants CAD/AUD/MXN', async () => {
		const user = userEvent.setup()
		renderWithProviders(<CurrencyToggle />)
		await user.click(screen.getByRole('switch', { name: /currency symbols/i }))

		const options = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
		expect(options).not.toContain('CAD')
		expect(options).not.toContain('AUD')
		expect(options).not.toContain('MXN')
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

	it('presents currencies by symbol, not by bare ISO code', async () => {
		const user = userEvent.setup()
		renderWithProviders(<CurrencyToggle />)
		await user.click(screen.getByRole('switch', { name: /currency symbols/i }))

		const options = screen.getAllByRole('option') as HTMLOptionElement[]
		const byValue = new Map(options.map((o) => [o.value, o.textContent?.trim() ?? '']))

		expect(byValue.get('USD')).toBe('$')
		expect(byValue.get('EUR')).toBe('€')
		expect(byValue.get('GBP')).toBe('£')
		for (const [value, label] of byValue) {
			// CHF is the one currency whose symbol is its code.
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

		await user.selectOptions(screen.getByRole('combobox', { name: /currency/i }), 'EUR')

		expect(useCurrencyStore.getState().currency).toBe('EUR')
	})

	it('never renders a locale selector, even in symbol mode', async () => {
		const user = userEvent.setup()
		useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
		renderWithProviders(<CurrencyToggle />)

		expect(screen.getByRole('combobox', { name: /currency/i })).toBeInTheDocument()
		expect(screen.queryByRole('combobox', { name: /locale/i })).not.toBeInTheDocument()

		await user.click(screen.getByRole('switch', { name: /currency symbols/i }))
		await user.click(screen.getByRole('switch', { name: /currency symbols/i }))
		expect(screen.queryByRole('combobox', { name: /locale/i })).not.toBeInTheDocument()
	})
})
