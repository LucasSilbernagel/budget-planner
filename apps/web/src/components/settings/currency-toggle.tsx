import { currencyDisplayLabel, getSupportedCurrencies } from '@budget-planner/core'
import { type ChangeEvent, useId } from 'react'
import { useCurrencyStore } from '../../stores/currencyStore'

const SELECTABLE_CURRENCIES = getSupportedCurrencies().filter((code: string) => code !== 'NONE')

export interface CurrencyToggleProps {
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
    // 'NONE' renders raw numbers even in symbol mode, so pick a default currency.
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
      // `max-w-full` lets `flex-wrap` break lines at narrow widths instead of growing to max-content.
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
            {/* The value stays the ISO code for persistence and sync; only the label shows the symbol. */}
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
