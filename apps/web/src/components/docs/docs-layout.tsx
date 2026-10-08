import type { ReactNode } from 'react'
import { DocsSidebar } from './sidebar'

export interface DocsLayoutProps {
	title: string
	description?: string
	activeSlug?: string
	children: ReactNode
}

export function DocsLayout({ title, description, activeSlug, children }: DocsLayoutProps) {
	return (
		<div className="min-h-screen surface-sunken p-4 sm:p-8">
			<div className="mx-auto max-w-6xl">
				<header className="mb-8">
					<a href="/" className="text-sm text-accent hover:underline">
						← Back to app
					</a>
					<h1 className="mt-2 text-3xl font-bold text-heading">{title}</h1>
					{description ? <p className="mt-2 text-body">{description}</p> : null}
				</header>

				<div className="flex flex-col gap-8 sm:flex-row">
					<aside className="sm:w-56 sm:flex-shrink-0">
						<DocsSidebar activeSlug={activeSlug} />
					</aside>
					<main className="min-w-0 flex-1">{children}</main>
				</div>
			</div>
		</div>
	)
}
