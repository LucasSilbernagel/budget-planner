import { APP_VERSION } from '../../utils/version'
import { FeedbackLink } from './FeedbackLink'

/**
 * Global application footer (story 4-8, FR13 / UX-DR5; story 4-9, FR14 / UX-DR6).
 *
 * Renders once at the root layout so the application version AND the GitHub
 * "Report Issue / Feedback" link are available on every page. The version comes
 * from `APP_VERSION`, which is inlined at build time from package.json, so it
 * updates automatically on deploy (4-8 AC-1).
 *
 * Kept deliberately minimal and unobtrusive: small, muted text in a semantic
 * `<footer>` (an implicit `contentinfo` landmark when it is a direct child of
 * the document body).
 */
export function Footer() {
  return (
    <footer className="mt-auto border-t border-gray-200 py-3 text-center text-xs text-gray-500">
      <div className="flex flex-col items-center justify-center gap-1 sm:flex-row sm:gap-3">
        {/* Brand stays a plain text node so it's announced; the label is scoped
            to the version span so screen readers say "version 0.0.1" rather than
            spelling out the decorative "v". */}
        <span>
          Budget Planner <span aria-label={`version ${APP_VERSION}`}>v{APP_VERSION}</span>
        </span>
        <FeedbackLink />
      </div>
    </footer>
  )
}
