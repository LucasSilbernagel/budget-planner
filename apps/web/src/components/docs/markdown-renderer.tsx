import Markdown from 'markdown-to-jsx'
import type { AnchorHTMLAttributes } from 'react'

function isExternalHref(href: string): boolean {
	// An explicit scheme or a protocol-relative URL can leave the site; relative links stay in-tab.
	return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)
}

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
	content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
	return (
		<article className="prose prose-slate dark:prose-invert max-w-none">
			<Markdown options={{ overrides: { a: { component: DocLink } } }}>{content}</Markdown>
		</article>
	)
}
