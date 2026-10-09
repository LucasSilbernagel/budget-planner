import type { ReactNode } from 'react'
import { Card } from '../ui/Card'
import { Page } from '../ui/Page'
import { PageContent } from '../ui/PageContent'
import { PageDescription } from '../ui/PageDescription'
import { PageHeader } from '../ui/PageHeader'
import { PageTitle } from '../ui/PageTitle'

export type LegalPageLayoutProps = {
	title: string
	description?: string
	children: ReactNode
}

export function LegalPageLayout({ title, description, children }: LegalPageLayoutProps) {
	return (
		<Page>
			<PageContent className="max-w-3xl">
				<PageHeader>
					<a href="/" className="text-sm text-accent hover:underline">
						← Back to app
					</a>
					<PageTitle className="mt-2">{title}</PageTitle>
					{description ? <PageDescription>{description}</PageDescription> : null}
				</PageHeader>

				<main>
					<Card as="section">{children}</Card>
				</main>
			</PageContent>
		</Page>
	)
}
