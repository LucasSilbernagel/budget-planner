import { expect } from 'vitest'

/**
 * ONE shared retired-token blocklist for the story 31.2 finance-table sweeps.
 *
 * Defined here and imported by every page suite rather than copied per file.
 * A previous story shipped three subtree sweeps with three divergent lists,
 * and the review recorded the consequence: the WEAKEST list defines the real
 * protection. Add to this list, never to a local copy.
 *
 * Membership is asserted on class TOKENS (split on whitespace / `classList`),
 * never as a substring of `className` — `-` and `:` are substring boundaries,
 * so `hidden` false-matches `overflow-hidden` and `bg-white` false-matches
 * `dark:bg-white`.
 */
export const RETIRED_SURFACE_TOKENS = [
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

/**
 * Responsive variants stripped before a token is matched against the blocklist.
 *
 * Without this the sweep is exact-equality only, so `max-sm:bg-white` and
 * `sm:text-gray-900` sail past a list containing `bg-white` and
 * `text-gray-900` — and a breakpoint-prefixed raw colour is exactly the leak
 * this story's `max-sm:`-heavy composition makes likely.
 */
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

/**
 * What this sweep does NOT catch, stated plainly so nobody reads a green run as
 * more than it is:
 *
 *  - **State variants are deliberately preserved, not stripped.** `hover:` /
 *    `focus:` / `active:` forms are left intact, so `hover:bg-gray-50` does not
 *    match `bg-gray-50`. That is intentional: story 11.2 sanctioned the row
 *    hover accent (`hover:bg-gray-50 dark:hover:bg-gray-700/40`) as a one-off,
 *    and it sits on every swept row. The cost is that a hand-rolled
 *    `dark:hover:bg-gray-900` surface would slip through.
 *  - **Only the tokens listed above.** Notably `BalancePage.tsx`'s
 *    unknown/legacy finance-type fallback pill carries `text-gray-800`, a
 *    listed token on an element with no exemption hook. It is unreachable with
 *    valid data (both real types resolve in `TYPE_OPTIONS`), so no current test
 *    trips it — but a future test seeding a corrupt `type` would fail this
 *    sweep on pre-existing, sanctioned styling rather than on a real leak.
 */
export const SWEEP_KNOWN_BLIND_SPOTS = [
  'state variants (hover:/focus:/active:) are not stripped',
  'BalancePage unknown-type fallback pill carries text-gray-800 with no exemption hook',
] as const

/**
 * The one-off accents story 11.2 explicitly carved OUT of the token layer:
 * "genuinely one-off accents (blue/green/red info/result/error panels, badges,
 * form inputs) keep inline `dark:` variants".
 *
 * Exemptions are by ELEMENT, not by token, so a leak anywhere else in the same
 * subtree still fails.
 */
export const SANCTIONED_ACCENT_SELECTORS = [
  // Savings Account/Goal badge — `text-gray-700` light arm.
  '[data-testid^="savings-badge-"]',
  // Savings Auto/Fixed allocation-mode chip — `text-gray-600 dark:text-gray-300`.
  '[data-testid^="savings-allocation-mode-"]',
] as const

/** Strip responsive variants from a class token, preserving state variants. */
function stripResponsiveVariants(token: string): string {
  const parts = token.split(':')
  const base = parts.pop() ?? token
  return [...parts.filter((part) => !RESPONSIVE_VARIANTS.has(part)), base].join(':')
}

/**
 * Assert that no element in `root`'s subtree carries a retired token.
 *
 * `allow` exempts the deliberately sanctioned one-off accents — pass the
 * elements, not the tokens, so a leak elsewhere still fails. Defaults to
 * {@link SANCTIONED_ACCENT_SELECTORS}.
 */
export function collectRetiredTokenViolations(
  root: HTMLElement,
  allow: (el: Element) => boolean = (el) =>
    SANCTIONED_ACCENT_SELECTORS.some((selector) => el.matches(selector))
): string[] {
  const retired: readonly string[] = RETIRED_SURFACE_TOKENS
  const violations: string[] = []
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (allow(el)) continue
    const tokens = el.className.toString().split(/\s+/).filter(Boolean)
    for (const token of tokens) {
      const normalized = stripResponsiveVariants(token)
      if (retired.includes(token) || retired.includes(normalized)) {
        violations.push(`<${el.tagName.toLowerCase()}> carries retired token "${token}"`)
      }
    }
  }
  return violations
}

/**
 * AC-5 (story 31.2) — assert a row action button carries a real focus ring.
 *
 * Extracted here rather than copied into each page suite: the identical ~20
 * lines lived in four files, which is the same drift risk that made the
 * blocklist above shared. Call it once per button and pass every button you
 * expect to exist — coverage of these controls has to come from ENUMERATION,
 * because they carried neither `focus:outline-none` nor `focus:ring-2` before
 * this story, so the completeness grep that guards the modal controls is
 * structurally blind to them. A missing guard has no mutation to run against.
 */
export function assertHasFocusRing(button: HTMLElement, label: string): void {
  const tokens = button.className.split(/\s+/)
  expect(tokens, `${label} has no visible focus ring`).toContain('focus:ring-2')
  // The ring must carry a real COLOUR — `focus:ring-offset-*` and
  // `focus:ring-inset` satisfy a naive "starts with focus:ring-" check while
  // painting nothing.
  expect(
    tokens.some((t) => /^focus:ring-(?!offset-|inset$)[a-z]+-\d+$/.test(t)),
    `${label} has a ring width but no ring colour`
  ).toBe(true)
  // `--tw-ring-offset-color` defaults to WHITE and global.css has no override,
  // so any ring-offset on a gray-800 `.surface` card paints a white band. These
  // buttons take no offset today; this is a forward guard for the day one is
  // added, which is how that defect shipped once already.
  if (tokens.some((t) => t.startsWith('focus:ring-offset-'))) {
    expect(tokens, `${label} paints a white ring offset on dark`).toContain(
      'dark:focus:ring-offset-gray-800'
    )
  }
}

/** AC-6 — assert a row action button declares a breakpoint-scoped 44px target. */
export function assertHasMobileTapTarget(button: HTMLElement, label: string): void {
  const tokens = button.className.split(/\s+/)
  // Concrete floors, not "smaller than desktop".
  expect(tokens, `${label} has no 44px mobile height`).toContain('max-sm:min-h-[44px]')
  expect(tokens, `${label} has no 44px mobile width`).toContain('max-sm:min-w-[44px]')
  // Unprefixed would change the desktop rendering (AC-2).
  expect(tokens, `${label} leaks a 44px floor onto desktop`).not.toContain('min-h-[44px]')
  expect(tokens, `${label} leaks a 44px floor onto desktop`).not.toContain('min-w-[44px]')
}
