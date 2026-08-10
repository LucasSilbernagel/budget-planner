import Markdown from 'markdown-to-jsx'
import type { AnchorHTMLAttributes } from 'react'

/**
 * Renders a raw Markdown string (loaded from a static `.md` file) as HTML
 * (story 4-10, AC-2).
 *
 * Styling comes from Tailwind's typography plugin via the `prose` classes, so
 * headings, lists, tables, blockquotes, and code blocks get readable defaults
 * without per-element overrides. Links are the one exception: external links
 * are opened safely in a new tab while internal links navigate in place.
 *
 * `dark:prose-invert` (story 31-1) is unconditional rather than an opt-in prop:
 * this component has exactly three importers — `routes/docs/$docId.tsx`,
 * `legal/legal-page-view.tsx` and `pricing/pricing-page.tsx` — and all three are
 * dark-aware, so a prop would be unearned plumbing. It is also the only place
 * `prose` appears in the codebase, which makes this one line what themes every
 * heading, paragraph, link, inline `code`, fenced `pre`, blockquote, `hr` and
 * table border across `/docs/*`, `/terms`, `/privacy`, `/refund` and `/pricing`.
 */

function isExternalHref(href: string): boolean {
  // Treat anything that can navigate off-site as external: an absolute URL with
  // an explicit scheme (`https:`, `http:`, `mailto:`, …) or a protocol-relative
  // URL (`//host`). Same-document/relative links (`/docs/faq`, `#section`,
  // `./other`) have neither and stay in-tab.
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)
}

/** Anchor override: adds new-tab safety attributes to external links only. */
function DocLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href && isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    )
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}

export interface MarkdownRendererProps {
  /** Raw Markdown source to render. */
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-none">
      <Markdown options={{ overrides: { a: { component: DocLink } } }}>{content}</Markdown>
    </article>
  )
}
