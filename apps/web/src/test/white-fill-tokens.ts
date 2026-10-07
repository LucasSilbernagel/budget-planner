import { expect } from 'vitest'

/**
 * Class-token pins for white text on a coloured fill (story 115.1, FR183).
 *
 * ⚠️ Tokens, not paint: jsdom applies no Tailwind, so a computed-colour
 * assertion would pass for free. The rendered contrast is proven by the
 * story's Lighthouse re-run.
 */

/** The element uses the shared `.fill-green` and NO other green fill utility. */
export function expectSharedGreen(element: Element): void {
  const tokens = [...element.classList]
  expect(tokens).toContain('fill-green')
  // Any other `bg-green-*` (plain, `dark:`, an old `hover:bg-green-700`): a
  // utility outranks the components-layer class, so the old green would paint.
  expect(
    tokens.filter((token) => /(^|:)bg-green-/.test(token) && token !== 'hover:bg-green-800')
  ).toEqual([])
}

/** A red/blue white-text fill keeps its light shade in dark: no dark fill override. */
export function expectNoDarkFill(element: Element): void {
  const tokens = [...element.classList]
  expect(tokens.filter((token) => token.startsWith('dark:bg-'))).toEqual([])
  expect(tokens.filter((token) => token.startsWith('dark:hover:bg-'))).toEqual([])
}
