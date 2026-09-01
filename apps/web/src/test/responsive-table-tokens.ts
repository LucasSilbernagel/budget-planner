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
    // ⚠️ `getAttribute('class')`, NOT `el.className`. On an SVGElement `className` is an
    // `SVGAnimatedString`, which stringifies to "[object SVGAnimatedString]" — it splits into
    // two tokens that match nothing, so this sweep was STRUCTURALLY BLIND to every `<svg>` and
    // `<path>` it walked. Latent until story 50.1 put eight class-carrying icons inside the
    // swept region; found because 50.1's mutation arm M11 (`text-gray-500` on a row icon) came
    // back green and the recorded REASON — "gray-500 is not on the list" — was false. It is on
    // the list, at the top of this file. A green arm with a plausible wrong reason is worse
    // than a red one.
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

/**
 * Story 50.1 (AC-1, AC-3, AC-9) — assert a row action button shows an ICON and
 * carries no visible label beside it.
 *
 * ⚠️ THIS EXISTS BECAUSE NOTHING ELSE IN THE REPO COULD SEE THE CHANGE IT
 * GUARDS. The eight row action buttons carry `aria-label={`Edit ${name}`}`, and
 * `aria-label` overrides element content in accessible-name computation. So the
 * visible words "Edit"/"Delete" contributed NOTHING to any
 * `getByRole('button', { name })` query even BEFORE 50.1 removed them. Swept the
 * whole `apps/web` test surface — `getByText` / `queryByText` / `findByText` /
 * `getAllByText` / `toHaveTextContent` / `toContainText` / `.textContent` /
 * `.innerHTML` / `getByTitle` / `toHaveAccessibleName` / `toMatchSnapshot` /
 * `toMatchInlineSnapshot` / Playwright `text=` / `hasText` / `:has-text()`. Every
 * hit intersected with /edit|delete/i is a false positive (a seeded row NAMED
 * `DeleteMe`, three unrelated copy pins), and the repo contains no `.snap` file
 * at all. ⚠️ The first version of this list named only five patterns; a review
 * layer correctly pointed out that an absence claim is only as good as its
 * vocabulary, so the wider sweep was re-run before this wording was trusted. The four sibling tests literally titled "offers exactly
 * Edit and Delete in a row action cell" read `getAttribute('aria-label')` and
 * stay green against a button rendering nothing at all.
 *
 * ⚠️ BOTH HALVES SHIP TOGETHER OR NEITHER DOES. The absence half alone is
 * vacuous by construction: a button whose child failed to render satisfies "no
 * visible text" for the wrong reason. That is 48.1's HIGH and 47.2's repeat of
 * it. The presence half is the one no pre-existing assertion could make.
 *
 * ⚠️ `aria-hidden` IS PINNED AS AN ATTRIBUTE, NEVER VIA THE ACCESSIBLE NAME.
 * Because `aria-label` overrides content unconditionally, an un-hidden `<svg>` —
 * even one carrying a `<title>` — still yields the name `Edit Salary`. A name
 * assertion therefore proves nothing about `aria-hidden` in EITHER direction, so
 * do not "strengthen" this by adding one. `SortableColumnHeader.tsx` documents
 * the same mechanism for the sort chevron.
 *
 * ⚠️ jsdom COMPUTES NO LAYOUT, so this cannot prove the icon has a box. An
 * `h-0 w-0` glyph passes here. The rendered-box floors (>= 24px desktop for WCAG
 * 2.2 SC 2.5.8, >= 44px below `sm`) are asserted in Playwright —
 * `e2e/responsive-320.spec.ts`. Read a pass here as "an aria-hidden SVG with real
 * path geometry is this button's only content", never as "the icon is visible" —
 * an `h-0 w-0` glyph passes everything here.
 */
export function assertIsIconOnlyAction(button: HTMLElement, label: string): string {
  // ABSENCE — no text label survives beside the glyph.
  expect(button.textContent?.trim(), `${label} still renders a visible text label`).toBe('')
  // PRESENCE — ...and something IS rendered, so the absence above is not vacuous.
  const icons = button.querySelectorAll('svg')
  expect(icons.length, `${label} renders no icon`).toBe(1)
  const icon = icons[0]
  // The docblock says "the button's ONLY content", so assert exactly that rather
  // than the weaker "contains an svg somewhere" — an empty `<span>`, an `<img>`,
  // or a wrapper `<div>` all satisfy the three checks above.
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
