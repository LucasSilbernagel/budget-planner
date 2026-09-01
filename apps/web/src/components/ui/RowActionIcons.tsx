import type React from 'react'

/**
 * The two glyphs the finance tables use for their per-row actions (story 50.1,
 * UX-DR56). Shared rather than inlined because there are FOUR call sites —
 * `IncomePage`, `ExpensesPage`, `BalancePage`, `SavingsPage` — and eight
 * buttons. `SortableColumnHeader` keeps its chevrons file-local for the
 * opposite reason: it has one consumer.
 *
 * ⚠️ HAND-ROLLED ON PURPOSE, NOT FOR WANT OF A LIBRARY. `lucide`, `heroicons`,
 * `react-icons`, `feather`, `phosphor`, `tabler` and `iconify` are absent from
 * `apps/web/package.json`, the root manifest AND `pnpm-lock.yaml`; 18 components
 * already draw their own inline SVG. A CDN-hosted icon font or sprite is not an
 * alternative either — `server/middleware/security-headers.ts` ships
 * `font-src 'self' data:` and `img-src 'self' data:`, so both are unloadable.
 * (That is the real blocker. `script-src`'s missing `'unsafe-inline'` governs
 * scripts and is NOT what stops an icon font, whatever a passing reader assumes.)
 *
 * ⚠️ `aria-hidden="true"` IS NOT DECORATION HERE, IT IS THE CONTRACT. Every
 * caller wraps these in a button carrying `aria-label={`Edit ${name}`}` /
 * `Delete ${name}`, which is the row's entire accessible name. Hiding the glyph
 * keeps it out of the name computation.
 *
 * ⚠️ AND NO ACCESSIBLE-NAME TEST CAN PROVE THAT ATTRIBUTE IS PRESENT. `aria-label`
 * overrides element content unconditionally, so an un-hidden `<svg>` — even one
 * carrying a `<title>` — still computes the name `Edit Salary`. The guard that
 * can see it is an attribute pin: `assertIsIconOnlyAction` in
 * `src/test/responsive-table-tokens.ts`.
 *
 * House idiom, measured across the 43 inline SVGs in this app: `fill="none"` +
 * `stroke="currentColor"`, `viewBox="0 0 24 24"`, round caps and joins,
 * `strokeWidth` as a JSX number, and sizing ALWAYS through `className` — not one
 * existing SVG sets a `width` or `height` attribute. `currentColor` is what lets
 * the caller's `text-blue-600` / `text-red-600` and their `hover:` and `dark:`
 * variants reach the glyph unchanged.
 *
 * Paths are Heroicons v1 outline (`pencil-alt`, `trash`), MIT © Tailwind Labs,
 * transcribed by hand — see the CSP note above for why they are not imported.
 */

/** ⚠️ A DEFAULT, NOT A CONSTANT TO OVERRIDE CASUALLY. These SVGs set no `width`
 * or `height` attributes (house idiom), so an element that receives no sizing
 * class falls back to the replaced-element default of roughly 300x150 and
 * destroys the table row. jsdom computes no layout and the e2e box assertion is
 * a lower bound, so NOTHING would catch it. Defaulting is cheaper than a guard. */
const ICON_SIZE = 'h-5 w-5'

/** Heroicons v1 outline `pencil-alt` — the row Edit action. */
export function PencilIcon({ className = ICON_SIZE }: { className?: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  )
}

/** Heroicons v1 outline `trash` — the row Delete action. */
export function TrashIcon({ className = ICON_SIZE }: { className?: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )
}
