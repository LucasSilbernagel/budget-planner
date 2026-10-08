import { expect } from 'vitest'

/** Matched on class tokens, never substrings: `hidden` would match `overflow-hidden`. */
const RETIRED_SURFACE_TOKENS = [
  // Raw surface colours that must come from `.surface` / `.surface-inset`.
  'bg-white',
  'bg-gray-50',
  'dark:bg-gray-800',
  'dark:bg-gray-900',
  // Raw body/heading text colours that must come from the text tokens.
  'text-gray-900',
  'text-gray-800',
  'text-gray-700',
  'text-gray-600',
  'text-gray-500',
  'dark:text-gray-100',
  'dark:text-gray-300',
  'dark:text-gray-400',
  'dark:text-white',
  // Raw border colour that must come from `.border-default`.
  'border-gray-200',
  'dark:border-gray-700',
] as const

/** Stripped so `max-sm:bg-white` cannot evade the list. */
const RESPONSIVE_VARIANTS = new Set([
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  'max-sm',
  'max-md',
  'max-lg',
  'max-xl',
  'max-2xl',
])

// State variants (`hover:`, `focus:`) are preserved on purpose: the row hover accent is sanctioned.

/** Exempted by element, not token, so a leak elsewhere in the subtree still fails. */
const SANCTIONED_ACCENT_SELECTORS = [
  // Savings Account/Goal badge — `text-gray-700` light arm.
  '[data-testid^="savings-badge-"]',
  // Savings Auto/Fixed allocation-mode chip — `text-gray-600 dark:text-gray-300`.
  '[data-testid^="savings-allocation-mode-"]',
] as const

function stripResponsiveVariants(token: string): string {
  const parts = token.split(':')
  const base = parts.pop() ?? token
  return [...parts.filter((part) => !RESPONSIVE_VARIANTS.has(part)), base].join(':')
}

export function collectRetiredTokenViolations(
  root: HTMLElement,
  allow: (el: Element) => boolean = (el) =>
    SANCTIONED_ACCENT_SELECTORS.some((selector) => el.matches(selector))
): string[] {
  const retired: readonly string[] = RETIRED_SURFACE_TOKENS
  const violations: string[] = []
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (allow(el)) continue
    // `getAttribute('class')`, not `className`: on SVG elements className is an SVGAnimatedString.
    const tokens = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
    for (const token of tokens) {
      const normalized = stripResponsiveVariants(token)
      if (retired.includes(token) || retired.includes(normalized)) {
        violations.push(`<${el.tagName.toLowerCase()}> carries retired token "${token}"`)
      }
    }
  }
  return violations
}

export function assertHasFocusRing(button: HTMLElement, label: string): void {
  const tokens = button.className.split(/\s+/)
  expect(tokens, `${label} has no visible focus ring`).toContain('focus:ring-2')
  // The ring needs a real colour: `focus:ring-offset-*` / `focus:ring-inset` paint nothing.
  expect(
    tokens.some((t) => /^focus:ring-(?!offset-|inset$)[a-z]+-\d+$/.test(t)),
    `${label} has a ring width but no ring colour`
  ).toBe(true)
  // `--tw-ring-offset-color` defaults to white, so any ring offset on a dark surface paints a
  // white band.
  if (tokens.some((t) => t.startsWith('focus:ring-offset-'))) {
    expect(tokens, `${label} paints a white ring offset on dark`).toContain(
      'dark:focus:ring-offset-gray-800'
    )
  }
}

export function assertHasMobileTapTarget(button: HTMLElement, label: string): void {
  const tokens = button.className.split(/\s+/)
  expect(tokens, `${label} has no 44px mobile height`).toContain('max-sm:min-h-[44px]')
  expect(tokens, `${label} has no 44px mobile width`).toContain('max-sm:min-w-[44px]')
  // Unprefixed would change the desktop rendering.
  expect(tokens, `${label} leaks a 44px floor onto desktop`).not.toContain('min-h-[44px]')
  expect(tokens, `${label} leaks a 44px floor onto desktop`).not.toContain('min-w-[44px]')
}

/**
 * aria-label overrides content, so no name query can see the icon; aria-hidden is pinned as an
 * attribute. jsdom has no layout, so an h-0 w-0 glyph still passes.
 */
export function assertIsIconOnlyAction(button: HTMLElement, label: string): string {
  expect(button.textContent?.trim(), `${label} still renders a visible text label`).toBe('')
  // PRESENCE — ...and something IS rendered, so the absence above is not vacuous.
  const icons = button.querySelectorAll('svg')
  expect(icons.length, `${label} renders no icon`).toBe(1)
  const icon = icons[0]
  // Exactly one child, not just "contains an svg".
  expect(button.children.length, `${label} renders more than the icon`).toBe(1)
  expect(button.firstElementChild, `${label}'s icon is not the button's own child`).toBe(icon)
  expect(
    icon.getAttribute('aria-hidden'),
    `${label}'s icon is not hidden from the accessible name`
  ).toBe('true')
  // A glyph that paints nothing still passes every check above. `currentColor` is
  // also what carries the caller's text-blue-600/text-red-600 into the stroke.
  expect(icon.getAttribute('stroke'), `${label}'s icon paints no stroke`).toBe('currentColor')
  const d = icon.querySelector('path')?.getAttribute('d')
  expect(d, `${label}'s icon has no path geometry`).toBeTruthy()
  // Returned so the caller can prove Edit and Delete are DIFFERENT glyphs.
  return d as string
}
