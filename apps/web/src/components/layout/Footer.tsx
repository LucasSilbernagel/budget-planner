import { Link } from '@tanstack/react-router'

/**
 * Global application footer (story 4-8; story 9-1, FR27; story 5-13 compliance
 * links; story 21-1 chrome polish).
 *
 * Renders once at the root layout so the in-app "Documentation" link (story
 * 4-10), the in-app "Contact" link (story 9-1, which replaced the old GitHub
 * feedback link from story 4-9), AND the Paddle-required compliance pages
 * (Pricing, Terms, Privacy, Refund — story 5-13) are available on every page.
 *
 * Story 21-1: the developer build version was removed from the footer (it was
 * the only in-UI surface of `APP_VERSION`; the product decision is to drop the
 * in-UI version, superseding the original FR13 / UX-DR5 requirement — the
 * `utils/version` module is retained but no longer rendered). The internal
 * links are TanStack Router `<Link>`s so the current footer page is marked
 * `aria-current="page"` and visually distinguished (UX-DR28), mirroring
 * `GlobalNav`. The `/docs` link uses `activeOptions={{ exact: true }}` so it is
 * not marked active while viewing an individual `/docs/$docId` page (the same
 * reasoning GlobalNav's root `/` link uses).
 *
 * Kept deliberately minimal and unobtrusive: small, muted text in a semantic
 * `<footer>` (an implicit `contentinfo` landmark when it is a direct child of
 * the document body).
 */

/** Registered route paths the footer links to — a subset of the app's route tree. */
type FooterPath = '/pricing' | '/docs' | '/terms' | '/privacy' | '/refund' | '/contact'

interface FooterLink {
  label: string
  to: FooterPath
  /**
   * Match this route exactly. Only `/docs` needs it: it is the parent of
   * `/docs/$docId`, so without `exact` the Documentation link would read as the
   * current page while viewing an individual doc.
   */
  exact?: boolean
}

const FOOTER_LINKS: readonly FooterLink[] = [
  { label: 'Pricing', to: '/pricing' },
  { label: 'Documentation', to: '/docs', exact: true },
  { label: 'Terms of Service', to: '/terms' },
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Refund Policy', to: '/refund' },
  { label: 'Contact', to: '/contact' },
]

// Inactive link style (unchanged from before story 21-1): muted, underlined.
const LINK_CLASS =
  'text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'

// Active (current-page) style. Reuses the app's green accent (as GlobalNav does)
// and drops the underline so the current page reads as distinct without the
// heavier full-background pill — in keeping with the deliberately minimal footer.
// NB (Tailwind merge order): `activeProps.className` is applied ON TOP of
// LINK_CLASS, and conflicting utilities resolve by CSS source order, not string
// order. `green` is emitted after `gray`, so `text-green-*` overrides the base
// `text-gray-*` in BOTH light and dark; `no-underline` is emitted after
// `underline`, so it wins. (An intra-`gray` override, e.g. gray-900 over
// gray-400, would NOT reliably win in dark mode — hence the green accent.)
const ACTIVE_LINK_CLASS =
  'font-medium text-green-700 no-underline hover:text-green-800 dark:text-green-400 dark:hover:text-green-300'

export function Footer() {
  return (
    // `data-print-hide` (story 30-3): app chrome must not reach paper. Marked on
    // THIS element rather than matching the bare `footer` tag in the print
    // stylesheet, because `<footer>` is also used for in-page content elsewhere
    // (e.g. the forecasting page's data-location disclosure), which a tag
    // selector would suppress too.
    <footer
      data-print-hide
      className="mt-auto border-t border-gray-200 py-3 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400"
    >
      {/* The dark-mode toggle moved to the consolidated /settings surface
          (story 11-6). It remains a single global instance there, per story 7-3
          DECISION 2. */}
      {/* At 320px this stacks vertically (story 18-2): the base `gap-3` gives the
          three groups — brand, the legal-link cluster, and copyright —
          comfortable vertical rhythm. At >=640px `sm:flex-row sm:flex-wrap
          sm:gap-x-3 sm:gap-y-1` restores the single wrapping row. */}
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap sm:gap-x-3 sm:gap-y-1">
        {/* Brand text node (story 21-1 dropped the trailing build version).
            Formal form "Longhand Budget" rather than the short "Longhand"
            (story brand-1, AC-1): this node sits in the footer's legal cluster
            beside the copyright and the six legal links. */}
        <span>Longhand Budget</span>
        {/* Legal/nav links grouped as a comfortably-spaced cluster on the 320px
            stacked layout (story 18-2). `sm:contents` dissolves this wrapper at
            >=640px (display: contents) so the six links rejoin the outer wrapping
            row exactly as before — the desktop footer layout is unchanged. */}
        <div className="flex flex-col items-center gap-2 sm:contents">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              activeOptions={link.exact ? { exact: true } : undefined}
              className={LINK_CLASS}
              activeProps={{ 'aria-current': 'page', className: ACTIVE_LINK_CLASS }}
            >
              {link.label}
            </Link>
          ))}
        </div>
        {/* Copyright notice (story 6-9). The year is computed at render time so
            it stays correct year over year rather than being hardcoded. Story
            21-1: `mt-2 sm:mt-0 sm:ml-3` gives it clear separation from the
            legal-link cluster beyond the uniform inter-group gap — extra top
            space in the stacked mobile column (UX-DR33) and extra left space in
            the desktop wrapping row (UX-DR27) — so the copyright reads as a
            distinct group. The `sm:mt-0` resets the mobile top margin at >=640px
            so a top-only margin does not nudge the copyright below its siblings'
            centre in the `items-center` row (kept baseline-aligned).
            The external author link follows the app's new-tab link convention
            (target/rel + an aria-label ending in "(opens in a new tab)").
            suppressHydrationWarning covers the negligible case where an SSR
            render and client hydration straddle New Year midnight and the year
            differs — the value still updates, this just silences the warning. */}
        <span className="mt-2 sm:ml-3 sm:mt-0" suppressHydrationWarning>
          Copyright {new Date().getFullYear()}{' '}
          <a
            href="https://lucassilbernagel.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Lucas Silbernagel's website (opens in a new tab)"
            className="text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Lucas Silbernagel
          </a>
        </span>
      </div>
    </footer>
  )
}
