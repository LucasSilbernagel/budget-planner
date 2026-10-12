import { COMPARE_PAGES, COMPARE_ROW_IDS, TRADEMARK_LINE } from '../../content/compare'

export const HUB_TITLE = 'Budget planner without bank sync'

export const HUB_DESCRIPTION =
	'How Longhand Budget compares with a spreadsheet and with Actual Budget, with every competitor figure dated and linked to its source.'

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
					Every comparison uses the same {COMPARE_ROW_IDS.length} rows in the same order, from price
					and bank sync to where your data lives and who else can see it. Every competitor figure
					links to its source and carries the date we last checked it. Each page says where the
					other tool is better before it says where Longhand Budget is better.
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
				<p className="mt-6 text-xs text-muted">{TRADEMARK_LINE}</p>
			</section>
		</div>
	)
}
