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
 * separator comes from the same locale that formatter used
 * (`useCurrencyPreferences().locale`), found with `Intl.formatToParts`, never a
 * hard-coded `,` (de-DE uses `.`, de-CH `'`, en-ZA a no-break space).
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

/** The locale's digit-group separator, or `null` if it has none (or the locale is invalid). */
export function groupSeparator(locale: string): string | null {
  try {
    return (
      new Intl.NumberFormat(locale).formatToParts(1_234_567).find((p) => p.type === 'group')
        ?.value ?? null
    )
  } catch {
    return null
  }
}

const DIGIT = /\d/

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
  const { locale } = useCurrencyPreferences()
  const segments = splitAtGroupSeparators(text, groupSeparator(locale))
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
