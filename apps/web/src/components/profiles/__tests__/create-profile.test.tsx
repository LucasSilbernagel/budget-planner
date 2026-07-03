import { renderWithProviders, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { CreateProfileDialog } from '../create-profile'

/**
 * CreateProfileDialog currency-selector tests (story 8-2, FR26).
 *
 * The profile dialog carries its own hardcoded currency list, independent of the
 * core `getSupportedCurrencies()`. Consolidation drops the dollar-family
 * duplicates (CAD/AUD) that render identically to USD, keeping a single US Dollar
 * entry. Distinct-render codes (SEK/NZD) stay.
 */
describe('CreateProfileDialog currency options (story 8-2)', () => {
  const renderDialog = () => renderWithProviders(<CreateProfileDialog onClose={() => {}} />)

  it('drops the consolidated dollar duplicates (Canadian / Australian Dollar)', () => {
    renderDialog()

    const select = screen.getByRole('combobox', { name: /currency/i })
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)

    expect(labels).not.toContain('Canadian Dollar (C$)')
    expect(labels).not.toContain('Australian Dollar (A$)')
  })

  it('keeps a single US Dollar ($) entry as the dollar representative', () => {
    renderDialog()

    const select = screen.getByRole('combobox', { name: /currency/i })
    const usdOptions = Array.from(select.querySelectorAll('option')).filter(
      (o) => (o as HTMLOptionElement).value === 'USD'
    )

    expect(usdOptions).toHaveLength(1)
    expect(usdOptions[0].textContent).toBe('US Dollar ($)')
  })

  it('keeps distinct-render currencies SEK and NZD (not part of the dollar cluster)', () => {
    renderDialog()

    const select = screen.getByRole('combobox', { name: /currency/i })
    const values = Array.from(select.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value
    )

    expect(values).toContain('SEK')
    expect(values).toContain('NZD')
  })
})
