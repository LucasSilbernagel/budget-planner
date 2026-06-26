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
    <article className="prose prose-slate max-w-none">
      <Markdown options={{ overrides: { a: { component: DocLink } } }}>{content}</Markdown>
    </article>
  )
}
