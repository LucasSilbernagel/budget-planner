/**
 * The accessible name of a locked premium row (`PremiumFeatureGate`'s button),
 * as a role-query matcher (story 116.2, FR184).
 *
 * Since 116.2 the button has no `aria-label`: its name is its own content, the
 * visible title, the description, the badge's "Premium" and a hidden ", locked".
 * So the matcher is anchored on BOTH ends: it starts with the visible `title`
 * (a whole word) and ends with "Premium, locked".
 *
 * ⚠️ It does not pin the full concatenated string, nor the exact spacing:
 * jsdom has no Tailwind, so its name puts a space before the comma ("Premium ,
 * locked") where Chrome may not. The real-browser name is checked by the
 * Lighthouse re-run (`label-content-name-mismatch`), not here.
 *
 * ⚠️ `getByRole`'s `name` matches the WHOLE name, so an absence probe on a
 * stale matcher passes silently: pair every `queryByRole(…, { name:
 * lockedName(…) })` absence with a positive control.
 */
import { within } from '@testing-library/react'
import { expect } from 'vitest'

export function lockedName(title: string): RegExp {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}\\b.*\\bpremium\\s*,\\s*locked$`, 'i')
}

/** Any locked premium row, whatever its title. */
export const ANY_LOCKED_NAME = /\bpremium\s*,\s*locked$/i

/** The accessible name testing-library computes for `button` (via a `name` matcher). */
function accessibleNameOf(button: HTMLElement): string {
  let name: string | null = null
  within(button.parentElement ?? document.body).queryAllByRole('button', {
    name: (computed, node) => {
      if (node === button) name = computed
      return false
    },
  })
  if (name === null) throw new Error('not an exposed button')
  return name
}

/**
 * Asserts every locked premium row in `container` is named by what it SHOWS
 * (story 116.2, AC-1/AC-2): no `aria-label`/`aria-labelledby`; the name starts
 * with the row's first visible text (its title), contains every other visible
 * text (the description, the badge's "Premium") and ends "Premium, locked".
 * Derived from each row's own rendered text, so no title is hard-coded.
 * Returns the rows so callers can count them.
 */
export function expectLockedRowsNamedByVisibleText(container: HTMLElement): HTMLElement[] {
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="premium-gate-locked"]')
  )
  for (const row of rows) {
    expect(row).not.toHaveAttribute('aria-label')
    expect(row).not.toHaveAttribute('aria-labelledby')
    const visibleTexts = Array.from(row.querySelectorAll('*'))
      .filter((el) => el.closest('[aria-hidden="true"], .sr-only') === null)
      .flatMap((el) => Array.from(el.childNodes))
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => (node.textContent ?? '').trim())
      .filter(Boolean)
    const name = accessibleNameOf(row)
    expect(visibleTexts.length, `${name}: has a title and a description`).toBeGreaterThanOrEqual(3)
    expect(name.startsWith(visibleTexts[0] as string), `${name}: starts with its title`).toBe(true)
    for (const text of visibleTexts) expect(name).toContain(text)
    expect(name).toMatch(ANY_LOCKED_NAME)
  }
  return rows
}
