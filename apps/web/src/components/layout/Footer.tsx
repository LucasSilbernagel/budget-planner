import { APP_VERSION } from '../../utils/version'

/**
 * Global application footer (story 4-8, FR13 / UX-DR5; story 9-1, FR27;
 * story 5-13 compliance links).
 *
 * Renders once at the root layout so the application version, the in-app
 * "Documentation" link (story 4-10), the in-app "Contact" link (story 9-1,
 * which replaced the old GitHub feedback link from story 4-9),
 * AND the Paddle-required compliance pages (Pricing, Terms, Privacy, Refund —
 * story 5-13) are available on every page. The version comes from `APP_VERSION`,
 * which is inlined at build time from package.json, so it updates automatically
 * on deploy (4-8 AC-1).
 *
 * Kept deliberately minimal and unobtrusive: small, muted text in a semantic
 * `<footer>` (an implicit `contentinfo` landmark when it is a direct child of
 * the document body).
 */
export function Footer() {
  return (
    <footer className="mt-auto border-t border-gray-200 py-3 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
      {/* The dark-mode toggle moved to the consolidated /settings surface
          (story 11-6). It remains a single global instance there, per story 7-3
          DECISION 2. */}
      {/* At 320px this stacks vertically (story 18-2): the base `gap-3` gives the
          three groups — brand/version, the legal-link cluster, and copyright —
          comfortable vertical rhythm instead of the old cramped `gap-1` (4px)
          run-together stack. At >=640px `sm:flex-row sm:flex-wrap sm:gap-x-3
          sm:gap-y-1` restores the single wrapping row (unchanged from before). */}
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap sm:gap-x-3 sm:gap-y-1">
        {/* Brand stays a plain text node so it's announced; the label is scoped
            to the version span so screen readers say "version 0.0.1" rather than
            spelling out the decorative "v". */}
        <span>
          Budget Planner <span aria-label={`version ${APP_VERSION}`}>v{APP_VERSION}</span>
        </span>
        {/* Legal/nav links grouped as a comfortably-spaced cluster on the 320px
            stacked layout (story 18-2). `sm:contents` dissolves this wrapper at
            >=640px (display: contents) so the six links rejoin the outer wrapping
            row exactly as before — the desktop footer layout is unchanged. */}
        <div className="flex flex-col items-center gap-2 sm:contents">
          <a
            href="/pricing"
            className="text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Pricing
          </a>
          <a
            href="/docs"
            className="text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Documentation
          </a>
          <a
            href="/terms"
            className="text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Terms of Service
          </a>
          <a
            href="/privacy"
            className="text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Privacy Policy
          </a>
          <a
            href="/refund"
            className="text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Refund Policy
          </a>
          <a
            href="/contact"
            className="text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Contact
          </a>
        </div>
        {/* Copyright notice (story 6-9). The year is computed at render time so
            it stays correct year over year (AC-1) rather than being hardcoded.
            "Copyright <year>" and the author link are grouped in one <span>; it
            wraps as a unit against the other footer items, though the internal
            space may itself break at very narrow widths (still graceful, AC-5).
            The external author link follows the app's new-tab link convention
            (target/rel + an aria-label ending in "(opens in a new
            tab)"). suppressHydrationWarning covers the negligible case where an
            SSR render and client hydration straddle New Year midnight and the
            year differs — the value still updates, this just silences the warning. */}
        <span suppressHydrationWarning>
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
