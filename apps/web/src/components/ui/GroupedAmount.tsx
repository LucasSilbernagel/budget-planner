/**
 * A headline money figure that may wrap ONLY between digit groups (story 88.1,
 * FR142, decision D1).
 *
 * ## Why
 *
 * A formatted amount is one unbroken string, so its min-content width is the
 * whole figure. The stat cards sit in `grid-cols-*` columns, which are
 * `minmax(0,1fr)`: a column SHRINKS below its content and the figure overflows
 * its card silently instead of widening the page. With the seed's figures under
 * CI's font (DejaVu Sans) that cut or overflowed 19 of 46 measured figures, e.g.
 * `$1,013,222,221.80` needs 254 px against a 208 px card at 320 px (story 88.1
 * Dev Agent Record, Task 1).
 *
 * A `<wbr>` after each locale group separator gives the browser a break
 * opportunity there and nowhere else, so a figure that does not fit takes a
 * second line at a group boundary (`$1,013,222,` / `221.80`), and never splits
 * inside a group the way `overflow-wrap: anywhere` can (`$14,812,345,6` /
 * `78.90`), which is exactly the misreading this exists to prevent. The type
 * size is untouched. `<wbr>` carries no text, so `textContent`, copy-paste and
 * screen readers read exactly the formatted string.
 *
 * ## Contract
 *
 * `text` is the ALREADY-FORMATTED string from `useFormattedAmount()`. The
 * separator comes from the same locale, mode and currency that formatter used
 * (`useCurrencyPreferences()`), found with `Intl.formatToParts`, never a
 * hard-coded `,` (de-DE uses `.`, en-ZA a no-break space; de-CH's apostrophe
 * differs between CLDR versions).
 *
 * A separator only counts when a DIGIT sits on both sides of it: in en-ZA the
 * same no-break space also separates the `R` from the number, and a break there
 * would strand the symbol.
 *
 * ⚠️ Render it only inside the `hydrated` branch, as every caller does: the
 * locale comes from a persisted store, so the server and the first client
 * render could otherwise disagree on where the `<wbr>`s go.
 */

import { Fragment } from 'react'
import type React from 'react'
import { useCurrencyPreferences } from '../../stores/currencyStore'

/**
 * The digit-group separator of the formatter that produced the text, or `null`
 * if it has none (or the locale/currency is invalid).
 *
 * Pass `currency` in symbol mode: the separator is read from a CURRENCY-style
 * formatter, exactly as `formatCurrency` builds it. Some locales group
 * differently in currency style (de-AT: no-break space in decimal style, `.`
 * in currency style), so a decimal-style lookup would find no break at all.
 */
export function groupSeparator(locale: string, currency?: string | null): string | null {
  try {
    const options: Intl.NumberFormatOptions = currency ? { style: 'currency', currency } : {}
    return (
      new Intl.NumberFormat(locale, options)
        .formatToParts(1_234_567)
        .find((p) => p.type === 'group')?.value ?? null
    )
  } catch {
    return null
  }
}

/** Any decimal digit, not just ASCII (a locale with native digits still groups). */
const DIGIT = /\p{Nd}/u

/**
 * Splits `text` just AFTER each `separator` that has a digit on both sides.
 * Joining the result gives `text` back unchanged.
 */
export function splitAtGroupSeparators(text: string, separator: string | null): string[] {
  if (!separator) return [text]
  const segments: string[] = []
  let start = 0
  for (let i = text.indexOf(separator); i !== -1; i = text.indexOf(separator, i + 1)) {
    const end = i + separator.length
    if (DIGIT.test(text.charAt(i - 1)) && DIGIT.test(text.charAt(end))) {
      segments.push(text.slice(start, end))
      start = end
    }
  }
  segments.push(text.slice(start))
  return segments
}

export function GroupedAmount({ text }: { text: string }): React.ReactElement {
  const { mode, currency, locale } = useCurrencyPreferences()
  // Mirrors `formatCurrency`'s branch: currency-less (or `NONE`) is decimal style.
  const symbolCurrency = mode === 'none' || currency === 'NONE' ? null : currency
  const segments = splitAtGroupSeparators(text, groupSeparator(locale, symbolCurrency))
  return (
    <>
      {segments.map((segment, i) => (
        // Index keys are correct here: the segments are a pure function of
        // `text` and have no identity of their own.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {segment}
        </Fragment>
      ))}
    </>
  )
}
