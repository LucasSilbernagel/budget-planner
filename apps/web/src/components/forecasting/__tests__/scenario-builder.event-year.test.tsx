import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScenarioBuilder } from '../scenario-builder'

vi.mock('../../../stores/currencyStore', () => ({
	useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
	useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
	useCurrencyMode: () => 'none',
	useCurrencyCode: () => 'NONE',
}))

const HELP = '1 = the first year of your forecast'

function describedBy(element: HTMLElement): string[] {
	return (element.getAttribute('aria-describedby') ?? '')
		.split(/\s+/)
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent?.trim() ?? `<missing #${id}>`)
}

function addEvent(): HTMLInputElement {
	render(<ScenarioBuilder onSave={vi.fn()} />)
	fireEvent.click(screen.getByRole('button', { name: /add event/i }))
	return screen.getByLabelText('Years from now') as HTMLInputElement
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
})

afterEach(() => {
	vi.useRealTimers()
})

describe('the one-time event year field', () => {
	it('is labelled "Years from now", not "Year"', () => {
		const field = addEvent()
		expect(field.id).toMatch(/^event-year-/)
		expect(screen.queryByLabelText('Year')).toBeNull()
	})

	it('keeps its label on one line, so the row stays aligned (108.1 review)', () => {
		const field = addEvent()
		const label = document.querySelector(`label[for="${field.id}"]`)
		expect(label?.textContent?.trim()).toBe('Years from now')
		expect(label?.classList.contains('whitespace-nowrap')).toBe(true)
	})

	it('explains that 1 is the first year and shows the calendar year, both described', () => {
		const field = addEvent()
		expect(field.value).toBe('1')
		expect(screen.getByText(HELP)).toBeInTheDocument()
		expect(screen.getByText('Year 1 (2027)')).toBeInTheDocument()
		expect(describedBy(field)).toEqual(['Year 1 (2027)', HELP])
	})

	it('follows the value: year 5 is 2031', () => {
		const field = addEvent()
		fireEvent.change(field, { target: { value: '5' } })
		expect(field.value).toBe('5')
		expect(screen.getByText('Year 5 (2031)')).toBeInTheDocument()
		expect(screen.queryByText('Year 1 (2027)')).toBeNull()
	})

	it('keeps the stored value a whole number from 1 to the period', () => {
		const field = addEvent()
		expect(field).toHaveAttribute('type', 'number')
		expect(field).toHaveAttribute('min', '1')
		expect(field).toHaveAttribute('max', '10')
		expect(field).toHaveAttribute('step', '1')
		fireEvent.change(field, { target: { value: '25' } })
		expect(field.value).toBe('10')
		expect(screen.getByText('Year 10 (2036)')).toBeInTheDocument()
	})
})
