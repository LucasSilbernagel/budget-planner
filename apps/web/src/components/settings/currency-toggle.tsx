import { currencyDisplayLabel, getSupportedCurrencies } from '@budget-planner/core'
import { type ChangeEvent, useId } from 'react'
import { useCurrencyStore } from '../../stores/currencyStore'

/**
 * Currency mode toggle (story 4-6, FR9 / UX-DR3).
 *
 * Lets the user switch between the two currency display modes and pick a
 * currency for explicit-symbols mode:
 * - currency-less (default): raw numeric entries, no symbol
 * - explicit symbols: values formatted via Intl.NumberFormat
 *
 * The selected currency alone drives the formatting locale (story 8-1); there is
 * no separate locale control.
 *
 * Preference is held in the global, localStorage-persisted currency store, so a
 * single instance controls formatting across the whole app and the choice
 * survives navigation (AC-3). Since story 11-6 this single instance lives on the
 * consolidated `/settings` surface rather than in each page header.
 */

// 'NONE' is the currency-less sentinel; it is not a selectable symbol currency.
const SELECTABLE_CURRENCIES = getSupportedCurrencies().filter((code: string) => code !== 'NONE')

export interface CurrencyToggleProps {
  /** Extra classes for the outer wrapper (e.g. layout/spacing from the host header). */
  className?: string
}

export function CurrencyToggle({ className }: CurrencyToggleProps) {
  const mode = useCurrencyStore((state) => state.mode)
  const currency = useCurrencyStore((state) => state.currency)
  const setMode = useCurrencyStore((state) => state.setMode)
  const setCurrency = useCurrencyStore((state) => state.setCurrency)

  const labelId = useId()
  const symbolsOn = mode === 'symbol'

  const handleToggle = () => {
    if (symbolsOn) {
      setMode('none')
      return
    }
    setMode('symbol')
    // The currency-less default leaves `currency` as 'NONE', which still renders
    // raw numbers even in symbol mode — pick a sensible default so symbols show.
    if (currency === 'NONE') {
      setCurrency('USD')
    }
  }

  const handleCurrencyChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setCurrency(event.target.value)
  }

  return (
    <div
      role="group"
      aria-label="Currency display"
      // `max-w-full` caps the group at its container width so `flex-wrap` can
      // actually break the label/switch/selects onto multiple lines at narrow
      // (≤320px) widths instead of growing to its single-line max-content width.
      className={`flex max-w-full flex-wrap items-center gap-3 ${className ?? ''}`.trim()}
    >
      <span id={labelId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Currency symbols
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={symbolsOn}
        aria-labelledby={labelId}
        onClick={handleToggle}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          symbolsOn ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            symbolsOn ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>

      {symbolsOn && (
        <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
          <span className="sr-only">Currency</span>
          <select
            aria-label="Currency"
            value={currency === 'NONE' ? 'USD' : currency}
            onChange={handleCurrencyChange}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          >
            {/*
              Story 14-1 (UX-DR16): present each currency by its SYMBOL, not its
              nationality-tagged ISO code. The option `value` stays the ISO code so
              the store/persistence/sync contract (story 8-2) is unchanged; only the
              visible, screen-reader-legible label changes via currencyDisplayLabel.
            */}
            {SELECTABLE_CURRENCIES.map((code: string) => (
              <option key={code} value={code}>
                {currencyDisplayLabel(code)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
