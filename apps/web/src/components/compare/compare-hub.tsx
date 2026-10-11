import { COMPARE_PAGES } from '../../content/compare'

export const HUB_TITLE = 'Budget planner without bank sync'

export const HUB_DESCRIPTION =
	'How Longhand Budget compares with YNAB, Monarch, spreadsheets and the other ways people budget, with every competitor fact dated and sourced.'

export function CompareHub() {
	return (
		<div className="space-y-6">
			<section className="rounded-lg surface p-6 shadow-md">
				<p className="text-body">
					Longhand Budget plans your money from the figures you enter yourself: income, bills,
					savings, debts and what you own. It never connects to a bank and it does not track
					individual purchases. The free tier is private by construction, because it runs entirely
					in your browser. Premium sync keeps your plan EU-hosted, on servers in Germany.
				</p>
				<h2 className="mt-6 mb-2 text-xl font-semibold text-subheading">How we compare</h2>
				<p className="text-body">
					Every comparison uses the same rows, in the same order: price, free tier, bank sync,
					whether the tool tracks transactions, platforms, where your data lives, who else sees it,
					forecasting, separate budgets, sharing, export, and ads or AI. Each competitor fact links
					to the competitor's own page and carries the date we last checked it. Where the other tool
					is better, the page says so first.
				</p>
			</section>

			<section className="rounded-lg surface p-6 shadow-md">
				<h2 className="mb-4 text-xl font-semibold text-subheading">Comparisons</h2>
				<ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{COMPARE_PAGES.map((page) => (
						<li key={page.slug}>
							{/* .surface-interactive has its own hover; a hover:surface-inset here would be a silent no-op. */}
							<a
								href={`/compare/${page.slug}`}
								className="block h-full rounded-lg surface-interactive p-4 transition-colors"
							>
								<h3 className="font-medium text-accent">{page.title}</h3>
								<p className="mt-1 text-sm text-body">{page.description}</p>
							</a>
						</li>
					))}
				</ul>
			</section>
		</div>
	)
}
