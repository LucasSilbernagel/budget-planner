import type React from 'react'

/**
 * The header's ONE disclosure chevron (story 69.1, FR108), shared by the two
 * disclosures that sit side by side in the desktop header row: the account
 * menu's trigger (`auth/auth-indicator.tsx`, story 59.3) and the nav's More
 * trigger (`layout/GlobalNav.tsx`).
 *
 * ⚠️ Shared on purpose, not for tidiness. Two visually different "this opens"
 * cues one flex item apart read as two different kinds of control. Both
 * triggers take this glyph AND `DISCLOSURE_CHEVRON_CLASS`, and add only what
 * differs by MECHANISM:
 *
 *   - the account trigger is a `<button>` driven by React state, so it adds
 *     `rotate-180` from its `isOpen`;
 *   - the More trigger is a native `<details>`/`<summary>` that must work with
 *     JavaScript off, so it rotates on the `open` ATTRIBUTE (`group-open:`),
 *     which is what actually shows its panel. See `GlobalNav.tsx`.
 *
 * `SavingsPage.tsx` and `ui/SortableColumnHeader.tsx` draw the same path for
 * unrelated purposes (a row expander and a sort indicator). They are not header
 * disclosure cues and deliberately do not use this.
 *
 * `motion-reduce:transition-none`: the turn is decoration, so it is dropped
 * under `prefers-reduced-motion` (both triggers, via this shared class).
 *
 * Hand-rolled inline SVG, the app's house style: there is no icons package, and
 * the CSP rules out an icon font (see `ui/RowActionIcons.tsx`). Decorative:
 * `aria-hidden`, so each trigger's own label stays its whole accessible name.
 */
export const DISCLOSURE_CHEVRON_CLASS =
  'h-4 w-4 shrink-0 text-gray-500 transition-transform motion-reduce:transition-none dark:text-gray-400'

export function ChevronDownIcon({
  className,
  ...rest
}: { className: string } & Omit<React.SVGProps<SVGSVGElement>, 'className'>): React.ReactElement {
  // `rest` is spread FIRST so no caller can override the fixed attributes
  // below, `aria-hidden` above all: it is what keeps each trigger's label its
  // whole accessible name (code review 2026-09-25).
  return (
    <svg
      {...rest}
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}
