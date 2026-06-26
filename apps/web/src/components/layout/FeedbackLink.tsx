import { useLocation } from '@tanstack/react-router'
import { APP_VERSION } from '../../utils/version'

/**
 * Integrated GitHub issue / feedback link (story 4-9, FR14 / UX-DR6).
 *
 * Rendered inside the global {@link Footer}, so a "Report Issue / Feedback"
 * affordance is available on every page (AC-1). The link points at a GitHub
 * "new issue" form pre-filled with a feedback template plus context about the
 * page the user is on and the running app version, so bug reports arrive
 * actionable. It opens in a new tab and is a plain navigable anchor, so
 * middle-click, "copy link", and keyboard activation all behave normally.
 */

/**
 * Canonical repository URL. Uses the repository owner's exact casing
 * (`LucasSilbernagel`); GitHub redirects case-insensitively, but the canonical
 * form avoids a redirect hop and keeps the value consistent across the app.
 */
export const GITHUB_REPO_URL = 'https://github.com/LucasSilbernagel/budget-planner'

/** The "new issue" form URL, used as the base before context is appended. */
export const NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new`

/**
 * Builds a GitHub "new issue" URL pre-filled with a feedback template plus the
 * page and app version the report originated from.
 *
 * Pure and side-effect free so the URL contract can be unit-tested without a
 * DOM or router. Query params are encoded via {@link URLSearchParams}, so paths
 * containing characters like `&`, spaces, or `#` are escaped safely.
 *
 * Privacy: only the route path and version are included — never query strings,
 * form values, or any user-entered financial data (technical note in the story).
 *
 * @param path The current route path (e.g. `/income`).
 * @param version The running application version (e.g. `0.0.1`).
 */
export function buildIssueUrl(path: string, version: string): string {
  const title = `Issue report (${path})`
  const body = [
    'Thanks for helping improve Budget Planner! Please describe the issue or feedback below.',
    '',
    '## What happened?',
    '',
    '',
    '## What did you expect to happen?',
    '',
    '',
    '## Steps to reproduce',
    '1. ',
    '2. ',
    '',
    '---',
    '_Context (auto-filled):_',
    `- Page: ${path}`,
    `- App version: ${version}`,
  ].join('\n')

  const params = new URLSearchParams({ title, body })
  return `${NEW_ISSUE_URL}?${params.toString()}`
}

export interface FeedbackLinkProps {
  /** Extra classes appended to the link's styling. */
  className?: string
}

export function FeedbackLink({ className = '' }: FeedbackLinkProps) {
  // Reading the path from the router (rather than `window.location`) keeps the
  // href correct during SSR and fresh across client-side navigation: the Footer
  // is mounted once at the root, so `useLocation` re-rendering on route changes
  // is what keeps the captured page accurate.
  const pathname = useLocation({ select: (location) => location.pathname })
  const href = buildIssueUrl(pathname, APP_VERSION)

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Report an issue or share feedback on GitHub (opens in a new tab)"
      className={`text-blue-600 hover:text-blue-800 hover:underline focus-visible:underline ${className}`.trim()}
    >
      Report Issue / Feedback
    </a>
  )
}
