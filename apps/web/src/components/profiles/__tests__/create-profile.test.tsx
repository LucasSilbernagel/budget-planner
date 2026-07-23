import { renderWithProviders, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { CreateProfileDialog } from '../create-profile'

/**
 * CreateProfileDialog currency-selector tests (story 8-2, FR26; story 22-1 / FR38
 * label neutralization).
 *
 * The profile dialog carries its own currency list, independent of the core
 * `getSupportedCurrencies()`. Consolidation drops the dollar-family duplicates
 * (CAD/AUD) that render identically to USD, keeping a single USD entry.
 * Distinct-render codes (SEK/NZD) stay. Story 22-1: option LABELS now come from
 * the shared, nationality-neutral `currencyDisplayLabel` (matching the Settings
 * picker) — no national name ("US Dollar", "New Zealand Dollar") surfaces now
 * that `$` is the app default.
 */
describe('CreateProfileDialog currency options (story 8-2 / story 22-1)', () => {
  const renderDialog = () => renderWithProviders(<CreateProfileDialog onClose={() => {}} />)

  const optionsOf = (select: Element) =>
    Array.from(select.querySelectorAll('option')).map((o) => ({
      value: (o as HTMLOptionElement).value,
      label: o.textContent,
    }))

  it('drops the consolidated dollar duplicates (CAD / AUD)', () => {
    renderDialog()
    const values = optionsOf(screen.getByRole('combobox', { name: /currency/i })).map(
      (o) => o.value
    )
    expect(values).not.toContain('CAD')
    expect(values).not.toContain('AUD')
  })

  it('keeps a single USD entry labelled with the nationality-neutral "$" symbol (story 22-1)', () => {
    renderDialog()
    const usd = optionsOf(screen.getByRole('combobox', { name: /currency/i })).filter(
      (o) => o.value === 'USD'
    )
    expect(usd).toHaveLength(1)
    expect(usd[0].label).toBe('$')
  })

  it('surfaces no national-dollar label anywhere in the picker (story 22-1 / SCP refinement)', () => {
    renderDialog()
    const labels = optionsOf(screen.getByRole('combobox', { name: /currency/i })).map(
      (o) => o.label
    )
    for (const label of labels) {
      expect(label).not.toMatch(/dollar/i)
    }
  })

  it('labels each currency with its shared nationality-neutral display label (story 22-1)', () => {
    renderDialog()
    const byValue = new Map(
      optionsOf(screen.getByRole('combobox', { name: /currency/i })).map((o) => [o.value, o.label])
    )
    // Positive, per-code assertions (not just a negative sweep). These mirror the
    // canonical `currencyDisplayLabel` outputs used by the Settings picker.
    expect(byValue.get('NONE')).toBe('No Currency')
    expect(byValue.get('USD')).toBe('$')
    expect(byValue.get('EUR')).toBe('€')
    expect(byValue.get('GBP')).toBe('£')
    expect(byValue.get('CHF')).toBe('CHF')
    // JPY and CNY both use the ¥ glyph, so each carries a disambiguating suffix —
    // guards against the old collision where both rendered a bare "¥".
    expect(byValue.get('JPY')).toBe('¥ JPY')
    expect(byValue.get('CNY')).toBe('¥ CNY')
    expect(byValue.get('JPY')).not.toBe(byValue.get('CNY'))
    // SEK/NZD have no core symbol → bare ISO code (canonical, leak-free).
    expect(byValue.get('SEK')).toBe('SEK')
    expect(byValue.get('NZD')).toBe('NZD')
  })

  it('keeps distinct-render currencies SEK and NZD (not part of the dollar cluster)', () => {
    renderDialog()
    const values = optionsOf(screen.getByRole('combobox', { name: /currency/i })).map(
      (o) => o.value
    )
    expect(values).toContain('SEK')
    expect(values).toContain('NZD')
  })
})
