import type { ReactNode } from 'react'
import { Page } from '../ui/Page'
import { PageContent } from '../ui/PageContent'
import { PageDescription } from '../ui/PageDescription'
import { PageHeader } from '../ui/PageHeader'
import { PageTitle } from '../ui/PageTitle'
import { CompareSidebar } from './compare-sidebar'

export type CompareLayoutProps = {
	title: string
	description?: string
	activeSlug?: string | null
	children: ReactNode
}

export function CompareLayout({ title, description, activeSlug, children }: CompareLayoutProps) {
	return (
		<Page>
			<PageContent className="max-w-6xl">
				<PageHeader>
					<a href="/" className="text-sm text-accent hover:underline">
						← Back to app
					</a>
					<PageTitle className="mt-2">{title}</PageTitle>
					{description ? <PageDescription>{description}</PageDescription> : null}
				</PageHeader>

				<div className="flex flex-col gap-8 sm:flex-row">
					<aside className="sm:w-56 sm:flex-shrink-0">
						<CompareSidebar activeSlug={activeSlug} />
					</aside>
					<main className="min-w-0 flex-1">{children}</main>
				</div>
			</PageContent>
		</Page>
	)
}
