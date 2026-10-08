import { DOC_PAGES } from '../../content/docs'

export function DocsIndex() {
	return (
		<section className="rounded-lg surface p-6 shadow-md">
			<h2 className="mb-4 text-xl font-semibold text-subheading">Documentation index</h2>
			<ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
				{DOC_PAGES.map((page) => (
					<li key={page.slug}>
						{/* .surface-interactive has its own hover; a hover:surface-inset here would be a silent no-op. */}
						<a
							href={`/docs/${page.slug}`}
							className="block h-full rounded-lg surface-interactive p-4 transition-colors"
						>
							<h3 className="font-medium text-accent">{page.title}</h3>
							<p className="mt-1 text-sm text-body">{page.description}</p>
						</a>
					</li>
				))}
			</ul>
		</section>
	)
}
