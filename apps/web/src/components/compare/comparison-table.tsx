import { COMPARE_ROW_IDS, COMPARE_ROW_LABELS, type ComparePage } from '../../content/compare'
import { RESPONSIVE_WRAPPER_CLASS } from '../ui/ResponsiveTable'

export type ComparisonTableProps = {
	page: ComparePage
}

const CELL_CLASS = 'px-3 py-2 align-top text-sm text-body'

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1)
}

export function ComparisonTable({ page }: ComparisonTableProps) {
	return (
		<div className={RESPONSIVE_WRAPPER_CLASS}>
			<table className="min-w-full border-collapse text-left">
				<caption className="sr-only">Longhand Budget compared with {page.competitorName}</caption>
				<thead className="surface-inset">
					<tr>
						<th
							scope="col"
							className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
						>
							Feature
						</th>
						<th
							scope="col"
							className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
						>
							Longhand Budget
						</th>
						<th
							scope="col"
							className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
						>
							{capitalise(page.competitorName)}
						</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
					{COMPARE_ROW_IDS.map((id) => {
						const cell = page.rows[id]
						return (
							<tr key={id}>
								<th scope="row" className="px-3 py-2 align-top text-sm font-medium text-subheading">
									{COMPARE_ROW_LABELS[id]}
								</th>
								<td className={CELL_CLASS}>{cell.longhand}</td>
								<td className={CELL_CLASS}>
									{cell.competitor}
									{cell.source ? (
										<>
											{' '}
											<a
												href={cell.source}
												target="_blank"
												rel="noopener noreferrer"
												className="text-xs text-accent underline"
												aria-label={`Source for ${COMPARE_ROW_LABELS[id]} (opens in a new tab)`}
											>
												source
											</a>
										</>
									) : null}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}
