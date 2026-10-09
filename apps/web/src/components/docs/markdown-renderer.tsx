import Markdown from 'markdown-to-jsx'
import { DocLink } from './doc-link'

export type MarkdownRendererProps = {
	content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
	return (
		<article className="prose prose-slate dark:prose-invert max-w-none">
			<Markdown options={{ overrides: { a: { component: DocLink } } }}>{content}</Markdown>
		</article>
	)
}
