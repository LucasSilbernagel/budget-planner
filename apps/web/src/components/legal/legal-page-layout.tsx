import type { ReactNode } from 'react'

export interface LegalPageLayoutProps {
	title: string
	description?: string
	children: ReactNode
}

export function LegalPageLayout({ title, description, children }: LegalPageLayoutProps) {
	return (
		<div className="min-h-screen surface-sunken p-4 sm:p-8">
			<div className="mx-auto max-w-3xl">
				<header className="mb-8">
					<a href="/" className="text-sm text-accent hover:underline">
						← Back to app
					</a>
					<h1 className="mt-2 text-3xl font-bold text-heading">{title}</h1>
					{description ? <p className="mt-2 text-body">{description}</p> : null}
				</header>

				<main>
					<section className="rounded-lg surface p-6 shadow-md">{children}</section>
				</main>
			</div>
		</div>
	)
}
