import { expect } from 'vitest'

// Tokens, not paint: jsdom applies no Tailwind, so a computed-colour assertion would pass free.

export function expectSharedGreen(element: Element): void {
  const tokens = [...element.classList]
  expect(tokens).toContain('fill-green')
  // Any other `bg-green-*` (plain, `dark:`, an old `hover:bg-green-700`): a
  // utility outranks the components-layer class, so the old green would paint.
  expect(
    tokens.filter((token) => /(^|:)bg-green-/.test(token) && token !== 'hover:bg-green-800')
  ).toEqual([])
}

export function expectNoDarkFill(element: Element): void {
  const tokens = [...element.classList]
  expect(tokens.filter((token) => token.startsWith('dark:bg-'))).toEqual([])
  expect(tokens.filter((token) => token.startsWith('dark:hover:bg-'))).toEqual([])
}
