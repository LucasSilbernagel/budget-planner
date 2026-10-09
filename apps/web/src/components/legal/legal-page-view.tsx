import type { LegalPage } from '../../content/legal'
import { MarkdownRenderer } from '../docs/markdown-renderer'
import { LegalPageLayout } from './legal-page-layout'

export type LegalPageViewProps = {
	page: LegalPage
}

export function LegalPageView({ page }: LegalPageViewProps) {
	return (
		<LegalPageLayout title={page.title} description={page.description}>
			<MarkdownRenderer content={page.content} />
		</LegalPageLayout>
	)
}
