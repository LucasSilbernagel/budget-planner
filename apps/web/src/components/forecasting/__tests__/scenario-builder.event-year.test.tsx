import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScenarioBuilder } from '../scenario-builder'

/**
 * A one-time event's year field says what it means (story 108.1, FR176, D6).
 *
 * It used to be labelled just "Year", and a user could read it as a calendar
 * year (2027) or as a count. It is a count of years from the start of the
 * forecast: the engine applies an event in loop year `event.year`, 1 being the
 * first projected year. So the field is "Years from now", explains that 1 is the
 * first year, and shows the calendar year beside the value. The stored value is
 * unchanged (an integer 1..period).
 *
 * The clock is fixed (Date only, so the builder's debounce timers stay real):
 * the calendar year is the current year plus the value.
 */

vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
  useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
  useCurrencyMode: () => 'none',
  useCurrencyCode: () => 'NONE',
}))

const HELP = '1 = the first year of your forecast'

/** The texts an element's `aria-describedby` points at, in order. */
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

describe('the one-time event year field (108.1, AC-2)', () => {
  it('is labelled "Years from now", not "Year"', () => {
    const field = addEvent()
    expect(field.id).toMatch(/^event-year-/)
    // Absence of the old label; the getByLabelText above is the positive control.
    expect(screen.queryByLabelText('Year')).toBeNull()
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
    // The clamp is unchanged: above the period lands on the period.
    fireEvent.change(field, { target: { value: '25' } })
    expect(field.value).toBe('10')
    expect(screen.getByText('Year 10 (2036)')).toBeInTheDocument()
  })
})
